'use strict';

const { EventStore } = require('./store');
const { RetryPolicy } = require('./retryPolicy');

const STATES = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
};

class DeliveryEngine {
  /**
   * @param {object} opts
   * @param {object} opts.client - { async send(url, event) -> {ok, statusCode, networkError} }
   * @param {RetryPolicy} [opts.retryPolicy]
   * @param {EventStore} [opts.store]
   * @param {function} [opts.scheduler] - (fn, delayMs) => void. Defaults to setTimeout.
   *   Unit tests inject a scheduler that runs the callback on the next
   *   microtask instead of a real timer, so retry behavior can be asserted
   *   quickly and deterministically without depending on arbitrary sleeps.
   */
  constructor({ client, retryPolicy, store, scheduler } = {}) {
    if (!client) throw new Error('DeliveryEngine requires a delivery client');
    this.client = client;
    this.retryPolicy = retryPolicy || new RetryPolicy();
    this.store = store || new EventStore();
    this.scheduler = scheduler || ((fn, delayMs) => setTimeout(fn, delayMs));
    this._onSettled = null; // optional hook (tests/demo): called after an event reaches a terminal state
  }

  /**
   * Submit an event for delivery. Idempotent: resubmitting the same
   * eventId returns the existing record and does not schedule a second
   * delivery.
   */
  submit({ eventId, webhookUrl, ...eventFields }) {
    if (!eventId) throw new Error('eventId is required');
    if (!webhookUrl) throw new Error('webhookUrl is required');

    const { record, created } = this.store.getOrCreate(eventId, () => ({
      eventId,
      webhookUrl,
      event: { eventId, ...eventFields },
      state: STATES.PENDING,
      attempts: [],
      createdAt: new Date().toISOString(),
    }));

    if (created) {
      this._scheduleAttempt(eventId, 1, 0);
    }

    return { record, deduplicated: !created };
  }

  get(eventId) {
    return this.store.get(eventId);
  }

  list() {
    return this.store.all();
  }

  _scheduleAttempt(eventId, attemptNumber, delayMs) {
    this.scheduler(() => this._executeAttempt(eventId, attemptNumber), delayMs);
  }

  async _executeAttempt(eventId, attemptNumber) {
    const record = this.store.get(eventId);
    if (!record) return; // defensive; should not happen
    if (record.state === STATES.SUCCEEDED || record.state === STATES.FAILED) return;

    record.state = STATES.IN_PROGRESS;
    const startedAt = new Date().toISOString();

    const result = await this.client.send(record.webhookUrl, record.event);
    const finishedAt = new Date().toISOString();

    const attempt = {
      attemptNumber,
      startedAt,
      finishedAt,
      statusCode: result.statusCode ?? null,
      outcome: result.ok ? 'success' : 'failure',
      networkError: !!result.networkError,
      error: result.error || null,
    };
    record.attempts.push(attempt);

    if (result.ok) {
      record.state = STATES.SUCCEEDED;
      this._settled(eventId);
      return;
    }

    const retryable = this.retryPolicy.isRetryable(result);
    const hasAttemptsLeft = this.retryPolicy.hasAttemptsLeft(attemptNumber);

    if (retryable && hasAttemptsLeft) {
      record.state = STATES.PENDING;
      const delay = this.retryPolicy.nextDelayMs(attemptNumber);
      record.nextRetryAt = new Date(Date.now() + delay).toISOString();
      this._scheduleAttempt(eventId, attemptNumber + 1, delay);
    } else {
      record.state = STATES.FAILED;
      record.terminalReason = retryable ? 'attempts_exhausted' : 'non_retryable_response';
      this._settled(eventId);
    }
  }

  _settled(eventId) {
    if (this._onSettled) this._onSettled(eventId);
  }
}

module.exports = { DeliveryEngine, STATES };
