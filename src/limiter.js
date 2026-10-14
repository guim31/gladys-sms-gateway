// -----------------------------------------------------------------------------
// The hourly sending limit: an SMS costs money, and a scene that loops (an
// "SMS received" trigger answering an automatic reply, a state that flaps)
// could send hundreds. Every recipient of every message counts as one SMS;
// beyond the limit over the last 60 minutes (a sliding window), the send is
// refused, never queued.
//
// The window is saved in /data: restarting the integration does not reset it.
// -----------------------------------------------------------------------------

export const WINDOW_MS = 60 * 60_000;

export class HourlyLimiter {
  /**
   * @param {object} options
   * @param {() => number} options.now
   * @param {Array<{ at: number, count: number }>} [options.entries] saved sends
   */
  constructor({ now, entries = [] }) {
    this.now = now;
    this.entries = (Array.isArray(entries) ? entries : []).filter(
      (entry) => Number.isFinite(entry?.at) && Number.isInteger(entry?.count) && entry.count > 0,
    );
    this.prune();
  }

  prune() {
    const since = this.now() - WINDOW_MS;
    this.entries = this.entries.filter((entry) => entry.at > since);
  }

  /** SMS sent over the last hour. */
  used() {
    this.prune();
    return this.entries.reduce((sum, entry) => sum + entry.count, 0);
  }

  /**
   * Whether `count` more SMS fit under `limit`; if not, when they will.
   * @returns {{ allowed: true } | { allowed: false, used: number, retryAt: number|null }}
   */
  check(count, limit) {
    const used = this.used();
    if (used + count <= limit) {
      return { allowed: true };
    }
    if (count > limit) {
      return { allowed: false, used, retryAt: null };
    }
    // The oldest sends leave the window first.
    let freed = 0;
    for (const entry of this.entries) {
      freed += entry.count;
      if (used - freed + count <= limit) {
        return { allowed: false, used, retryAt: entry.at + WINDOW_MS };
      }
    }
    return { allowed: false, used, retryAt: null };
  }

  record(count) {
    this.entries.push({ at: this.now(), count });
    this.prune();
  }

  /** What /data keeps. */
  toJSON() {
    this.prune();
    return this.entries;
  }
}
