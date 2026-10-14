// -----------------------------------------------------------------------------
// A fake SMS Gateway for Android API, in memory: the app's local server, or
// the cloud / private server, with the routes, the authentication, the
// validation and the answer shapes of the real ones (see
// test/fixtures/smsgate/README.md). The tests drive it like the phone would
// evolve: a message delivered or failed, an SMS received, the phone switched
// off, the battery draining.
//
// Two ways to reach it:
//   - `createNetwork(servers).fetch`: a `fetch` over a fake network, given to
//     the integration in place of the real one (no socket at all);
//   - `server.listen()`: a real HTTP server on 127.0.0.1, for the end-to-end
//     test through the real `fetch` of Node.
// -----------------------------------------------------------------------------

import http from 'node:http';
import { readFileSync } from 'node:fs';

const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/smsgate/${name}.json`, import.meta.url), 'utf8'));

export const USERNAME = 'sms';
export const PASSWORD = 'Xk2pq9Lm';

let sequence = 0;
const nextId = (prefix) => `${prefix}${String((sequence += 1)).padStart(17, '0')}`.slice(0, 21);

export class FakeSmsGate {
  /**
   * @param {object} [options]
   * @param {'local'|'cloud'} [options.kind] local app server, or a cloud/private server
   * @param {() => number} [options.now]
   * @param {string} [options.basePath] where the API lives ('' local, '/3rdparty/v1' servers)
   */
  constructor({ kind = 'local', now = () => Date.now(), basePath } = {}) {
    this.kind = kind;
    this.now = now;
    this.basePath = basePath ?? (kind === 'local' ? '' : '/3rdparty/v1');
    this.username = USERNAME;
    this.password = PASSWORD;
    this.online = true;
    this.inboxSupported = true;
    this.health = fixture('health-local');
    this.devices =
      kind === 'local'
        ? fixture('device-local')
        : fixture('devices-cloud').map((device) =>
            device.deletedAt ? device : { ...device, lastSeen: new Date(now()).toISOString() },
          );
    /** @type {Map<string, object>} messages by id */
    this.messages = new Map();
    this.inbox = [];
    /** Every request received: `{ method, path, query, body, authorized }`. */
    this.requests = [];
    /** Answer the next send with this status (e.g. 503 queue full). */
    this.failNextSend = null;
  }

  get phoneId() {
    return this.devices.find((device) => !device.deletedAt).id;
  }

  // --- What the phone does -------------------------------------------------------

  setBattery(level, chargingFlags = 0) {
    this.health.checks['battery:level'].observedValue = level;
    this.health.checks['battery:charging'].observedValue = chargingFlags;
  }

  /** Move every recipient of a message to a state (Sent, Delivered, Failed). */
  setState(id, state, error) {
    const message = this.messages.get(id);
    message.state = state;
    message.states[state] = new Date(this.now()).toISOString();
    for (const recipient of message.recipients) {
      recipient.state = state;
      if (error) {
        recipient.error = error;
      }
    }
  }

  /** Move one recipient only; the message takes the worst state. */
  setRecipientState(id, phoneNumber, state, error) {
    const message = this.messages.get(id);
    const recipient = message.recipients.find((entry) => entry.phoneNumber === phoneNumber);
    recipient.state = state;
    if (error) {
      recipient.error = error;
    }
    const states = message.recipients.map((entry) => entry.state);
    message.state = states.includes('Failed')
      ? 'Failed'
      : states.every((s) => s === 'Delivered')
        ? 'Delivered'
        : states.some((s) => s === 'Pending')
          ? 'Pending'
          : 'Sent';
  }

  /** The phone receives an SMS. */
  receive({ sender, text, at = this.now(), simNumber = 1, deviceId, encrypted = false }) {
    const item = {
      id: nextId('In'),
      type: 'SMS',
      sender,
      simNumber,
      contentPreview: text,
      createdAt: new Date(at).toISOString(),
      deviceId: deviceId ?? this.phoneId,
    };
    if (encrypted) {
      item.isEncrypted = true;
    }
    this.inbox.push(item);
    return item;
  }

  /** The texts sent, in order (what the recipients got). */
  sentTexts() {
    return [...this.messages.values()].map((message) => message.textMessage.text);
  }

  // --- The API ---------------------------------------------------------------------

  /**
   * @param {{ method: string, path: string, headers: Record<string, string>, body: string }} request
   * @returns {{ status: number, body: string }}
   */
  handle({ method, path, headers, body }) {
    const url = new URL(path, 'http://fake');
    const route = url.pathname.startsWith(this.basePath)
      ? url.pathname.slice(this.basePath.length) || '/'
      : null;
    const authorized =
      headers.authorization ===
      `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`;
    this.requests.push({
      method,
      path: route,
      query: Object.fromEntries(url.searchParams),
      body: body ? JSON.parse(body) : null,
      authorized,
    });
    const json = (status, data) => ({
      status,
      body: data === undefined ? '' : JSON.stringify(data),
    });
    if (route === null) {
      return json(404, { message: 'Not Found' });
    }
    const local = this.kind === 'local';

    if (method === 'GET' && route === '/health') {
      // The local health is the phone's; the server's says nothing of it.
      return local
        ? json(this.health.status === 'fail' ? 500 : 200, this.health)
        : json(200, { status: 'pass', version: '1.33.0', releaseId: 1, checks: {} });
    }
    if (!authorized) {
      return json(401, { message: 'Unauthorized' });
    }
    if (method === 'GET' && route === (local ? '/device' : '/devices')) {
      return json(200, this.devices);
    }
    const messagesRoute = local ? '/message' : '/messages';
    if (method === 'POST' && route === messagesRoute) {
      return this.send(JSON.parse(body ?? '{}'));
    }
    if (method === 'GET' && route.startsWith(`${messagesRoute}/`)) {
      const message = this.messages.get(decodeURIComponent(route.slice(messagesRoute.length + 1)));
      return message ? json(200, this.view(message)) : json(404, { message: 'Not Found' });
    }
    if (method === 'GET' && route === '/inbox') {
      if (!this.inboxSupported) {
        return json(404, { message: 'Not Found' });
      }
      return this.listInbox(url.searchParams);
    }
    return json(404, { message: 'Not Found' });
  }

  send(request) {
    const json = (status, data) => ({ status, body: JSON.stringify(data) });
    if (this.failNextSend) {
      const status = this.failNextSend;
      this.failNextSend = null;
      return json(status, { message: 'Queue limits exceeded; ensure device is online' });
    }
    const numbers = request.phoneNumbers;
    if (!Array.isArray(numbers) || numbers.length === 0 || numbers.length > 100) {
      return json(400, { message: 'phoneNumbers: must contain 1 to 100 items' });
    }
    if (new Set(numbers).size !== numbers.length) {
      return json(400, { message: 'phoneNumbers: must contain unique values' });
    }
    if (!request.textMessage || typeof request.textMessage.text !== 'string') {
      return json(400, { message: 'one of message, textMessage or dataMessage is required' });
    }
    if (request.simNumber !== undefined && ![1, 2, 3].includes(request.simNumber)) {
      return json(400, { message: 'simNumber: must be between 1 and 3' });
    }
    let deviceId = this.phoneId;
    if (request.deviceId) {
      if (this.kind === 'local') {
        return json(400, { message: 'Invalid device ID' });
      }
      if (!this.devices.some((device) => device.id === request.deviceId && !device.deletedAt)) {
        return json(400, { message: 'device not found' });
      }
      deviceId = request.deviceId;
    }
    const createdAt = new Date(this.now()).toISOString();
    const message = {
      id: nextId('Ms'),
      deviceId,
      state: 'Pending',
      isHashed: false,
      isEncrypted: false,
      recipients: numbers.map((phoneNumber) => ({ phoneNumber, state: 'Pending' })),
      states: { Pending: createdAt },
      createdAt,
      textMessage: { text: request.textMessage.text },
      simNumber: request.simNumber ?? null,
      withDeliveryReport: request.withDeliveryReport,
    };
    this.messages.set(message.id, message);
    return json(202, this.view(message));
  }

  /** A message as the API shows it (without content, like includeContent=false). */
  view(message) {
    const { textMessage: _text, simNumber: _sim, withDeliveryReport: _report, ...state } = message;
    return structuredClone(state);
  }

  listInbox(params) {
    const json = (status, data) => ({ status, body: JSON.stringify(data) });
    const from = params.get('from') ? Date.parse(params.get('from')) : 0;
    const limit = Number(params.get('limit') ?? 50);
    const offset = Number(params.get('offset') ?? 0);
    if (limit < 1 || limit > 500) {
      return json(400, { message: 'limit must be between 1 and 500' });
    }
    const deviceId = params.get('deviceId');
    if (this.kind === 'local' && deviceId && deviceId !== this.phoneId) {
      return json(400, { message: 'Invalid device ID' });
    }
    const items = this.inbox
      .filter((item) => params.get('type') === null || item.type === params.get('type'))
      .filter((item) => Date.parse(item.createdAt) >= from)
      .filter((item) => !deviceId || item.deviceId === deviceId)
      // Newest first, like the app's database query.
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(offset, offset + limit)
      .map(({ deviceId: _device, ...item }) => item);
    return json(200, items);
  }

  // --- Real HTTP (end-to-end test) -------------------------------------------------

  /** Serve the API on 127.0.0.1; resolves with the base URL. */
  async listen() {
    this.server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        const answer = this.handle({
          method: req.method,
          path: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        res.writeHead(answer.status, { 'content-type': 'application/json' });
        res.end(answer.body);
      });
    });
    await new Promise((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${this.server.address().port}`;
  }

  close() {
    return new Promise((resolve) => (this.server ? this.server.close(resolve) : resolve()));
  }
}

/**
 * A fake network: `fetch` reaches the server registered for the origin of the
 * URL; any other origin, or a server switched off, does not answer.
 * @param {Record<string, FakeSmsGate>} servers by origin (`http://192.0.2.10:8080`)
 */
export function createNetwork(servers) {
  return {
    servers,
    async fetch(url, init = {}) {
      const target = new URL(url);
      const server = servers[target.origin];
      if (!server || !server.online) {
        throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
      }
      const answer = server.handle({
        method: init.method ?? 'GET',
        path: `${target.pathname}${target.search}`,
        headers: Object.fromEntries(
          Object.entries(init.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
        ),
        body: init.body ?? '',
      });
      return new Response(answer.body || null, {
        status: answer.status,
        headers: { 'content-type': 'application/json' },
      });
    },
  };
}
