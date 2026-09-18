'use strict';

const express = require('express');

/**
 * A tiny local HTTP receiver for tests and demos — no paid service, no
 * external dependency.
 *
 * @param {number} failuresBeforeSuccess - number of transient failures to
 *   return before returning 200.
 * @param {number} failureStatus - status code used for those transient
 *   failures (default 503).
 * @param {boolean} terminalFailure - if true, always returns a
 *   non-retryable 4xx regardless of attempt count.
 */
function createTestReceiver({ failuresBeforeSuccess = 0, failureStatus = 503, terminalFailure = false } = {}) {
  const app = express();
  app.use(express.json());
  let calls = 0;
  const received = [];

  app.post('/webhook', (req, res) => {
    calls += 1;
    received.push({ body: req.body, at: new Date().toISOString() });

    if (terminalFailure) {
      return res.status(400).json({ error: 'bad request (terminal)' });
    }
    if (calls <= failuresBeforeSuccess) {
      return res.status(failureStatus).json({ error: 'temporary failure' });
    }
    return res.status(200).json({ ok: true });
  });

  return { app, received, callCount: () => calls };
}

module.exports = { createTestReceiver };
