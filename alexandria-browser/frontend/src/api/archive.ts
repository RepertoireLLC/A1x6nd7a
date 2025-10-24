import type {
  ArchiveSearchPayload,
  ArchiveSearchResponse,
  LinkStatus,
  ArchiveMetadataResponse,
  CdxResponse,
  ScrapeResponse,
  WaybackAvailabilityResponse,
  SavePageResponse,
  SearchFilters,
  SearchModeSetting,
} from "../types";
import type { ReportSubmissionPayload, ReportResponse } from "../reporting";
import { performFallbackArchiveSearch } from "../utils/fallbackSearch";
import { postProcessDirectSearchPayload } from "./postProcess";

const HTML_CONTENT_TYPE_PATTERN = /text\/html/i;
const HTML_DOCTYPE_PATTERN = /^\s*<!DOCTYPE\s+html/i;
const HTML_TAG_PATTERN = /^\s*<html/i;
const HTML_PREVIEW_LIMIT = 200;
const NETWORK_ERROR_MESSAGE_PATTERN = /(failed to fetch|fetch failed|network\s?error|network request failed|load failed|connection refused|dns lookup failed)/i;

const ARCHIVE_SEARCH_ENDPOINT = "https://archive.org/advancedsearch.php";
const ARCHIVE_PRIMARY_STRATEGY = "primary search with fuzzy expansion";
const ARCHIVE_SEARCH_FIELDS = [
  "identifier",
  "title",
  "description",
  "creator",
  "collection",
  "mediatype",
  "year",
  "date",
  "publicdate",
  "downloads",
  "originalurl",
  "original"
].join(",");

let archiveApiSuccessLogged = false;

function isLikelyHtmlResponse(body: string, contentType: string): boolean {
  if (!body) {
    return false;
  }

  if (HTML_CONTENT_TYPE_PATTERN.test(contentType)) {
    return true;
  }

  return HTML_DOCTYPE_PATTERN.test(body) || HTML_TAG_PATTERN.test(body) || body.trim().startsWith("<");
}

function createFriendlySearchError(error: unknown): Error {
  if (!error) {
    return new Error("Search request failed. Please try again later.");
  }

  if (isApiErrorInfo(error)) {
    const message = error.message?.trim();
    if (error.type === "network") {
      return new Error(message || "Unable to reach the Internet Archive. Please check your connection and try again.");
    }
    if (error.type === "invalid-response") {
      return new Error(message || "Invalid response from Internet Archive. Please try again later.");
    }
    return new Error(message || "Search request failed. Please try again later.");
  }

  if (error instanceof DirectArchiveSearchError) {
    const message = error.message ?? "";
    if (error.status && error.status >= 500) {
      return new Error("The Internet Archive search service is temporarily unavailable. Please try again later.");
    }
    if (/invalid html response|failed to parse/i.test(message)) {
      return new Error("Invalid response from Internet Archive. Please try again later.");
    }
    if (NETWORK_ERROR_MESSAGE_PATTERN.test(message)) {
      return new Error("Unable to reach the Internet Archive. Please check your connection and try again.");
    }
    return new Error(message || "Search request failed. Please try again later.");
  }

  if (error instanceof Error) {
    const message = error.message ?? "";
    if (NETWORK_ERROR_MESSAGE_PATTERN.test(message)) {
      return new Error("Unable to reach the Internet Archive. Please check your connection and try again.");
    }
    return error;
  }

  if (typeof error === "string" && error.trim()) {
    return new Error(error.trim());
  }

  return new Error("Search request failed. Please try again later.");
}

const offlineFallbackPreference = import.meta.env.VITE_ENABLE_OFFLINE_FALLBACK;
const OFFLINE_FALLBACK_ENABLED =
  offlineFallbackPreference === "true" ||
  (offlineFallbackPreference === undefined && import.meta.env.DEV);

const DEV_SERVER_PORT = (import.meta.env.VITE_DEV_SERVER_PORT ?? "5173").trim();

function resolveApiBaseUrl(): string {
  const configuredUrl = import.meta.env.VITE_API_BASE_URL?.trim();
  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, "");
  }

  if (typeof window !== "undefined") {
    const { hostname, protocol, port } = window.location;
    const isLocalhost =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]";

    const normalizedPort = port?.trim() ?? "";
    const originPort = normalizedPort ? `:${normalizedPort}` : "";
    const sameOrigin = `${protocol}//${hostname}${originPort}`;
    const isHttpProtocol = protocol === "http:" || protocol === "https:";
    const matchesDevPort = normalizedPort && normalizedPort === DEV_SERVER_PORT;

    if ((!isLocalhost || matchesDevPort) && isHttpProtocol) {
      return sameOrigin.replace(/\/$/, "");
    }

    if (isLocalhost) {
      return "http://localhost:4000";
    }

    if (isHttpProtocol) {
      return sameOrigin.replace(/\/$/, "");
    }

    return "http://localhost:4000";
  }

  return "http://localhost:4000";
}

export const API_BASE_URL = resolveApiBaseUrl();

function mapModeToSetting(mode: string | undefined): SearchModeSetting {
  const normalized = (mode ?? "").trim().toLowerCase();
  if (normalized === "moderate") {
    return "moderate";
  }
  if (normalized === "nsfw-only") {
    return "nsfw-only";
  }
  if (normalized === "unrestricted" || normalized === "no-restriction" || normalized === "off") {
    return "no-restriction";
  }
  return "safe";
}

export interface ApiErrorInfo {
  message: string;
  status?: number;
  details?: string;
  type?: "network" | "invalid-response" | "server" | "abort";
}

export type ApiResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: ApiErrorInfo; status?: number };

function buildApiUrl(path: string): URL {
  return new URL(path, `${API_BASE_URL}/`);
}

function createApiError(message: string, extras?: Partial<ApiErrorInfo>): ApiResult<never> {
  return {
    ok: false,
    error: {
      message,
      ...extras,
    },
    status: extras?.status,
  };
}

function previewBody(body: string): string {
  return body.slice(0, HTML_PREVIEW_LIMIT).replace(/\s+/g, " ").trim();
}

function isApiErrorInfo(value: unknown): value is ApiErrorInfo {
  return Boolean(value && typeof value === "object" && "message" in (value as Record<string, unknown>));
}

async function buildResponseErrorMessage(response: Response, fallbackMessage: string): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    try {
      const payload = (await response.json()) as { error?: unknown; details?: unknown } | null;
      const parts: string[] = [];
      if (payload && typeof payload === "object") {
        const errorText = payload.error;
        const detailText = payload.details;
        if (typeof errorText === "string" && errorText.trim()) {
          parts.push(errorText.trim());
        }
        if (typeof detailText === "string" && detailText.trim()) {
          parts.push(detailText.trim());
        }
      }

      if (parts.length > 0) {
        return `${fallbackMessage} ${parts.join(" ")}`.trim();
      }
    } catch (error) {
      console.warn("Failed to parse error response payload", error);
    }
  }

  try {
    const text = (await response.text()).trim();
    if (text) {
      return `${fallbackMessage} ${text}`.trim();
    }
  } catch (error) {
    console.warn("Failed to read error response body", error);
  }

  return fallbackMessage;
}

async function safeJsonFetch<T>(
  input: string,
  init: RequestInit | undefined,
  fallbackMessage: string
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return createApiError("Request cancelled.", {
        details: "The request was aborted before completion.",
        type: "abort",
      });
    }

    const details = error instanceof Error ? error.message : String(error);
    return createApiError("Unable to reach the Alexandria service. Please check your connection and try again.", {
      details,
      type: "network",
    });
  }

  const clone = response.clone();
  let rawBody = "";
  try {
    rawBody = await response.text();
  } catch (error) {
    console.warn("Failed to read response body", error);
  }

  const trimmedBody = rawBody.trim();
  const contentType = response.headers.get("content-type") ?? "";

  if (!response.ok) {
    const message = await buildResponseErrorMessage(clone, fallbackMessage);
    return createApiError(message, {
      status: response.status,
      details: trimmedBody ? previewBody(trimmedBody) : undefined,
      type: response.status >= 500 ? "server" : "invalid-response",
    });
  }

  if (!trimmedBody) {
    return createApiError("The Alexandria service returned an empty response.", {
      status: response.status,
      type: "invalid-response",
    });
  }

  if (isLikelyHtmlResponse(trimmedBody, contentType)) {
    return createApiError("Received invalid HTML response from the Alexandria service.", {
      status: response.status,
      details: previewBody(trimmedBody),
      type: "invalid-response",
    });
  }

  try {
    const data = JSON.parse(trimmedBody) as T;
    return { ok: true, data, status: response.status };
  } catch (error) {
    console.warn("Failed to parse response as JSON", error, { preview: previewBody(trimmedBody) });
    return createApiError("Failed to parse response from the Alexandria service.", {
      status: response.status,
      details: previewBody(trimmedBody),
      type: "invalid-response",
    });
  }
}

interface DirectArchiveSearchAttempt {
  description: string;
  url: URL;
  query: string;
}

class DirectArchiveSearchError extends Error {
  retryable: boolean;
  status?: number;
  details?: unknown;

  constructor(message: string, options?: { retryable?: boolean; status?: number; details?: unknown }) {
    super(message);
    this.name = "DirectArchiveSearchError";
    this.retryable = options?.retryable ?? false;
    this.status = options?.status;
    this.details = options?.details;
  }
}

function isRetryableDirectError(error: unknown): boolean {
  if (error instanceof DirectArchiveSearchError) {
    return error.retryable;
  }

  if (error instanceof Error) {
    return NETWORK_ERROR_MESSAGE_PATTERN.test(error.message ?? "");
  }

  return false;
}

function buildPlainKeywordQuery(query: string): string {
  const normalized = query.normalize("NFKC");
  const tokens = normalized
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return normalized.trim().replace(/\s+/g, " ");
  }

  return tokens.join(" ");
}

function buildSearchExpression(query: string, includeFuzzy: boolean): string {
  const sanitized = query.trim();
  if (!includeFuzzy) {
    return sanitized;
  }

  const tokens = sanitized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return sanitized;
  }

  const fuzzyClause = tokens.map((token) => `${token}~`).join(" ");
  if (!fuzzyClause) {
    return sanitized;
  }

  return `(${sanitized}) OR (${fuzzyClause})`;
}

function buildFilterExpressions(filters: SearchFilters, includeFilters: boolean): string[] {
  if (!includeFilters) {
    return [];
  }

  const expressions: string[] = [];
  const mediaTypeValue = filters.mediaType?.trim().toLowerCase() ?? "";
  const yearFromValue = filters.yearFrom?.trim() ?? "";
  const yearToValue = filters.yearTo?.trim() ?? "";
  const languageValue = filters.language?.trim() ?? "";
  const collectionValue = filters.collection?.trim() ?? "";
  const uploaderValue = filters.uploader?.trim() ?? "";
  const subjectValue = filters.subject?.trim() ?? "";

  if (mediaTypeValue && mediaTypeValue !== "all") {
    expressions.push(`mediatype:(${mediaTypeValue})`);
  }

  if (yearFromValue || yearToValue) {
    const start = yearFromValue || "*";
    const end = yearToValue || "*";
    expressions.push(`year:[${start} TO ${end}]`);
  }

  if (languageValue) {
    const tokens = languageValue
      .split(/[,\s]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
    if (tokens.length > 0) {
      const clause = tokens.map((token) => `"${token.replace(/"/g, '\\"')}"`).join(" OR ");
      expressions.push(`language:(${clause})`);
    }
  }

  const buildClause = (rawValue: string, field: string): string | null => {
    if (!rawValue) {
      return null;
    }
    const tokens = rawValue
      .split(/[,\n]+/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0)
      .map((token) => `"${token.replace(/"/g, '\\"')}"`);
    if (tokens.length === 0) {
      return null;
    }
    if (tokens.length === 1) {
      return `${field}:(${tokens[0]})`;
    }
    return `${field}:(` + tokens.join(" OR ") + ")";
  };

  const collectionClause = buildClause(collectionValue, "collection");
  if (collectionClause) {
    expressions.push(collectionClause);
  }

  const uploaderClause = buildClause(uploaderValue, "uploader");
  if (uploaderClause) {
    expressions.push(uploaderClause);
  }

  const subjectClause = buildClause(subjectValue, "subject");
  if (subjectClause) {
    expressions.push(subjectClause);
  }

  return expressions;
}

function buildDirectArchiveSearchUrl(
  query: string,
  page: number,
  rows: number,
  filters: SearchFilters,
  options: { includeFilters: boolean; includeFuzzy: boolean }
): URL {
  const requestUrl = new URL(ARCHIVE_SEARCH_ENDPOINT);
  const baseExpression = buildSearchExpression(query, options.includeFuzzy);
  const filterExpressions = buildFilterExpressions(filters, options.includeFilters);
  const parts = [baseExpression, ...filterExpressions].filter((part) => part && part.length > 0);

  const safeRows = Number.isFinite(rows) && rows > 0 ? rows : 20;
  const safePage = Number.isFinite(page) && page > 0 ? page : 1;
  const safeOffset = Math.max(0, (safePage - 1) * safeRows);

  let finalQuery: string;
  if (parts.length > 1) {
    const normalizedParts = parts.map((part) => {
      if (part.startsWith("(") && part.endsWith(")")) {
        return part;
      }
      return `(${part})`;
    });
    finalQuery = normalizedParts.join(" AND ");
  } else if (parts.length === 1 && parts[0]) {
    finalQuery = parts[0];
  } else {
    finalQuery = baseExpression;
  }

  requestUrl.searchParams.set("q", finalQuery);
  requestUrl.searchParams.set("output", "json");
  requestUrl.searchParams.set("page", String(safePage));
  requestUrl.searchParams.set("rows", String(safeRows));
  requestUrl.searchParams.set("start", String(safeOffset));
  requestUrl.searchParams.set("offset", String(safeOffset));
  requestUrl.searchParams.set("fl", ARCHIVE_SEARCH_FIELDS);

  return requestUrl;
}

function buildDirectArchiveSearchAttempts(
  query: string,
  page: number,
  rows: number,
  filters: SearchFilters
): DirectArchiveSearchAttempt[] {
  const trimmedQuery = query.trim();
  const safeRows = Number.isFinite(rows) && rows > 0 ? rows : 20;
  const safePage = Number.isFinite(page) && page > 0 ? page : 1;

  const normalizedFilters: SearchFilters = {
    mediaType: filters.mediaType.trim(),
    yearFrom: filters.yearFrom.trim(),
    yearTo: filters.yearTo.trim(),
    language: filters.language.trim(),
    sourceTrust: filters.sourceTrust.trim(),
    availability: filters.availability.trim(),
    nsfwMode: filters.nsfwMode,
    collection: filters.collection?.trim() ?? "",
    uploader: filters.uploader?.trim() ?? "",
    subject: filters.subject?.trim() ?? "",
  };

  const createAttempt = (
    description: string,
    queryValue: string,
    filterValue: SearchFilters,
    options: { includeFilters: boolean; includeFuzzy: boolean }
  ): DirectArchiveSearchAttempt => {
    const url = buildDirectArchiveSearchUrl(queryValue, safePage, safeRows, filterValue, options);
    const effectiveQuery = url.searchParams.get("q") ?? queryValue;
    return { description, url, query: effectiveQuery };
  };

  const emptyFilters: SearchFilters = {
    mediaType: "",
    yearFrom: "",
    yearTo: "",
    language: "",
    sourceTrust: "",
    availability: "",
    nsfwMode: filters.nsfwMode,
    collection: "",
    uploader: "",
    subject: "",
  };

  const attempts: DirectArchiveSearchAttempt[] = [
    createAttempt(ARCHIVE_PRIMARY_STRATEGY, trimmedQuery, normalizedFilters, {
      includeFilters: true,
      includeFuzzy: true
    }),
    createAttempt("clean search without fuzzy expansion", trimmedQuery, normalizedFilters, {
      includeFilters: true,
      includeFuzzy: false
    }),
    createAttempt("minimal search without filters", trimmedQuery, emptyFilters, {
      includeFilters: false,
      includeFuzzy: false
    })
  ];

  const plainKeywords = buildPlainKeywordQuery(trimmedQuery);
  if (plainKeywords && plainKeywords !== trimmedQuery) {
    attempts.push(
      createAttempt("plain keyword search without special syntax", plainKeywords, emptyFilters, {
        includeFilters: false,
        includeFuzzy: false
      })
    );
  }

  return attempts.filter((attempt, index, array) => {
    const signature = attempt.url.toString();
    return array.findIndex((candidate) => candidate.url.toString() === signature) === index;
  });
}

async function fetchDirectArchiveAttempt(attempt: DirectArchiveSearchAttempt): Promise<ArchiveSearchPayload> {
  let response: Response;
  try {
    response = await fetch(attempt.url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      mode: "cors",
      credentials: "omit",
      cache: "no-store"
    });
  } catch (error) {
    throw new DirectArchiveSearchError("Unable to reach the Internet Archive search endpoint.", {
      retryable: true,
      details: error
    });
  }

  if (!response.ok) {
    const retryableStatus =
      response.status >= 500 || response.status === 429 || response.status === 408 || response.status === 400 || response.status === 403;
    throw new DirectArchiveSearchError(`Search request failed with status ${response.status}.`, {
      retryable: retryableStatus,
      status: response.status
    });
  }

  const rawBody = await response.text();
  const trimmedBody = rawBody.trim();
  if (!trimmedBody) {
    throw new DirectArchiveSearchError("Search request returned an empty response body.", {
      retryable: true
    });
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (isLikelyHtmlResponse(trimmedBody, contentType)) {
    const preview = trimmedBody.slice(0, HTML_PREVIEW_LIMIT).replace(/\s+/g, " ").trim();
    throw new DirectArchiveSearchError("Invalid HTML response received from Internet Archive search.", {
      retryable: true,
      details: { contentType, preview }
    });
  }

  try {
    return JSON.parse(trimmedBody) as ArchiveSearchPayload;
  } catch (error) {
    const preview = trimmedBody.slice(0, HTML_PREVIEW_LIMIT).replace(/\s+/g, " ").trim();
    throw new DirectArchiveSearchError("Failed to parse Internet Archive search response.", {
      retryable: true,
      details: { error, preview }
    });
  }
}

async function executeDirectArchiveSearch(
  query: string,
  page: number,
  rows: number,
  filters: SearchFilters
): Promise<{ payload: ArchiveSearchPayload; attempt: DirectArchiveSearchAttempt }> {
  const safeRows = Number.isFinite(rows) && rows > 0 ? rows : 20;
  const safePage = Number.isFinite(page) && page > 0 ? page : 1;
  const safeOffset = Math.max(0, (safePage - 1) * safeRows);

  const attempts = buildDirectArchiveSearchAttempts(query, safePage, safeRows, filters);
  let lastError: unknown = null;

  for (let index = 0; index < attempts.length; index++) {
    const attempt = attempts[index];
    const isLastAttempt = index === attempts.length - 1;

    try {
      const payload = await fetchDirectArchiveAttempt(attempt);
      const augmented: ArchiveSearchPayload = {
        ...payload,
        search_strategy: attempt.description,
        search_strategy_query: attempt.query
      };
      const processed = postProcessDirectSearchPayload(augmented, query, filters);

      const normalizedResponse = processed.response ?? {};
      const resolvedStart =
        typeof normalizedResponse.start === "number" && Number.isFinite(normalizedResponse.start)
          ? normalizedResponse.start
          : safeOffset;

      const payloadWithStart: ArchiveSearchPayload = {
        ...processed,
        response: {
          ...normalizedResponse,
          start: resolvedStart,
        },
      };

      if (!archiveApiSuccessLogged) {
        console.info("Archive API fully connected. Live search 100% operational.");
        archiveApiSuccessLogged = true;
      }

      if (attempt.description !== ARCHIVE_PRIMARY_STRATEGY) {
        console.info("Archive search completed using fallback strategy:", attempt.description);
        if (attempt.query && attempt.query !== query) {
          console.info("Retry used simplified query:", attempt.query);
        }
      }

      return { payload: payloadWithStart, attempt };
    } catch (error) {
      lastError = error;
      const context =
        error instanceof DirectArchiveSearchError
          ? { message: error.message, status: error.status, details: error.details }
          : { error };

      if (!isLastAttempt && isRetryableDirectError(error)) {
        console.warn(
          `Direct archive search attempt failed (${attempt.description}). Retrying with a sanitized query variant.`,
          {
            ...context,
            query: attempt.query
          }
        );
        continue;
      }

      console.warn(`Direct archive search attempt failed (${attempt.description}).`, {
        ...context,
        query: attempt.query
      });
      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Direct archive search attempts exhausted.");
}

/**
 * Execute an archive search request with the provided parameters.
 */
export async function searchArchive(
  query: string,
  page: number,
  rows: number,
  filters: SearchFilters,
  options?: { aiMode?: boolean; signal?: AbortSignal }
): Promise<ApiResult<ArchiveSearchResponse>> {
  const sanitizedQuery = query.trim();
  if (!sanitizedQuery) {
    return createApiError("Please enter a search query before searching the Internet Archive.", {
      type: "invalid-response",
    });
  }

  const safeRows = Number.isFinite(rows) && rows > 0 ? rows : 20;
  const safePage = Number.isFinite(page) && page > 0 ? page : 1;
  const safeOffset = Math.max(0, (safePage - 1) * safeRows);

  const url = buildApiUrl("/api/searchArchive");
  url.searchParams.set("q", sanitizedQuery);
  url.searchParams.set("page", String(safePage));
  url.searchParams.set("rows", String(safeRows));
  url.searchParams.set("offset", String(safeOffset));

  if (filters.mediaType !== "all") {
    url.searchParams.set("mediaType", filters.mediaType);
  }
  if (filters.yearFrom.trim()) {
    url.searchParams.set("yearFrom", filters.yearFrom.trim());
  }
  if (filters.yearTo.trim()) {
    url.searchParams.set("yearTo", filters.yearTo.trim());
  }
  if (filters.language.trim()) {
    url.searchParams.set("language", filters.language.trim());
  }
  if (filters.sourceTrust.trim() && filters.sourceTrust !== "any") {
    url.searchParams.set("sourceTrust", filters.sourceTrust.trim());
  }
  if (filters.availability.trim() && filters.availability !== "any") {
    url.searchParams.set("availability", filters.availability.trim());
  }
  if (filters.nsfwMode) {
    url.searchParams.set("nsfwMode", filters.nsfwMode);
  }
  if (filters.collection?.trim()) {
    url.searchParams.set("collection", filters.collection.trim());
  }
  if (filters.uploader?.trim()) {
    url.searchParams.set("uploader", filters.uploader.trim());
  }
  if (filters.subject?.trim()) {
    url.searchParams.set("subject", filters.subject.trim());
  }
  if (options?.aiMode) {
    url.searchParams.set("ai", "1");
  }

  let lastError: unknown = null;

  const requestResult = await safeJsonFetch<ArchiveSearchResponse>(
    url.toString(),
    { headers: { Accept: "application/json" }, signal: options?.signal },
    "Search request failed."
  );

  if (!requestResult.ok && requestResult.error.type === "abort") {
    return requestResult;
  }

  if (requestResult.ok) {
    const payload = requestResult.data;
    const archivePayload = payload.archive;
    if (!archiveApiSuccessLogged) {
      console.info("Archive API fully connected. Live search 100% operational.");
      archiveApiSuccessLogged = true;
    }
    if (archivePayload?.fallback) {
      if (archivePayload.fallback_message) {
        console.warn("Archive search fell back to offline dataset:", archivePayload.fallback_message);
      } else {
        console.warn("Archive search fell back to offline dataset.");
      }
      if (archivePayload.fallback_reason) {
        console.warn("Offline fallback reason:", archivePayload.fallback_reason);
      }
    }
    if (
      archivePayload?.search_strategy &&
      archivePayload.search_strategy !== "primary search with fuzzy expansion"
    ) {
      const strategyDetails = archivePayload.search_strategy_query?.trim();
      console.info("Archive search completed using fallback strategy:", archivePayload.search_strategy);
      if (strategyDetails) {
        console.info("Retry used simplified query:", strategyDetails);
      }
    }
    return requestResult;
  }

  lastError = requestResult.error;
  console.warn(
    "Alexandria API search request failed. Attempting direct Internet Archive connection.",
    requestResult.error
  );

  try {
    const directFilters: SearchFilters = {
      mediaType: filters.mediaType.trim(),
      yearFrom: filters.yearFrom.trim(),
      yearTo: filters.yearTo.trim(),
      language: filters.language.trim(),
      sourceTrust: filters.sourceTrust.trim(),
      availability: filters.availability.trim(),
      nsfwMode: filters.nsfwMode,
      collection: filters.collection?.trim(),
      uploader: filters.uploader?.trim(),
      subject: filters.subject?.trim(),
    };
    const { payload } = await executeDirectArchiveSearch(sanitizedQuery, safePage, safeRows, directFilters);
    const directResponse: ArchiveSearchResponse = {
      originalQuery: sanitizedQuery,
      finalQuery: sanitizedQuery,
      refinedByAI: false,
      mode: mapModeToSetting(filters.nsfwMode),
      results: Array.isArray(payload.results) ? payload.results : [],
      error: null,
      archive: payload,
    };
    return { ok: true, data: directResponse, status: 200 };
  } catch (directError) {
    lastError = directError;
    console.error("Direct Internet Archive search failed.", directError);
  }

  if (OFFLINE_FALLBACK_ENABLED) {
    console.warn("Search request failed, using local fallback dataset.", lastError);
    const fallbackPayload = performFallbackArchiveSearch(sanitizedQuery, safePage, safeRows, filters);
    const fallbackResponse: ArchiveSearchResponse = {
      originalQuery: sanitizedQuery,
      finalQuery: sanitizedQuery,
      refinedByAI: false,
      mode: mapModeToSetting(filters.nsfwMode),
      results: Array.isArray(fallbackPayload.results) ? fallbackPayload.results : [],
      error: null,
      archive: fallbackPayload,
    };
    return { ok: true, data: fallbackResponse, status: 200 };
  }

  const friendlyError = createFriendlySearchError(lastError);
  const errorDetails = isApiErrorInfo(lastError) ? lastError : undefined;
  return createApiError(friendlyError.message, {
    status: errorDetails?.status,
    details: errorDetails?.details,
    type: errorDetails?.type,
  });
}

/**
 * Request link availability for the provided URL.
 */
export async function checkLinkStatus(url: string): Promise<ApiResult<LinkStatus>> {
  const request = buildApiUrl("/api/status");
  request.searchParams.set("url", url);

  const result = await safeJsonFetch<{ status?: LinkStatus }>(
    request.toString(),
    undefined,
    "Status check failed."
  );

  if (!result.ok) {
    return result;
  }

  const status = result.data.status ?? "offline";
  return { ok: true, data: status, status: result.status };
}

/**
 * Query the Wayback Machine availability endpoint.
 */
export async function getWaybackAvailability(url: string): Promise<ApiResult<WaybackAvailabilityResponse>> {
  const request = buildApiUrl("/api/wayback");
  request.searchParams.set("url", url);

  return safeJsonFetch<WaybackAvailabilityResponse>(
    request.toString(),
    undefined,
    "Wayback availability request failed."
  );
}

/**
 * Ask the backend to request a Save Page Now snapshot for the URL.
 */
export async function requestSaveSnapshot(url: string): Promise<ApiResult<SavePageResponse>> {
  return safeJsonFetch<SavePageResponse>(
    buildApiUrl("/api/save").toString(),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url }),
    },
    "Save Page Now request failed."
  );
}

export async function submitReport(payload: ReportSubmissionPayload): Promise<ApiResult<ReportResponse>> {
  const result = await safeJsonFetch<ReportResponse>(
    buildApiUrl("/api/report").toString(),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    "Report submission failed."
  );

  if (!result.ok) {
    return result;
  }

  if (result.data.success === false) {
    const parts: string[] = [];
    if (typeof result.data.error === "string" && result.data.error.trim()) {
      parts.push(result.data.error.trim());
    }
    if (typeof result.data.details === "string" && result.data.details.trim()) {
      parts.push(result.data.details.trim());
    }
    return createApiError(parts.join(" ") || "Report submission failed.", {
      type: "invalid-response",
      status: result.status,
    });
  }

  return result;
}

export async function fetchArchiveMetadata(identifier: string): Promise<ApiResult<ArchiveMetadataResponse>> {
  const request = buildApiUrl("/api/metadata");
  request.searchParams.set("identifier", identifier);

  return safeJsonFetch<ArchiveMetadataResponse>(
    request.toString(),
    undefined,
    "Metadata request failed."
  );
}

export async function fetchCdxSnapshots(targetUrl: string, limit = 25): Promise<ApiResult<CdxResponse>> {
  const request = buildApiUrl("/api/cdx");
  request.searchParams.set("url", targetUrl);
  request.searchParams.set("limit", String(limit));

  return safeJsonFetch<CdxResponse>(
    request.toString(),
    undefined,
    "CDX timeline request failed."
  );
}

export async function scrapeArchive(query: string, count = 5): Promise<ApiResult<ScrapeResponse>> {
  const request = buildApiUrl("/api/scrape");
  request.searchParams.set("query", query);
  request.searchParams.set("count", String(count));

  return safeJsonFetch<ScrapeResponse>(
    request.toString(),
    undefined,
    "Archive highlights request failed."
  );
}
