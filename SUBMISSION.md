# Submission

## Candidate

- Name: Utkarsh Pandey
- Email: pandeyutk239@gmail.com
- GitHub: https://github.com/utkarsh9600
- Selected problem: Webhook Retry Engine
- Demo video: https://drive.google.com/file/d/1Zo-LCOFMOXefuiLIiuKuMOq7k1US10Kg/view?usp=sharing

---

## Run the project

### Prerequisites

- Node.js 18+
- npm

### Install dependencies

npm install

### Start the service

npm start

The service starts the HTTP API.

### Run the demo

npm run demo

The demo starts a local webhook receiver that intentionally fails initially and then succeeds. It submits an event, demonstrates retry and recovery behavior, prints the delivery attempt history, and submits the same event again to demonstrate idempotency.

### API endpoints

#### Create an event

POST /events

Example request:

{
  "eventId": "evt_123",
  "webhookUrl": "http://localhost:3001/webhook",
  "type": "incident.created",
  "occurredAt": "2026-09-15T10:00:00Z",
  "payload": {
    "incidentId": "inc_456",
    "severity": "high"
  }
}

A newly created event returns 202.

If the same eventId is submitted again, the existing event is returned and another delivery is not scheduled.

#### Get an event

GET /events/:eventId

Returns the current state and ordered delivery attempt history.

#### List events

GET /events

Returns all known events.

---

## Run tests

Run the automated test suite with:

npm test

The test suite passes successfully.

---

## Acceptance scenarios and verification

### 1. Successful delivery

An event can be submitted to the service and delivered to the configured webhook endpoint.

The successful delivery behavior can be demonstrated with:

npm run demo

### 2. Failure and recovery

The demo receiver intentionally returns failures for the initial delivery attempts.

The delivery engine identifies the failures as retryable, applies the retry policy, and attempts delivery again.

The demo eventually shows successful delivery after retrying.

### 3. Idempotency

The same eventId is submitted more than once.

The first submission creates the event and schedules its delivery.

A repeated submission with the same eventId returns the existing event and does not schedule another delivery.

### 4. Attempt history

The service retains information about delivery attempts.

The history can be inspected using:

GET /events/:eventId

The attempt history includes the attempt number, timestamps, outcome, HTTP status when available, network-error information, and error message when applicable.

---

## Architecture and data flow

The implementation separates the HTTP API, event state, delivery orchestration, retry policy, and HTTP transport.

High-level flow:

Client
  |
  v
server.js
  |
  v
Event Store
  |
  v
Delivery Engine
  |
  +------> Retry Policy
  |
  v
Delivery Client
  |
  v
Webhook Endpoint

### Components

#### src/server.js

Thin HTTP API layer.

It accepts incoming events and exposes endpoints for creating and inspecting events.

#### src/store.js

In-memory event store.

It maintains event state and ordered delivery attempt history.

It also provides the idempotent getOrCreate operation.

#### src/deliveryEngine.js

Main delivery orchestration layer.

It handles:
- Delivery scheduling
- Webhook execution
- Retry handling
- Attempt tracking
- Idempotency

#### src/retryPolicy.js

Contains retry classification and backoff behavior.

It determines which HTTP responses and network errors should be retried.

#### src/deliveryClient.js

Responsible for HTTP webhook transport.

Keeping transport separate makes the delivery logic easier to test and allows the HTTP implementation to be replaced later.

#### src/testReceiver.js

A configurable local webhook receiver used by the tests and demo to simulate failures and successful recovery.

---

## Technology choices

### Node.js 18+

Node.js provides the runtime for the service and supports the built-in fetch API and AbortController used for HTTP delivery and request timeouts.

### Express

Express is used for the HTTP API while keeping the server layer relatively thin.

### Built-in fetch

The delivery client uses Node's built-in fetch instead of adding another HTTP client dependency.

### In-memory store

An in-memory store was selected to keep the assignment focused on the webhook retry engine rather than database infrastructure.

For a production system, this would be replaced with durable shared storage.

### Jest

Jest is used for focused automated tests of the retry and delivery behavior.

---

## Important decisions

### Retryable HTTP responses and errors

The following failures are treated as retryable:

- Network errors
- Request timeout/network failures
- HTTP 408
- HTTP 425
- HTTP 429
- HTTP 5xx

Other 4xx responses are treated as terminal failures because the request is generally considered invalid and repeating it is unlikely to resolve the problem.

### Retry limit and backoff

The default policy uses:

- Maximum total attempts: 5
- Base delay: 500 ms
- Exponential backoff
- Maximum delay: 30 seconds

The delay can be configured through the supported environment variables and constructor options used by tests.

### Delivery guarantee

The system provides an at-least-once delivery guarantee.

Exactly-once delivery cannot be guaranteed across an external HTTP boundary because the receiver can successfully process a request while the response is lost before the delivery service receives it.

In that situation, the service may classify the attempt as failed and retry it.

Therefore receivers should use eventId to de-duplicate events when necessary.

### Concurrent duplicate submissions

EventStore.getOrCreate(eventId, factory) performs the check-and-create operation synchronously without an await between the check and insertion.

Because JavaScript execution is synchronous within the Node.js process, two submissions for the same eventId cannot both observe that the event is absent before creating it.

This prevents duplicate delivery scheduling within the current single-process implementation.

### Attempt information retained

Each attempt retains:

- Attempt number
- Start timestamp
- Finish timestamp
- Outcome
- HTTP status code when available
- Whether a network error occurred
- Error message when available

The attempts are stored in order on the event record.

---

## Assumptions and limitations

The implementation intentionally focuses on the core webhook retry behavior.

Current limitations include:

- Event state is stored in memory.
- State is lost if the process restarts.
- The implementation is designed for a single process.
- There is no distributed worker coordination.
- There is no durable message queue.
- There is no management dashboard.
- Authentication and multi-tenancy are outside the scope.
- Multiple subscriber endpoint management is outside the scope.
- High-volume load testing is outside the scope.
- Billing, quotas, and rate limits are outside the scope.
- Production secret management is outside the scope.
- Request signing is outside the scope.
- Manual replay is outside the scope.
- Endpoint health controls are outside the scope.

---

## Production and scale

For production deployment, the in-memory event store would need to be replaced with durable shared storage such as PostgreSQL or Redis.

A scalable architecture could look like:

API
 |
 v
Durable Event Store
 |
 v
Durable Queue
 |
 v
Worker Pool
 |
 v
Webhook Endpoints

### Shared idempotency

A database-level atomic operation such as INSERT ... ON CONFLICT DO NOTHING could provide idempotent event creation across multiple processes.

A Redis-based implementation could use an atomic SETNX-style operation.

### Durable retries

The in-process setTimeout approach would be replaced by a durable delayed-job mechanism.

For example:

- A next_retry_at value stored in a database
- A durable queue with delayed jobs
- BullMQ
- Amazon SQS with an appropriate retry/delay design

This would allow scheduled retries to survive process restarts.

### Worker coordination

With multiple workers, each delivery attempt would need a claim or lease mechanism so that two workers cannot process the same attempt simultaneously.

### Endpoint isolation

Per-endpoint concurrency limits and circuit breakers could prevent one unhealthy webhook endpoint from consuming all available worker capacity.

### Observability

Production monitoring should include:

- Delivery success rate
- Attempts per event
- Time to final outcome
- Pending/in-progress event count
- Retry count by status-code class
- Failure rate per endpoint
- Queue/backlog depth

Useful alerts would include:

- Sustained drop in delivery success rate
- Growing pending backlog
- Increase in attempts-exhausted events
- Endpoint-specific failure spikes
- Circuit breakers remaining open for an extended period

---

## Questions and further considerations

### What could still cause a receiver to observe a duplicate delivery?

A receiver can observe a duplicate if it successfully processes a request but the response does not reach the delivery service.

Examples include:

- Network failure after the receiver commits the operation
- Receiver crash after processing but before responding
- Delivery-service timeout while the receiver is still processing

The delivery service may then retry the event.

This is why the system uses an at-least-once model rather than claiming exactly-once delivery.

Receivers should use eventId for de-duplication when duplicate processing would be harmful.

### How would this operate with many workers?

The in-memory store would be replaced with shared durable storage.

The retry scheduler would move from in-process timers to a durable queue or database-backed scheduler.

Workers would use atomic claims or leases so that only one worker processes a particular delivery attempt.

### How would one failing endpoint be prevented from consuming all capacity?

Per-endpoint concurrency limits or worker pools could be used together with a circuit breaker.

After repeated failures from an endpoint, the circuit could temporarily stop new attempts for that endpoint while allowing other endpoints to continue using worker capacity.

### What metrics and alerts would be added in production?

Important metrics include:

- Delivery success rate
- Retry rate
- Attempts per event
- Final outcome latency
- Pending event count
- Failure rate per endpoint
- Retryable failures by HTTP status

Important alerts include:

- Low delivery success rate
- Growing backlog
- High number of exhausted retries
- Sudden endpoint-specific failure rates
- Long-running circuit breakers

---

## AI usage

I used AI tools, including ChatGPT and Claude, during development for implementation assistance, debugging guidance, code review, and explanation of design decisions.

I reviewed the generated suggestions and integrated the relevant changes into the project.

I also verified the implementation by running the automated test suite and the project demo locally.

---

## Credibility note

### Previous product/system

I have worked on a hotel booking application/backend project called Zyvo Rooms.

### Problem

The project was designed around hotel discovery and booking workflows, with backend APIs for users, hotels, bookings, and enquiries.

### Personal contribution

My contribution included backend/API development using Node.js and Express, MongoDB-based data handling, authentication, booking workflows, and payment-related integrations.

### Technical considerations

The project involved multiple backend components and external service integrations, requiring attention to API behavior, database operations, authentication, booking state, and payment-related processing.

### Difficult decision

One important design consideration was keeping API/transport concerns separate from business logic so that backend components could be tested and modified independently.

### Evidence

Relevant project code and work can be shared through my GitHub profile and repositories.

---

## Out of scope

The following were deliberately left out of this focused assignment implementation:

- Authentication
- Multi-tenancy
- Management dashboard
- Multiple subscriber endpoints
- Distributed queue
- Multi-region deployment
- High-volume load testing
- Billing
- Quotas
- Rate limits
- Production secret management
- Request signing
- Manual replay
- Endpoint health controls
