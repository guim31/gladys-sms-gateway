// -----------------------------------------------------------------------------
// The API client and the reading of its answers: the routes of each mode,
// the authentication, the error kinds, and the fixtures rebuilt from the
// sources of the app and the server (test/fixtures/smsgate/README.md).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ERROR_KINDS, SmsGateClient } from '../src/smsgate/client.js';
import {
  STATUS,
  parseDevices,
  parseHealth,
  parseIncoming,
  parseMessageState,
} from '../src/smsgate/model.js';
import { FakeSmsGate, PASSWORD, USERNAME, createNetwork } from './helpers/fakeSmsGate.js';
import { CLOUD_ORIGIN, LOCAL_ORIGIN, NUMBER_1, NUMBER_2, createClock } from './helpers/world.js';

const fixture = async (name) =>
  JSON.parse(await readFile(new URL(`./fixtures/smsgate/${name}.json`, import.meta.url), 'utf8'));

function localClient(server, extra = {}) {
  const network = createNetwork({ [LOCAL_ORIGIN]: server });
  return new SmsGateClient({
    mode: 'local',
    apiUrl: LOCAL_ORIGIN,
    username: USERNAME,
    password: PASSWORD,
    fetch: network.fetch,
    ...extra,
  });
}

test('the health of the phone: battery level, charging flags, version', async () => {
  assert.deepEqual(parseHealth(await fixture('health-local')), {
    battery: 23,
    charging: true, // flags 5 = charging (1) on USB (4)
    version: '1.77.2',
    failedLastHour: 0,
  });
  assert.deepEqual(parseHealth({ checks: { 'battery:charging': { observedValue: 4 } } }), {
    battery: null,
    charging: false, // plugged on USB, not charging (full)
    version: null,
    failedLastHour: null,
  });
  assert.deepEqual(parseHealth(null), {
    battery: null,
    charging: null,
    version: null,
    failedLastHour: null,
  });
});

test('the phones: the local one, the cloud ones without the deleted one', async () => {
  assert.deepEqual(parseDevices(await fixture('device-local')), [
    {
      id: 'Qx7RkT2mWb9aLp4vZc8nE',
      name: 'samsung/a52qnsxx',
      lastSeen: '2026-10-12T08:00:00.000Z',
      simCards: [1, 2],
    },
  ]);
  const cloud = parseDevices(await fixture('devices-cloud'));
  assert.deepEqual(
    cloud.map((phone) => phone.id),
    ['Hn3cVd6sPq1xYt0uJk5wR'],
  );
  assert.deepEqual(parseDevices([{ id: '' }, { name: 'x' }, null, { id: 'abc' }]), [
    { id: 'abc', name: 'abc', lastSeen: null, simCards: [] },
  ]);
  assert.deepEqual(parseDevices({}), []);
});

test('message states: pending, delivered, failed with the reason', async () => {
  const pending = parseMessageState(await fixture('message-pending'));
  assert.equal(pending.status, STATUS.PENDING);
  assert.equal(pending.deviceId, 'Qx7RkT2mWb9aLp4vZc8nE');
  assert.deepEqual(
    pending.recipients.map((r) => r.number),
    [NUMBER_1, '+447700900123'],
  );
  assert.equal(parseMessageState(await fixture('message-delivered')).status, STATUS.DELIVERED);
  const failed = parseMessageState(await fixture('message-failed'));
  assert.equal(failed.status, STATUS.FAILED);
  assert.deepEqual(failed.recipients[1], {
    number: '+447700900123',
    status: STATUS.FAILED,
    error: 'RESULT_ERROR_GENERIC_FAILURE',
  });
  assert.equal(failed.recipients[0].status, STATUS.SENT);
  assert.equal(parseMessageState({ id: 'x', state: 'Processed' }).status, STATUS.PENDING);
  assert.equal(parseMessageState({ id: 'x', state: 'Cancelled' }).status, STATUS.CANCELLED);
  assert.equal(parseMessageState({ state: 'Sent' }), null);
});

test('received messages: sender, text, time, SIM; a broken entry is skipped', async () => {
  const [first, second] = (await fixture('inbox')).map(parseIncoming);
  assert.deepEqual(first, {
    id: 'In2bOxMs9gA7kQ1pZt5vW',
    sender: NUMBER_2,
    text: 'Alarm code ok, I am home in 10 minutes',
    receivedAt: '2026-10-12T07:59:30.000Z',
    simNumber: 1,
    encrypted: false,
  });
  assert.equal(second.sender, 'AMELI');
  assert.equal(parseIncoming({ id: 'x', sender: 'y', createdAt: 'never' }), null);
  assert.equal(parseIncoming({ id: 'x', createdAt: '2026-10-12T07:59:30Z' }), null);
});

test('local mode: /device, /health without credentials, /message', async () => {
  const server = new FakeSmsGate({ kind: 'local', now: createClock().now });
  const client = localClient(server);
  assert.equal((await client.getDevices()).length, 1);
  assert.equal((await client.getHealth()).version, '1.77.2');
  const sent = await client.sendMessage({ phoneNumbers: [NUMBER_1], text: 'Hi', simNumber: 2 });
  assert.equal(sent.state, 'Pending');
  assert.equal((await client.getMessage(sent.id)).id, sent.id);
  assert.deepEqual(
    server.requests.map((r) => `${r.method} ${r.path} ${r.authorized}`),
    ['GET /device true', 'GET /health false', 'POST /message true', `GET /message/${sent.id} true`],
  );
  const body = server.requests[2].body;
  assert.deepEqual(body, {
    textMessage: { text: 'Hi' },
    phoneNumbers: [NUMBER_1],
    withDeliveryReport: true,
    simNumber: 2,
  });
});

test('cloud mode: /devices, /messages with the phone chosen, /inbox per phone', async () => {
  const clock = createClock();
  const server = new FakeSmsGate({ kind: 'cloud', now: clock.now });
  const network = createNetwork({ [CLOUD_ORIGIN]: server });
  const client = new SmsGateClient({
    mode: 'cloud',
    apiUrl: 'https://api.sms-gate.app/3rdparty/v1',
    username: USERNAME,
    password: PASSWORD,
    fetch: network.fetch,
  });
  await client.getDevices();
  await client.sendMessage({ phoneNumbers: [NUMBER_1], text: 'Hi', deviceId: server.phoneId });
  await client.listInbox({ from: new Date(clock.now() - 3_600_000), deviceId: server.phoneId });
  assert.deepEqual(
    server.requests.map((r) => `${r.method} ${r.path}`),
    ['GET /devices', 'POST /messages', 'GET /inbox'],
  );
  assert.equal(server.requests[1].body.deviceId, server.phoneId);
  assert.deepEqual(server.requests[2].query, {
    type: 'SMS',
    from: '2026-10-12T07:00:00.000Z',
    limit: '100',
    offset: '0',
    deviceId: server.phoneId,
  });
});

test('errors carry a kind: unreachable, refused password, refused request, full queue', async () => {
  const server = new FakeSmsGate({ kind: 'local' });
  const kindOf = (promise) =>
    promise.then(
      () => 'resolved',
      (err) => err.kind,
    );

  server.online = false;
  assert.equal(await kindOf(localClient(server).getDevices()), ERROR_KINDS.UNREACHABLE);
  server.online = true;
  assert.equal(
    await kindOf(localClient(server, { password: 'wrong' }).getDevices()),
    ERROR_KINDS.AUTH,
  );
  const client = localClient(server);
  const refused = await client
    .sendMessage({ phoneNumbers: [NUMBER_1, NUMBER_1], text: 'x' })
    .catch((err) => err);
  assert.equal(refused.kind, ERROR_KINDS.REFUSED);
  assert.match(refused.message, /HTTP 400: phoneNumbers: must contain unique values/);
  server.failNextSend = 503;
  assert.equal(
    await kindOf(client.sendMessage({ phoneNumbers: [NUMBER_1], text: 'x' })),
    ERROR_KINDS.QUEUE,
  );
  server.inboxSupported = false;
  assert.equal(await kindOf(client.listInbox({ from: new Date() })), ERROR_KINDS.NOT_FOUND);
  assert.equal(await kindOf(client.getMessage('unknown')), ERROR_KINDS.NOT_FOUND);
});

test('a phone too slow to answer times out, and says the request may have gone', async () => {
  const client = new SmsGateClient({
    mode: 'local',
    apiUrl: LOCAL_ORIGIN,
    username: USERNAME,
    password: PASSWORD,
    timeoutMs: 20,
    fetch: (url, { signal }) =>
      new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason));
      }),
  });
  // The abort timer does not hold the event loop (the SDK's WebSocket does, in
  // production): keep the test alive meanwhile.
  const alive = setTimeout(() => {}, 1000);
  const err = await client.getDevices().catch((error) => error);
  clearTimeout(alive);
  assert.equal(err.kind, ERROR_KINDS.UNREACHABLE);
  assert.equal(err.timedOut, true);
  assert.match(err.message, /TimeoutError/);
});

test('an answer that is not JSON is an unexpected answer, not a crash', async () => {
  const client = new SmsGateClient({
    mode: 'local',
    apiUrl: LOCAL_ORIGIN,
    username: USERNAME,
    password: PASSWORD,
    fetch: async () => new Response('<html>captive portal</html>', { status: 200 }),
  });
  const err = await client.getDevices().catch((error) => error);
  assert.equal(err.kind, ERROR_KINDS.HTTP);
});

test('over real HTTP: the Node fetch against the fake app server', async (t) => {
  const server = new FakeSmsGate({ kind: 'local' });
  const origin = await server.listen();
  t.after(() => server.close());
  const client = new SmsGateClient({
    mode: 'local',
    apiUrl: origin,
    username: USERNAME,
    password: PASSWORD,
  });
  const [phone] = parseDevices(await client.getDevices());
  assert.equal(phone.name, 'samsung/a52qnsxx');
  const sent = parseMessageState(
    await client.sendMessage({ phoneNumbers: [NUMBER_1, NUMBER_2], text: 'Bonjour 🙂' }),
  );
  assert.equal(sent.recipients.length, 2);
  server.setState(sent.id, 'Delivered');
  assert.equal(parseMessageState(await client.getMessage(sent.id)).status, STATUS.DELIVERED);
  assert.deepEqual(server.sentTexts(), ['Bonjour 🙂']);
});
