// -----------------------------------------------------------------------------
// End to end over real HTTP: the integration, with the real `fetch` of Node,
// against the fake app server listening on 127.0.0.1 (loopback only, nothing
// leaves the machine). The address typed in the configuration is the one of
// the fake server, exactly as a user would type the phone's.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../src/app.js';
import { Store } from '../src/store.js';
import { FakeSmsGate, NUMBER_1, NUMBER_2, PASSWORD, USERNAME } from './helpers/world.js';

test('configure, add the device, send, follow, receive: through real HTTP', async (t) => {
  const server = new FakeSmsGate({ kind: 'local' });
  const origin = await server.listen();
  t.after(() => server.close());
  const gladys = createFakeGladys({
    config: {
      mode: 'local',
      local_address: origin.replace('http://', ''),
      username: USERNAME,
      password: PASSWORD,
      language: 'fr',
    },
  });
  const app = registerHandlers(gladys, {
    store: new Store(mkdtempSync(join(tmpdir(), 'gladys-sms-e2e-'))),
    timers: false,
  });
  t.after(() => app.stop());
  await gladys.connect();
  await app.ready;

  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.name, 'Passerelle SMS samsung/a52qnsxx');
  await gladys.fake.deviceCreated(device);

  const ack = await gladys.fake.sceneAction('send_sms', {
    phone_numbers: `${NUMBER_1}, ${NUMBER_2}`,
    message: 'Fuite d’eau détectée dans la buanderie 💧',
    sim_number: '1',
  });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(server.sentTexts(), ['Fuite d’eau détectée dans la buanderie 💧']);

  server.setState(ack.data.outputs.message_id, 'Delivered');
  server.receive({ sender: NUMBER_2, text: 'Bien reçu', at: Date.now() });
  await app.hub.refresh({ force: true });

  const sent = device.features.find((f) => f.external_id.endsWith(':sms_sent')).external_id;
  assert.equal(gladys.fake.lastState(sent), 2);
  assert.deepEqual(
    gladys.fake.sceneEvents.map((event) => [event.key, event.data.message]),
    [['sms_received', 'Bien reçu']],
  );
  const report = await gladys.fake.action('recent_messages', {});
  assert.match(report.data.message.fr, /••12, ••34 · Délivré/);
});
