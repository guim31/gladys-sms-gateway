// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a fake SMS Gateway API on a
// fake network, a temporary /data and a manual clock, with the integration
// wired on top through registerHandlers. No timer runs unless `timers: true`
// (with node:test mock timers): the tests read the phone with
// `world.hub.refresh({ force: true })`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { FakeSmsGate, PASSWORD, USERNAME, createNetwork } from './fakeSmsGate.js';

// The integration logs every change; keep the test output readable. Times are
// shown in the time zone of Gladys (TZ): pin it.
process.env.LOG_LEVEL ??= 'silent';
process.env.TZ = 'UTC';

export const LOCAL_ADDRESS = '192.0.2.10';
export const LOCAL_ORIGIN = 'http://192.0.2.10:8080';
export const CLOUD_ORIGIN = 'https://api.sms-gate.app';
export const PRIVATE_URL = 'https://sms.example.com/gateway';
export const PRIVATE_ORIGIN = 'https://sms.example.com';

export const NUMBER_1 = '+33639980012';
export const NUMBER_2 = '+33639980034';

/** A manual clock, shared by the hub and the fake servers. */
export function createClock(start = Date.UTC(2026, 9, 12, 8, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

export const localConfig = (extra = {}) => ({
  mode: 'local',
  local_address: LOCAL_ADDRESS,
  username: USERNAME,
  password: PASSWORD,
  language: 'en',
  ...extra,
});

export const cloudConfig = (extra = {}) => ({
  mode: 'cloud',
  username: USERNAME,
  password: PASSWORD,
  language: 'en',
  ...extra,
});

/**
 * @param {object} [options]
 * @param {'local'|'cloud'|'private'} [options.mode] which fake server, and its default config
 * @param {object} [options.config] raw integration config
 * @param {Record<string, FakeSmsGate>} [options.servers] by origin
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {boolean} [options.connect]
 */
export async function createWorld({
  mode = 'local',
  clock = createClock(),
  server,
  servers,
  config,
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-sms-')),
  timings = {},
  timers = false,
  store,
} = {}) {
  const gate =
    server ??
    new FakeSmsGate({
      kind: mode === 'local' ? 'local' : 'cloud',
      now: clock.now,
      basePath: mode === 'private' ? '/gateway/3rdparty/v1' : undefined,
    });
  const origin = mode === 'local' ? LOCAL_ORIGIN : mode === 'cloud' ? CLOUD_ORIGIN : PRIVATE_ORIGIN;
  const network = createNetwork(servers ?? { [origin]: gate });
  const gladys = createFakeGladys({
    config:
      config ??
      (mode === 'local'
        ? localConfig()
        : mode === 'cloud'
          ? cloudConfig()
          : cloudConfig({ mode: 'private', server_url: PRIVATE_URL })),
    devices,
  });
  const app = registerHandlers(gladys, {
    store: store ?? new Store(dataDir),
    fetch: network.fetch,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return { gladys, fake: gladys.fake, network, server: gate, app, hub: app.hub, clock, dataDir };
}

/** External id of a phone's device, and of one of its features. */
export const deviceId = (gladys, phoneId) => gladys.externalIds('phone', phoneId).device;
export const featureId = (gladys, phoneId, key) =>
  gladys.externalIds('phone', phoneId).feature(key);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

export { FakeSmsGate, PASSWORD, USERNAME };
