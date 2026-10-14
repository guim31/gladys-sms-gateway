// -----------------------------------------------------------------------------
// The `sms_gateway` widget: within the content budget of the core in every
// state (not configured, phone down, messages failed, several phones), and
// its Refresh button.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/hub.js';
import { messageRow } from '../src/widgets.js';
import {
  FakeSmsGate,
  NUMBER_1,
  NUMBER_2,
  createClock,
  createWorld,
  deviceId,
} from './helpers/world.js';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

async function content(w, settings = {}, language = 'en') {
  const ack = await w.fake.widgetGet(WIDGET_KEY, { settings, language });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(validateWidgetContent(ack.data.content), [], 'rendered as sent');
  return ack.data.content;
}

const statusItems = (c) => c.components.find((component) => component.type === 'status').items;

test('a working phone: battery, SMS this hour, received, phone row, Refresh', async (t) => {
  const w = await world(t);
  const c = await content(w);
  assert.deepEqual(
    c.components.map((component) => component.type),
    ['value', 'value', 'value', 'status', 'button'],
  );
  assert.equal(c.components[0].value, 23);
  assert.equal(c.components[1].value, '0/20');
  const items = statusItems(c);
  assert.deepEqual(items[0], {
    label: 'samsung/a52qnsxx',
    icon: 'smartphone',
    value: 'Reachable · Charging',
    color: 'success',
  });
  assert.equal(items[1].label, 'No SMS sent yet');
  assert.equal(c.ttl_seconds, 120);
});

test('the last SMS with their state; a failure shows its reason; refresh sooner while moving', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  const ok = await w.fake.sceneAction('send_sms', { phone_numbers: NUMBER_1, message: 'a' });
  clock.advance(60_000);
  const ko = await w.fake.sceneAction('send_sms', {
    phone_numbers: `${NUMBER_2},+447700900123`,
    message: 'b',
  });
  clock.advance(60_000);
  await w.fake.sceneAction('send_sms', { phone_numbers: NUMBER_1, message: 'c' });
  w.server.setState(ok.data.outputs.message_id, 'Delivered');
  w.server.setState(ko.data.outputs.message_id, 'Failed', 'RESULT_ERROR_NO_SERVICE');
  await w.hub.refresh({ force: true });

  const c = await content(w, {}, 'fr');
  const items = statusItems(c).slice(1);
  assert.deepEqual(
    items.map((item) => [item.label, item.value, item.color]),
    [
      ['08:02 · ••12', 'En attente', 'neutral'],
      ['08:01 · ••34 +1', 'Échec · RESULT_ERROR_NO_SERVICE', 'danger'],
      ['08:00 · ••12', 'Délivré', 'success'],
    ],
  );
  assert.equal(c.components[1].value, '4/20');
  assert.equal(c.ttl_seconds, 30, 'a message still pending');
});

test('a phone that does not answer: the reason on top, the phone in red', async (t) => {
  const w = await world(t);
  w.server.online = false;
  await w.hub.refresh({ force: true });
  const c = await content(w);
  assert.equal(c.components[0].type, 'text');
  assert.match(c.components[0].text, /no answer/);
  assert.equal(statusItems(c)[0].color, 'danger');
});

test('not configured, or a phone no longer known: a message instead', async (t) => {
  const blank = await world(t, { config: { mode: 'local', language: 'en' } });
  assert.match((await content(blank)).components[0].text, /Configure the SMS gateway/);
  const w = await world(t);
  const unknown = await content(w, { device: deviceId(w.gladys, 'gone') });
  assert.match(unknown.components[0].text, /no longer known/);
});

test('cloud with several phones: one row each, filtered by the settings', async (t) => {
  const clock = createClock();
  const server = new FakeSmsGate({ kind: 'cloud', now: clock.now });
  server.devices.push({ id: 'Pz4kXw8yNb2mQs6tRu1vA', name: 'Second phone', lastSeen: null });
  const w = await world(t, { mode: 'cloud', clock, server });
  const all = await content(w);
  assert.equal(all.components.filter((c) => c.type === 'value').length, 2, 'no battery in cloud');
  assert.deepEqual(
    statusItems(all)
      .slice(0, 2)
      .map((item) => item.value),
    ['Reachable', 'Unreachable'],
  );
  const one = await content(w, { device: deviceId(w.gladys, 'Pz4kXw8yNb2mQs6tRu1vA') });
  assert.equal(statusItems(one)[0].label, 'Second phone');
});

test('the Refresh button reads the phone now and answers in every language', async (t) => {
  const w = await world(t);
  const reads = () => w.server.requests.filter((r) => r.path === '/device').length;
  const before = reads();
  const ack = await w.fake.widgetAction(WIDGET_KEY, 'refresh', {}, { settings: {} });
  assert.equal(ack.success, true, ack.error);
  assert.equal(reads(), before + 1);
  assert.deepEqual(Object.keys(ack.data.message), ['en', 'fr', 'de', 'es']);
  const unknown = await w.fake.widgetAction(WIDGET_KEY, 'pause', {}, { settings: {} });
  assert.equal(unknown.success, false);
});

test('a status row never exceeds what the core shows', () => {
  const row = messageRow(
    {
      at: Date.UTC(2026, 9, 12, 8, 0),
      status: 'failed',
      recipients: [{ number: NUMBER_1, error: 'x'.repeat(200) }],
    },
    'en',
  );
  assert.ok(row.value.length <= 40);
  assert.ok(row.label.length <= 40);
});
