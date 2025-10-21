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

const DOMAIN_PATTERN = /^(?:[a-z0-9-]+\.)+[a-z0-9-]+(?::\d+)?(?:[\/?#][\S]*)?$/i;
const IPV4_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:[\/?#][\S]*)?$/;
const LOCALHOST_PATTERN = /^localhost(?::\d+)?(?:[\/?#][\S]*)?$/i;

function tryParseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function resolveUrlLikeInput(input: string): URL | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const direct = tryParseUrl(trimmed);
  if (direct && (direct.protocol === "http:" || direct.protocol === "https:")) {
    return direct;
  }

  if (/\s/.test(trimmed)) {
    return null;
  }

  if (
    !DOMAIN_PATTERN.test(trimmed) &&
    !IPV4_PATTERN.test(trimmed) &&
    !LOCALHOST_PATTERN.test(trimmed)
  ) {
    return null;
  }

  const fallback = tryParseUrl(`https://${trimmed}`);
  if (!fallback) {
    return null;
  }

  return fallback.protocol === "http:" || fallback.protocol === "https:" ? fallback : null;
}

/**
 * Determine if the user provided a valid or coercible HTTP(S) URL.
 */
export function isLikelyUrl(input: string) {
  return resolveUrlLikeInput(input) !== null;
}

/**
 * Normalize user input that resembles a URL so downstream calls receive a full HTTP(S) address.
 */
export function normalizeUrlInput(input: string): string | null {
  const parsed = resolveUrlLikeInput(input);
  return parsed ? parsed.toString() : null;
}
