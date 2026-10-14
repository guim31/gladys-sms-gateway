// -----------------------------------------------------------------------------
// The reading timer of the container. Gladys 5.2 never polls a device
// published with should_poll: false (and never polls the devices created
// without should_poll, GladysAssistant/Gladys#3198): the phone must be read
// by the hub's own timer, with no onPoll at all.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NUMBER_2,
  createAll,
  createClock,
  createWorld,
  featureId,
  localConfig,
} from './helpers/world.js';

/** Let the timer callback and the fake network settle. */
const settle = async () => {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

test('the internal timer reads the phone and the inbox without any onPoll', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = createClock();
  const w = await createWorld({
    clock,
    timers: true,
    config: localConfig({ poll_interval: '30' }),
  });
  t.after(() => w.app.stop());
  const polled = t.mock.method(w.hub, 'pollDevice');
  await createAll(w);

  const device = w.fake.discoveredDevices[0];
  assert.equal(device.should_poll, false, 'Gladys is not asked to poll');
  const reads = () => w.server.requests.filter((r) => r.path === '/device').length;
  const before = reads();

  for (const level of [60, 59, 58]) {
    w.server.setBattery(level);
    clock.advance(30_000);
    t.mock.timers.tick(30_000);
    await settle();
    assert.equal(w.fake.lastState(featureId(w.gladys, w.server.phoneId, 'battery')), level);
  }
  w.server.receive({ sender: NUMBER_2, text: 'via the timer', at: clock.now() });
  clock.advance(30_000);
  t.mock.timers.tick(30_000);
  await settle();
  assert.equal(w.fake.sceneEvents.at(-1).data.message, 'via the timer');
  assert.equal(reads() - before, 4, 'one reading per interval');
  assert.equal(polled.mock.callCount(), 0, 'no onPoll involved');
});

test('the timer stops with the integration', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = await createWorld({ timers: true });
  await w.app.stop();
  const before = w.server.requests.length;
  t.mock.timers.tick(10 * 60_000);
  await settle();
  assert.equal(w.server.requests.length, before);
});
