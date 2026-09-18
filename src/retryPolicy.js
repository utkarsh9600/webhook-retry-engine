'use strict';

const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

class RetryPolicy {
  constructor({ maxAttempts = 5, baseDelayMs = 500, maxDelayMs = 30000 } = {}) {
    this.maxAttempts = maxAttempts;
    this.baseDelayMs = baseDelayMs;
    this.maxDelayMs = maxDelayMs;
  }

  /**
   * Decide whether a failed attempt is retryable.
   * - No response at all (network/timeout error) -> retryable.
   * - 408, 425, 429, and any 5xx -> retryable (transient).
   * - Any other 4xx -> not retryable: the request itself is considered
   *   invalid, so retrying it would just reproduce the same failure.
   */
  isRetryable({ statusCode, networkError }) {
    if (networkError) return true;
    if (typeof statusCode !== 'number') return false;
    if (statusCode >= 500) return true;
    return RETRYABLE_STATUS_CODES.has(statusCode);
  }

  hasAttemptsLeft(attemptNumber) {
    return attemptNumber < this.maxAttempts;
  }

  /** Exponential backoff with a cap. Delay before attemptNumber+1 runs. */
  nextDelayMs(attemptNumber) {
    const delay = this.baseDelayMs * Math.pow(2, attemptNumber - 1);
    return Math.min(delay, this.maxDelayMs);
  }
}

module.exports = { RetryPolicy, RETRYABLE_STATUS_CODES };
