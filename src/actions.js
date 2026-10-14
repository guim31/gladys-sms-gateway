// -----------------------------------------------------------------------------
// Actions of the Configuration screen (manifest `actions`): reports shown
// under their button, in every language (Gladys picks the user's).
//
//   - test_connection: read the phone now, say what answers;
//   - send_test_sms:   send one SMS to the number typed, through the same
//                      checks and the same hourly limit as the scenes;
//   - recent_messages: the last SMS sent and their state.
//
// Gladys applies no `default` to action fields and refuses a missing
// `required` one (GladysAssistant/Gladys#3155): every field is optional, and
// the handlers say what is missing.
// -----------------------------------------------------------------------------

import { maskNumber } from './phone.js';
import { REPORT_TEXT, STATUS_TEXT, allLanguages, labelled, pick, timeOf } from './texts.js';
import { STATUS } from './smsgate/model.js';

/** "Test the connection": read now, one line per phone, then the inbox and the limit. */
async function testConnection(hub) {
  await hub.refresh({ force: true });
  const status = hub.connectionStatus();
  return allLanguages((language) => {
    const text = pick(REPORT_TEXT, language);
    if (!status.connected && status.message) {
      return pick(status.message, language);
    }
    const lines = [text.connected(text.modes[hub.config.mode])];
    for (const record of hub.view()) {
      const parts = [record.reachable ? text.reachable : text.unreachable];
      if (record.battery !== null) {
        parts.push(text.battery(record.battery, record.charging));
      }
      if (record.version) {
        parts.push(text.appVersion(record.version));
      }
      lines.push(labelled(text.phone(record.phone.name), parts.join(', '), language));
    }
    if (!hub.config.receiveSms) {
      lines.push(text.inboxOff);
    } else if (hub.inbox.supported === false) {
      lines.push(text.inboxUnsupported);
    } else {
      lines.push(text.inboxOn);
    }
    const { used, limit } = hub.usage();
    lines.push(text.usage(used, limit));
    return lines.join('\n');
  });
}

/** "Send a test SMS": the number typed, a fixed text unless one is typed. */
async function sendTestSms(hub, fields = {}) {
  const language = hub.config?.language ?? 'en';
  const typed = typeof fields.message === 'string' ? fields.message.trim() : '';
  const result = await hub.send({
    recipients: fields.phone_number,
    text: typed || pick(REPORT_TEXT, language).testText,
    sim: fields.sim_number,
    origin: 'test',
  });
  return allLanguages((lang) =>
    pick(REPORT_TEXT, lang).testQueued(result.recipients, result.id || '?'),
  );
}

/** "Recent SMS": one line per SMS sent, newest first. */
async function recentMessages(hub) {
  const recent = hub.recent();
  return allLanguages((language) => {
    const text = pick(REPORT_TEXT, language);
    if (recent.length === 0) {
      return text.noMessages;
    }
    return recent
      .map((sent) => {
        const who = sent.recipients.map((recipient) => maskNumber(recipient.number)).join(', ');
        const failed = sent.recipients.find((recipient) => recipient.error);
        const state = pick(STATUS_TEXT[sent.status] ?? STATUS_TEXT[STATUS.PENDING], language);
        return text.message(
          timeOf(sent.at, language),
          who,
          sent.status === STATUS.FAILED && failed ? `${state} (${failed.error})` : state,
        );
      })
      .join('\n');
  });
}

export const ACTIONS = {
  test_connection: testConnection,
  send_test_sms: sendTestSms,
  recent_messages: recentMessages,
};
