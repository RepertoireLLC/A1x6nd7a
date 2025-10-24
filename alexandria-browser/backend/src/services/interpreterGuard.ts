import { interpretSearchQuery, type QueryFilters, type QueryInterpretation } from "./queryInterpreter";

export interface SafeInterpretSearchOptions {
  allowedMediaTypes: ReadonlySet<string>;
  yearPattern: RegExp;
}

export interface SafeInterpretationResult {
  interpretation: QueryInterpretation | null;
  filters: QueryFilters;
  error: Error | null;
}

const TRUST_LEVELS = new Set(["high", "medium", "low"]);
const AVAILABILITY_LEVELS = new Set(["online", "archived-only"]);

function sanitizeYear(value: unknown, pattern: RegExp): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (pattern.test(trimmed)) {
    return trimmed;
  }
  const match = trimmed.match(pattern);
  return match ? match[0] : undefined;
}

function sanitizeMediaType(value: unknown, allowed: ReadonlySet<string>): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized || !allowed.has(normalized)) {
    return undefined;
  }
  return normalized;
}

function sanitizeLanguage(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (!/^[a-z][a-z\s-]{1,31}$/.test(normalized)) {
    return undefined;
  }
  return normalized.replace(/\s+/g, " ");
}

function sanitizeSourceTrust(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!TRUST_LEVELS.has(normalized)) {
    return undefined;
  }
  return normalized;
}

function sanitizeAvailability(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!AVAILABILITY_LEVELS.has(normalized)) {
    return undefined;
  }
  return normalized;
}

function sanitizeCollectionList(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const tokens = value
    .split(/[,;]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0)
    .filter((token) => /^[a-z0-9][a-z0-9_-]{1,63}$/.test(token));
  if (tokens.length === 0) {
    return undefined;
  }
  return Array.from(new Set(tokens)).join(",");
}

function sanitizeSubjectList(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const tokens = value
    .split(/[,;]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .map((token) => token.replace(/["<>]/g, ""))
    .map((token) => token.replace(/\s+/g, " "))
    .filter((token) => token.length > 0 && token.length <= 80);
  if (tokens.length === 0) {
    return undefined;
  }
  return Array.from(new Set(tokens.map((token) => token.toLowerCase()))).join(",");
}

function sanitizeUploader(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (!/^[a-z0-9][a-z0-9_.@-]{1,63}$/.test(normalized)) {
    return undefined;
  }
  return normalized;
}

export function sanitizeQueryFilters(
  filters: QueryFilters | null | undefined,
  options: SafeInterpretSearchOptions,
): QueryFilters {
  if (!filters || typeof filters !== "object") {
    return {};
  }

  const sanitized: QueryFilters = {};

  const mediaType = sanitizeMediaType(filters.mediaType, options.allowedMediaTypes);
  if (mediaType) {
    sanitized.mediaType = mediaType;
  }

  const yearFrom = sanitizeYear(filters.yearFrom, options.yearPattern);
  if (yearFrom) {
    sanitized.yearFrom = yearFrom;
  }

  const yearTo = sanitizeYear(filters.yearTo, options.yearPattern);
  if (yearTo) {
    sanitized.yearTo = yearTo;
  }

  const language = sanitizeLanguage(filters.language);
  if (language) {
    sanitized.language = language;
  }

  const sourceTrust = sanitizeSourceTrust(filters.sourceTrust);
  if (sourceTrust) {
    sanitized.sourceTrust = sourceTrust;
  }

  const availability = sanitizeAvailability(filters.availability);
  if (availability) {
    sanitized.availability = availability;
  }

  const collection = sanitizeCollectionList(filters.collection);
  if (collection) {
    sanitized.collection = collection;
  }

  const uploader = sanitizeUploader(filters.uploader);
  if (uploader) {
    sanitized.uploader = uploader;
  }

  const subject = sanitizeSubjectList(filters.subject);
  if (subject) {
    sanitized.subject = subject;
  }

  return sanitized;
}

export function safeInterpretSearchQuery(
  input: string,
  options: SafeInterpretSearchOptions,
): SafeInterpretationResult {
  try {
    const interpretation = interpretSearchQuery(input);
    const sanitizedQuery =
      interpretation && typeof interpretation.query === "string"
        ? interpretation.query.trim()
        : "";
    const sanitizedFilters = sanitizeQueryFilters(interpretation?.filters ?? {}, options);

    const safeInterpretation: QueryInterpretation = {
      query: sanitizedQuery,
      filters: sanitizedFilters,
    };

    return {
      interpretation: safeInterpretation,
      filters: sanitizedFilters,
      error: null,
    };
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    return {
      interpretation: null,
      filters: {},
      error: normalizedError,
    };
  }
}

export default safeInterpretSearchQuery;
