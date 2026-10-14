// -----------------------------------------------------------------------------
// One Gladys device per phone running SMS Gateway for Android: the app itself
// in local mode, every phone of the account in cloud and private modes.
//
// Identity: the device id the app or the server gives the phone (a random
// 21-character id, stable for the life of the installation), never its name.
//
// Features (category/type couples of the core table, see
// test/gladys-rules.test.js):
//   - reachable: input/binary, 1 when the phone answers (local) or contacted
//     the server recently (cloud, private: the "offline after" setting);
//   - battery level and charging: battery/integer and battery/charging, local
//     mode only (the servers do not relay the phone's battery);
//   - SMS sent, failed and received: counter-sensor/integer, counted by the
//     integration since it was installed (the SMS it sent, the SMS the phone
//     received while the integration was reading its inbox). A message to
//     three numbers is three SMS.
//
// The devices are published with should_poll: false: the integration reads
// the phone on its own timer (src/hub.js), at the interval of the
// configuration (up to 5 minutes, beyond the fixed list of the core).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';
import { MODES } from './config.js';

export const DEVICE_TYPE = 'phone';
export const MODE_PARAM = 'SMS_GATEWAY_MODE';

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  REACHABLE: 'reachable',
  BATTERY: 'battery',
  CHARGING: 'charging',
  SENT: 'sms_sent',
  FAILED: 'sms_failed',
  RECEIVED: 'sms_received',
});

// Device and feature names, in the language chosen in the configuration
// (Gladys does not tell a device integration the user's language). Frozen at
// creation in Gladys.
export const NAMES = {
  en: {
    device: 'SMS gateway',
    [FEATURE_KEYS.REACHABLE]: 'Phone reachable',
    [FEATURE_KEYS.BATTERY]: 'Phone battery',
    [FEATURE_KEYS.CHARGING]: 'Phone charging',
    [FEATURE_KEYS.SENT]: 'SMS sent',
    [FEATURE_KEYS.FAILED]: 'SMS failed',
    [FEATURE_KEYS.RECEIVED]: 'SMS received',
  },
  fr: {
    device: 'Passerelle SMS',
    [FEATURE_KEYS.REACHABLE]: 'Téléphone joignable',
    [FEATURE_KEYS.BATTERY]: 'Batterie du téléphone',
    [FEATURE_KEYS.CHARGING]: 'Téléphone en charge',
    [FEATURE_KEYS.SENT]: 'SMS envoyés',
    [FEATURE_KEYS.FAILED]: 'SMS en échec',
    [FEATURE_KEYS.RECEIVED]: 'SMS reçus',
  },
  de: {
    device: 'SMS-Gateway',
    [FEATURE_KEYS.REACHABLE]: 'Telefon erreichbar',
    [FEATURE_KEYS.BATTERY]: 'Akku des Telefons',
    [FEATURE_KEYS.CHARGING]: 'Telefon lädt',
    [FEATURE_KEYS.SENT]: 'Gesendete SMS',
    [FEATURE_KEYS.FAILED]: 'Fehlgeschlagene SMS',
    [FEATURE_KEYS.RECEIVED]: 'Empfangene SMS',
  },
  es: {
    device: 'Pasarela SMS',
    [FEATURE_KEYS.REACHABLE]: 'Teléfono accesible',
    [FEATURE_KEYS.BATTERY]: 'Batería del teléfono',
    [FEATURE_KEYS.CHARGING]: 'Teléfono cargando',
    [FEATURE_KEYS.SENT]: 'SMS enviados',
    [FEATURE_KEYS.FAILED]: 'SMS fallidos',
    [FEATURE_KEYS.RECEIVED]: 'SMS recibidos',
  },
};

// Display bounds (the core never applies them on write).
const COUNTER_MAX = 1_000_000_000;

const binary = (category, type, value) => ({
  definition: {
    category,
    type,
    read_only: true,
    has_feedback: false,
    keep_history: true,
    min: 0,
    max: 1,
  },
  value: (snapshot) => {
    const known = value(snapshot);
    return known === null || known === undefined ? null : known ? 1 : 0;
  },
});

const counter = (key) => ({
  definition: {
    category: DEVICE_FEATURE_CATEGORIES.COUNTER_SENSOR,
    type: DEVICE_FEATURE_TYPES.SENSOR.INTEGER,
    read_only: true,
    has_feedback: false,
    keep_history: true,
    min: 0,
    max: COUNTER_MAX,
  },
  value: (snapshot) => snapshot.counters?.[key] ?? 0,
});

// Order = display order in Gladys. `localOnly`: only the app's own server
// tells the battery.
const FEATURES = [
  {
    key: FEATURE_KEYS.REACHABLE,
    // An "input": an on/off badge with a label in the front, where a light
    // sensor has none and a presence sensor would read "presence detected".
    ...binary(
      DEVICE_FEATURE_CATEGORIES.INPUT,
      DEVICE_FEATURE_TYPES.INPUT.BINARY,
      (snapshot) => snapshot.reachable,
    ),
  },
  {
    key: FEATURE_KEYS.BATTERY,
    localOnly: true,
    definition: {
      category: DEVICE_FEATURE_CATEGORIES.BATTERY,
      type: DEVICE_FEATURE_TYPES.BATTERY.INTEGER,
      unit: DEVICE_FEATURE_UNITS.PERCENT,
      read_only: true,
      has_feedback: false,
      keep_history: true,
      min: 0,
      max: 100,
    },
    value: (snapshot) => snapshot.battery ?? null,
  },
  {
    key: FEATURE_KEYS.CHARGING,
    localOnly: true,
    ...binary(
      DEVICE_FEATURE_CATEGORIES.BATTERY,
      DEVICE_FEATURE_TYPES.BATTERY.CHARGING,
      (snapshot) => snapshot.charging,
    ),
  },
  { key: FEATURE_KEYS.SENT, ...counter('sent') },
  { key: FEATURE_KEYS.FAILED, ...counter('failed') },
  { key: FEATURE_KEYS.RECEIVED, ...counter('received') },
];

const featuresOf = (mode) =>
  FEATURES.filter((feature) => !feature.localOnly || mode === MODES.LOCAL);

/** External ids of a phone's device and features. */
export const deviceIds = (gladys, phoneId) => gladys.externalIds(DEVICE_TYPE, phoneId);

/** The phone id of a device external id, null when it is not one of ours. */
export function phoneIdOf(gladys, externalId) {
  const prefix = deviceIds(gladys, '').device;
  return typeof externalId === 'string' && externalId.startsWith(prefix) && externalId !== prefix
    ? externalId.slice(prefix.length)
    : null;
}

/**
 * The discovery payload of a phone.
 * @param {object} gladys SDK client
 * @param {{ id: string, name: string }} phone
 * @param {string} mode MODES value
 * @param {string} language names language
 */
export function buildDevice(gladys, phone, mode, language = 'fr') {
  const ids = deviceIds(gladys, phone.id);
  const names = NAMES[language] ?? NAMES.en;
  return {
    name: `${names.device} ${phone.name}`.slice(0, 80),
    external_id: ids.device,
    should_poll: false,
    params: [{ name: MODE_PARAM, value: mode }],
    features: featuresOf(mode).map(({ key, definition }) => ({
      ...definition,
      name: names[key],
      external_id: ids.feature(key),
    })),
  };
}

/**
 * The value of every feature of a phone (null: nothing to publish).
 * @param {object} snapshot `{ reachable, battery, charging, counters: { sent, failed, received } }`
 * @returns {Array<{ key: string, externalId: string, value: number|null }>}
 */
export function featureValues(gladys, phoneId, mode, snapshot) {
  const ids = deviceIds(gladys, phoneId);
  return featuresOf(mode).map(({ key, value }) => ({
    key,
    externalId: ids.feature(key),
    value: value(snapshot),
  }));
}
