/**
 * Replaces {{name}}, {{company}}, and {{website}} placeholders in text
 * using values from a recipient object. Supports optional whitespace inside
 * braces (e.g., {{ name }}). Leaves unknown tokens untouched.
 * @param {string} text
 * @param {object} [recipientObj={}]
 * @returns {string}
 */
export function parsePlaceholders(text, recipientObj = {}) {
  if (typeof text !== 'string' || text.length === 0) {
    return '';
  }

  const recipient = recipientObj && typeof recipientObj === 'object' ? recipientObj : {};
  const replacements = {
    name: recipient.name ?? '',
    company: recipient.company ?? '',
    website: recipient.website ?? ''
  };

  return text.replace(/\{\{\s*(name|company|website)\s*\}\}/gi, (_, key) => {
    const normalizedKey = key.toLowerCase();
    return String(replacements[normalizedKey] ?? '');
  });
}

/**
 * Promise-based delay helper.
 * @param {number} ms Duration in milliseconds.
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  const safeMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
  return new Promise((resolve) => {
    setTimeout(resolve, safeMs);
  });
}

/**
 * Formats a duration in seconds into a human-readable string.
 * - Under 1 hour: MM:SS (e.g., 01:05)
 * - 1 hour or more: HH:MM:SS (e.g., 01:02:09)
 * @param {number} seconds
 * @returns {string}
 */
export function formatTime(seconds) {
  const totalSeconds = Number.isFinite(seconds) && seconds > 0
    ? Math.floor(seconds)
    : 0;

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  const pad = (value) => String(value).padStart(2, '0');

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
  }

  return `${pad(minutes)}:${pad(secs)}`;
}
