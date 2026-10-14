// -----------------------------------------------------------------------------
// Configuration normalization: the addresses as users type them, the three
// modes, and the bounds of every setting.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLOUD_API_URL,
  DEFAULT_CONFIG,
  isConfigured,
  normalizeConfig,
  parseLocalAddress,
  parseServerUrl,
} from '../src/config.js';

test('the phone address: IP, port, scheme and path as users type them', () => {
  assert.equal(parseLocalAddress('192.168.1.50'), 'http://192.168.1.50:8080');
  assert.equal(parseLocalAddress(' 192.168.1.50:8081 '), 'http://192.168.1.50:8081');
  assert.equal(parseLocalAddress('http://phone.lan:8080/docs'), 'http://phone.lan:8080');
  assert.equal(parseLocalAddress('https://192.168.1.50:8443'), 'https://192.168.1.50:8443');
  assert.equal(parseLocalAddress(''), null);
  assert.equal(parseLocalAddress('ftp://192.168.1.50'), null);
  assert.equal(parseLocalAddress('http://user:pass@192.168.1.50'), null, 'no credentials in URLs');
  assert.equal(parseLocalAddress(42), null);
});

test('the private server address gets the API path once', () => {
  assert.equal(parseServerUrl('sms.example.com'), 'https://sms.example.com/3rdparty/v1');
  assert.equal(parseServerUrl('https://sms.example.com/'), 'https://sms.example.com/3rdparty/v1');
  assert.equal(
    parseServerUrl('https://example.com/sms/3rdparty/v1/'),
    'https://example.com/sms/3rdparty/v1',
  );
  assert.equal(parseServerUrl('http://192.168.1.5:3000'), 'http://192.168.1.5:3000/3rdparty/v1');
  assert.equal(parseServerUrl('not a url at all'), null);
});

test('defaults: local mode, 20 SMS per hour, inbox read every minute, French names', () => {
  const config = normalizeConfig({});
  assert.equal(config.mode, 'local');
  assert.equal(config.apiUrl, null);
  assert.equal(config.addressProblem, 'missing');
  assert.equal(config.maxSmsPerHour, 20);
  assert.equal(config.receiveSms, true);
  assert.equal(config.pollIntervalMs, 60_000);
  assert.equal(config.offlineAfterMs, 60 * 60_000);
  assert.equal(config.language, 'fr');
  assert.equal(isConfigured(config), false);
  assert.equal(DEFAULT_CONFIG.language, 'fr');
});

test('each mode resolves its API address', () => {
  const credentials = { username: 'u', password: ' p ' };
  const local = normalizeConfig({ mode: 'local', local_address: '192.0.2.10', ...credentials });
  assert.equal(local.apiUrl, 'http://192.0.2.10:8080');
  assert.equal(local.password, ' p ', 'passwords are kept as typed');
  assert.equal(isConfigured(local), true);

  const cloud = normalizeConfig({ mode: 'cloud', local_address: 'ignored', ...credentials });
  assert.equal(cloud.apiUrl, CLOUD_API_URL);

  const wrong = normalizeConfig({ mode: 'private', server_url: 'http://', ...credentials });
  assert.equal(wrong.apiUrl, null);
  assert.equal(wrong.addressProblem, 'invalid');
  assert.equal(isConfigured(wrong), false);

  assert.equal(normalizeConfig({ mode: 'bluetooth' }).mode, 'local');
});

test('numbers and choices are bounded, strings from the form accepted', () => {
  assert.equal(normalizeConfig({ max_sms_per_hour: '35' }).maxSmsPerHour, 35);
  assert.equal(normalizeConfig({ max_sms_per_hour: 0 }).maxSmsPerHour, 1);
  assert.equal(normalizeConfig({ max_sms_per_hour: 10_000 }).maxSmsPerHour, 200);
  assert.equal(normalizeConfig({ max_sms_per_hour: 'many' }).maxSmsPerHour, 20);
  assert.equal(normalizeConfig({ receive_sms: false }).receiveSms, false);
  assert.equal(normalizeConfig({ receive_sms: 'false' }).receiveSms, false);
  assert.equal(normalizeConfig({ poll_interval: 300 }).pollIntervalMs, 300_000);
  assert.equal(normalizeConfig({ poll_interval: '7' }).pollIntervalMs, 60_000);
  assert.equal(normalizeConfig({ offline_after_minutes: '15' }).offlineAfterMs, 15 * 60_000);
  assert.equal(normalizeConfig({ language: 'it' }).language, 'fr');
  assert.equal(normalizeConfig(null).mode, 'local');
});
