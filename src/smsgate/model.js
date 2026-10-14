// -----------------------------------------------------------------------------
// The answers of the API, read defensively: the app and the servers evolve
// fast (a release a week), so every field is optional here and a shape that
// does not fit gives `null`, never an exception.
// -----------------------------------------------------------------------------

// Message states of the API (ProcessingState), and the four the user sees.
export const STATUS = Object.freeze({
  PENDING: 'pending',
  SENT: 'sent',
  DELIVERED: 'delivered',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

const API_STATES = {
  Pending: STATUS.PENDING,
  Processed: STATUS.PENDING, // received by the phone, not sent yet
  Sent: STATUS.SENT,
  Delivered: STATUS.DELIVERED,
  Failed: STATUS.FAILED,
  Cancelling: STATUS.CANCELLED,
  Cancelled: STATUS.CANCELLED,
};

/** States after which nothing changes any more. */
export const FINAL_STATUSES = new Set([STATUS.DELIVERED, STATUS.FAILED, STATUS.CANCELLED]);

/** A state of the API, as one of STATUS (unknown: pending). */
export const statusOf = (apiState) => API_STATES[apiState] ?? STATUS.PENDING;

const isoOrNull = (value) => {
  if (typeof value !== 'string' && !(value instanceof Date)) {
    return null;
  }
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? null : time.toISOString();
};

/**
 * The phones of a `/device(s)` answer.
 * @returns {Array<{ id: string, name: string, lastSeen: string|null, simCards: number[] }>}
 */
export function parseDevices(list) {
  return (Array.isArray(list) ? list : [])
    .filter((device) => device && typeof device.id === 'string' && device.id && !device.deletedAt)
    .map((device) => ({
      id: device.id,
      name: typeof device.name === 'string' && device.name.trim() ? device.name.trim() : device.id,
      lastSeen: isoOrNull(device.lastSeen),
      simCards: (Array.isArray(device.simCards) ? device.simCards : [])
        .map((sim) => sim?.simNumber)
        .filter((number) => Number.isInteger(number)),
    }));
}

/**
 * The phone's health (local `/health`): battery level and charging, app
 * version. Charging is a set of flags: 1 charging, 2 on AC, 4 on USB.
 * @returns {{ battery: number|null, charging: boolean|null, version: string|null, failedLastHour: number|null }}
 */
export function parseHealth(health) {
  const checks = health && typeof health.checks === 'object' ? health.checks : {};
  const observed = (key) => {
    const value = checks[key]?.observedValue;
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  const level = observed('battery:level');
  const flags = observed('battery:charging');
  return {
    battery: level === null ? null : Math.max(0, Math.min(100, Math.round(level))),
    charging: flags === null ? null : (flags & 1) === 1,
    version: typeof health?.version === 'string' ? health.version : null,
    failedLastHour: observed('messages:failed'),
  };
}

/**
 * A message state (`/message/{id}` or the answer of a send).
 * @returns {{ id: string, deviceId: string|null, status: string,
 *   recipients: Array<{ number: string, status: string, error: string|null }> }|null}
 */
export function parseMessageState(data) {
  if (!data || typeof data.id !== 'string' || !data.id) {
    return null;
  }
  const recipients = (Array.isArray(data.recipients) ? data.recipients : [])
    .filter((recipient) => recipient && typeof recipient.phoneNumber === 'string')
    .map((recipient) => ({
      number: recipient.phoneNumber,
      status: statusOf(recipient.state),
      error: typeof recipient.error === 'string' && recipient.error ? recipient.error : null,
    }));
  return {
    id: data.id,
    deviceId: typeof data.deviceId === 'string' && data.deviceId ? data.deviceId : null,
    status: statusOf(data.state),
    recipients,
  };
}

/**
 * One received message of `/inbox`. Encrypted ones (end-to-end encryption on
 * in the app) cannot be read: flagged, never shown.
 * @returns {{ id: string, sender: string, text: string, receivedAt: string,
 *   simNumber: number|null, encrypted: boolean }|null}
 */
export function parseIncoming(item) {
  if (!item || typeof item.id !== 'string' || typeof item.sender !== 'string') {
    return null;
  }
  const receivedAt = isoOrNull(item.createdAt);
  if (!receivedAt) {
    return null;
  }
  return {
    id: item.id,
    sender: item.sender,
    text: typeof item.contentPreview === 'string' ? item.contentPreview : '',
    receivedAt,
    simNumber: Number.isInteger(item.simNumber) ? item.simNumber : null,
    encrypted: item.isEncrypted === true,
  };
}
