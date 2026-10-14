// -----------------------------------------------------------------------------
// Phone numbers: the international format only, typed loosely, and never
// whole in the logs.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskEntry, maskNumber, normalizeNumber, parseRecipients } from '../src/phone.js';

test('a number in the international format, spaces and separators ignored', () => {
  assert.equal(normalizeNumber('+33639980012'), '+33639980012');
  assert.equal(normalizeNumber('+33 6 39 98 00 12'), '+33639980012');
  assert.equal(normalizeNumber('+33 (0)6'), null, 'a national 0 inside is not a number');
  assert.equal(normalizeNumber('0033.6.39.98.00.12'), '+33639980012');
  assert.equal(normalizeNumber('+44 7700-900123'), '+447700900123');
  assert.equal(normalizeNumber('+33 639 980012'), '+33639980012');
});

test('national numbers, short codes and garbage are refused', () => {
  for (const raw of ['0639980012', '36179', 'AMELI', '+0639980012', '+1234', '+1234567890123456']) {
    assert.equal(normalizeNumber(raw), null, raw);
  }
  assert.equal(normalizeNumber(undefined), null);
});

test('several recipients: commas, semicolons or lines; duplicates dropped', () => {
  assert.deepEqual(parseRecipients('+33639980012, +33 6 39 98 00 34;+33639980012\n+447700900123'), {
    numbers: ['+33639980012', '+33639980034', '+447700900123'],
    invalid: [],
  });
  assert.deepEqual(parseRecipients('+33639980012, 0639980034, ,'), {
    numbers: ['+33639980012'],
    invalid: ['0639980034'],
  });
  assert.deepEqual(parseRecipients(''), { numbers: [], invalid: [] });
  assert.deepEqual(parseRecipients(null), { numbers: [], invalid: [] });
});

test('a number in the logs keeps its last two digits only', () => {
  assert.equal(maskNumber('+33639980012'), '••12');
  assert.equal(maskNumber('AMELI'), '••');
  assert.equal(maskNumber(null), '••');
  assert.equal(maskEntry('0639980034'), '0639…34');
  assert.equal(maskEntry('3617'), '3617');
});
