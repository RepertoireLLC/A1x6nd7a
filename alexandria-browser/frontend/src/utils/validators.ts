const YEAR_PATTERN = /^\d{4}$/;

/**
 * Validate that a year input is either empty or a four digit value.
 */
export function isYearValid(value: string) {
  const trimmed = value.trim();
  return trimmed.length === 0 || YEAR_PATTERN.test(trimmed);
}

/**
 * Sanitize a year field prior to sending to the backend.
 */
export function normalizeYear(value: string) {
  return YEAR_PATTERN.test(value.trim()) ? value.trim() : "";
}

/**
 * Determine if the user provided a valid HTTP or HTTPS URL.
 */
export function isLikelyUrl(input: string) {
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
