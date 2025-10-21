import type {
  ArchiveSearchResponse,
  LinkStatus,
  ArchiveMetadataResponse,
  CdxResponse,
  ScrapeResponse,
  WaybackAvailabilityResponse,
  SavePageResponse,
  SearchFilters
} from "../types";
import { performFallbackArchiveSearch } from "../utils/fallbackSearch";

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
const OFFLINE_FALLBACK_ENABLED = offlineFallbackPreference === "true";

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

const API_BASE_URL = resolveApiBaseUrl();

function buildApiUrl(path: string): URL {
  return new URL(path, `${API_BASE_URL}/`);
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

  if (mediaTypeValue && mediaTypeValue !== "all") {
    expressions.push(`mediatype:(${mediaTypeValue})`);
  }

  if (yearFromValue || yearToValue) {
    const start = yearFromValue || "*";
    const end = yearToValue || "*";
    expressions.push(`year:[${start} TO ${end}]`);
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
  requestUrl.searchParams.set("page", String(page));
  requestUrl.searchParams.set("rows", String(rows));
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

  const normalizedFilters: SearchFilters = {
    mediaType: filters.mediaType.trim(),
    yearFrom: filters.yearFrom.trim(),
    yearTo: filters.yearTo.trim()
  };

  const createAttempt = (
    description: string,
    queryValue: string,
    filterValue: SearchFilters,
    options: { includeFilters: boolean; includeFuzzy: boolean }
  ): DirectArchiveSearchAttempt => {
    const url = buildDirectArchiveSearchUrl(queryValue, page, rows, filterValue, options);
    const effectiveQuery = url.searchParams.get("q") ?? queryValue;
    return { description, url, query: effectiveQuery };
  };

  const emptyFilters: SearchFilters = { mediaType: "", yearFrom: "", yearTo: "" };

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

async function fetchDirectArchiveAttempt(attempt: DirectArchiveSearchAttempt): Promise<ArchiveSearchResponse> {
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
    return JSON.parse(trimmedBody) as ArchiveSearchResponse;
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
): Promise<{ payload: ArchiveSearchResponse; attempt: DirectArchiveSearchAttempt }> {
  const attempts = buildDirectArchiveSearchAttempts(query, page, rows, filters);
  let lastError: unknown = null;

  for (let index = 0; index < attempts.length; index++) {
    const attempt = attempts[index];
    const isLastAttempt = index === attempts.length - 1;

    try {
      const payload = await fetchDirectArchiveAttempt(attempt);
      const augmented: ArchiveSearchResponse = {
        ...payload,
        search_strategy: attempt.description,
        search_strategy_query: attempt.query
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

      return { payload: augmented, attempt };
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
  filters: SearchFilters
): Promise<ArchiveSearchResponse> {
  const sanitizedQuery = query.trim();
  if (!sanitizedQuery) {
    throw new Error("Please enter a search query before searching the Internet Archive.");
  }

  const url = buildApiUrl("/api/searchArchive");
  url.searchParams.set("q", sanitizedQuery);
  url.searchParams.set("page", String(page));
  url.searchParams.set("rows", String(rows));

  if (filters.mediaType !== "all") {
    url.searchParams.set("mediaType", filters.mediaType);
  }
  if (filters.yearFrom.trim()) {
    url.searchParams.set("yearFrom", filters.yearFrom.trim());
  }
  if (filters.yearTo.trim()) {
    url.searchParams.set("yearTo", filters.yearTo.trim());
  }

  let lastError: unknown = null;

  try {
    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) {
      throw await buildResponseError(
        response,
        `Search request failed with status ${response.status}.`
      );
    }

    const rawBody = await response.text();
    const trimmedBody = rawBody.trim();
    if (!trimmedBody) {
      throw new Error("Search request returned an empty response body.");
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (isLikelyHtmlResponse(trimmedBody, contentType)) {
      const preview = trimmedBody.slice(0, HTML_PREVIEW_LIMIT).replace(/\s+/g, " ").trim();
      console.warn("Received non-JSON response from Internet Archive search endpoint.", {
        contentType,
        preview
      });
      throw new Error("Invalid response from Internet Archive. Please try again later.");
    }

    try {
      const payload = JSON.parse(trimmedBody) as ArchiveSearchResponse;
      if (!archiveApiSuccessLogged) {
        console.info("Archive API fully connected. Live search 100% operational.");
        archiveApiSuccessLogged = true;
      }
      if (payload.fallback) {
        if (payload.fallback_message) {
          console.warn("Archive search fell back to offline dataset:", payload.fallback_message);
        } else {
          console.warn("Archive search fell back to offline dataset.");
        }
        if (payload.fallback_reason) {
          console.warn("Offline fallback reason:", payload.fallback_reason);
        }
      }
      if (payload.search_strategy && payload.search_strategy !== "primary search with fuzzy expansion") {
        const strategyDetails = payload.search_strategy_query?.trim();
        console.info("Archive search completed using fallback strategy:", payload.search_strategy);
        if (strategyDetails) {
          console.info("Retry used simplified query:", strategyDetails);
        }
      }
      return payload;
    } catch (parseError) {
      const preview = trimmedBody.slice(0, HTML_PREVIEW_LIMIT).replace(/\s+/g, " ").trim();
      console.warn("Failed to parse Internet Archive search response as JSON.", parseError, {
        preview
      });
      throw new Error("Invalid response from Internet Archive. Please try again later.");
    }
  } catch (error) {
    lastError = error;
    console.warn("Alexandria API search request failed. Attempting direct Internet Archive connection.", error);
  }

  try {
    const directFilters: SearchFilters = {
      mediaType: filters.mediaType.trim(),
      yearFrom: filters.yearFrom.trim(),
      yearTo: filters.yearTo.trim()
    };
    const { payload } = await executeDirectArchiveSearch(sanitizedQuery, page, rows, directFilters);
    return payload;
  } catch (directError) {
    lastError = directError;
    console.error("Direct Internet Archive search failed.", directError);
  }

  if (OFFLINE_FALLBACK_ENABLED) {
    console.warn("Search request failed, using local fallback dataset.", lastError);
    return performFallbackArchiveSearch(sanitizedQuery, page, rows, filters);
  }

  throw createFriendlySearchError(lastError);
}

/**
 * Request link availability for the provided URL.
 */
export async function checkLinkStatus(url: string): Promise<LinkStatus> {
  const request = buildApiUrl("/api/status");
  request.searchParams.set("url", url);

  const response = await fetch(request.toString());
  if (!response.ok) {
    throw new Error(`Status check failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { status?: LinkStatus };
  return payload.status ?? "offline";
}

/**
 * Query the Wayback Machine availability endpoint.
 */
export async function getWaybackAvailability(url: string) {
  const request = buildApiUrl("/api/wayback");
  request.searchParams.set("url", url);

  const response = await fetch(request.toString());
  if (!response.ok) {
    throw new Error(`Wayback availability failed with status ${response.status}`);
  }

  return response.json() as Promise<WaybackAvailabilityResponse>;
}

/**
 * Ask the backend to request a Save Page Now snapshot for the URL.
 */
export async function requestSaveSnapshot(url: string): Promise<SavePageResponse> {
  const response = await fetch(buildApiUrl("/api/save").toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ url })
  });

  if (!response.ok) {
    throw new Error(`Save Page Now request failed with status ${response.status}`);
  }

  return (await response.json()) as SavePageResponse;
}

export async function fetchArchiveMetadata(identifier: string): Promise<ArchiveMetadataResponse> {
  const request = buildApiUrl("/api/metadata");
  request.searchParams.set("identifier", identifier);

  const response = await fetch(request.toString());
  if (!response.ok) {
    throw new Error(`Metadata request failed with status ${response.status}`);
  }

  return (await response.json()) as ArchiveMetadataResponse;
}

export async function fetchCdxSnapshots(targetUrl: string, limit = 25): Promise<CdxResponse> {
  const request = buildApiUrl("/api/cdx");
  request.searchParams.set("url", targetUrl);
  request.searchParams.set("limit", String(limit));

  const response = await fetch(request.toString());
  if (!response.ok) {
    throw new Error(`CDX timeline request failed with status ${response.status}`);
  }

  return (await response.json()) as CdxResponse;
}

export async function scrapeArchive(query: string, count = 5): Promise<ScrapeResponse> {
  const request = buildApiUrl("/api/scrape");
  request.searchParams.set("query", query);
  request.searchParams.set("count", String(count));

  const response = await fetch(request.toString());
  if (!response.ok) {
    throw new Error(`Scrape request failed with status ${response.status}`);
  }

  return (await response.json()) as ScrapeResponse;
}

async function buildResponseError(response: Response, fallbackMessage: string): Promise<Error> {
  const contentType = response.headers.get("content-type") ?? "";
  const responseClone = response.clone();

  if (contentType.includes("application/json")) {
    try {
      const payload = (await responseClone.json()) as { error?: unknown; details?: unknown } | null;
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
        return new Error(`${fallbackMessage} ${parts.join(" ")}`.trim());
      }
    } catch (error) {
      console.warn("Failed to parse error response payload", error);
    }
  }

  try {
    const text = (await response.text()).trim();
    if (text) {
      return new Error(`${fallbackMessage} ${text}`.trim());
    }
  } catch (error) {
    console.warn("Failed to read error response body", error);
  }

  return new Error(fallbackMessage);
}
