'use strict';

/**
 * Thin wrapper around fetch so the delivery engine never depends directly
 * on the transport. Production uses this; tests inject a fake/scripted
 * client so unit tests don't need real network calls.
 */
class HttpDeliveryClient {
  constructor({ timeoutMs = 5000 } = {}) {
    this.timeoutMs = timeoutMs;
  }

  async send(url, event) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(event),
        signal: controller.signal,
      });
      const ok = res.status >= 200 && res.status < 300;
      return { ok, statusCode: res.status, networkError: false };
    } catch (err) {
      return { ok: false, statusCode: null, networkError: true, error: err.message };
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = { HttpDeliveryClient };
