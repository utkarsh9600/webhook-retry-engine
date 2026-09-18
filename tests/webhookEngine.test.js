'use strict';

const { DeliveryEngine, STATES } = require('../src/deliveryEngine');
const { RetryPolicy } = require('../src/retryPolicy');

// Fake client lets us script exact outcomes per attempt without any real
// HTTP calls, so these tests are fast and deterministic.
function makeScriptedClient(script) {
  let calls = 0;
  return {
    calls: () => calls,
    async send() {
      const outcome = script[calls] || script[script.length - 1];
      calls += 1;
      return outcome;
    },
  };
}

// Runs the callback on the next microtask instead of a real timer, so
// retry tests don't depend on arbitrary sleep timing.
function immediateScheduler(fn) {
  Promise.resolve().then(fn);
}

function waitForSettled(engine, eventId) {
  return new Promise((resolve) => {
    engine._onSettled = (id) => {
      if (id === eventId) resolve();
    };
  });
}

describe('DeliveryEngine', () => {
  test('AC1: successful delivery is marked successful with one recorded attempt', async () => {
    const client = makeScriptedClient([{ ok: true, statusCode: 200 }]);
    const engine = new DeliveryEngine({ client, scheduler: immediateScheduler });

    const settled = waitForSettled(engine, 'evt_1');
    engine.submit({ eventId: 'evt_1', webhookUrl: 'http://fake/webhook', type: 'incident.created' });
    await settled;

    const record = engine.get('evt_1');
    expect(record.state).toBe(STATES.SUCCEEDED);
    expect(record.attempts).toHaveLength(1);
    expect(record.attempts[0].outcome).toBe('success');
  });

  test('AC2: temporary failure is retried and eventually succeeds', async () => {
    const client = makeScriptedClient([
      { ok: false, statusCode: 503 },
      { ok: true, statusCode: 200 },
    ]);
    const engine = new DeliveryEngine({
      client,
      scheduler: immediateScheduler,
      retryPolicy: new RetryPolicy({ maxAttempts: 5, baseDelayMs: 1 }),
    });

    const settled = waitForSettled(engine, 'evt_2');
    engine.submit({ eventId: 'evt_2', webhookUrl: 'http://fake/webhook' });
    await settled;

    const record = engine.get('evt_2');
    expect(record.state).toBe(STATES.SUCCEEDED);
    expect(record.attempts).toHaveLength(2);
    expect(record.attempts[0].outcome).toBe('failure');
    expect(record.attempts[1].outcome).toBe('success');
  });

  test('AC3: bounded failure stops after the attempt limit with a final failed state', async () => {
    const client = makeScriptedClient([{ ok: false, statusCode: 502 }]); // always fails
    const engine = new DeliveryEngine({
      client,
      scheduler: immediateScheduler,
      retryPolicy: new RetryPolicy({ maxAttempts: 3, baseDelayMs: 1 }),
    });

    const settled = waitForSettled(engine, 'evt_3');
    engine.submit({ eventId: 'evt_3', webhookUrl: 'http://fake/webhook' });
    await settled;

    const record = engine.get('evt_3');
    expect(record.state).toBe(STATES.FAILED);
    expect(record.attempts).toHaveLength(3);
    expect(record.terminalReason).toBe('attempts_exhausted');
  });

  test('AC4: repeated submission with the same eventId is idempotent', async () => {
    const client = makeScriptedClient([{ ok: true, statusCode: 200 }]);
    const engine = new DeliveryEngine({ client, scheduler: immediateScheduler });

    const settled = waitForSettled(engine, 'evt_4');
    const first = engine.submit({ eventId: 'evt_4', webhookUrl: 'http://fake/webhook' });
    await settled;

    const second = engine.submit({ eventId: 'evt_4', webhookUrl: 'http://fake/webhook' });

    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(second.record).toBe(first.record);
    expect(client.calls()).toBe(1); // no second delivery was ever scheduled
  });

  test('AC5: current state and ordered attempt history are inspectable', async () => {
    const client = makeScriptedClient([
      { ok: false, statusCode: 500 },
      { ok: false, statusCode: 500 },
      { ok: true, statusCode: 200 },
    ]);
    const engine = new DeliveryEngine({
      client,
      scheduler: immediateScheduler,
      retryPolicy: new RetryPolicy({ maxAttempts: 5, baseDelayMs: 1 }),
    });

    const settled = waitForSettled(engine, 'evt_5');
    engine.submit({ eventId: 'evt_5', webhookUrl: 'http://fake/webhook' });
    await settled;

    const record = engine.get('evt_5');
    expect(record.state).toBe(STATES.SUCCEEDED);
    expect(record.attempts.map((a) => a.attemptNumber)).toEqual([1, 2, 3]);
  });

  test('a non-retryable 4xx response fails immediately without burning the retry budget', async () => {
    const client = makeScriptedClient([{ ok: false, statusCode: 400 }]);
    const engine = new DeliveryEngine({
      client,
      scheduler: immediateScheduler,
      retryPolicy: new RetryPolicy({ maxAttempts: 5, baseDelayMs: 1 }),
    });

    const settled = waitForSettled(engine, 'evt_6');
    engine.submit({ eventId: 'evt_6', webhookUrl: 'http://fake/webhook' });
    await settled;

    const record = engine.get('evt_6');
    expect(record.state).toBe(STATES.FAILED);
    expect(record.attempts).toHaveLength(1);
    expect(record.terminalReason).toBe('non_retryable_response');
  });
});
