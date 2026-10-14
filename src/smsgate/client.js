// -----------------------------------------------------------------------------
// Client of the SMS Gateway for Android API (capcom6/android-sms-gateway,
// Apache-2.0; endpoints and shapes from its OpenAPI document and its official
// TypeScript client, android-sms-gateway/client-ts).
//
// The same API in the three modes, with two differences:
//   - the app's local server answers `/device`, `/message` and `/health` (the
//     phone's own battery); the cloud and private servers answer `/devices`
//     (every phone of the account, with its last contact) and `/messages`,
//     their `/health` being the server's, not the phone's;
//   - the local server is plain HTTP on the home network, the servers HTTPS.
// Authentication: HTTP Basic, the username and password shown by the app.
//
// The client takes `fetch` as a parameter: the tests pass the in-memory server
// of test/helpers/fakeSmsGate.js. Errors carry a `kind` (ERROR_KINDS) the rest
// of the code turns into a message in the user's language.
// -----------------------------------------------------------------------------

import { MODES } from '../config.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: phone off, app stopped, wrong address
  AUTH: 'auth', // 401/403: wrong username or password
  NOT_FOUND: 'not_found', // 404: older app, wrong server path
  REFUSED: 'refused', // 400/409: the API refused the request (its message says why)
  QUEUE: 'queue', // 503 on a send: the phone is offline or its queue is full
  HTTP: 'http', // anything else unexpected
});

export const REQUEST_TIMEOUT_MS = 15_000;
const MAX_API_MESSAGE_LENGTH = 160;

export class SmsGateError extends Error {
  constructor(kind, message, status = null) {
    super(message);
    this.name = 'SmsGateError';
    this.kind = kind;
    this.status = status;
  }
}

/** The `message` of an API error body, shortened; never the request. */
function apiMessage(body) {
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed.message === 'string') {
      return parsed.message.slice(0, MAX_API_MESSAGE_LENGTH);
    }
  } catch {
    // not JSON
  }
  return '';
}

export class SmsGateClient {
  /**
   * @param {object} options
   * @param {string} options.mode MODES value
   * @param {string} options.apiUrl API base URL (src/config.js)
   * @param {string} options.username
   * @param {string} options.password
   * @param {typeof fetch} [options.fetch]
   * @param {number} [options.timeoutMs]
   */
  constructor({ mode, apiUrl, username, password, fetch: fetchImpl, timeoutMs }) {
    this.mode = mode;
    this.local = mode === MODES.LOCAL;
    this.apiUrl = apiUrl.replace(/\/+$/, '');
    this.authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    this.fetch = fetchImpl ?? globalThis.fetch;
    this.timeoutMs = timeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  /**
   * @param {string} method
   * @param {string} path relative to the API base URL, query included
   * @param {object} [options]
   * @param {unknown} [options.json] request body
   * @param {boolean} [options.auth] send the credentials (default true)
   * @param {number[]} [options.okStatuses] answers to return instead of throwing
   * @returns {Promise<{ status: number, data: any }>}
   */
  async request(method, path, { json, auth = true, okStatuses = [] } = {}) {
    const headers = { accept: 'application/json' };
    if (auth) {
      headers.authorization = this.authorization;
    }
    if (json !== undefined) {
      headers['content-type'] = 'application/json';
    }
    let response;
    try {
      response = await this.fetch(`${this.apiUrl}${path}`, {
        method,
        headers,
        body: json === undefined ? undefined : JSON.stringify(json),
        redirect: 'error',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const reason = err?.cause?.code ?? err?.name ?? 'network error';
      const error = new SmsGateError(ERROR_KINDS.UNREACHABLE, `no answer (${reason})`);
      // The request may have reached the phone: a send that timed out may
      // still go out, and counts against the hourly limit.
      error.timedOut = err?.name === 'TimeoutError';
      throw error;
    }
    const body = await response.text().catch(() => '');
    const { status } = response;
    if ((status >= 200 && status < 300) || okStatuses.includes(status)) {
      let data = null;
      if (body) {
        try {
          data = JSON.parse(body);
        } catch {
          throw new SmsGateError(ERROR_KINDS.HTTP, `HTTP ${status}: not JSON`, status);
        }
      }
      return { status, data };
    }
    const detail = apiMessage(body);
    const message = `HTTP ${status}${detail ? `: ${detail}` : ''}`;
    if (status === 401 || status === 403) {
      throw new SmsGateError(ERROR_KINDS.AUTH, message, status);
    }
    if (status === 404 || status === 405 || status === 501) {
      throw new SmsGateError(ERROR_KINDS.NOT_FOUND, message, status);
    }
    if (status === 400 || status === 409 || status === 422) {
      throw new SmsGateError(ERROR_KINDS.REFUSED, message, status);
    }
    if (status === 503) {
      throw new SmsGateError(ERROR_KINDS.QUEUE, message, status);
    }
    throw new SmsGateError(ERROR_KINDS.HTTP, message, status);
  }

  /** The phones: the app itself (local), or every phone of the account. */
  async getDevices() {
    const { data } = await this.request('GET', this.local ? '/device' : '/devices');
    return Array.isArray(data) ? data : [];
  }

  /**
   * The phone's health (local mode only): battery, failed messages, app
   * version. The app answers 500 with the same body when a check fails (a
   * battery under 10 %), which is still a reading.
   */
  async getHealth() {
    const { data } = await this.request('GET', '/health', { auth: false, okStatuses: [500] });
    return data;
  }

  /**
   * Queue a text message.
   * @param {object} message
   * @param {string[]} message.phoneNumbers international numbers
   * @param {string} message.text
   * @param {number|null} [message.simNumber] 1 to 3, null for the phone's default
   * @param {string|null} [message.deviceId] the phone to send from (servers only)
   */
  async sendMessage({ phoneNumbers, text, simNumber = null, deviceId = null }) {
    const json = { textMessage: { text }, phoneNumbers, withDeliveryReport: true };
    if (simNumber) {
      json.simNumber = simNumber;
    }
    if (deviceId && !this.local) {
      json.deviceId = deviceId;
    }
    const { data } = await this.request('POST', this.local ? '/message' : '/messages', { json });
    return data;
  }

  /** The state of a queued message. */
  async getMessage(id) {
    const path = `${this.local ? '/message' : '/messages'}/${encodeURIComponent(id)}`;
    const { data } = await this.request('GET', path);
    return data;
  }

  /**
   * Received text messages (app 1.59.0 and later), newest window only.
   * @param {object} options
   * @param {Date} options.from
   * @param {string|null} [options.deviceId] one phone of the account (servers only)
   * @param {number} [options.limit]
   * @param {number} [options.offset]
   */
  async listInbox({ from, deviceId = null, limit = 100, offset = 0 }) {
    const query = new URLSearchParams({
      type: 'SMS',
      from: from.toISOString(),
      limit: String(limit),
      offset: String(offset),
    });
    if (deviceId && !this.local) {
      query.set('deviceId', deviceId);
    }
    const { data } = await this.request('GET', `/inbox?${query}`);
    return Array.isArray(data) ? data : [];
  }
}
