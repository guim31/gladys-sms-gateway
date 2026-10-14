// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures (test/fixtures/smsgate): the app's local server and the cloud and
// private servers, before and after SMS sent, received and failed, in every
// feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// (Adapted from guim31/gladys-wled.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { NUMBER_1, NUMBER_2, cloudConfig, createWorld, localConfig } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const scenarios = [
  { label: 'local, English names', mode: 'local', config: localConfig(), phones: 1 },
  {
    label: 'local, French names',
    mode: 'local',
    config: localConfig({ language: 'fr' }),
    phones: 1,
  },
  {
    label: 'cloud, German names',
    mode: 'cloud',
    config: cloudConfig({ language: 'de' }),
    phones: 1,
  },
  {
    label: 'private server, Spanish names',
    mode: 'private',
    config: cloudConfig({
      mode: 'private',
      server_url: 'https://sms.example.com/gateway',
      language: 'es',
    }),
    phones: 1,
  },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const { gladys, app, server, hub, clock } = await createWorld({
      mode: scenario.mode,
      config: scenario.config,
    });
    try {
      // Some life first: a delivered SMS, a failed one, a received one.
      const ok = await gladys.fake.sceneAction('send_sms', {
        phone_numbers: NUMBER_1,
        message: 'ok',
      });
      const ko = await gladys.fake.sceneAction('send_sms', {
        phone_numbers: NUMBER_2,
        message: 'ko',
      });
      server.setState(ok.data.outputs.message_id, 'Delivered');
      server.setState(ko.data.outputs.message_id, 'Failed', 'RESULT_ERROR_NO_SERVICE');
      server.receive({ sender: NUMBER_2, text: 'hello', at: clock.now() });
      clock.advance(60_000);
      await hub.refresh({ force: true });

      const devices = gladys.fake.discoveredDevices;
      assert.equal(devices.length, scenario.phones);

      for (const device of devices) {
        const where = device.name;

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);

          // The value read from the fixtures fits the declared bounds.
          const value = gladys.fake.lastState(feature.external_id);
          assert.equal(typeof value, 'number', `${at}: no state published`);
          assert.ok(value >= feature.min && value <= feature.max, `${at}: ${value} out of bounds`);
          if (feature.type === 'integer' || feature.type === 'binary') {
            assert.ok(Number.isInteger(value), `${at}: ${value} is not an integer`);
          }
        }
        // The counters moved: one sent, one failed, one received.
        const counter = (suffix) =>
          gladys.fake.lastState(
            device.features.find((f) => f.external_id.endsWith(suffix)).external_id,
          );
        assert.equal(counter(':sms_sent'), 1, `${where}: SMS sent`);
        assert.equal(counter(':sms_failed'), 1, `${where}: SMS failed`);
        assert.equal(counter(':sms_received'), 1, `${where}: SMS received`);
      }
    } finally {
      await app.stop();
    }
  });
}
