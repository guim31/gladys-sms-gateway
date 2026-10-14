// -----------------------------------------------------------------------------
// Repeated failures, logged once.
//
// A phone that stays off, a server that keeps refusing the password, a
// sending limit hit by a scene in a loop: each would write the same line at
// every cycle. An issue log keeps, per key, whether the problem is ongoing:
// the first occurrence is logged at its level (warn by default), the next ones
// at debug, and the recovery is one info line.
// (Adapted from guim31/gladys-subsonic.)
// -----------------------------------------------------------------------------

/**
 * @param {{ debug: Function, info: Function, warn: Function, error: Function }} logger
 */
export function createIssueLog(logger) {
  const ongoing = new Set();
  return {
    /** The problem `key` happened (again). */
    fail(key, message, level = 'warn') {
      if (ongoing.has(key)) {
        logger.debug(`${message} (again)`);
        return;
      }
      ongoing.add(key);
      logger[level](message);
    },

    /** The problem `key` is over: one info line if it was ongoing. */
    ok(key, message) {
      if (ongoing.delete(key) && message) {
        logger.info(message);
      }
    },

    has: (key) => ongoing.has(key),

    /** Forget every ongoing problem (new configuration). */
    clear() {
      ongoing.clear();
    },
  };
}
