'use strict';

const { createTestReceiver } = require('../src/testReceiver');
const { DeliveryEngine } = require('../src/deliveryEngine');
const { HttpDeliveryClient } = require('../src/deliveryClient');
const { RetryPolicy } = require('../src/retryPolicy');

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  // 1. Start a local test receiver that fails twice, then succeeds.
  const { app, received } = createTestReceiver({ failuresBeforeSuccess: 2, failureStatus: 503 });
  const server = app.listen(0);
  const { port } = server.address();
  console.log(`Test receiver listening on http://127.0.0.1:${port}/webhook`);

  const engine = new DeliveryEngine({
    client: new HttpDeliveryClient(),
    retryPolicy: new RetryPolicy({ maxAttempts: 5, baseDelayMs: 300, maxDelayMs: 2000 }),
  });

  console.log('\n--- Submitting evt_demo_1 (receiver will fail twice, then succeed) ---');
  engine.submit({
    eventId: 'evt_demo_1',
    webhookUrl: `http://127.0.0.1:${port}/webhook`,
    type: 'incident.created',
    payload: { incidentId: 'inc_456', severity: 'high' },
  });

  await wait(3000);
  console.log('State after retries:', JSON.stringify(engine.get('evt_demo_1'), null, 2));

  console.log('\n--- Resubmitting evt_demo_1 (should be deduplicated) ---');
  const result = engine.submit({
    eventId: 'evt_demo_1',
    webhookUrl: `http://127.0.0.1:${port}/webhook`,
    type: 'incident.created',
    payload: { incidentId: 'inc_456', severity: 'high' },
  });
  console.log('deduplicated:', result.deduplicated);
  console.log('Total webhook calls actually received by the receiver:', received.length);

  server.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
