# Submission notes

## Decisions

**Which HTTP responses and errors are retryable**
- Network errors (timeout, connection refused, DNS failure — anything with
  no HTTP response at all) are treated as retryable.
- HTTP `408`, `425`, `429`, and any `5xx` are treated as retryable
  (transient — the endpoint or network is temporarily unhealthy).
- Any other `4xx` is treated as non-retryable / terminal: the request
  itself is considered invalid, so retrying it would just reproduce the
  same failure.

**The retry limit and delay/backoff policy**
- Default: 5 attempts total, exponential backoff (`baseDelay * 2^(n-1)`)
  capped at a maximum delay. Defaults are `baseDelayMs=500ms`,
  `maxDelayMs=30s`, both overridable via `MAX_ATTEMPTS` / `BASE_DELAY_MS`
  env vars in the running service, and fully overridable as constructor
  options in tests so retry behavior can be exercised without waiting on
  real wall-clock delays.

**The delivery guarantee provided**
- At-least-once. Exactly-once delivery across an external HTTP boundary
  isn't achievable without a receiver-side transactional handshake this
  service doesn't control, so the guarantee is: an event is attempted until
  it succeeds or the attempt budget is exhausted, and a receiver may still
  observe the same event more than once (e.g. if the receiver processed the
  request but the response was lost before this service saw it as a
  success). Receivers are expected to de-duplicate on `eventId`.

**How concurrent duplicate submissions are handled**
- `EventStore.getOrCreate(eventId, factory)` performs a synchronous
  check-and-set with no `await` in between. Node.js runs synchronous
  JavaScript without interleaving, so two "concurrent" `submit()` calls for
  the same `eventId` within the same process can't both observe "not
  present" — the second always sees the record the first one created and is
  deduplicated, without a second delivery ever being scheduled.

**What information is retained from an attempt**
- Attempt number, start/finish timestamps, outcome (`success`/`failure`),
  HTTP status code (if any), whether it was a network error, and the error
  message if present — kept as an ordered array on the event record so the
  full history is inspectable via `GET /events/:eventId`.

## Questions

**What could still cause a receiver to observe a duplicate delivery?**
If the receiver successfully processes the request but the response never
makes it back (network drop, the receiver crashing right after committing
the work, or this service's own timeout firing just before a slow success
response arrives), this service records that attempt as a failure and
retries — so the receiver ends up processing the same event twice. This is
exactly why the delivery guarantee is at-least-once rather than
exactly-once, and why receivers are expected to de-duplicate on `eventId`.

**How would you operate this with many workers?**
Move the in-memory `EventStore` to a shared datastore (e.g. Postgres or
Redis) with a real atomic operation for `getOrCreate` (`INSERT ... ON
CONFLICT DO NOTHING`, or a `SETNX`-style call), so idempotency holds across
processes and not just within one. Replace the in-process `setTimeout`
scheduler with a durable delayed-job mechanism — a `next_retry_at` column
polled by workers, or a queue with native delay support (e.g. BullMQ, SQS)
— so a scheduled retry survives a process restart. Attempts would also need
a claim/lease step (e.g. `SELECT ... FOR UPDATE SKIP LOCKED`) so two workers
can never execute the same attempt at once.

**How would you prevent one failing endpoint from consuming all capacity?**
Add a per-endpoint concurrency limit or worker pool, plus a circuit
breaker: after N consecutive failures for a given `webhookUrl`, stop
dispatching new attempts to it for a cooldown window (recording those as
"skipped — circuit open" rather than spending a worker slot on an endpoint
that's currently down). That keeps one unhealthy endpoint from starving
delivery capacity for events headed elsewhere.

**What metrics and alerts would you add in production?**
- Metrics: delivery success rate, attempts-per-event (histogram), time to
  final outcome, count of events currently `PENDING`/`IN_PROGRESS` (queue
  depth), retry count broken down by status-code class, failure rate per
  endpoint.
- Alerts: delivery success rate sustained below a threshold, a growing
  backlog of `PENDING` events (the scheduler falling behind), a spike in
  `FAILED` (attempts-exhausted) events, and a per-endpoint circuit breaker
  staying open longer than expected.

## Out of scope (per the brief)

Authentication/multi-tenancy, a management dashboard, multiple subscriber
endpoints, a distributed queue or multi-region deployment, high-volume load
testing, billing/quotas/rate limits, and production secret management were
all deliberately left out, per the problem brief. Request signing, manual
replay, and endpoint health controls were left out as optional/secondary.
