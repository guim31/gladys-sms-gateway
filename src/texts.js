// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the reports of the Configuration screen actions,
// the errors of the "Send an SMS" scene action. Four languages, the four of
// the Gladys interface; German says "du", Spanish "usted".
// test/i18n.test.js checks every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './smsgate/client.js';
import { STATUS } from './smsgate/model.js';

export const LANGUAGE_FALLBACK = 'en';

export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];

/** "Label: text", with the space French puts before a colon. */
export const labelled = (label, text, language) =>
  `${label}${language === 'fr' ? ' : ' : ': '}${text}`;

/** One multi-language object from a function of the language. */
export const allLanguages = (render) =>
  Object.fromEntries(['en', 'fr', 'de', 'es'].map((language) => [language, render(language)]));

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  missingAddress: {
    en: 'Enter the address of the phone (local mode) or of your server in the configuration.',
    fr: "Saisissez l'adresse du téléphone (mode local) ou de votre serveur dans la configuration.",
    de: 'Gib die Adresse des Telefons (lokaler Modus) oder deines Servers in der Konfiguration ein.',
    es: 'Introduzca la dirección del teléfono (modo local) o de su servidor en la configuración.',
  },
  invalidAddress: {
    en: 'Address not understood, e.g. 192.168.1.50:8080 or https://sms.example.com',
    fr: 'Adresse incomprise, ex. 192.168.1.50:8080 ou https://sms.example.com',
    de: 'Adresse nicht verstanden, z. B. 192.168.1.50:8080 oder https://sms.example.com',
    es: 'Dirección no válida, p. ej. 192.168.1.50:8080 o https://sms.example.com',
  },
  missingCredentials: {
    en: 'Enter the username and password shown by the SMS Gateway app.',
    fr: "Saisissez l'utilisateur et le mot de passe affichés par l'application SMS Gateway.",
    de: 'Gib den Benutzernamen und das Passwort ein, die die App SMS Gateway anzeigt.',
    es: 'Introduzca el usuario y la contraseña que muestra la aplicación SMS Gateway.',
  },
  noPhone: {
    en: 'No phone is registered on this account: open the app and connect it to the server.',
    fr: "Aucun téléphone n'est inscrit sur ce compte : ouvrez l'application et connectez-la au serveur.",
    de: 'Auf diesem Konto ist kein Telefon registriert: Öffne die App und verbinde sie mit dem Server.',
    es: 'No hay ningún teléfono registrado en esta cuenta: abra la aplicación y conéctela al servidor.',
  },
  phoneOffline: {
    en: 'The server answers, but the phone has not contacted it recently.',
    fr: "Le serveur répond, mais le téléphone ne l'a pas contacté récemment.",
    de: 'Der Server antwortet, aber das Telefon hat sich in letzter Zeit nicht gemeldet.',
    es: 'El servidor responde, pero el teléfono no se ha conectado a él recientemente.',
  },
};

// One short explanation per error kind (src/smsgate/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'no answer: is the phone on, the app started, the address right?',
    fr: "pas de réponse : le téléphone est-il allumé, l'application lancée, l'adresse juste ?",
    de: 'keine Antwort: Ist das Telefon an, die App gestartet, die Adresse richtig?',
    es: 'sin respuesta: ¿está el teléfono encendido, la aplicación iniciada, la dirección correcta?',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'username or password refused',
    fr: 'utilisateur ou mot de passe refusé',
    de: 'Benutzername oder Passwort abgelehnt',
    es: 'usuario o contraseña rechazados',
  },
  [ERROR_KINDS.NOT_FOUND]: {
    en: 'unknown address on the API: update the app, or check the server address',
    fr: "adresse inconnue de l'API : mettez l'application à jour, ou vérifiez l'adresse du serveur",
    de: 'Adresse der API unbekannt: Aktualisiere die App oder prüfe die Serveradresse',
    es: 'dirección desconocida para la API: actualice la aplicación o compruebe la dirección del servidor',
  },
  [ERROR_KINDS.REFUSED]: {
    en: 'request refused by the app',
    fr: "requête refusée par l'application",
    de: 'Anfrage von der App abgelehnt',
    es: 'solicitud rechazada por la aplicación',
  },
  [ERROR_KINDS.QUEUE]: {
    en: 'the phone is offline or its sending queue is full',
    fr: "le téléphone est hors ligne ou sa file d'envoi est pleine",
    de: 'das Telefon ist offline oder seine Warteschlange ist voll',
    es: 'el teléfono está desconectado o su cola de envío está llena',
  },
  [ERROR_KINDS.HTTP]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The four states the user sees (src/smsgate/model.js), plus cancelled.
export const STATUS_TEXT = {
  [STATUS.PENDING]: { en: 'Pending', fr: 'En attente', de: 'Ausstehend', es: 'Pendiente' },
  [STATUS.SENT]: { en: 'Sent', fr: 'Envoyé', de: 'Gesendet', es: 'Enviado' },
  [STATUS.DELIVERED]: { en: 'Delivered', fr: 'Délivré', de: 'Zugestellt', es: 'Entregado' },
  [STATUS.FAILED]: { en: 'Failed', fr: 'Échec', de: 'Fehlgeschlagen', es: 'Fallido' },
  [STATUS.CANCELLED]: { en: 'Cancelled', fr: 'Annulé', de: 'Abgebrochen', es: 'Cancelado' },
};

// Errors of a send (scene action, test action), shown in Gladys. A refused
// send says why, and what to change.
export const SEND_TEXT = {
  en: {
    notConfigured: 'The SMS gateway is not configured yet.',
    noRecipient: 'No recipient: enter a number in the international format, e.g. +33639980012.',
    invalidNumber: (entry) =>
      `"${entry}" is not a number in the international format (e.g. +33639980012): SMS not sent.`,
    tooManyRecipients: (max) => `${max} recipients at most per SMS: SMS not sent.`,
    emptyText: 'The message is empty: SMS not sent.',
    textTooLong: (max) => `The message is longer than ${max} characters: SMS not sent.`,
    limitReached: (limit, time) =>
      `Limit of ${limit} SMS per hour reached: SMS not sent. Next one possible at ${time}.`,
    limitTooLow: (limit) =>
      `This message needs more SMS than the limit of ${limit} per hour: SMS not sent.`,
    unknownPhone: 'This phone is no longer known to the gateway: choose another one.',
    failed: (reason) => `SMS not sent: ${reason}`,
  },
  fr: {
    notConfigured: "La passerelle SMS n'est pas encore configurée.",
    noRecipient:
      'Aucun destinataire : saisissez un numéro au format international, ex. +33639980012.',
    invalidNumber: (entry) =>
      `« ${entry} » n'est pas un numéro au format international (ex. +33639980012) : SMS non envoyé.`,
    tooManyRecipients: (max) => `${max} destinataires au plus par SMS : SMS non envoyé.`,
    emptyText: 'Le message est vide : SMS non envoyé.',
    textTooLong: (max) => `Le message dépasse ${max} caractères : SMS non envoyé.`,
    limitReached: (limit, time) =>
      `Limite de ${limit} SMS par heure atteinte : SMS non envoyé. Prochain envoi possible à ${time}.`,
    limitTooLow: (limit) =>
      `Ce message demande plus de SMS que la limite de ${limit} par heure : SMS non envoyé.`,
    unknownPhone: "Ce téléphone n'est plus connu de la passerelle : choisissez-en un autre.",
    failed: (reason) => `SMS non envoyé : ${reason}`,
  },
  de: {
    notConfigured: 'Das SMS-Gateway ist noch nicht konfiguriert.',
    noRecipient:
      'Kein Empfänger: Gib eine Nummer im internationalen Format ein, z. B. +33639980012.',
    invalidNumber: (entry) =>
      `„${entry}“ ist keine Nummer im internationalen Format (z. B. +33639980012): SMS nicht gesendet.`,
    tooManyRecipients: (max) => `Höchstens ${max} Empfänger pro SMS: SMS nicht gesendet.`,
    emptyText: 'Die Nachricht ist leer: SMS nicht gesendet.',
    textTooLong: (max) => `Die Nachricht ist länger als ${max} Zeichen: SMS nicht gesendet.`,
    limitReached: (limit, time) =>
      `Grenze von ${limit} SMS pro Stunde erreicht: SMS nicht gesendet. Nächste SMS möglich um ${time}.`,
    limitTooLow: (limit) =>
      `Diese Nachricht braucht mehr SMS als die Grenze von ${limit} pro Stunde: SMS nicht gesendet.`,
    unknownPhone: 'Dieses Telefon ist dem Gateway nicht mehr bekannt: Wähle ein anderes.',
    failed: (reason) => `SMS nicht gesendet: ${reason}`,
  },
  es: {
    notConfigured: 'La pasarela SMS aún no está configurada.',
    noRecipient:
      'Ningún destinatario: introduzca un número en formato internacional, p. ej. +33639980012.',
    invalidNumber: (entry) =>
      `«${entry}» no es un número en formato internacional (p. ej. +33639980012): SMS no enviado.`,
    tooManyRecipients: (max) => `${max} destinatarios como máximo por SMS: SMS no enviado.`,
    emptyText: 'El mensaje está vacío: SMS no enviado.',
    textTooLong: (max) => `El mensaje supera los ${max} caracteres: SMS no enviado.`,
    limitReached: (limit, time) =>
      `Límite de ${limit} SMS por hora alcanzado: SMS no enviado. Próximo envío posible a las ${time}.`,
    limitTooLow: (limit) =>
      `Este mensaje necesita más SMS que el límite de ${limit} por hora: SMS no enviado.`,
    unknownPhone: 'Este teléfono ya no es conocido por la pasarela: elija otro.',
    failed: (reason) => `SMS no enviado: ${reason}`,
  },
};

// The reports of the Configuration screen actions.
export const REPORT_TEXT = {
  en: {
    modes: { local: 'local network', cloud: 'cloud server', private: 'private server' },
    connected: (mode) => `Connected (${mode}).`,
    phone: (name) => `Phone ${name}`,
    reachable: 'reachable',
    unreachable: 'unreachable',
    battery: (level, charging) => `battery ${level} %${charging ? ', charging' : ''}`,
    appVersion: (version) => `app ${version}`,
    inboxOn: 'Received SMS: read every cycle.',
    inboxOff: 'Received SMS: not read (option off).',
    inboxUnsupported: 'Received SMS: this app version has no inbox, update it (1.59.0 or later).',
    usage: (used, limit) => `SMS sent over the last hour: ${used} of ${limit} allowed.`,
    testQueued: (count, id) => `Test SMS queued for ${count} recipient(s) (message ${id}).`,
    testText: 'Test SMS from Gladys: the gateway works.',
    noMessages: 'No SMS sent since the integration started.',
    message: (time, recipients, status) => `${time} · ${recipients} · ${status}`,
  },
  fr: {
    modes: { local: 'réseau local', cloud: 'serveur cloud', private: 'serveur privé' },
    connected: (mode) => `Connecté (${mode}).`,
    phone: (name) => `Téléphone ${name}`,
    reachable: 'joignable',
    unreachable: 'injoignable',
    battery: (level, charging) => `batterie ${level} %${charging ? ', en charge' : ''}`,
    appVersion: (version) => `application ${version}`,
    inboxOn: 'SMS reçus : lus à chaque cycle.',
    inboxOff: 'SMS reçus : non lus (option désactivée).',
    inboxUnsupported:
      "SMS reçus : cette version de l'application n'a pas de boîte de réception, mettez-la à jour (1.59.0 ou plus).",
    usage: (used, limit) => `SMS envoyés sur la dernière heure : ${used} sur ${limit} autorisés.`,
    testQueued: (count, id) => `SMS de test en file pour ${count} destinataire(s) (message ${id}).`,
    testText: 'SMS de test de Gladys : la passerelle fonctionne.',
    noMessages: "Aucun SMS envoyé depuis le démarrage de l'intégration.",
    message: (time, recipients, status) => `${time} · ${recipients} · ${status}`,
  },
  de: {
    modes: { local: 'lokales Netzwerk', cloud: 'Cloud-Server', private: 'privater Server' },
    connected: (mode) => `Verbunden (${mode}).`,
    phone: (name) => `Telefon ${name}`,
    reachable: 'erreichbar',
    unreachable: 'nicht erreichbar',
    battery: (level, charging) => `Akku ${level} %${charging ? ', lädt' : ''}`,
    appVersion: (version) => `App ${version}`,
    inboxOn: 'Empfangene SMS: werden bei jedem Durchlauf gelesen.',
    inboxOff: 'Empfangene SMS: werden nicht gelesen (Option aus).',
    inboxUnsupported:
      'Empfangene SMS: Diese App-Version hat keinen Posteingang, aktualisiere sie (1.59.0 oder neuer).',
    usage: (used, limit) => `In der letzten Stunde gesendete SMS: ${used} von ${limit} erlaubten.`,
    testQueued: (count, id) =>
      `Test-SMS für ${count} Empfänger in der Warteschlange (Nachricht ${id}).`,
    testText: 'Test-SMS von Gladys: Das Gateway funktioniert.',
    noMessages: 'Seit dem Start der Integration wurde keine SMS gesendet.',
    message: (time, recipients, status) => `${time} · ${recipients} · ${status}`,
  },
  es: {
    modes: { local: 'red local', cloud: 'servidor en la nube', private: 'servidor privado' },
    connected: (mode) => `Conectado (${mode}).`,
    phone: (name) => `Teléfono ${name}`,
    reachable: 'accesible',
    unreachable: 'inaccesible',
    battery: (level, charging) => `batería ${level} %${charging ? ', cargando' : ''}`,
    appVersion: (version) => `aplicación ${version}`,
    inboxOn: 'SMS recibidos: se leen en cada ciclo.',
    inboxOff: 'SMS recibidos: no se leen (opción desactivada).',
    inboxUnsupported:
      'SMS recibidos: esta versión de la aplicación no tiene bandeja de entrada, actualícela (1.59.0 o posterior).',
    usage: (used, limit) => `SMS enviados en la última hora: ${used} de ${limit} permitidos.`,
    testQueued: (count, id) =>
      `SMS de prueba en cola para ${count} destinatario(s) (mensaje ${id}).`,
    testText: 'SMS de prueba de Gladys: la pasarela funciona.',
    noMessages: 'No se ha enviado ningún SMS desde el inicio de la integración.',
    message: (time, recipients, status) => `${time} · ${recipients} · ${status}`,
  },
};

/** Hours and minutes of a moment, in the language and time zone of Gladys (TZ). */
export function timeOf(time, language) {
  return new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(
    new Date(time),
  );
}
