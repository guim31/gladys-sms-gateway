// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle and
// one line per send. A normal cycle writes nothing, a failure that repeats is
// logged once, and its end once. Never the password, never a whole number,
// never the text of an SMS.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NUMBER_1,
  NUMBER_2,
  PASSWORD,
  USERNAME,
  createClock,
  createWorld,
} from './helpers/world.js';

/** Capture the lines of the SDK logger at a level. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  return {
    lines,
    clear: () => lines.splice(0),
    texts: () => lines.map((line) => line.text),
  };
}

async function world(t, options = {}) {
  const w = await createWorld({ clock: createClock(), ...options });
  t.after(() => w.app.stop());
  return w;
}

/** Nothing secret in what was logged. */
function assertNoSecret(text) {
  assert.ok(!text.includes(PASSWORD), 'never the password');
  assert.ok(
    !text.includes(Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64')),
    'never the Basic header',
  );
  for (const number of [NUMBER_1, NUMBER_2, '639980012', '639980034']) {
    assert.ok(!text.includes(number), `never a whole number (${number})`);
  }
}

test('a normal cycle writes nothing at info: readings, SMS received, deliveries', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  assert.ok(
    logs
      .texts()
      .some((text) => /Connected to the SMS gateway \(local, 192\.0\.2\.10:8080\)/.test(text)),
    'the start is logged',
  );
  const ack = await w.fake.sceneAction('send_sms', {
    phone_numbers: NUMBER_1,
    message: 'Secret code 1234',
  });
  logs.clear();

  w.server.setState(ack.data.outputs.message_id, 'Delivered');
  for (let i = 0; i < 5; i += 1) {
    w.server.setBattery(50 - i, i % 2);
    w.server.receive({ sender: NUMBER_2, text: `incoming ${i}`, at: w.clock.now() });
    w.clock.advance(60_000);
    await w.hub.refresh({ force: true });
  }
  assert.deepEqual(logs.texts(), []);
  assert.equal(w.fake.sceneEvents.length, 5);
});

test('one line per send, numbers masked, never the text', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  await w.fake.sceneAction('send_sms', {
    phone_numbers: `${NUMBER_1}, ${NUMBER_2}`,
    message: 'Secret code 1234',
    sim_number: '2',
  });
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(
    logs.lines[0].text,
    /\[INFO\].*SMS queued \(scene\) for 2 recipient\(s\) \(••12, ••34\) on SIM 2/,
  );
  assert.ok(!logs.lines[0].text.includes('Secret'));
  assertNoSecret(logs.texts().join('\n'));
});

test('a phone that stays down is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  w.server.online = false;
  for (let i = 0; i < 6; i += 1) {
    w.clock.advance(60_000);
    await w.hub.refresh({ force: true });
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.equal(logs.lines[0].stream, 'err');
  logs.clear();
  w.server.online = true;
  await w.hub.refresh({ force: true });
  await w.hub.refresh({ force: true });
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /SMS gateway answers again/);
});

test('a scene in a loop hits the limit: one warning, the repeats at debug only', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, {
    config: {
      mode: 'local',
      local_address: '192.0.2.10',
      username: USERNAME,
      password: PASSWORD,
      max_sms_per_hour: 1,
    },
  });
  await w.fake.sceneAction('send_sms', { phone_numbers: NUMBER_1, message: 'x' });
  logs.clear();
  for (let i = 0; i < 10; i += 1) {
    await w.fake.sceneAction('send_sms', { phone_numbers: NUMBER_1, message: 'loop' });
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /\[WARN\].*limit of 1 SMS per hour reached/);
  assertNoSecret(logs.texts().join('\n'));
});

test('a refused password is logged once; nothing secret even at debug', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await world(t, {
    config: {
      mode: 'local',
      local_address: '192.0.2.10',
      username: USERNAME,
      password: `${PASSWORD}x`,
    },
  });
  for (let i = 0; i < 3; i += 1) {
    await w.hub.refresh({ force: true });
  }
  const warnings = logs.lines.filter((line) => line.stream === 'err');
  assert.equal(warnings.length, 1, logs.texts().join('\n'));
  assert.match(logs.texts().join('\n'), /\[DEBUG\].*again/);
  await w.fake.configUpdated({
    mode: 'local',
    local_address: '192.0.2.10',
    username: USERNAME,
    password: PASSWORD,
  });
  await w.fake.sceneAction('send_sms', { phone_numbers: NUMBER_1, message: 'x' });
  w.server.receive({ sender: NUMBER_2, text: 'x', at: w.clock.now() });
  await w.hub.refresh({ force: true });
  const all = logs.texts().join('\n');
  assert.ok(!all.includes(`${PASSWORD}x`), 'never the wrong password either');
  assertNoSecret(all);
});

test('Gladys refusing the states is logged once', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  w.gladys.publishChangedStates = async () => {
    throw new Error('HTTP 500');
  };
  for (let i = 0; i < 4; i += 1) {
    w.server.setBattery(40 + i);
    await w.hub.refresh({ force: true });
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /States refused by Gladys/);
});
