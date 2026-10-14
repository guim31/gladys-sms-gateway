#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only probe of a real SMS Gateway for Android API, through the very
// client and parsers of the integration. It checks that the answers of a real
// phone (or server) have the shapes the fixtures assume. It never sends an
// SMS, and prints no secret, no phone number, no message text: only counts,
// field names and what the parsers made of them.
//
//   SMS_MODE=local   SMS_ADDRESS=192.168.1.50:8080 SMS_USERNAME=sms SMS_PASSWORD=... npm run probe
//   SMS_MODE=cloud                                 SMS_USERNAME=...  SMS_PASSWORD=... npm run probe
//   SMS_MODE=private SMS_ADDRESS=https://sms.example.com             ...              npm run probe
// -----------------------------------------------------------------------------

import { normalizeConfig } from '../src/config.js';
import { SmsGateClient } from '../src/smsgate/client.js';
import { parseDevices, parseHealth, parseIncoming } from '../src/smsgate/model.js';

const mode = process.env.SMS_MODE ?? 'local';
const config = normalizeConfig({
  mode,
  local_address: process.env.SMS_ADDRESS ?? '',
  server_url: process.env.SMS_ADDRESS ?? '',
  username: process.env.SMS_USERNAME ?? '',
  password: process.env.SMS_PASSWORD ?? '',
});
if (!config.apiUrl || !config.username || !config.password) {
  console.error('Set SMS_MODE, SMS_ADDRESS (local, private), SMS_USERNAME and SMS_PASSWORD.');
  process.exit(2);
}

const client = new SmsGateClient({
  mode: config.mode,
  apiUrl: config.apiUrl,
  username: config.username,
  password: config.password,
});
const report = { mode: config.mode, api: new URL(config.apiUrl).host };
const keysOf = (value) => (value && typeof value === 'object' ? Object.keys(value).sort() : null);

async function step(name, run) {
  try {
    report[name] = await run();
  } catch (err) {
    report[name] = { error: err.kind ?? 'bug', message: err.message };
  }
}

await step('devices', async () => {
  const raw = await client.getDevices();
  const phones = parseDevices(raw);
  return {
    count: raw.length,
    parsed: phones.length,
    fields: keysOf(raw[0]),
    simCards: phones.map((phone) => phone.simCards.length),
    lastSeenParsed: phones.map((phone) => phone.lastSeen !== null),
  };
});

if (config.mode === 'local') {
  await step('health', async () => {
    const raw = await client.getHealth();
    const parsed = parseHealth(raw);
    return {
      checks: keysOf(raw?.checks),
      battery: parsed.battery,
      charging: parsed.charging,
      version: parsed.version,
    };
  });
}

await step('inbox', async () => {
  const phones = parseDevices(await client.getDevices());
  const deviceId = config.mode === 'local' ? null : (phones[0]?.id ?? null);
  const raw = await client.listInbox({
    from: new Date(Date.now() - 7 * 24 * 60 * 60_000),
    deviceId,
    limit: 20,
  });
  const parsed = raw.map(parseIncoming);
  return {
    count: raw.length,
    parsed: parsed.filter(Boolean).length,
    fields: keysOf(raw[0]),
    encrypted: parsed.filter((message) => message?.encrypted).length,
  };
});

console.log(JSON.stringify(report, null, 2));
