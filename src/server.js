'use strict';

const express = require('express');
const { DeliveryEngine } = require('./deliveryEngine');
const { HttpDeliveryClient } = require('./deliveryClient');
const { RetryPolicy } = require('./retryPolicy');

function createApp({ engine } = {}) {
  const app = express();
  app.use(express.json());

  const deliveryEngine =
    engine ||
    new DeliveryEngine({
      client: new HttpDeliveryClient(),
      retryPolicy: new RetryPolicy({
        maxAttempts: Number(process.env.MAX_ATTEMPTS) || 5,
        baseDelayMs: Number(process.env.BASE_DELAY_MS) || 500,
      }),
    });

  // Accept and retain an event, then schedule delivery. Idempotent on eventId.
  app.post('/events', (req, res) => {
    const { eventId, webhookUrl, ...rest } = req.body || {};
    if (!eventId || !webhookUrl) {
      return res.status(400).json({ error: 'eventId and webhookUrl are required' });
    }
    const { record, deduplicated } = deliveryEngine.submit({ eventId, webhookUrl, ...rest });
    res.status(deduplicated ? 200 : 202).json({ deduplicated, event: record });
  });

  // Inspect current state + ordered attempt history for one event.
  app.get('/events/:eventId', (req, res) => {
    const record = deliveryEngine.get(req.params.eventId);
    if (!record) return res.status(404).json({ error: 'not found' });
    res.json(record);
  });

  // List all known events (minimal interface for observability).
  app.get('/events', (req, res) => {
    res.json(deliveryEngine.list());
  });

  app.locals.engine = deliveryEngine;
  return app;
}

if (require.main === module) {
  const app = createApp();
  const port = process.env.PORT || 4000;
  app.listen(port, () => console.log(`Webhook retry engine listening on :${port}`));
}

module.exports = { createApp };
