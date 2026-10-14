// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `sms_gateway`.
//
// The use case: "did the alert SMS go out?" and "is the old phone still
// alive?" at a glance. So the widget shows the phone (reachable, battery),
// how much of the hourly limit is used, and the last SMS sent with their
// state (pending, sent, delivered, failed), plus a Refresh button that reads
// the phone now instead of at the next cycle.
//
// Budget (8 components, 6 tiles, 1 status, 4 buttons): up to three tiles
// (battery, SMS this hour, SMS received), one status list (the phones, then
// the last five SMS) and one button. The figures are sent as values, not
// bound to device features, so the widget works before the devices are added
// to Gladys. Every phone by default, or the one chosen in the settings.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from './hub.js';
import { maskNumber } from './phone.js';
import { STATUS } from './smsgate/model.js';
import { ERROR_TEXT, STATUS_TEXT, allLanguages, pick, timeOf } from './texts.js';

// Action key of the button: permanent once published.
export const ACTIONS = Object.freeze({ REFRESH: 'refresh' });

const RECENT_ROWS = 5;

export const TEXT = {
  configure: {
    en: 'Configure the SMS gateway in the integration settings.',
    fr: "Configurez la passerelle SMS dans les réglages de l'intégration.",
    de: 'Konfiguriere das SMS-Gateway in den Einstellungen der Integration.',
    es: 'Configure la pasarela SMS en los ajustes de la integración.',
  },
  unknown: {
    en: 'This phone is no longer known to the gateway: choose another one in the widget settings.',
    fr: "Ce téléphone n'est plus connu de la passerelle : choisissez-en un autre dans les réglages du widget.",
    de: 'Dieses Telefon ist dem Gateway nicht mehr bekannt: Wähle ein anderes in den Widget-Einstellungen.',
    es: 'Este teléfono ya no es conocido por la pasarela: elija otro en los ajustes del widget.',
  },
  battery: { en: 'Battery', fr: 'Batterie', de: 'Akku', es: 'Batería' },
  thisHour: {
    en: 'SMS this hour',
    fr: 'SMS cette heure',
    de: 'SMS diese Stunde',
    es: 'SMS esta hora',
  },
  received: { en: 'SMS received', fr: 'SMS reçus', de: 'Empfangene SMS', es: 'SMS recibidos' },
  reachable: { en: 'Reachable', fr: 'Joignable', de: 'Erreichbar', es: 'Accesible' },
  unreachable: {
    en: 'Unreachable',
    fr: 'Injoignable',
    de: 'Nicht erreichbar',
    es: 'Inaccesible',
  },
  charging: { en: 'Charging', fr: 'En charge', de: 'Lädt', es: 'Cargando' },
  noSms: { en: 'No SMS sent yet', fr: 'Aucun SMS envoyé', de: 'Noch keine SMS', es: 'Ningún SMS' },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  refreshed: { en: 'Updated.', fr: 'Mis à jour.', de: 'Aktualisiert.', es: 'Actualizado.' },
};

const STATUS_STYLE = {
  [STATUS.PENDING]: { icon: 'clock', color: WIDGET_COLORS.NEUTRAL },
  [STATUS.SENT]: { icon: 'send', color: WIDGET_COLORS.INFO },
  [STATUS.DELIVERED]: { icon: 'check-circle', color: WIDGET_COLORS.SUCCESS },
  [STATUS.FAILED]: { icon: 'x-circle', color: WIDGET_COLORS.DANGER },
  [STATUS.CANCELLED]: { icon: 'slash', color: WIDGET_COLORS.WARNING },
};

const t = (text, language) => pick(text, language);
const fit = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

function phoneRow(record, language) {
  const label = fit(record.phone.name, 40);
  if (!record.reachable) {
    return {
      label,
      icon: 'alert-triangle',
      value: t(TEXT.unreachable, language),
      color: WIDGET_COLORS.DANGER,
    };
  }
  return {
    label,
    icon: 'smartphone',
    value: record.charging
      ? `${t(TEXT.reachable, language)} · ${t(TEXT.charging, language)}`
      : t(TEXT.reachable, language),
    color: WIDGET_COLORS.SUCCESS,
  };
}

/** One SMS sent: when, to whom (masked), and its state. */
export function messageRow(sent, language) {
  const [first, ...others] = sent.recipients;
  const who = `${maskNumber(first?.number)}${others.length ? ` +${others.length}` : ''}`;
  const style = STATUS_STYLE[sent.status] ?? STATUS_STYLE[STATUS.PENDING];
  const failed = sent.recipients.find((recipient) => recipient.error);
  const status = t(STATUS_TEXT[sent.status] ?? STATUS_TEXT[STATUS.PENDING], language);
  return {
    label: `${timeOf(sent.at, language)} · ${who}`,
    icon: style.icon,
    value: fit(
      sent.status === STATUS.FAILED && failed ? `${status} · ${failed.error}` : status,
      40,
    ),
    color: style.color,
  };
}

async function get(hub, { settings, language = 'en' }) {
  if (!hub.client) {
    return message(TEXT.configure, language);
  }
  const phones = hub.view(settings?.device);
  if (settings?.device && phones.length === 0 && hub.link === true) {
    return message(TEXT.unknown, language);
  }
  const components = [];
  const problem = hub.link instanceof Error ? ERROR_TEXT[hub.link.kind] : null;
  if (problem) {
    components.push({ type: 'text', variant: 'caption', text: fit(t(problem, language), 80) });
  }
  const battery = phones.find((record) => record.battery !== null && record.battery !== undefined);
  if (battery) {
    components.push({
      type: 'value',
      value: battery.battery,
      unit: '%',
      label: t(TEXT.battery, language),
      icon: battery.charging ? 'battery-charging' : 'battery',
      color: battery.battery < 20 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    });
  }
  const { used, limit } = hub.usage();
  components.push({
    type: 'value',
    value: `${used}/${limit}`,
    label: t(TEXT.thisHour, language),
    icon: 'send',
    color: used >= limit ? WIDGET_COLORS.WARNING : WIDGET_COLORS.PRIMARY,
  });
  if (hub.config.receiveSms) {
    const received = phones.reduce(
      (sum, record) => sum + (hub.saved.counters[record.phone.id]?.received ?? 0),
      0,
    );
    components.push({
      type: 'value',
      value: received,
      label: t(TEXT.received, language),
      icon: 'inbox',
    });
  }

  const items = phones.slice(0, 3).map((record) => phoneRow(record, language));
  const recent = hub.recent(settings?.device).slice(0, RECENT_ROWS);
  items.push(...recent.map((sent) => messageRow(sent, language)));
  if (recent.length === 0) {
    items.push({
      label: t(TEXT.noSms, language),
      icon: 'message-square',
      value: '—',
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  components.push({ type: 'status', items: items.slice(0, 10) });
  components.push({
    type: 'button',
    label: t(TEXT.refresh, language),
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: ACTIONS.REFRESH },
  });
  // A message on its way: refresh sooner.
  const moving = recent.some((sent) => !sent.final);
  return { ttl_seconds: moving ? 30 : 120, components };
}

async function action(hub, { actionKey }) {
  if (actionKey !== ACTIONS.REFRESH) {
    throw new Error(`Unknown action ${actionKey}`);
  }
  await hub.refresh({ force: true });
  return { message: allLanguages((language) => t(TEXT.refreshed, language)) };
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
