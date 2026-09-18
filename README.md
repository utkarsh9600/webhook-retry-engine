# Webhook Retry Engine

A small backend service that accepts an event and reliably delivers it to a
single configured webhook endpoint. It records every delivery attempt,
retries transient failures under a bounded policy, and treats repeated
submissions of the same event identifier idempotently.

## Requirements

- Node.js 18+ (uses the built-in `fetch` and `AbortController`)

## Install

```
npm install
```

## Run the service

```
npm start
```

Starts an HTTP API on `PORT` (default `4000`). Retry behavior can be tuned
via `MAX_ATTEMPTS` and `BASE_DELAY_MS`.

### API

**`POST /events`** — accept and schedule delivery of an event

```json
{
  "eventId": "evt_123",
  "webhookUrl": "https://example.com/webhook",
  "type": "incident.created",
  "occurredAt": "2026-09-15T10:00:00Z",
  "payload": { "incidentId": "inc_456", "severity": "high" }
}
```

Returns `202` with the created record, or `200` with the existing record if
`eventId` had already been submitted (idempotent — no second delivery is
scheduled).

**`GET /events/:eventId`** — current state and ordered attempt history

**`GET /events`** — list all known events

## Run the tests

```
npm test
```

- `tests/webhookEngine.test.js` — unit tests against a scripted fake
  transport and a microtask scheduler, so retries run instantly and
  deterministically with no real network calls or arbitrary sleeps. Covers
  successful delivery, a temporary failure followed by a retry, attempt
  exhaustion / terminal failure, idempotent resubmission, and inspectable
  attempt history.
- `tests/integration.test.js` — one end-to-end test against a real local
  HTTP receiver (`src/testReceiver.js`), proving the actual delivery path
  works. No paid service is used.

## Run the demo

```
npm run demo
```

Starts a local receiver that fails twice then succeeds, submits an event and
prints its retry/attempt history, then resubmits the same `eventId` to show
that no second delivery is made.

## Design

- `src/store.js` — in-memory event store; ingestion/state is kept separate
  from delivery logic
- `src/retryPolicy.js` — retry classification, backoff, attempt limits
- `src/deliveryClient.js` — the HTTP transport (swappable; tests use a fake)
- `src/deliveryEngine.js` — orchestration: schedule, execute, retry, idempotency
- `src/server.js` — a thin HTTP API over the engine
- `src/testReceiver.js` — configurable local receiver used by tests and the demo

See `SUBMISSION.md` for the documented design decisions and answers to the
required questions.
