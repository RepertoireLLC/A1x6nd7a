import type {
  ArchiveSearchResponse,
  LinkStatus,
  ArchiveMetadataResponse,
  CdxResponse,
  ScrapeResponse,
  WaybackAvailabilityResponse,
  SavePageResponse,
  SearchFilters,
  ArchiveDocLinks,
  ArchiveSearchDoc,
  ArchiveSearchResultSummary,
  SiteImageResponse
} from "../types";
import { performFallbackArchiveSearch } from "../utils/fallbackSearch";
import { getDescription, getYearOrDate } from "../utils/format";
import { NSFW_KEYWORDS } from "../data/nsfwKeywords";
import { gatherSearchableText, sortDocsByRelevance } from "../utils/relevance";

const HTML_CONTENT_TYPE_PATTERN = /text\/html/i;
const HTML_DOCTYPE_PATTERN = /^\s*<!DOCTYPE\s+html/i;
const HTML_TAG_PATTERN = /^\s*<html/i;
const HTML_PREVIEW_LIMIT = 200;
const NETWORK_ERROR_MESSAGE_PATTERN = /(failed to fetch|fetch failed|network\s?error|network request failed|load failed|connection refused|dns lookup failed|Proxy response \(\d+\) !== 200 when HTTP Tunneling)/i;

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
  "score",
  "downloads",
  "originalurl",
  "original"
].join(",");

const ARCHIVE_SEARCH_SORTS = ["downloads desc", "publicdate desc"];

const PUNCTUATION_PATTERN = /[^\p{L}\p{N}\s]+/gu;
const LUCENE_SPECIAL_CHARS = /([+\-!(){}\[\]^"~*?:\\\/])/g;
const MAX_SNIPPET_LENGTH = 280;

let archiveApiSuccessLogged = false;

function sanitizeSearchQuery(input: string): string {
  return input
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function removePunctuation(value: string): string {
  return value.replace(PUNCTUATION_PATTERN, " ").replace(/\s+/g, " ").trim();
}

function escapeLuceneValue(value: string): string {
  return value.replace(LUCENE_SPECIAL_CHARS, "\\$1");
}

function tokenizeQuery(value: string): string[] {
  return value
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function buildWildcardExpression(tokens: string[]): string {
  if (tokens.length === 0) {
    return "";
  }
  return tokens
    .map((token) => `${escapeLuceneValue(token)}*`)
    .join(" ");
}

function buildFuzzyExpression(tokens: string[], distance = 1): string {
  if (tokens.length === 0) {
    return "";
  }
  return tokens
    .map((token) => `${escapeLuceneValue(token)}~${distance}`)
    .join(" ");
}

function mergeTransformations(current: string[], next: string[]): string[] {
  const seen = new Set<string>();
  for (const entry of current) {
    if (entry && !seen.has(entry)) {
      seen.add(entry);
    }
  }
  for (const entry of next) {
    if (entry && !seen.has(entry)) {
      seen.add(entry);
    }
  }
  return Array.from(seen);
}

function computeArchiveLinks(identifier: string, existing?: ArchiveDocLinks): ArchiveDocLinks {
  if (existing?.archive) {
    const archiveLink = existing.archive;
    const waybackLink = existing.wayback ?? `https://web.archive.org/web/*/${archiveLink}`;
    return {
      archive: archiveLink,
      original: existing.original ?? null,
      wayback: waybackLink
    };
  }

  const archiveUrl = `https://archive.org/details/${encodeURIComponent(identifier)}`;
  return {
    archive: archiveUrl,
    original: existing?.original ?? null,
    wayback: `https://web.archive.org/web/*/${archiveUrl}`
  };
}

function computeThumbnail(identifier: string, current?: string): string | undefined {
  if (current) {
    return current;
  }
  if (!identifier || identifier.startsWith("http://") || identifier.startsWith("https://")) {
    return undefined;
  }
  return `https://archive.org/services/img/${encodeURIComponent(identifier)}`;
}

function isExplicitDoc(doc: ArchiveSearchDoc): boolean {
  if (doc.nsfw) {
    return true;
  }
  const haystack = gatherSearchableText(doc);
  return NSFW_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

function enrichArchiveDoc(doc: ArchiveSearchDoc): ArchiveSearchDoc {
  const links = computeArchiveLinks(doc.identifier, doc.links);
  const thumbnail = computeThumbnail(doc.identifier, doc.thumbnail);
  const archiveUrl = doc.archive_url ?? links.archive;
  const originalUrl = doc.original_url ?? links.original ?? undefined;
  const waybackUrl = doc.wayback_url ?? links.wayback ?? undefined;
  const flaggedNSFW = isExplicitDoc(doc);

  return {
    ...doc,
    links,
    archive_url: archiveUrl,
    ...(originalUrl ? { original_url: originalUrl } : {}),
    ...(waybackUrl ? { wayback_url: waybackUrl } : {}),
    ...(thumbnail ? { thumbnail } : {}),
    ...(flaggedNSFW ? { nsfw: true } : {})
  };
}

function truncateSnippet(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.length <= MAX_SNIPPET_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_SNIPPET_LENGTH - 1).trimEnd()}…`;
}

function buildResultSummaries(docs: ArchiveSearchDoc[]): ArchiveSearchResultSummary[] {
  return docs.map((doc) => {
    const description = truncateSnippet(getDescription(doc.description));
    const archiveUrl = doc.archive_url ?? doc.links?.archive ?? `https://archive.org/details/${encodeURIComponent(doc.identifier)}`;
    const originalUrl = doc.original_url ?? doc.links?.original ?? null;
    const creator = Array.isArray(doc.creator) ? doc.creator.join(", ") : doc.creator ?? null;
    const downloadsValue = (() => {
      if (typeof doc.downloads === "number" && Number.isFinite(doc.downloads)) {
        return doc.downloads;
      }
      if (typeof doc.downloads === "string") {
        const parsed = Number.parseInt(doc.downloads, 10);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    })();

    const yearValue = getYearOrDate(doc);

    return {
      identifier: doc.identifier,
      title: doc.title ?? doc.identifier,
      description,
      mediatype: doc.mediatype ?? null,
      year: yearValue && yearValue !== "Unknown" ? yearValue : null,
      creator,
      archive_url: archiveUrl,
      original_url: originalUrl,
      downloads: downloadsValue
    };
  });
}

function finalizeArchivePayload(
  payload: ArchiveSearchResponse,
  sanitizedQuery: string,
  options: {
    notice?: string | null;
    transformations?: string[];
    connectionMode?: "backend" | "direct" | "offline";
  } = {}
): ArchiveSearchResponse {
  const docs = payload.response?.docs ?? [];
  const enrichedDocs = docs.map((doc) => enrichArchiveDoc({ ...doc }));
  const sortedDocs = sortDocsByRelevance(enrichedDocs, sanitizedQuery);
  const notice = options.notice ?? payload.search_notice ?? null;
  const transformations = options.transformations ?? payload.search_transformations ?? [];
  const connectionMode = options.connectionMode ?? payload.connection_mode ?? undefined;

  const normalized: ArchiveSearchResponse = {
    ...payload,
    response: {
      ...payload.response,
      docs: sortedDocs
    },
    results: buildResultSummaries(sortedDocs),
    sanitized_query: sanitizedQuery,
    ...(notice ? { search_notice: notice } : {}),
    ...(transformations.length > 0 ? { search_transformations: mergeTransformations([], transformations) } : {}),
    ...(connectionMode ? { connection_mode: connectionMode } : {})
  };

  return normalized;
}

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
const OFFLINE_FALLBACK_ENABLED =
  offlineFallbackPreference === "true" || (typeof import.meta.env.DEV !== "undefined" && import.meta.env.DEV);

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
  transformations: string[];
  approximate: boolean;
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
  for (const sort of ARCHIVE_SEARCH_SORTS) {
    requestUrl.searchParams.append("sort[]", sort);
  }

  return requestUrl;
}

function buildDirectArchiveSearchAttempts(
  query: string,
  page: number,
  rows: number,
  filters: SearchFilters
): DirectArchiveSearchAttempt[] {
  const sanitizedQuery = sanitizeSearchQuery(query);

  const normalizedFilters: SearchFilters = {
    mediaType: filters.mediaType.trim(),
    yearFrom: filters.yearFrom.trim(),
    yearTo: filters.yearTo.trim()
  };

  const emptyFilters: SearchFilters = { mediaType: "", yearFrom: "", yearTo: "" };
  const seen = new Set<string>();
  const attempts: DirectArchiveSearchAttempt[] = [];

  const pushAttempt = (
    description: string,
    queryValue: string,
    filterValue: SearchFilters,
    options: { includeFilters: boolean; includeFuzzy: boolean },
    transformations: string[],
    approximate: boolean
  ) => {
    if (!queryValue) {
      return;
    }
    const url = buildDirectArchiveSearchUrl(queryValue, page, rows, filterValue, options);
    const signature = `${description}|${url.toString()}`;
    if (seen.has(signature)) {
      return;
    }
    seen.add(signature);
    const effectiveQuery = url.searchParams.get("q") ?? queryValue;
    attempts.push({ description, url, query: effectiveQuery, transformations, approximate });
  };

  const punctuationStripped = removePunctuation(sanitizedQuery);
  const punctuationTokens = tokenizeQuery(punctuationStripped);
  const wildcardExpression = buildWildcardExpression(punctuationTokens);
  const fuzzyExpression = buildFuzzyExpression(punctuationTokens);
  const plainKeywords = buildPlainKeywordQuery(sanitizedQuery);

  pushAttempt(ARCHIVE_PRIMARY_STRATEGY, sanitizedQuery, normalizedFilters, { includeFilters: true, includeFuzzy: true }, [], false);
  pushAttempt(
    "clean search without fuzzy expansion",
    sanitizedQuery,
    normalizedFilters,
    { includeFilters: true, includeFuzzy: false },
    ["no-fuzzy"],
    false
  );
  pushAttempt(
    "minimal search without filters",
    sanitizedQuery,
    emptyFilters,
    { includeFilters: false, includeFuzzy: false },
    ["no-filters"],
    false
  );

  if (punctuationStripped && punctuationStripped !== sanitizedQuery) {
    pushAttempt(
      "punctuation-stripped search",
      punctuationStripped,
      normalizedFilters,
      { includeFilters: true, includeFuzzy: true },
      ["punctuation-removed"],
      true
    );
  }

  if (wildcardExpression) {
    pushAttempt(
      "wildcard expansion search",
      wildcardExpression,
      normalizedFilters,
      { includeFilters: true, includeFuzzy: false },
      ["wildcard*"],
      true
    );
    pushAttempt(
      "wildcard expansion search (no filters)",
      wildcardExpression,
      emptyFilters,
      { includeFilters: false, includeFuzzy: false },
      ["wildcard*", "no-filters"],
      true
    );
  }

  if (fuzzyExpression) {
    pushAttempt(
      "fuzzy similarity search",
      fuzzyExpression,
      normalizedFilters,
      { includeFilters: true, includeFuzzy: false },
      ["fuzzy~1"],
      true
    );
    pushAttempt(
      "fuzzy similarity search (no filters)",
      fuzzyExpression,
      emptyFilters,
      { includeFilters: false, includeFuzzy: false },
      ["fuzzy~1", "no-filters"],
      true
    );
  }

  if (plainKeywords && plainKeywords !== sanitizedQuery) {
    pushAttempt(
      "plain keyword search without special syntax",
      plainKeywords,
      emptyFilters,
      { includeFilters: false, includeFuzzy: false },
      ["plain-keywords"],
      true
    );
  }

  return attempts;
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
    const data = JSON.parse(trimmedBody) as ArchiveSearchResponse & { error?: string };
    if (data && typeof data === "object" && typeof data.error === "string" && data.error.trim()) {
      throw new DirectArchiveSearchError(`Archive search failed: ${data.error.trim()}`, {
        retryable: true,
        details: { error: data.error }
      });
    }
    return data;
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
): Promise<{ payload: ArchiveSearchResponse; attempt: DirectArchiveSearchAttempt; notice: string | null; transformations: string[] }> {
  const attempts = buildDirectArchiveSearchAttempts(query, page, rows, filters);
  let lastError: unknown = null;
  let accumulatedTransformations: string[] = [];
  let fallbackActivated = false;

  for (let index = 0; index < attempts.length; index++) {
    const attempt = attempts[index];
    const isLastAttempt = index === attempts.length - 1;

    try {
      const payload = await fetchDirectArchiveAttempt(attempt);
      const docs = payload.response?.docs ?? [];

      if (docs.length === 0 && !isLastAttempt) {
        accumulatedTransformations = mergeTransformations(accumulatedTransformations, attempt.transformations);
        fallbackActivated = true;
        continue;
      }

      const combinedTransformations = mergeTransformations(accumulatedTransformations, attempt.transformations);
      const shouldNotify = fallbackActivated || attempt.approximate || combinedTransformations.length > 0;
      const noticeMessage = shouldNotify ? "No exact results. Showing closest matches:" : null;

      const augmented: ArchiveSearchResponse = {
        ...payload,
        search_strategy: attempt.description,
        search_strategy_query: attempt.query,
        ...(noticeMessage ? { search_notice: noticeMessage } : {}),
        ...(combinedTransformations.length > 0 ? { search_transformations: combinedTransformations } : {})
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

      return { payload: augmented, attempt, notice: noticeMessage, transformations: combinedTransformations };
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
  const sanitizedQuery = sanitizeSearchQuery(query);
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
      return finalizeArchivePayload(payload, sanitizedQuery, {
        notice: payload.search_notice ?? null,
        transformations: payload.search_transformations ?? [],
        connectionMode: "backend"
      });
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
    const { payload, notice, transformations } = await executeDirectArchiveSearch(
      sanitizedQuery,
      page,
      rows,
      directFilters
    );
    return finalizeArchivePayload(payload, sanitizedQuery, {
      notice,
      transformations,
      connectionMode: "direct"
    });
  } catch (directError) {
    lastError = directError;
    console.error("Direct Internet Archive search failed.", directError);
  }

  if (OFFLINE_FALLBACK_ENABLED) {
    console.warn("Search request failed, using local fallback dataset.", lastError);
    const fallback = performFallbackArchiveSearch(sanitizedQuery, page, rows, filters);
    return finalizeArchivePayload(fallback, sanitizedQuery, {
      notice: fallback.search_notice ?? null,
      transformations: fallback.search_transformations ?? [],
      connectionMode: "offline"
    });
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

export async function fetchSiteImages(
  targetUrl: string,
  page = 1,
  pageSize = 40
): Promise<SiteImageResponse> {
  const request = buildApiUrl("/api/site-images");
  request.searchParams.set("url", targetUrl);
  request.searchParams.set("page", String(page));
  request.searchParams.set("pageSize", String(pageSize));

  const response = await fetch(request.toString());
  if (!response.ok) {
    throw await buildResponseError(response, "Unable to load archived images.");
  }

  const rawPayload = (await response.json()) as Partial<SiteImageResponse>;
  const items = Array.isArray(rawPayload.items) ? rawPayload.items : [];
  const resolvedPage =
    typeof rawPayload.page === "number" && Number.isFinite(rawPayload.page) && rawPayload.page > 0
      ? rawPayload.page
      : page;
  const resolvedPageSize =
    typeof rawPayload.pageSize === "number" && Number.isFinite(rawPayload.pageSize) && rawPayload.pageSize > 0
      ? rawPayload.pageSize
      : pageSize;
  const resolvedScope = rawPayload.scope === "path" ? "path" : "host";
  const resolvedQuery =
    typeof rawPayload.query === "string" && rawPayload.query.trim() ? rawPayload.query.trim() : targetUrl;
  const fallback = Boolean(rawPayload.fallback);
  const total =
    typeof rawPayload.total === "number" && Number.isFinite(rawPayload.total) ? rawPayload.total : undefined;
  const hasMore = Boolean(rawPayload.hasMore);
  const site =
    typeof rawPayload.site === "string" && rawPayload.site.trim()
      ? rawPayload.site.trim()
      : (() => {
          try {
            return new URL(targetUrl).hostname;
          } catch {
            return targetUrl;
          }
        })();

  return {
    items,
    page: resolvedPage,
    pageSize: resolvedPageSize,
    hasMore,
    query: resolvedQuery,
    scope: resolvedScope,
    total,
    site,
    fallback
  };
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
