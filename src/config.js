// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// Three ways to reach the SMS Gateway for Android app, as the app offers them:
//   - local:   the API the app serves on the home network (port 8080 by default);
//   - cloud:   the public relay server of the project, api.sms-gate.app;
//   - private: the same server software, self-hosted at another address.
// The same username / password fields serve the three: the app shows the
// pair to use on its "Local server" or "Cloud server" card.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const MODES = Object.freeze({ LOCAL: 'local', CLOUD: 'cloud', PRIVATE: 'private' });

export const CLOUD_API_URL = 'https://api.sms-gate.app/3rdparty/v1';
export const DEFAULT_LOCAL_PORT = 8080;

// Refresh intervals offered in the configuration, in seconds.
export const POLL_INTERVALS = ['30', '60', '120', '300'];

// Cloud and private modes only: how long after its last contact with the
// server a phone counts as unreachable, in minutes.
export const OFFLINE_AFTER_MINUTES = ['15', '60', '360', '1440'];

// Bounds of the hourly sending limit (the manifest field declares the same).
export const MIN_SMS_PER_HOUR = 1;
export const MAX_SMS_PER_HOUR = 200;

export const DEFAULT_CONFIG = {
  mode: MODES.LOCAL,
  local_address: '',
  server_url: '',
  username: '',
  password: '',
  max_sms_per_hour: 20,
  receive_sms: true,
  poll_interval: '60',
  offline_after_minutes: '60',
  language: 'fr',
};

/**
 * The address of the phone typed by the user: an IP or a host name, with or
 * without port and scheme (`192.168.1.50`, `192.168.1.50:8081`,
 * `http://phone.lan:8080/`). HTTP and port 8080 by default, the path dropped.
 * @param {unknown} raw
 * @returns {string|null} `http(s)://host:port`, null when unusable
 */
export function parseLocalAddress(raw) {
  const url = parseUrl(raw, 'http');
  if (!url) {
    return null;
  }
  // No port typed: the app's default one, not the protocol's.
  return `${url.protocol}//${url.hostname}:${url.port || DEFAULT_LOCAL_PORT}`;
}

/**
 * The address of a private server: `https://sms.example.com`, or with the
 * path it is served under (`https://example.com/sms`). The API lives under
 * `/3rdparty/v1` of that address, added unless already typed.
 * @param {unknown} raw
 * @returns {string|null} the API base URL, null when unusable
 */
export function parseServerUrl(raw) {
  const url = parseUrl(raw, 'https');
  if (!url) {
    return null;
  }
  const path = url.pathname.replace(/\/+$/, '');
  const base = /\/3rdparty\/v1$/.test(path) ? path : `${path}/3rdparty/v1`;
  return `${url.origin}${base}`;
}

function parseUrl(raw, defaultScheme) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `${defaultScheme}://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs and the device params.
  if (url.username || url.password) {
    return null;
  }
  return url;
}

/** Host and port shown to the user, without scheme nor API path. */
export function hostOf(baseUrl) {
  return new URL(baseUrl).host;
}

/** A whole number from a form value (number or string), within bounds. */
function integer(raw, fallback, min, max) {
  const number =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw.trim())
        : NaN;
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(number)));
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };
  const mode = pick('mode', Object.values(MODES));

  // The API base URL, null while the address is missing or not understood.
  let apiUrl;
  let addressProblem = null;
  if (mode === MODES.CLOUD) {
    apiUrl = CLOUD_API_URL;
  } else {
    const key = mode === MODES.LOCAL ? 'local_address' : 'server_url';
    const typed = text(key);
    apiUrl = mode === MODES.LOCAL ? parseLocalAddress(typed) : parseServerUrl(typed);
    if (!apiUrl) {
      addressProblem = typed ? 'invalid' : 'missing';
    }
  }

  return {
    mode,
    apiUrl,
    addressProblem,
    username: text('username'),
    // Passwords are kept as typed: spaces may be part of them.
    password: typeof source.password === 'string' ? source.password : '',
    maxSmsPerHour: integer(
      source.max_sms_per_hour,
      DEFAULT_CONFIG.max_sms_per_hour,
      MIN_SMS_PER_HOUR,
      MAX_SMS_PER_HOUR,
    ),
    receiveSms: !(source.receive_sms === false || source.receive_sms === 'false'),
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    offlineAfterMs: Number(pick('offline_after_minutes', OFFLINE_AFTER_MINUTES)) * 60_000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}

/** Whether the configuration holds enough to call the API. */
export const isConfigured = (config) =>
  Boolean(config.apiUrl && config.username && config.password);
