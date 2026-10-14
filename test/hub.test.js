// -----------------------------------------------------------------------------
// The hub, end to end against the fake API: sending under the hourly limit,
// following the messages until delivered or failed, reading the inbox for the
// "SMS received" trigger, the cloud phones, and what the user sees when
// something is wrong.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TRIGGERS } from '../src/hub.js';
import {
  FakeSmsGate,
  NUMBER_1,
  NUMBER_2,
  cloudConfig,
  createAll,
  createClock,
  createWorld,
  deviceId,
  featureId,
  localConfig,
} from './helpers/world.js';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const send = (w, fields) => w.fake.sceneAction('send_sms', fields);
const posts = (server) => server.requests.filter((r) => r.method === 'POST');
const phone = (w) => w.server.phoneId;

// --- Sending ---------------------------------------------------------------------

test('a scene sends an SMS: numbers, text and SIM reach the app, outputs come back', async (t) => {
  const w = await world(t);
  const ack = await send(w, {
    phone_numbers: '+33 6 39 98 00 12; 0033639980034',
    message: 'Alarm: front door opened',
    sim_number: '2',
    device: '',
  });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(Object.keys(ack.data.outputs).sort(), ['message_id', 'recipients', 'state']);
  assert.equal(ack.data.outputs.recipients, 2);
  assert.equal(ack.data.outputs.state, 'pending');
  const [request] = posts(w.server);
  assert.deepEqual(request.body, {
    textMessage: { text: 'Alarm: front door opened' },
    phoneNumbers: [NUMBER_1, NUMBER_2],
    withDeliveryReport: true,
    simNumber: 2,
  });
  assert.deepEqual(w.fake.widgetRefreshes.slice(-1), ['sms_gateway']);
});

test('the default SIM sends no simNumber; a chosen phone is ignored in local mode', async (t) => {
  const w = await world(t);
  await send(w, {
    phone_numbers: NUMBER_1,
    message: 'x',
    sim_number: 'default',
    device: deviceId(w.gladys, phone(w)),
  });
  const [request] = posts(w.server);
  assert.equal(request.body.simNumber, undefined);
  assert.equal(request.body.deviceId, undefined);
});

test('a send is refused before reaching the phone when it cannot be right', async (t) => {
  const w = await world(t);
  const cases = [
    [
      { phone_numbers: '0639980012', message: 'x' },
      /"0639…12" is not a number in the international format/,
    ],
    [{ phone_numbers: ' , ', message: 'x' }, /No recipient/],
    [{ phone_numbers: NUMBER_1, message: '   ' }, /The message is empty/],
    [{ phone_numbers: NUMBER_1, message: 'x'.repeat(1601) }, /longer than 1600 characters/],
    [
      {
        phone_numbers: Array.from({ length: 11 }, (_, i) => `+3363998001${i}`).join(','),
        message: 'x',
      },
      /10 recipients at most/,
    ],
    [
      { phone_numbers: NUMBER_1, message: 'x', device: 'ext:test-integration:phone:unknown' },
      /no longer known to the gateway/,
    ],
  ];
  for (const [fields, expected] of cases) {
    const ack = await send(w, fields);
    assert.equal(ack.success, false);
    assert.match(ack.error, expected);
  }
  assert.equal(posts(w.server).length, 0, 'nothing sent');
});

test('errors speak the language of the configuration', async (t) => {
  const w = await world(t, { config: localConfig({ language: 'fr' }) });
  const ack = await send(w, { phone_numbers: '06', message: 'x' });
  assert.match(ack.error, /« 06 » n'est pas un numéro au format international/);
});

test('the hourly limit refuses the 21st SMS, says when the next one fits, and survives a restart', async (t) => {
  const clock = createClock();
  const dataDir = mkdtempSync(join(tmpdir(), 'gladys-sms-'));
  const w = await world(t, { clock, dataDir });
  for (let i = 0; i < 10; i += 1) {
    const ack = await send(w, { phone_numbers: `${NUMBER_1},${NUMBER_2}`, message: `#${i}` });
    assert.equal(ack.success, true, ack.error);
    clock.advance(60_000);
  }
  const refused = await send(w, { phone_numbers: NUMBER_1, message: 'one too many' });
  assert.equal(refused.success, false);
  assert.match(
    refused.error,
    /Limit of 20 SMS per hour reached: SMS not sent\. Next one possible at 09:00/,
  );
  assert.equal(posts(w.server).length, 10);

  // Restarted: the window is read back from /data.
  await w.app.stop();
  const again = await world(t, { clock, dataDir, server: w.server });
  const still = await send(again, { phone_numbers: NUMBER_1, message: 'after restart' });
  assert.equal(still.success, false);
  clock.advance(60 * 60_000);
  const later = await send(again, { phone_numbers: NUMBER_1, message: 'an hour later' });
  assert.equal(later.success, true, later.error);
});

test('a message bigger than the limit is refused, a lower limit applies at once', async (t) => {
  const w = await world(t, { config: localConfig({ max_sms_per_hour: 2 }) });
  const ack = await send(w, {
    phone_numbers: `${NUMBER_1},${NUMBER_2},+447700900123`,
    message: 'x',
  });
  assert.match(ack.error, /needs more SMS than the limit of 2 per hour/);
  await w.fake.configUpdated(localConfig({ max_sms_per_hour: 5 }));
  assert.equal(
    (await send(w, { phone_numbers: `${NUMBER_1},${NUMBER_2},+447700900123`, message: 'x' }))
      .success,
    true,
  );
});

test('a phone that does not answer: the send fails clearly and does not count', async (t) => {
  const w = await world(t);
  w.server.online = false;
  const ack = await send(w, { phone_numbers: NUMBER_1, message: 'x' });
  assert.equal(ack.success, false);
  assert.match(ack.error, /SMS not sent: no answer: is the phone on, the app started/);
  assert.deepEqual(w.hub.usage(), { used: 0, limit: 20 });
});

test('the app refuses the request: its reason is shown', async (t) => {
  const w = await world(t);
  w.server.failNextSend = 503;
  const queue = await send(w, { phone_numbers: NUMBER_1, message: 'x' });
  assert.match(queue.error, /the phone is offline or its sending queue is full/);
  const original = w.server.send.bind(w.server);
  w.server.send = () => ({
    status: 400,
    body: JSON.stringify({ message: 'invalid phone number' }),
  });
  const refused = await send(w, { phone_numbers: NUMBER_1, message: 'x' });
  assert.match(refused.error, /request refused by the app \(HTTP 400: invalid phone number\)/);
  w.server.send = original;
});

test('not configured: the scene action says so', async (t) => {
  const w = await world(t, { config: { mode: 'local', language: 'en' } });
  const ack = await send(w, { phone_numbers: NUMBER_1, message: 'x' });
  assert.match(ack.error, /not configured yet/);
});

// --- Following the messages --------------------------------------------------------

test('a delivered message counts as sent; a failed one fires "SMS failed" once', async (t) => {
  const w = await world(t);
  await createAll(w);
  const ok = await send(w, { phone_numbers: `${NUMBER_1},${NUMBER_2}`, message: 'ok' });
  const ko = await send(w, { phone_numbers: '+447700900123', message: 'ko' });
  w.server.setState(ok.data.outputs.message_id, 'Delivered');
  w.server.setState(ko.data.outputs.message_id, 'Failed', 'RESULT_ERROR_NO_SERVICE');
  await w.hub.refresh({ force: true });
  await w.hub.refresh({ force: true });

  const sent = featureId(w.gladys, phone(w), 'sms_sent');
  const failed = featureId(w.gladys, phone(w), 'sms_failed');
  assert.equal(w.fake.lastState(sent), 2);
  assert.equal(w.fake.lastState(failed), 1);
  const events = w.fake.sceneEvents.filter((e) => e.key === TRIGGERS.FAILED);
  assert.deepEqual(events, [
    {
      key: 'sms_failed',
      data: {
        device: deviceId(w.gladys, phone(w)),
        message_id: ko.data.outputs.message_id,
        recipients: '+447700900123',
        error: 'RESULT_ERROR_NO_SERVICE',
      },
    },
  ]);
  // Final states are not read again.
  const reads = () => w.server.requests.filter((r) => r.path?.startsWith('/message/')).length;
  const before = reads();
  await w.hub.refresh({ force: true });
  assert.equal(reads(), before);
});

test('one recipient fails, the other is delivered: both counted, one event', async (t) => {
  const w = await world(t);
  const ack = await send(w, { phone_numbers: `${NUMBER_1},${NUMBER_2}`, message: 'x' });
  const id = ack.data.outputs.message_id;
  w.server.setRecipientState(id, NUMBER_1, 'Sent');
  await w.hub.refresh({ force: true });
  w.server.setRecipientState(id, NUMBER_1, 'Delivered');
  w.server.setRecipientState(id, NUMBER_2, 'Failed', 'RESULT_ERROR_RADIO_OFF');
  await w.hub.refresh({ force: true });
  assert.deepEqual(w.hub.saved.counters[phone(w)], { sent: 1, failed: 1, received: 0 });
  const events = w.fake.sceneEvents.filter((e) => e.key === TRIGGERS.FAILED);
  assert.equal(events.length, 1);
  assert.equal(events[0].data.recipients, NUMBER_2);
});

test('a message purged by the app, or older than a day, is no longer followed', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  const purged = await send(w, { phone_numbers: NUMBER_1, message: 'x' });
  w.server.messages.delete(purged.data.outputs.message_id);
  const stale = await send(w, { phone_numbers: NUMBER_2, message: 'y' });
  await w.hub.refresh({ force: true });
  assert.equal(w.hub.saved.tracked[0].final, true);
  w.server.setState(stale.data.outputs.message_id, 'Sent'); // no delivery report ever
  clock.advance(25 * 60 * 60_000);
  await w.hub.refresh({ force: true });
  assert.ok(w.hub.saved.tracked.every((message) => message.final));
  assert.equal(w.hub.saved.tracked[1].status, 'pending', 'left as last read');
});

// --- Received SMS ------------------------------------------------------------------

test('SMS received: the ones already there are not news, each new one fires once', async (t) => {
  const clock = createClock();
  const server = new FakeSmsGate({ kind: 'local', now: clock.now });
  server.receive({ sender: NUMBER_2, text: 'old news', at: clock.now() - 10 * 60_000 });
  const w = await world(t, { clock, server });
  assert.deepEqual(w.fake.sceneEvents, [], 'the inbox at start is a baseline');

  server.receive({
    sender: NUMBER_2,
    text: 'Alarm off please',
    at: clock.now() - 1000,
    simNumber: 2,
  });
  server.receive({ sender: 'AMELI', text: 'Reimbursement paid', at: clock.now() });
  clock.advance(60_000);
  await w.hub.refresh({ force: true });
  await w.hub.refresh({ force: true });
  assert.deepEqual(
    w.fake.sceneEvents.map((e) => e.data),
    [
      {
        device: deviceId(w.gladys, server.phoneId),
        sender: NUMBER_2,
        message: 'Alarm off please',
        received_at: '2026-10-12T07:59:59.000Z',
        sim_number: 2,
      },
      {
        device: deviceId(w.gladys, server.phoneId),
        sender: 'AMELI',
        message: 'Reimbursement paid',
        received_at: '2026-10-12T08:00:00.000Z',
        sim_number: 1,
      },
    ],
  );
  assert.equal(w.fake.lastState(featureId(w.gladys, server.phoneId, 'sms_received')), 2);
});

test('a restart does not fire the same SMS again; a long one is cut to 1000 characters', async (t) => {
  const clock = createClock();
  const dataDir = mkdtempSync(join(tmpdir(), 'gladys-sms-'));
  const server = new FakeSmsGate({ kind: 'local', now: clock.now });
  const w = await world(t, { clock, server, dataDir });
  server.receive({ sender: NUMBER_1, text: 'é'.repeat(1500), at: clock.now() });
  await w.hub.refresh({ force: true });
  assert.equal(w.fake.sceneEvents.length, 1);
  assert.equal(w.fake.sceneEvents[0].data.message.length, 1000);
  await w.app.stop();

  const again = await world(t, { clock, server, dataDir });
  clock.advance(60_000);
  await again.hub.refresh({ force: true });
  assert.equal(again.fake.sceneEvents.length, 0);
});

test('an app without inbox: said once, asked again an hour later', async (t) => {
  const clock = createClock();
  const server = new FakeSmsGate({ kind: 'local', now: clock.now });
  server.inboxSupported = false;
  const w = await world(t, { clock, server });
  const inboxReads = () => server.requests.filter((r) => r.path === '/inbox').length;
  assert.equal(inboxReads(), 1);
  assert.equal(w.hub.inbox.supported, false);
  clock.advance(10 * 60_000);
  await w.hub.refresh({ force: true });
  assert.equal(inboxReads(), 1, 'not asked at every cycle');
  assert.equal(w.fake.connectionStatus.connected, true, 'sending still works');
  server.inboxSupported = true;
  clock.advance(60 * 60_000);
  await w.hub.refresh({ force: true });
  assert.equal(inboxReads(), 2);
  assert.equal(w.hub.inbox.supported, true);
});

test('an encrypted SMS is skipped; reading the inbox can be turned off', async (t) => {
  const clock = createClock();
  const server = new FakeSmsGate({ kind: 'local', now: clock.now });
  const w = await world(t, { clock, server });
  server.receive({ sender: NUMBER_1, text: 'b64:AbCd', at: clock.now(), encrypted: true });
  await w.hub.refresh({ force: true });
  assert.deepEqual(w.fake.sceneEvents, []);

  await w.fake.configUpdated(localConfig({ receive_sms: false }));
  const before = server.requests.filter((r) => r.path === '/inbox').length;
  server.receive({ sender: NUMBER_1, text: 'ignored', at: clock.now() });
  await w.hub.refresh({ force: true });
  assert.equal(server.requests.filter((r) => r.path === '/inbox').length, before);
  assert.deepEqual(w.fake.sceneEvents, []);
});

// --- Phones and statuses -------------------------------------------------------------

test('local mode: one device per phone, battery and charging, transport local', async (t) => {
  const w = await world(t);
  const [device] = w.fake.discoveredDevices;
  assert.equal(device.name, 'SMS gateway samsung/a52qnsxx');
  assert.equal(device.external_id, deviceId(w.gladys, phone(w)));
  assert.equal(w.fake.lastState(featureId(w.gladys, phone(w), 'battery')), 23);
  assert.equal(w.fake.lastState(featureId(w.gladys, phone(w), 'charging')), 1);
  assert.equal(w.fake.lastState(featureId(w.gladys, phone(w), 'reachable')), 1);
  assert.deepEqual(w.fake.transports.slice(-1), [
    { device_external_id: device.external_id, transport: 'local' },
  ]);

  w.server.setBattery(81, 0);
  await w.hub.refresh({ force: true });
  assert.equal(w.fake.lastState(featureId(w.gladys, phone(w), 'battery')), 81);
  assert.equal(w.fake.lastState(featureId(w.gladys, phone(w), 'charging')), 0);

  w.server.online = false;
  await w.hub.refresh({ force: true });
  assert.equal(w.fake.lastState(featureId(w.gladys, phone(w), 'reachable')), 0);
  assert.equal(w.fake.transports.at(-1).transport, 'unreachable');
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /no answer/);
});

test('cloud mode: every phone of the account, reachable while in contact with the server', async (t) => {
  const clock = createClock();
  const server = new FakeSmsGate({ kind: 'cloud', now: clock.now });
  server.devices.push({
    id: 'Pz4kXw8yNb2mQs6tRu1vA',
    name: 'Second phone',
    lastSeen: new Date(clock.now() - 2 * 60 * 60_000).toISOString(),
  });
  const w = await world(t, { mode: 'cloud', clock, server });
  const names = w.fake.discoveredDevices.map((d) => d.name).sort();
  assert.deepEqual(names, ['SMS gateway Old Pixel in the hallway', 'SMS gateway Second phone']);
  const features = w.fake.discoveredDevices[0].features.map((f) => f.external_id.split(':').pop());
  assert.deepEqual(features, ['reachable', 'sms_sent', 'sms_failed', 'sms_received'], 'no battery');
  assert.equal(w.fake.lastState(featureId(w.gladys, server.phoneId, 'reachable')), 1);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'Pz4kXw8yNb2mQs6tRu1vA', 'reachable')), 0);
  assert.equal(w.fake.connectionStatus.connected, true);
  assert.match(w.fake.connectionStatus.message.en, /has not contacted it recently/);

  // A send through the second phone, an SMS received on it.
  const ack = await send(w, {
    phone_numbers: NUMBER_1,
    message: 'x',
    device: deviceId(w.gladys, 'Pz4kXw8yNb2mQs6tRu1vA'),
  });
  assert.equal(ack.success, true, ack.error);
  assert.equal(posts(server)[0].body.deviceId, 'Pz4kXw8yNb2mQs6tRu1vA');
  server.receive({
    sender: NUMBER_2,
    text: 'hi',
    at: clock.now(),
    deviceId: 'Pz4kXw8yNb2mQs6tRu1vA',
  });
  await w.hub.refresh({ force: true });
  assert.equal(w.fake.sceneEvents[0].data.device, deviceId(w.gladys, 'Pz4kXw8yNb2mQs6tRu1vA'));
  assert.deepEqual(
    server.requests
      .filter((r) => r.path === '/inbox')
      .map((r) => r.query.deviceId)
      .slice(-2)
      .sort(),
    ['Hn3cVd6sPq1xYt0uJk5wR', 'Pz4kXw8yNb2mQs6tRu1vA'],
  );
});

test('cloud mode: a phone silent longer than the setting becomes unreachable', async (t) => {
  const clock = createClock();
  const server = new FakeSmsGate({ kind: 'cloud', now: clock.now });
  const w = await world(t, {
    mode: 'cloud',
    clock,
    server,
    config: cloudConfig({ offline_after_minutes: '15' }),
  });
  assert.equal(w.fake.lastState(featureId(w.gladys, server.phoneId, 'reachable')), 1);
  clock.advance(16 * 60_000);
  await w.hub.refresh({ force: true });
  assert.equal(w.fake.lastState(featureId(w.gladys, server.phoneId, 'reachable')), 0);
  assert.equal(w.fake.transports.at(-1).transport, 'unreachable');
  server.devices[0].lastSeen = new Date(clock.now()).toISOString();
  await w.hub.refresh({ force: true });
  assert.equal(w.fake.transports.at(-1).transport, 'cloud');
});

test('a private server: the API under the path typed', async (t) => {
  const w = await world(t, { mode: 'private' });
  assert.equal(w.fake.discoveredDevices.length, 1);
  assert.ok(
    w.server.requests.every((r) => r.path !== null),
    'every call under /gateway/3rdparty/v1',
  );
});

test('cloud account without phone, refused password, missing settings: what to do', async (t) => {
  const server = new FakeSmsGate({ kind: 'cloud' });
  server.devices = [];
  const empty = await world(t, { mode: 'cloud', server });
  assert.match(empty.fake.connectionStatus.message.en, /No phone is registered/);

  const wrong = await world(t, { config: localConfig({ password: 'nope' }) });
  assert.deepEqual(wrong.fake.connectionStatus, {
    connected: false,
    message: {
      en: 'username or password refused',
      fr: 'utilisateur ou mot de passe refusé',
      de: 'Benutzername oder Passwort abgelehnt',
      es: 'usuario o contraseña rechazados',
    },
  });

  const blank = await world(t, { config: { mode: 'local', language: 'en' } });
  assert.match(blank.fake.connectionStatus.message.en, /Enter the address of the phone/);
  const typo = await world(t, { config: localConfig({ local_address: 'http://' }) });
  assert.match(typo.fake.connectionStatus.message.en, /Address not understood/);
  const noPassword = await world(t, { config: localConfig({ password: '' }) });
  assert.match(noPassword.fake.connectionStatus.message.en, /username and password shown/);
});

test('a device added in Gladys gets its states again; a heartbeat every 6 hours', async (t) => {
  // The SDK dates the states it published with the real clock: move it too.
  const clock = createClock();
  t.mock.timers.enable({ apis: ['Date'], now: clock.now() });
  const w = await world(t, { clock });
  const battery = featureId(w.gladys, phone(w), 'battery');
  const count = () => w.fake.states.filter((s) => s.device_feature_external_id === battery).length;
  assert.equal(count(), 1);
  await w.hub.refresh({ force: true });
  assert.equal(count(), 1, 'unchanged: not sent again');
  await createAll(w);
  assert.equal(count(), 2, 'sent again once the feature exists');
  clock.advance(6 * 60 * 60_000 + 1);
  t.mock.timers.setTime(clock.now());
  await w.hub.refresh({ force: true });
  assert.equal(count(), 3, 'heartbeat');
});

test('a new language republishes the names; a new address starts afresh', async (t) => {
  const w = await world(t);
  await w.fake.configUpdated(localConfig({ language: 'de' }));
  assert.equal(w.fake.discoveredDevices[0].features[0].name, 'Telefon erreichbar');
  await w.fake.configUpdated(localConfig({ local_address: '192.0.2.99' }));
  assert.equal(w.fake.connectionStatus.connected, false, 'nobody at the new address');
  await w.fake.configUpdated(localConfig());
  assert.equal(w.fake.connectionStatus.connected, true);
});

test('Gladys asks to poll: answered from the timer, not read twice in a row', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  const reads = () => w.server.requests.filter((r) => r.path === '/device').length;
  const before = reads();
  const [device] = w.fake.discoveredDevices;
  await w.fake.poll(device);
  assert.equal(reads(), before, 'just refreshed');
  clock.advance(60_000);
  await w.fake.poll(device);
  assert.equal(reads(), before + 1);
});

test('a scan request reads the phone and publishes the devices again', async (t) => {
  const w = await world(t);
  const published = () => w.fake.requests.filter((r) => r.path === '/discovered_device').length;
  const reads = () => w.server.requests.filter((r) => r.path === '/device').length;
  const [before, readsBefore] = [published(), reads()];
  await w.fake.scanRequest();
  assert.equal(published(), before + 1);
  assert.equal(reads(), readsBefore + 1);
});
