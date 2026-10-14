// -----------------------------------------------------------------------------
// Phone numbers: what a scene may send to, and how a number appears in the
// logs.
//
// Recipients are typed in the international format (E.164: `+` then the
// country code, 7 to 15 digits in all), the only one that means the same
// thing whatever the SIM card of the phone: `0612345678` is French for one
// operator and nothing for another. Spaces, dots, dashes and parentheses are
// ignored, `00` is read as `+`. Several numbers are separated by commas or
// semicolons (a space separates the digit groups of one number).
//
// A number never appears whole in the logs: only its last two digits.
// -----------------------------------------------------------------------------

export const MAX_RECIPIENTS = 10;

const E164 = /^\+[1-9]\d{6,14}$/;

/**
 * One number in the international format, or null.
 * @param {unknown} raw
 */
export function normalizeNumber(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  let text = raw.replace(/[\s.\-()/\u00a0\u202f]/g, '');
  if (text.startsWith('00')) {
    text = `+${text.slice(2)}`;
  }
  return E164.test(text) ? text : null;
}

/**
 * The recipients of a message, as typed in a scene or a form.
 * @param {unknown} raw `+33639980012, +447700900123`
 * @returns {{ numbers: string[], invalid: string[] }} unique valid numbers,
 *   and the entries that are not numbers (as typed, trimmed)
 */
export function parseRecipients(raw) {
  const entries = (typeof raw === 'string' ? raw : '')
    .split(/[,;\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const numbers = [];
  const invalid = [];
  for (const entry of entries) {
    const number = normalizeNumber(entry);
    if (!number) {
      invalid.push(entry);
    } else if (!numbers.includes(number)) {
      // The app refuses a message listing the same number twice.
      numbers.push(number);
    }
  }
  return { numbers, invalid };
}

/** A number for the logs: its last two digits only (`••78`). */
export function maskNumber(number) {
  const digits = String(number ?? '').replace(/\D/g, '');
  return digits.length >= 2 ? `••${digits.slice(-2)}` : '••';
}

/**
 * An invalid entry, shown in an error message: enough to find the typo, not
 * the whole number (scene errors land in the Gladys logs).
 */
export function maskEntry(entry) {
  const text = String(entry);
  return text.length > 8 ? `${text.slice(0, 4)}…${text.slice(-2)}` : text;
}
