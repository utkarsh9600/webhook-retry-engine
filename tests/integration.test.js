'use strict';

const { createTestReceiver } = require('../src/testReceiver');
const { DeliveryEngine } = require('../src/deliveryEngine');
const { HttpDeliveryClient } = require('../src/deliveryClient');
const { RetryPolicy } = require('../src/retryPolicy');

function waitForSettled(engine, eventId) {
  return new Promise((resolve) => {
    engine._onSettled = (id) => {
      if (id === eventId) resolve();
    };
  });
}

describe('Integration: real HTTP delivery against a local receiver', () => {
  let server;

  afterEach((done) => {
    if (server) server.close(done);
    else done();
  });

  test('delivers over real HTTP and retries a transient failure until it succeeds', async () => {
    const { app } = createTestReceiver({ failuresBeforeSuccess: 1, failureStatus: 503 });
    server = app.listen(0);
    const { port } = server.address();

    const engine = new DeliveryEngine({
      client: new HttpDeliveryClient({ timeoutMs: 2000 }),
      // Small but real delays — the test waits on the settled event, not a
      // fixed sleep, so this still isn't timing-dependent.
      retryPolicy: new RetryPolicy({ maxAttempts: 5, baseDelayMs: 10, maxDelayMs: 50 }),
    });

    const settled = waitForSettled(engine, 'evt_int_1');
    engine.submit({
      eventId: 'evt_int_1',
      webhookUrl: `http://127.0.0.1:${port}/webhook`,
      type: 'incident.created',
      payload: { incidentId: 'inc_456', severity: 'high' },
    });
    await settled;

    const record = engine.get('evt_int_1');
    expect(record.state).toBe('SUCCEEDED');
    expect(record.attempts.map((a) => a.outcome)).toEqual(['failure', 'success']);
  }, 10000);
});
