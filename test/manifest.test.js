// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// (Adapted from guim31/gladys-pihole.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACTIONS } from '../src/actions.js';
import {
  DEFAULT_CONFIG,
  LANGUAGES,
  MAX_SMS_PER_HOUR,
  MIN_SMS_PER_HOUR,
  MODES,
  OFFLINE_AFTER_MINUTES,
  POLL_INTERVALS,
} from '../src/config.js';
import { MAX_TEXT_LENGTH, TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import { MAX_RECIPIENTS } from '../src/phone.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { WIDGETS } from '../src/widgets.js';
import { NUMBER_1, NUMBER_2, createWorld } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const CAPABILITY_FIELDS = ['scene_triggers', 'scene_actions', 'widgets'];
const CAPABILITY_MIN_GLADYS_VERSION = [5, 1, 0];
const CATEGORIES_MIN_GLADYS_VERSION = [4, 86, 0];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);
const field = (list, key) => list.find((entry) => entry.key === key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('identity: name, image, cover, transports, notifications category', () => {
  assert.equal(manifest.name, 'SMS Gateway for Android');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-sms-gateway:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-sms-gateway/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['local', 'cloud']);
  assert.deepEqual(manifest.categories, ['notifications']);
  assert.equal(manifest.webhooks, undefined, 'received SMS are read, not pushed');
  assert.equal(manifest.network_discovery, undefined);
});

test('every manifest action has a handler', async (t) => {
  assert.deepEqual(keysOf(manifest.actions).sort(), Object.keys(ACTIONS).sort());
  const world = await createWorld();
  t.after(() => world.app.stop());
  for (const action of manifest.actions) {
    const fields = action.key === 'send_test_sms' ? { phone_number: NUMBER_1 } : {};
    const ack = await world.fake.action(action.key, fields);
    assert.equal(ack.success, true, `${action.key}: ${ack.error}`);
    assert.deepEqual(Object.keys(ack.data.message), LANGUAGES, `${action.key}: four languages`);
  }
});

test('the test SMS without a number says so, through the same checks', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.action('send_test_sms', {});
  assert.equal(ack.success, false);
  assert.match(ack.error, /No recipient/);
});

test('declaring catalog categories requires Gladys >= 4.86.0', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(isAtLeast(minGladysVersion(), CATEGORIES_MIN_GLADYS_VERSION));
});

test('declaring scene triggers, scene actions or widgets requires Gladys >= 5.1.0', () => {
  const declared = CAPABILITY_FIELDS.filter((key) => manifest[key] !== undefined);
  assert.deepEqual(declared, CAPABILITY_FIELDS);
  assert.ok(isAtLeast(minGladysVersion(), CAPABILITY_MIN_GLADYS_VERSION));
});

test('no widget button opens a form: Gladys 5.1.0 is enough', async (t) => {
  // Widget action `fields` need Gladys 5.2.0 (GladysAssistant/Gladys#3168).
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'en' });
  for (const component of ack.data.content.components) {
    assert.equal(component.action?.fields, undefined);
  }
});

test('every scene_actions key has a handler, and returns the declared outputs', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
  const world = await createWorld();
  t.after(() => world.app.stop());
  for (const action of manifest.scene_actions) {
    const ack = await world.fake.sceneAction(action.key, {
      phone_numbers: `${NUMBER_1}, ${NUMBER_2}`,
      message: 'Manifest test',
      sim_number: 'default',
    });
    assert.equal(ack.success, true, `${action.key}: ${ack.error}`);
    assert.deepEqual(
      Object.keys(ack.data.outputs).sort(),
      keysOf(action.outputs).sort(),
      `${action.key} outputs`,
    );
    for (const output of action.outputs) {
      assert.equal(typeof ack.data.outputs[output.key], output.type, output.key);
    }
  }
});

test('the send action: required recipients and text, SIM 1 to 3, phone from the devices', () => {
  const action = field(manifest.scene_actions, 'send_sms');
  assert.equal(field(action.fields, 'phone_numbers').required, true);
  assert.equal(field(action.fields, 'phone_numbers').type, 'string', 'scene variables allowed');
  assert.equal(field(action.fields, 'message').required, true);
  assert.equal(field(action.fields, 'message').type, 'string', 'scene variables allowed');
  assert.match(field(action.fields, 'message').description.en, new RegExp(`${MAX_TEXT_LENGTH}`));
  assert.match(
    field(action.fields, 'phone_numbers').description.en,
    new RegExp(`${MAX_RECIPIENTS}`),
  );
  const sim = field(action.fields, 'sim_number');
  assert.equal(sim.default, 'default', 'a new field never breaks a scene: it has a default');
  assert.deepEqual(
    sim.options.map((option) => option.value),
    ['default', '1', '2', '3'],
  );
  assert.equal(field(action.fields, 'device').required, undefined);
});

test('the scene triggers are the ones the hub fires, with their filters and variables', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
  const world = await createWorld();
  t.after(() => world.app.stop());
  // Every trigger once: an SMS failed, an SMS received.
  const ack = await world.fake.sceneAction('send_sms', { phone_numbers: NUMBER_1, message: 'x' });
  world.server.setState(ack.data.outputs.message_id, 'Failed', 'RESULT_ERROR_NO_SERVICE');
  world.server.receive({ sender: NUMBER_2, text: 'hello', at: world.clock.now() });
  await world.hub.refresh({ force: true });
  const fired = new Map(world.fake.sceneEvents.map((event) => [event.key, event.data]));
  for (const trigger of manifest.scene_triggers) {
    const data = fired.get(trigger.key);
    assert.ok(data, `${trigger.key} was fired`);
    // Filters match keys of `data`, variables read keys of `data`.
    for (const key of [...keysOf(trigger.fields), ...keysOf(trigger.variables)]) {
      assert.ok(key in data, `${trigger.key}: "${key}" is in the event data`);
    }
    for (const key of Object.keys(data)) {
      assert.ok(
        keysOf(trigger.variables).includes(key) || keysOf(trigger.fields).includes(key),
        `${trigger.key}: "${key}" is declared`,
      );
    }
    for (const variable of trigger.variables) {
      const value = data[variable.key];
      assert.ok(value === null || typeof value === variable.type, `${trigger.key}.${variable.key}`);
    }
    // A boolean filter could never say "any" (the core refuses it).
    assert.ok(trigger.fields.every((f) => f.type !== 'boolean'));
  }
});

test('every widgets key has a handler', async (t) => {
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  assert.deepEqual(Object.keys(WIDGETS), [WIDGET_KEY]);
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.widgetGet(WIDGET_KEY, { settings: {} });
  assert.equal(ack.success, true, ack.error);
});

test('config_schema defaults and options stay consistent with the code', () => {
  for (const entry of manifest.config_schema) {
    if (entry.default !== undefined) {
      assert.equal(
        DEFAULT_CONFIG[entry.key],
        entry.default,
        `DEFAULT_CONFIG.${entry.key} must match the manifest default`,
      );
    }
  }
  const options = (key) => field(manifest.config_schema, key).options.map((o) => o.value);
  assert.deepEqual(options('language'), LANGUAGES);
  assert.deepEqual(options('mode'), Object.values(MODES));
  assert.deepEqual(options('poll_interval'), POLL_INTERVALS);
  assert.deepEqual(options('offline_after_minutes'), OFFLINE_AFTER_MINUTES);
  const limit = field(manifest.config_schema, 'max_sms_per_hour');
  assert.equal(limit.min, MIN_SMS_PER_HOUR);
  assert.equal(limit.max, MAX_SMS_PER_HOUR);
  assert.deepEqual(
    Object.keys(DEFAULT_CONFIG).sort(),
    manifest.config_schema
      .filter((f) => f.type !== 'section')
      .map((f) => f.key)
      .sort(),
  );
  assert.equal(field(manifest.config_schema, 'password').type, 'secret');
  assert.equal(DEFAULT_CONFIG.language, 'fr', 'French by default');
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0);
  for (const section of sections) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  const dynamicSelects = allFields.filter((f) => f.source !== undefined);
  assert.ok(dynamicSelects.length > 0);
  for (const entry of dynamicSelects) {
    assert.equal(entry.source, 'devices');
    assert.equal(entry.options, undefined);
  }
});

test('number fields have integer bounds and defaults (the form has no step)', () => {
  for (const entry of allFields.filter((f) => f.type === 'number')) {
    for (const key of ['min', 'max', 'default']) {
      if (entry[key] !== undefined) {
        assert.ok(Number.isInteger(entry[key]), `field "${entry.key}".${key} must be an integer`);
      }
    }
  }
});

test('actions declare no secret field, no required field (no default is applied)', () => {
  // Gladys#3154/#3155: a secret in an action form cannot be filled, and an
  // action applies no default while enforcing `required`.
  for (const action of manifest.actions ?? []) {
    for (const entry of action.fields ?? []) {
      assert.notEqual(entry.type, 'secret');
      assert.notEqual(entry.required, true);
      assert.equal(entry.default, undefined);
    }
  }
});

test('scene fields hold no secret (a scene is readable by every user)', () => {
  for (const item of [...manifest.scene_triggers, ...manifest.scene_actions]) {
    for (const entry of item.fields ?? []) {
      assert.ok(!['secret', 'oauth2', 'account_link'].includes(entry.type));
    }
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${lang} has ${text.length} characters (10 to 100 allowed)`,
    );
  }
});
