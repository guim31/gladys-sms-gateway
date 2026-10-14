// -----------------------------------------------------------------------------
// The hourly limit: a sliding window of 60 minutes, every recipient counts,
// and the moment the next SMS fits is announced.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HourlyLimiter, WINDOW_MS } from '../src/limiter.js';
import { createClock } from './helpers/world.js';

test('sends fit until the limit, then the oldest one frees its place', () => {
  const clock = createClock();
  const limiter = new HourlyLimiter({ now: clock.now });
  const first = clock.now();
  limiter.record(2);
  clock.advance(10 * 60_000);
  limiter.record(2);
  assert.equal(limiter.used(), 4);
  assert.deepEqual(limiter.check(1, 5), { allowed: true });
  assert.deepEqual(limiter.check(2, 5), { allowed: false, used: 4, retryAt: first + WINDOW_MS });
  clock.advance(50 * 60_000);
  assert.equal(limiter.used(), 2, 'the first send left the window');
  assert.deepEqual(limiter.check(3, 5), { allowed: true });
});

test('a message bigger than the limit never fits', () => {
  const limiter = new HourlyLimiter({ now: createClock().now });
  assert.deepEqual(limiter.check(6, 5), { allowed: false, used: 0, retryAt: null });
});

test('the window survives a restart, damaged entries are dropped', () => {
  const clock = createClock();
  const limiter = new HourlyLimiter({ now: clock.now });
  limiter.record(3);
  const saved = JSON.parse(JSON.stringify(limiter));
  const again = new HourlyLimiter({
    now: clock.now,
    entries: [...saved, { at: 'x', count: 1 }, { at: clock.now(), count: -2 }, null],
  });
  assert.equal(again.used(), 3);
  clock.advance(WINDOW_MS);
  assert.equal(again.used(), 0);
});
