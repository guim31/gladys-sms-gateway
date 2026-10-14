// -----------------------------------------------------------------------------
// The SMS gateway hub: reads the phone(s) on a timer of the container (the
// interval chosen in the configuration), publishes their states to Gladys when
// they change, follows the messages it sent until they are delivered or fail,
// reads the inbox for the "SMS received" trigger, and sends the SMS of the
// scene action and of the Configuration screen, under the hourly limit.
//
// Gladys never polls these devices (should_poll: false): the configurable
// interval goes up to 5 minutes, beyond the fixed list of the core scheduler,
// a device created without polling is never polled by Gladys 5.2
// (GladysAssistant/Gladys#3198), and the inbox must be read even before the
// device is added. onPoll stays as a fallback.
//
// Received SMS come from the app's inbox (GET /inbox), read at every cycle:
// it works in the three modes, without exposing anything to the Internet.
// The app's webhooks would need a URL the phone can reach, which the Gladys
// sandbox does not offer (no published port); the Gladys Plus relay could, at
// the price of an Internet round trip and a Gladys Plus subscription — kept
// for later, see CLAUDE.md.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { MODES, hostOf, isConfigured } from './config.js';
import { buildDevice, deviceIds, featureValues, phoneIdOf } from './devices.js';
import { createIssueLog } from './issues.js';
import { HourlyLimiter } from './limiter.js';
import { MAX_RECIPIENTS, maskEntry, maskNumber, parseRecipients } from './phone.js';
import { ERROR_KINDS, SmsGateClient } from './smsgate/client.js';
import {
  FINAL_STATUSES,
  STATUS,
  parseDevices,
  parseHealth,
  parseIncoming,
  parseMessageState,
} from './smsgate/model.js';
import { CONNECTION_TEXT, ERROR_TEXT, SEND_TEXT, pick, timeOf } from './texts.js';

const logger = createLogger({ name: 'sms-hub' });

export const WIDGET_KEY = 'sms_gateway';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  RECEIVED: 'sms_received',
  FAILED: 'sms_failed',
});

export const HUB_TIMINGS = {
  // A message is followed this long after its send, then left as it is (an
  // operator that never returns a delivery report leaves it "sent").
  trackForMs: 24 * 60 * 60_000,
  // Messages whose state is read per cycle at most, the newest ones.
  trackPerCycle: 10,
  // Received SMS are looked for over this window: wide enough for a phone
  // whose clock is off, or a cycle missed.
  inboxWindowMs: 2 * 60 * 60_000,
  // A received SMS id is remembered this long (no scene fired twice).
  inboxMemoryMs: 6 * 60 * 60_000,
  // Pages of 100 read per phone and cycle at most.
  inboxPages: 3,
  // An app without inbox is asked again after this delay (it may be updated).
  inboxRetryMs: 60 * 60_000,
  // Every state is sent again at least this often, unchanged or not: a value
  // older than 48 h shows as "no recent value" in Gladys.
  heartbeatMs: 6 * 60 * 60_000,
};

// Longest text accepted: ten SMS of 160 characters.
export const MAX_TEXT_LENGTH = 1600;
// Messages kept for the widget and the "Recent SMS" report.
export const MAX_TRACKED = 20;
const MAX_EVENT_TEXT = 1000; // core bound of a scene event string

/** The SIM card typed in a scene: 1 to 3, or null for the phone's default. */
export function parseSim(raw) {
  const number = Number(typeof raw === 'string' ? raw.trim() : raw);
  return Number.isInteger(number) && number >= 1 && number <= 3 ? number : null;
}

const signature = (config) =>
  JSON.stringify([config.mode, config.apiUrl, config.username, config.password]);

export class SmsHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {typeof fetch} [options.fetch] HTTP seam (the tests' fake server)
   * @param {boolean} [options.timers] periodic timer (off in tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, fetch: fetchImpl, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.fetch = fetchImpl;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.issues = createIssueLog(logger);
    this.config = null;
    this.client = null;
    this.clientSignature = null;
    /** @type {Map<string, object>} phone records, by phone id */
    this.phones = new Map();
    /** null: never read; true: the API answers; an error: it does not. */
    this.link = null;
    this.everConnected = false;
    this.inbox = { supported: null, retryAt: 0 };
    this.saved = emptySaved();
    this.limiter = new HourlyLimiter({ now: this.now });
    this.devicesKey = null;
    this.transports = new Map();
    this.connectionKey = null;
    this.lastRefreshAt = 0;
    this.refreshing = null;
    this.timer = null;
    this.stopped = false;
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    this.saved = readSaved(await this.store.load());
    this.limiter = new HourlyLimiter({ now: this.now, entries: this.saved.limiter });
    logger.info(`Starting in ${config.mode} mode`);
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates();
    this.devicesKey = null;
    this.transports.clear();
    this.connectionKey = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    this.config = config;
    const next = isConfigured(config) ? signature(config) : null;
    if (next !== this.clientSignature) {
      this.clientSignature = next;
      this.client = next
        ? new SmsGateClient({
            mode: config.mode,
            apiUrl: config.apiUrl,
            username: config.username,
            password: config.password,
            fetch: this.fetch,
          })
        : null;
      this.phones.clear();
      this.link = null;
      this.everConnected = false;
      this.inbox = { supported: null, retryAt: 0 };
      this.issues.clear();
    }
    this.devicesKey = null; // the names follow the language
    await this.refresh({ force: true });
    this.schedule();
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = null;
    await this.refreshing?.catch(() => {});
    this.save();
    await this.store.flush();
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = null;
    if (!this.timersEnabled || this.stopped || !this.client) {
      return;
    }
    this.timer = setTimeout(async () => {
      this.timer = null;
      try {
        await this.refresh();
      } catch (err) {
        this.issues.fail('cycle', `Refresh cycle failed (${err.message})`, 'error');
      } finally {
        this.schedule();
      }
    }, this.config.pollIntervalMs);
  }

  save() {
    this.saved.limiter = this.limiter.toJSON();
    this.store.save(this.saved);
  }

  // --- Reading the phone -------------------------------------------------------

  /**
   * One cycle: phones, followed messages, inbox, then the states. Concurrent
   * calls share the cycle in progress; without `force`, a cycle less than
   * `minGap` periods after the previous one is skipped (the core's onPoll
   * arriving just after the timer).
   */
  async refresh({ force = false, minGap = 0.5 } = {}) {
    if (this.refreshing) {
      await this.refreshing.catch(() => {});
      if (!force) {
        return;
      }
    }
    if (!force && this.now() - this.lastRefreshAt < this.config.pollIntervalMs * minGap) {
      logger.debug('Refreshed moments ago: skipped');
      return;
    }
    this.lastRefreshAt = this.now();
    this.refreshing = this.cycle().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /** The core's onPoll (fallback): refresh unless the timer just did. */
  async pollDevice() {
    await this.refresh({ minGap: 0.9 });
  }

  async cycle() {
    let changed = false;
    if (this.client) {
      try {
        changed = await this.readPhones();
        changed = (await this.trackMessages()) || changed;
        changed = (await this.readInbox()) || changed;
      } catch (err) {
        if (!err.kind) {
          throw err;
        }
        changed = this.applyFailure(err) || changed;
      }
    }
    await this.publishDevices();
    await this.publishStates();
    await this.publishTransports();
    await this.publishConnectionStatus();
    this.save();
    if (changed) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  /** @returns {Promise<boolean>} whether something visible changed */
  async readPhones() {
    const local = this.config.mode === MODES.LOCAL;
    const [devices, health] = await Promise.all([
      this.client.getDevices(),
      local ? this.client.getHealth().catch((err) => err) : null,
    ]);
    const phones = parseDevices(devices);
    const reading = health && !(health instanceof Error) ? parseHealth(health) : null;
    if (health instanceof Error) {
      this.issues.fail('health', `Battery not readable: ${health.message}`);
    } else if (local) {
      this.issues.ok('health');
    }

    const wasDown = this.link instanceof Error;
    this.link = true;
    if (!this.everConnected) {
      this.everConnected = true;
      logger.info(
        `Connected to the SMS gateway (${this.config.mode}, ${hostOf(this.config.apiUrl)}): ${phones.length} phone(s)`,
      );
    } else if (wasDown) {
      this.issues.ok('link', 'SMS gateway answers again');
    }
    this.issues.ok('link');

    let changed = wasDown;
    const seen = new Set();
    for (const phone of phones) {
      seen.add(phone.id);
      const reachable = local
        ? true
        : phone.lastSeen !== null &&
          this.now() - Date.parse(phone.lastSeen) <= this.config.offlineAfterMs;
      const previous = this.phones.get(phone.id);
      const record = {
        phone,
        reachable,
        battery: reading?.battery ?? null,
        charging: reading?.charging ?? null,
        version: reading?.version ?? null,
      };
      // Local: the phone is the server, its loss and return are the link's.
      if (!local && !wasDown && previous && previous.reachable !== reachable) {
        const name = this.phoneLabel(record);
        if (reachable) {
          logger.info(`${name}: in contact again`);
        } else {
          logger.warn(`${name}: no contact with the server for a while`);
        }
      }
      changed ||=
        !previous ||
        previous.reachable !== reachable ||
        previous.battery !== record.battery ||
        previous.charging !== record.charging ||
        previous.phone.name !== phone.name;
      this.phones.set(phone.id, record);
    }
    for (const id of [...this.phones.keys()]) {
      if (!seen.has(id)) {
        this.phones.delete(id);
        changed = true;
      }
    }
    return changed;
  }

  applyFailure(err) {
    const was = this.link;
    this.link = err;
    for (const record of this.phones.values()) {
      record.reachable = false;
    }
    this.issues.fail('link', `SMS gateway: ${err.message}`);
    return !(was instanceof Error) || was.kind !== err.kind;
  }

  phoneLabel(record) {
    return `Phone ${record.phone.name}`;
  }

  // --- Following the messages sent ------------------------------------------

  /** @returns {Promise<boolean>} whether a followed message changed */
  async trackMessages() {
    const now = this.now();
    const open = this.saved.tracked
      .filter((message) => !message.final && now - message.at < this.timings.trackForMs)
      .slice(-this.timings.trackPerCycle);
    let changed = false;
    for (const message of this.saved.tracked) {
      if (!message.final && now - message.at >= this.timings.trackForMs) {
        message.final = true; // no delivery report after a day: left as it is
      }
    }
    for (const message of open) {
      let state;
      try {
        state = parseMessageState(await this.client.getMessage(message.id));
      } catch (err) {
        if (err.kind === ERROR_KINDS.NOT_FOUND) {
          // Purged by the app (its message log lifetime): nothing more to learn.
          message.final = true;
          continue;
        }
        throw err;
      }
      if (state) {
        changed = (await this.applyMessageState(message, state)) || changed;
      }
    }
    return changed;
  }

  /**
   * Apply a state read from the API to a followed message: count the SMS
   * that went out or failed (once each), fire "SMS failed".
   */
  async applyMessageState(message, state) {
    let changed = message.status !== state.status;
    message.status = state.status;
    message.final = FINAL_STATUSES.has(state.status);
    const counters = this.countersOf(message.phoneId);
    const failed = [];
    for (const recipient of message.recipients) {
      const read = state.recipients.find((entry) => entry.number === recipient.number);
      if (!read) {
        continue;
      }
      changed ||= recipient.status !== read.status;
      recipient.status = read.status;
      recipient.error = read.error;
      if ([STATUS.SENT, STATUS.DELIVERED].includes(read.status) && !recipient.counted) {
        recipient.counted = true;
        counters.sent += 1;
      } else if (read.status === STATUS.FAILED && !recipient.counted) {
        recipient.counted = true;
        counters.failed += 1;
        failed.push(recipient);
      }
    }
    if (failed.length > 0) {
      logger.warn(
        `SMS ${message.id} failed for ${failed.map((r) => maskNumber(r.number)).join(', ')}: ${failed[0].error ?? 'no reason given'}`,
      );
      await this.fire(TRIGGERS.FAILED, {
        device: message.phoneId ? deviceIds(this.gladys, message.phoneId).device : null,
        message_id: message.id,
        recipients: failed.map((r) => r.number).join(', '),
        error: (failed.find((r) => r.error)?.error ?? '').slice(0, MAX_EVENT_TEXT),
      });
    }
    return changed;
  }

  countersOf(phoneId) {
    const key = phoneId ?? '_';
    this.saved.counters[key] ??= { sent: 0, failed: 0, received: 0 };
    return this.saved.counters[key];
  }

  // --- Received SMS ------------------------------------------------------------

  /** @returns {Promise<boolean>} whether an SMS was received */
  async readInbox() {
    if (!this.config.receiveSms) {
      return false;
    }
    if (this.inbox.supported === false && this.now() < this.inbox.retryAt) {
      return false;
    }
    // Local: the app is the phone. Servers: one read per phone, so each SMS
    // is credited to the phone that received it.
    const scopes =
      this.config.mode === MODES.LOCAL
        ? [...this.phones.keys()].slice(0, 1).map((id) => ({ scope: id, deviceId: null }))
        : [...this.phones.keys()].map((id) => ({ scope: id, deviceId: id }));
    let received = false;
    for (const { scope, deviceId } of scopes) {
      let items;
      try {
        items = await this.readInboxPages(deviceId);
      } catch (err) {
        if (err.kind === ERROR_KINDS.NOT_FOUND) {
          this.inbox = { supported: false, retryAt: this.now() + this.timings.inboxRetryMs };
          this.issues.fail(
            'inbox',
            'This app version has no inbox (GET /inbox): received SMS cannot be read, update the app to 1.59.0 or later',
          );
          return received;
        }
        throw err;
      }
      this.inbox.supported = true;
      this.issues.ok('inbox', 'Inbox readable again: received SMS are read');
      received = (await this.applyInbox(scope, items)) || received;
    }
    return received;
  }

  async readInboxPages(deviceId) {
    const from = new Date(this.now() - this.timings.inboxWindowMs);
    const all = [];
    for (let page = 0; page < this.timings.inboxPages; page += 1) {
      const items = await this.client.listInbox({ from, deviceId, limit: 100, offset: page * 100 });
      all.push(...items);
      if (items.length < 100) {
        break;
      }
    }
    return all;
  }

  async applyInbox(scope, items) {
    const now = this.now();
    const inbox = this.saved.inbox;
    for (const [id, at] of Object.entries(inbox.seen)) {
      if (now - at > this.timings.inboxMemoryMs) {
        delete inbox.seen[id];
      }
    }
    const messages = items
      .map(parseIncoming)
      .filter(Boolean)
      .filter((message) => !(message.id in inbox.seen))
      .sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));
    const baseline = !inbox.baselined.includes(scope);
    if (baseline) {
      // First read for this phone: what is already there is not news.
      inbox.baselined.push(scope);
    }
    let fired = false;
    for (const message of messages) {
      inbox.seen[message.id] = now;
      if (baseline) {
        continue;
      }
      if (message.encrypted) {
        this.issues.fail(
          'encrypted',
          'A received SMS is end-to-end encrypted in the app: it cannot be read, turn the encryption off',
        );
        continue;
      }
      this.countersOf(scope).received += 1;
      logger.debug(`SMS received from ${maskNumber(message.sender)}`);
      await this.fire(TRIGGERS.RECEIVED, {
        device: deviceIds(this.gladys, scope).device,
        sender: message.sender,
        message: message.text.slice(0, MAX_EVENT_TEXT),
        received_at: message.receivedAt,
        sim_number: message.simNumber,
      });
      fired = true;
    }
    return fired;
  }

  async fire(key, data) {
    try {
      await this.gladys.publishSceneEvent(key, data);
      this.issues.ok('scene-event');
    } catch (err) {
      this.issues.fail('scene-event', `Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys ----------------------------------------------------

  async publishDevices() {
    const phones = [...this.phones.values()].map((record) => record.phone);
    const key = JSON.stringify([
      this.config.mode,
      this.config.language,
      phones.map((phone) => [phone.id, phone.name]),
    ]);
    if (key === this.devicesKey || this.link === null) {
      return;
    }
    try {
      // Even an empty list: the Discovery tab then shows no stale phone.
      await this.gladys.publishDiscoveredDevices(
        phones.map((phone) =>
          buildDevice(this.gladys, phone, this.config.mode, this.config.language),
        ),
      );
      this.devicesKey = key;
      this.issues.ok('devices');
    } catch (err) {
      this.issues.fail('devices', `Devices refused by Gladys: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: read the phones, publish them again. */
  async rediscover() {
    this.devicesKey = null;
    await this.refresh({ force: true });
  }

  async publishStates() {
    const states = [];
    for (const [id, record] of this.phones) {
      const snapshot = { ...record, counters: this.countersOf(id) };
      for (const { externalId, value } of featureValues(
        this.gladys,
        id,
        this.config.mode,
        snapshot,
      )) {
        if (value !== null) {
          states.push({ device_feature_external_id: externalId, state: value });
        }
      }
    }
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.issues.ok('states');
    } catch (err) {
      this.issues.fail('states', `States refused by Gladys: ${err.message}`);
    }
  }

  /** The user added a device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    if (phoneIdOf(this.gladys, device.external_id) === null) {
      return;
    }
    this.gladys.forgetPublishedStates(device.external_id);
    await this.publishStates();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  async publishTransports() {
    const entries = [];
    for (const [id, record] of this.phones) {
      const externalId = deviceIds(this.gladys, id).device;
      const transport = !record.reachable
        ? DEVICE_TRANSPORTS.UNREACHABLE
        : this.config.mode === MODES.LOCAL
          ? DEVICE_TRANSPORTS.LOCAL
          : DEVICE_TRANSPORTS.CLOUD;
      if (this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
      this.issues.ok('transports');
    } catch (err) {
      this.issues.fail('transports', `Transports refused by Gladys: ${err.message}`);
    }
  }

  /** The status under the integration name, with what to do when it fails. */
  connectionStatus() {
    const config = this.config;
    if (!this.client) {
      const message =
        config.mode !== MODES.CLOUD && config.addressProblem === 'invalid'
          ? CONNECTION_TEXT.invalidAddress
          : config.mode !== MODES.CLOUD && config.addressProblem === 'missing'
            ? CONNECTION_TEXT.missingAddress
            : CONNECTION_TEXT.missingCredentials;
      return { connected: false, message };
    }
    if (this.link instanceof Error) {
      return { connected: false, message: ERROR_TEXT[this.link.kind] };
    }
    if (this.link === true && this.phones.size === 0) {
      return { connected: false, message: CONNECTION_TEXT.noPhone };
    }
    if ([...this.phones.values()].some((record) => !record.reachable)) {
      return { connected: true, message: CONNECTION_TEXT.phoneOffline };
    }
    return { connected: true };
  }

  async publishConnectionStatus() {
    if (this.client && this.link === null) {
      return; // not read yet
    }
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connectionKey) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connectionKey = key;
      this.issues.ok('connection-status');
    } catch (err) {
      this.issues.fail('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  // --- Sending ----------------------------------------------------------------------

  text(entry) {
    return pick(SEND_TEXT, this.config?.language ?? 'en')[entry];
  }

  /**
   * Send one text message, under the hourly limit. Throws an Error whose
   * message, in the configured language, says why nothing was sent.
   * @param {object} request
   * @param {unknown} request.recipients numbers, comma separated
   * @param {unknown} request.text
   * @param {unknown} [request.sim] 1 to 3, anything else: the phone's default
   * @param {unknown} [request.device] the device external id of the phone to use
   * @param {string} [request.origin] for the log line (scene, test)
   * @returns {Promise<{ id: string, recipients: number, status: string }>}
   */
  async send({ recipients, text, sim, device, origin = 'scene' }) {
    if (!this.config || !this.client) {
      throw new Error(this.text('notConfigured'));
    }
    const { numbers, invalid } = parseRecipients(recipients);
    if (invalid.length > 0) {
      throw new Error(this.text('invalidNumber')(maskEntry(invalid[0])));
    }
    if (numbers.length === 0) {
      throw new Error(this.text('noRecipient'));
    }
    if (numbers.length > MAX_RECIPIENTS) {
      throw new Error(this.text('tooManyRecipients')(MAX_RECIPIENTS));
    }
    const body = typeof text === 'string' ? text : '';
    if (body.trim() === '') {
      throw new Error(this.text('emptyText'));
    }
    if (body.length > MAX_TEXT_LENGTH) {
      throw new Error(this.text('textTooLong')(MAX_TEXT_LENGTH));
    }
    let phoneId = null;
    if (typeof device === 'string' && device) {
      phoneId = phoneIdOf(this.gladys, device);
      if (phoneId === null || (this.link === true && !this.phones.has(phoneId))) {
        throw new Error(this.text('unknownPhone'));
      }
    }
    const simNumber = parseSim(sim);

    const count = numbers.length;
    const limit = this.config.maxSmsPerHour;
    const check = this.limiter.check(count, limit);
    if (!check.allowed) {
      this.issues.fail(
        'limit',
        `SMS refused (${origin}): limit of ${limit} SMS per hour reached (${check.used} sent over the last hour)`,
      );
      throw new Error(
        check.retryAt === null
          ? this.text('limitTooLow')(limit)
          : this.text('limitReached')(limit, timeOf(check.retryAt, this.config.language)),
      );
    }

    const masked = numbers.map(maskNumber).join(', ');
    let data;
    try {
      data = await this.client.sendMessage({
        phoneNumbers: numbers,
        text: body,
        simNumber,
        deviceId: phoneId,
      });
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      if (err.timedOut) {
        // It may still go out: it counts against the limit.
        this.limiter.record(count);
        this.save();
      }
      this.issues.fail('send', `SMS to ${masked} not sent (${origin}): ${err.message}`);
      const reason = pick(ERROR_TEXT[err.kind], this.config.language);
      // The API says why it refused (an invalid number for the app, a SIM
      // card that does not exist): worth showing.
      const detail = err.kind === ERROR_KINDS.REFUSED ? ` (${err.message})` : '';
      throw new Error(this.text('failed')(`${reason}${detail}`), { cause: err });
    }
    this.limiter.record(count);
    this.issues.ok('send');
    this.issues.ok('limit', 'Hourly SMS limit: sending again');

    const state = parseMessageState(data);
    const id = state?.id ?? (typeof data?.id === 'string' ? data.id : '');
    const single = this.phones.size === 1 ? [...this.phones.keys()][0] : null;
    const message = {
      id,
      at: this.now(),
      phoneId: state?.deviceId ?? phoneId ?? single,
      status: state?.status ?? STATUS.PENDING,
      final: !id,
      recipients: numbers.map((number) => ({ number, status: STATUS.PENDING, error: null })),
    };
    this.saved.tracked.push(message);
    this.saved.tracked = this.saved.tracked.slice(-MAX_TRACKED);
    if (state) {
      await this.applyMessageState(message, state);
    }
    logger.info(
      `SMS queued (${origin}) for ${count} recipient(s) (${masked})${simNumber ? ` on SIM ${simNumber}` : ''}, message ${id || 'without id'}`,
    );
    this.save();
    await this.publishStates();
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
    return { id, recipients: count, status: message.status };
  }

  // --- What the widget and the reports read ---------------------------------------

  /** SMS sent over the last hour, and the limit. */
  usage() {
    return { used: this.limiter.used(), limit: this.config?.maxSmsPerHour ?? 0 };
  }

  /** The phones, one or all. */
  view(deviceExternalId) {
    if (!deviceExternalId) {
      return [...this.phones.values()];
    }
    const record = this.phones.get(phoneIdOf(this.gladys, deviceExternalId));
    return record ? [record] : [];
  }

  /** The messages followed, newest first, for one phone or all. */
  recent(deviceExternalId) {
    const phoneId = deviceExternalId ? phoneIdOf(this.gladys, deviceExternalId) : null;
    return this.saved.tracked
      .filter((message) => !phoneId || message.phoneId === phoneId)
      .slice()
      .reverse();
  }
}

function emptySaved() {
  return {
    limiter: [],
    counters: {},
    tracked: [],
    inbox: { baselined: [], seen: {} },
  };
}

/** What /data held, checked field by field: a damaged file starts afresh. */
function readSaved(data) {
  const saved = emptySaved();
  if (Array.isArray(data.limiter)) {
    saved.limiter = data.limiter;
  }
  if (data.counters && typeof data.counters === 'object') {
    for (const [id, value] of Object.entries(data.counters)) {
      saved.counters[id] = {
        sent: Number.isInteger(value?.sent) ? value.sent : 0,
        failed: Number.isInteger(value?.failed) ? value.failed : 0,
        received: Number.isInteger(value?.received) ? value.received : 0,
      };
    }
  }
  if (Array.isArray(data.tracked)) {
    saved.tracked = data.tracked
      .filter(
        (message) =>
          message &&
          typeof message.id === 'string' &&
          Number.isFinite(message.at) &&
          Array.isArray(message.recipients),
      )
      .slice(-MAX_TRACKED);
  }
  if (data.inbox && typeof data.inbox === 'object') {
    if (Array.isArray(data.inbox.baselined)) {
      saved.inbox.baselined = data.inbox.baselined.filter((scope) => typeof scope === 'string');
    }
    if (data.inbox.seen && typeof data.inbox.seen === 'object') {
      for (const [id, at] of Object.entries(data.inbox.seen)) {
        if (Number.isFinite(at)) {
          saved.inbox.seen[id] = at;
        }
      }
    }
  }
  return saved;
}
