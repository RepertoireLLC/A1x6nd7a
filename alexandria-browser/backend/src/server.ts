/**
 * Alexandria Browser Backend
 *
 * Manifesto:
 * The internet forgets. Links die. Knowledge is buried by algorithms and corporations.
 * The Alexandria Browser exists to preserve collective memory. It searches, restores,
 * and archives knowledge using the Internet Archive. It serves no ads, no agendas—only truth,
 * utility, and preservation.
 *
 * Core values:
 * - Preserve Everything
 * - No Gatekeepers
 * - Serve the Seeker
 * - Build Open and Forkable
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { ProxyAgent, setGlobalDispatcher } from "undici";

import { SAMPLE_ARCHIVE_DOCS, type SampleArchiveDoc } from "./data/sampleArchiveDocs";
import { SAMPLE_METADATA } from "./data/sampleMetadata";
import { SAMPLE_CDX_SNAPSHOTS } from "./data/sampleCdxSnapshots";
import { DEFAULT_SCRAPE_RESPONSE, SAMPLE_SCRAPE_RESULTS } from "./data/sampleScrapeResults";
import { isNSFWContent } from "./services/nsfwFilter";
import { getSpellCorrector, type SpellcheckResult } from "./services/spellCorrector";

const ARCHIVE_SEARCH_ENDPOINT = "https://archive.org/advancedsearch.php";
const WAYBACK_AVAILABILITY_ENDPOINT = "https://archive.org/wayback/available";
const SAVE_PAGE_NOW_ENDPOINT = "https://web.archive.org/save/";
const METADATA_ENDPOINT_BASE = "https://archive.org/metadata/";
const CDX_SEARCH_ENDPOINT = "https://web.archive.org/cdx/search/cdx";
const SCRAPE_SEARCH_ENDPOINT = "https://archive.org/services/search/v1/scrape";
const DEFAULT_USER_AGENT =
  getEnv("ARCHIVE_USER_AGENT") ??
  "Mozilla/5.0 (compatible; AlexandriaBrowser/1.0; +https://github.com/harmonia-labs/alexandria-browser)";

const ALLOWED_MEDIA_TYPES = new Set([
  "texts",
  "audio",
  "movies",
  "image",
  "software",
  "web",
  "data",
  "collection",
  "etree",
  "tvnews"
]);

const YEAR_PATTERN = /^\d{4}$/;

type LinkStatus = "online" | "archived-only" | "offline";

type ArchiveSearchResultSummary = {
  identifier: string;
  title: string;
  description: string;
  mediatype: string | null;
  year: string | null;
  creator: string | null;
  archive_url: string | null;
  original_url: string | null;
  downloads: number | null;
};

type SearchPagination = {
  page: number;
  rows: number;
  total: number | null;
};

type ArchiveSearchResponse = Record<string, unknown> & {
  response?: {
    docs?: Array<Record<string, unknown>>;
    numFound?: number;
    start?: number;
  };
  fallback?: boolean;
  fallback_reason?: string;
  fallback_message?: string;
  results?: ArchiveSearchResultSummary[];
  pagination?: SearchPagination;
  search_strategy?: string;
  search_strategy_query?: string;
};

type ArchiveSearchFiltersInput = {
  mediaType?: string;
  yearFrom?: string;
  yearTo?: string;
};

type ArchiveSearchAttempt = {
  description: string;
  url: URL;
  query: string;
};

type ArchiveLinks = {
  archive: string;
  original?: string | null;
  wayback?: string | null;
};

type ArchiveMetadataResponse = Record<string, unknown> & {
  metadata?: Record<string, unknown>;
  files?: Array<Record<string, unknown>>;
  fallback?: boolean;
};

type CdxSnapshot = {
  timestamp: string;
  original: string;
  status: string;
  mime: string;
  digest?: string;
  length?: number;
};

type CdxResponse = {
  snapshots: CdxSnapshot[];
  fallback?: boolean;
};

type ScrapeItem = Record<string, unknown> & {
  identifier: string;
  title?: string;
  mediatype?: string;
  description?: string;
  publicdate?: string;
  downloads?: number;
};

type ScrapeResponse = {
  items: ScrapeItem[];
  total: number;
  fallback?: boolean;
  query: string;
};

type HandlerContext = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
};

type RouteHandler = (context: HandlerContext) => Promise<void> | void;

const HEAD_TIMEOUT_MS = 7000;
const OFFLINE_FALLBACK_MESSAGE_BASE =
  "Working offline — showing a limited built-in dataset.";

const spellCorrector = getSpellCorrector();

function ensureUrlString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed).toString();
  } catch {
    return null;
  }
}

function buildArchiveLinks(identifier: unknown, originalField?: unknown): ArchiveLinks | null {
  const identifierString = typeof identifier === "string" ? identifier.trim() : "";
  const identifierLooksLikeUrl = /^https?:\/\//i.test(identifierString);
  const originalUrl = ensureUrlString(originalField);
  const preferredOriginal = identifierLooksLikeUrl ? ensureUrlString(identifierString) : originalUrl;

  const archiveUrlBase = identifierLooksLikeUrl
    ? ensureUrlString(identifierString)
    : identifierString
    ? `https://archive.org/details/${encodeURIComponent(identifierString)}`
    : null;

  const archiveUrl = archiveUrlBase ?? preferredOriginal;
  if (!archiveUrl) {
    return null;
  }

  const waybackTarget = archiveUrlBase ?? preferredOriginal;
  const waybackUrl = waybackTarget ? `https://web.archive.org/web/*/${waybackTarget}` : null;

  return {
    archive: archiveUrl,
    original: preferredOriginal,
    wayback: waybackUrl
  };
}

function buildArchiveThumbnail(identifier: unknown): string | null {
  if (typeof identifier !== "string" || !identifier.trim() || /^https?:\/\//i.test(identifier)) {
    return null;
  }
  const encoded = encodeURIComponent(identifier.trim());
  return `https://archive.org/services/img/${encoded}`;
}

function attachArchiveLinks(record: Record<string, unknown>): Record<string, unknown> {
  const existingLinks =
    record.links && typeof record.links === "object"
      ? (record.links as Record<string, unknown>)
      : null;

  const extractLinkValue = (value: unknown): string | null => {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const archiveFromRecord = extractLinkValue(existingLinks ? existingLinks["archive"] : null);
  const originalFromRecord = extractLinkValue(existingLinks ? existingLinks["original"] : null);
  const waybackFromRecord = extractLinkValue(existingLinks ? existingLinks["wayback"] : null);

  const generatedLinks = buildArchiveLinks(
    record.identifier,
    originalFromRecord ?? record["original_url"] ?? record["originalurl"] ?? record["original"] ?? record["url"]
  );

  let archive = archiveFromRecord ?? generatedLinks?.archive ?? null;
  const original = originalFromRecord ?? generatedLinks?.original ?? null;
  if (!archive && original) {
    archive = original;
  }
  const wayback =
    waybackFromRecord ?? generatedLinks?.wayback ?? (archive ? `https://web.archive.org/web/*/${archive}` : null);

  const thumbnail = buildArchiveThumbnail(record.identifier);
  const existingThumbnail = typeof record["thumbnail"] === "string" ? (record["thumbnail"] as string) : null;
  const hasExistingThumbnail = Boolean(existingThumbnail && existingThumbnail.trim().length > 0);

  if (!archive && !original && !wayback && !thumbnail) {
    return record;
  }

  const next: Record<string, unknown> = { ...record };

  if (archive) {
    const nextLinks: ArchiveLinks = { archive };
    if (original) {
      nextLinks.original = original;
    }
    if (wayback) {
      nextLinks.wayback = wayback;
    }

    next.links = nextLinks;

    if (typeof next["archive_url"] !== "string" || (next["archive_url"] as string).length === 0) {
      next["archive_url"] = archive;
    }
    if (original && (typeof next["original_url"] !== "string" || (next["original_url"] as string).length === 0)) {
      next["original_url"] = original;
    }
    if (original && (typeof next["originalurl"] !== "string" || (next["originalurl"] as string).length === 0)) {
      next["originalurl"] = original;
    }
    if (wayback && (typeof next["wayback_url"] !== "string" || (next["wayback_url"] as string).length === 0)) {
      next["wayback_url"] = wayback;
    }
  }

  if (!hasExistingThumbnail && thumbnail) {
    next["thumbnail"] = thumbnail;
  }

  return next;
}

function collectStringValues(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return [String(value)];
  }

  if (Array.isArray(value)) {
    const results: string[] = [];
    for (const entry of value) {
      if (typeof entry === "string") {
        const trimmed = entry.trim();
        if (trimmed) {
          results.push(trimmed);
        }
      } else if (typeof entry === "number" && Number.isFinite(entry)) {
        results.push(String(entry));
      }
    }
    return results;
  }

  return [];
}

function coerceSingleString(value: unknown): string | null {
  const values = collectStringValues(value);
  return values.length > 0 ? values[0] : null;
}

function coerceText(value: unknown): string | null {
  const values = collectStringValues(value);
  if (values.length === 0) {
    return null;
  }
  return values.join(" ");
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number.parseInt(trimmed, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function parseRequestUrl(req: IncomingMessage): URL {
  const hostHeader = req.headers?.host ?? "localhost";
  const requestUrl = req.url ?? "/";
  return new URL(requestUrl, `http://${hostHeader}`);
}

function getEnv(name: string): string | undefined {
  const globalProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return globalProcess?.env?.[name];
}

const nodeEnv = getEnv("NODE_ENV") ?? "development";
const offlineFallbackEnv = getEnv("ENABLE_OFFLINE_FALLBACK");
const offlineFallbackEnabled = offlineFallbackEnv === "true";
const proxyEnvCandidates = [
  getEnv("HTTPS_PROXY"),
  getEnv("https_proxy"),
  getEnv("HTTP_PROXY"),
  getEnv("http_proxy")
];
const proxyUrl = proxyEnvCandidates.find((value) => typeof value === "string" && value.trim().length > 0)?.trim() ?? null;
const noProxyEnv = getEnv("NO_PROXY") ?? getEnv("no_proxy") ?? "";

function parseNoProxyList(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function maskProxyForLog(raw: string): string {
  try {
    const parsed = new URL(raw);
    const hasAuth = parsed.username !== "" || parsed.password !== "";
    const authFragment = hasAuth ? "***@" : "";
    return `${parsed.protocol}//${authFragment}${parsed.host}`;
  } catch {
    return raw;
  }
}

if (proxyUrl) {
  try {
    const bypassEntries = parseNoProxyList(noProxyEnv);
    const agentOptions =
      bypassEntries.length > 0
        ? ({ uri: proxyUrl, noProxy: bypassEntries } as ProxyAgent.Options & { noProxy: string[] })
        : proxyUrl;
    const proxyAgent = new ProxyAgent(agentOptions);
    setGlobalDispatcher(proxyAgent);
    const maskedProxy = maskProxyForLog(proxyUrl);
    if (bypassEntries.length > 0) {
      console.info(
        `Configured HTTP proxy for outbound archive requests via ${maskedProxy} (no_proxy=${bypassEntries.join(",")}).`
      );
    } else {
      console.info(`Configured HTTP proxy for outbound archive requests via ${maskedProxy}.`);
    }
  } catch (error) {
    console.warn("Unable to configure HTTP proxy for outbound archive requests.", error);
  }
}

const HTML_CONTENT_TYPE_PATTERN = /text\/html/i;
const HTML_DOCTYPE_PATTERN = /<!doctype\s+html/i;
const HTML_TAG_PATTERN = /<html/i;
const HTML_PREVIEW_LIMIT = 240;

type ArchiveSearchErrorKind =
  | "http-status"
  | "empty-body"
  | "html-response"
  | "malformed-json";

class ArchiveSearchResponseError extends Error {
  public readonly retryable: boolean;
  public readonly preview?: string;
  public readonly contentType?: string;
  public readonly kind?: ArchiveSearchErrorKind;

  constructor(
    message: string,
    options: {
      retryable?: boolean;
      preview?: string;
      contentType?: string;
      kind?: ArchiveSearchErrorKind;
    } = {}
  ) {
    super(message);
    this.name = "ArchiveSearchResponseError";
    this.retryable = options.retryable ?? false;
    this.preview = options.preview;
    this.contentType = options.contentType;
    this.kind = options.kind;
  }
}

let archiveSearchConnectivityLogged = false;

function isHtmlLikeResponse(body: string, contentType: string): boolean {
  if (!body) {
    return false;
  }

  if (HTML_CONTENT_TYPE_PATTERN.test(contentType)) {
    return true;
  }

  const snippet = body.slice(0, HTML_PREVIEW_LIMIT).toLowerCase();
  if (HTML_DOCTYPE_PATTERN.test(snippet) || HTML_TAG_PATTERN.test(snippet)) {
    return true;
  }

  return snippet.trim().startsWith("<");
}

function logArchiveConnectivitySuccess(): void {
  if (!archiveSearchConnectivityLogged) {
    console.info("Archive API fully connected. Live search 100% operational.");
    archiveSearchConnectivityLogged = true;
  }
}

function buildPreviewSnippet(body: string): string {
  return body.slice(0, HTML_PREVIEW_LIMIT).replace(/\s+/g, " ").trim();
}

const NETWORK_ERROR_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH"
]);

const NETWORK_ERROR_MESSAGE_PATTERN =
  /(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|NetworkError)/i;

function isNetworkError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  if (error instanceof TypeError && error.message === "fetch failed") {
    return true;
  }

  const candidates: unknown[] = [error];
  if (typeof error === "object" && error !== null && "cause" in error) {
    const cause = (error as { cause?: unknown }).cause;
    if (cause) {
      candidates.push(cause);
    }
  }

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    const withCode = candidate as { code?: unknown; message?: unknown };
    const code = withCode.code;
    if (typeof code === "string" && NETWORK_ERROR_CODES.has(code)) {
      return true;
    }

    const message = withCode.message;
    if (typeof message === "string" && NETWORK_ERROR_MESSAGE_PATTERN.test(message)) {
      return true;
    }
  }

  return false;
}

function shouldUseOfflineFallback(error: unknown): boolean {
  if (!offlineFallbackEnabled) {
    return false;
  }

  if (error instanceof ArchiveSearchResponseError) {
    return Boolean(error.retryable);
  }

  return isNetworkError(error);
}

function describeArchiveFallback(
  error: unknown
): { reason: string; message: string } {
  if (error instanceof ArchiveSearchResponseError) {
    switch (error.kind) {
      case "html-response":
        return {
          reason: "html-response",
          message: `${OFFLINE_FALLBACK_MESSAGE_BASE} The Internet Archive returned HTML instead of JSON.`
        };
      case "malformed-json":
        return {
          reason: "malformed-json",
          message: `${OFFLINE_FALLBACK_MESSAGE_BASE} The Internet Archive returned malformed JSON.`
        };
      case "empty-body":
        return {
          reason: "empty-response",
          message: `${OFFLINE_FALLBACK_MESSAGE_BASE} The Internet Archive returned an empty response.`
        };
      case "http-status":
        return {
          reason: "http-status",
          message: `${OFFLINE_FALLBACK_MESSAGE_BASE} The Internet Archive search endpoint responded with an error.`
        };
      default:
        break;
    }

    if (error.retryable) {
      return {
        reason: "retryable-error",
        message: `${OFFLINE_FALLBACK_MESSAGE_BASE} The Internet Archive search endpoint responded with an unexpected error.`
      };
    }
  }

  if (isNetworkError(error)) {
    return {
      reason: "network-error",
      message: `${OFFLINE_FALLBACK_MESSAGE_BASE} The Internet Archive could not be reached.`
    };
  }

  if (error instanceof Error && error.message.trim()) {
    return {
      reason: "unexpected-error",
      message: `${OFFLINE_FALLBACK_MESSAGE_BASE} ${error.message.trim()}`.trim()
    };
  }

  if (typeof error === "string" && error.trim()) {
    return {
      reason: "unexpected-error",
      message: `${OFFLINE_FALLBACK_MESSAGE_BASE} ${error.trim()}`.trim()
    };
  }

  return {
    reason: "unknown-error",
    message: `${OFFLINE_FALLBACK_MESSAGE_BASE} The Internet Archive search service is currently unavailable.`
  };
}

function applyDefaultHeaders(
  init: RequestInit | undefined,
  additionalHeaders: Record<string, string> = {}
): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set("User-Agent", DEFAULT_USER_AGENT);
  for (const [key, value] of Object.entries(additionalHeaders)) {
    headers.set(key, value);
  }

  return { ...init, headers };
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const decoder = new TextDecoder();
  let body = "";

  return await new Promise<string>((resolve, reject) => {
    req.on("data", (chunk) => {
      if (typeof chunk === "string") {
        body += chunk;
      } else {
        body += decoder.decode(chunk as ArrayBufferView, { stream: true });
      }
    });

    req.on("end", () => {
      body += decoder.decode();
      resolve(body);
    });

    req.on("error", (error) => {
      reject(error);
    });
  });
}

class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const raw = await readRequestBody(req);
  if (!raw.trim()) {
    return {};
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

async function evaluateLinkStatus(targetUrl: string): Promise<LinkStatus> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEAD_TIMEOUT_MS);

  try {
    const headResponse = await fetch(
      targetUrl,
      applyDefaultHeaders(
        {
          method: "HEAD",
          redirect: "follow",
          signal: controller.signal
        }
      )
    );

    if (headResponse.ok || (headResponse.status >= 200 && headResponse.status < 400)) {
      return "online";
    }

    if (headResponse.status === 405 || headResponse.status === 501) {
      const getResponse = await fetch(
        targetUrl,
        applyDefaultHeaders(
          {
            method: "GET",
            redirect: "follow",
            signal: controller.signal
          }
        )
      );

      if (getResponse.ok || (getResponse.status >= 200 && getResponse.status < 400)) {
        return "online";
      }
    }
  } catch (error) {
    if ((error as Error).name !== "AbortError") {
      console.warn("HEAD request failed for", targetUrl, error);
    }
  } finally {
    clearTimeout(timeout);
  }

  try {
    const waybackUrl = new URL(WAYBACK_AVAILABILITY_ENDPOINT);
    waybackUrl.searchParams.set("url", targetUrl);

    const waybackResponse = await fetch(waybackUrl, applyDefaultHeaders(undefined, { Accept: "application/json" }));
    if (waybackResponse.ok) {
      const waybackData = (await waybackResponse.json()) as {
        archived_snapshots?: { closest?: unknown };
      };

      if (waybackData.archived_snapshots?.closest) {
        return "archived-only";
      }
    }
  } catch (error) {
    console.warn("Wayback availability check failed for", targetUrl, error);
  }

  return "offline";
}

function extractYearValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string") {
    const match = value.match(/(\d{4})/);
    if (match) {
      const parsed = Number.parseInt(match[1], 10);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

function resolveDocumentYear(doc: SampleArchiveDoc): number | null {
  const candidates: Array<unknown> = [doc.year, doc.date, doc.publicdate];
  for (const candidate of candidates) {
    const year = extractYearValue(candidate);
    if (year !== null) {
      return year;
    }
  }
  return null;
}

function getSampleMetadata(identifier: string): ArchiveMetadataResponse | null {
  const entry = SAMPLE_METADATA[identifier as keyof typeof SAMPLE_METADATA];
  if (!entry) {
    return null;
  }

  return {
    metadata: { ...entry.metadata },
    files: entry.files.map((file) => ({ ...file })),
    fallback: true
  } satisfies ArchiveMetadataResponse;
}

function getSampleCdxSnapshots(targetUrl: string): CdxResponse | null {
  const snapshots = SAMPLE_CDX_SNAPSHOTS[targetUrl as keyof typeof SAMPLE_CDX_SNAPSHOTS];
  if (!snapshots) {
    return null;
  }

  return {
    snapshots: snapshots.map((snapshot) => ({ ...snapshot })),
    fallback: true
  } satisfies CdxResponse;
}

function getSampleScrapeResults(query: string): ScrapeResponse {
  const normalizedQuery = query.trim();
  const entry = SAMPLE_SCRAPE_RESULTS[normalizedQuery as keyof typeof SAMPLE_SCRAPE_RESULTS];
  if (entry) {
    return {
      items: entry.items.map((item) => ({ ...item })),
      total: entry.total,
      fallback: true,
      query: normalizedQuery
    } satisfies ScrapeResponse;
  }

  return {
    items: DEFAULT_SCRAPE_RESPONSE.items.map((item) => ({ ...item })),
    total: DEFAULT_SCRAPE_RESPONSE.total,
    fallback: true,
    query: normalizedQuery
  } satisfies ScrapeResponse;
}

function gatherSearchableText(doc: SampleArchiveDoc): string {
  const values: string[] = [];

  const append = (input: unknown) => {
    if (typeof input === "string") {
      values.push(input);
    } else if (Array.isArray(input)) {
      for (const entry of input) {
        if (typeof entry === "string") {
          values.push(entry);
        }
      }
    }
  };

  append(doc.title);
  append(doc.description);
  append(doc.identifier);
  append(doc.creator);
  append(doc.collection);

  return values.join(" ");
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

function buildFilterExpressions(filters: ArchiveSearchFiltersInput, includeFilters: boolean): string[] {
  if (!includeFilters) {
    return [];
  }

  const expressions: string[] = [];
  const mediaTypeValue = filters.mediaType?.trim() ?? "";
  const yearFromValue = filters.yearFrom?.trim() ?? "";
  const yearToValue = filters.yearTo?.trim() ?? "";

  if (mediaTypeValue) {
    expressions.push(`mediatype:(${mediaTypeValue})`);
  }

  if (yearFromValue || yearToValue) {
    const start = yearFromValue || "*";
    const end = yearToValue || "*";
    expressions.push(`year:[${start} TO ${end}]`);
  }

  return expressions;
}

function buildArchiveSearchRequestUrl(
  query: string,
  page: number,
  rows: number,
  filters: ArchiveSearchFiltersInput,
  options: { includeFilters: boolean; includeFuzzy: boolean }
): URL {
  const requestUrl = new URL(ARCHIVE_SEARCH_ENDPOINT);
  const baseExpression = buildSearchExpression(query, options.includeFuzzy);
  const filterExpressions = buildFilterExpressions(filters, options.includeFilters);
  const parts = [baseExpression, ...filterExpressions].filter((part) => part && part.length > 0);

  const finalQuery =
    parts.length > 1
      ? parts.map((part) => (part.startsWith("(") && part.endsWith(")") ? part : `(${part})`)).join(" AND ")
      : parts[0] ?? baseExpression;

  requestUrl.searchParams.set("q", finalQuery);
  requestUrl.searchParams.set("output", "json");
  requestUrl.searchParams.set("page", String(page));
  requestUrl.searchParams.set("rows", String(rows));
  requestUrl.searchParams.set(
    "fl",
    [
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
    ].join(",")
  );

  return requestUrl;
}

function buildArchiveSearchAttempts(
  query: string,
  page: number,
  rows: number,
  filters: ArchiveSearchFiltersInput
): ArchiveSearchAttempt[] {
  const trimmedQuery = query.trim();

  const createAttempt = (
    description: string,
    queryValue: string,
    filterValue: ArchiveSearchFiltersInput,
    options: { includeFilters: boolean; includeFuzzy: boolean }
  ): ArchiveSearchAttempt => {
    const url = buildArchiveSearchRequestUrl(queryValue, page, rows, filterValue, options);
    const effectiveQuery = url.searchParams.get("q") ?? queryValue;
    return { description, url, query: effectiveQuery };
  };

  const attempts: ArchiveSearchAttempt[] = [
    createAttempt("primary search with fuzzy expansion", trimmedQuery, filters, {
      includeFilters: true,
      includeFuzzy: true
    }),
    createAttempt("clean search without fuzzy expansion", trimmedQuery, filters, {
      includeFilters: true,
      includeFuzzy: false
    }),
    createAttempt("minimal search without filters", trimmedQuery, {}, {
      includeFilters: false,
      includeFuzzy: false
    })
  ];

  const plainKeywords = buildPlainKeywordQuery(trimmedQuery);
  if (plainKeywords && plainKeywords !== trimmedQuery) {
    attempts.push(
      createAttempt("plain keyword search without special syntax", plainKeywords, {}, {
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

async function fetchArchiveSearchAttempt(attempt: ArchiveSearchAttempt): Promise<ArchiveSearchResponse> {
  const response = await fetch(
    attempt.url,
    applyDefaultHeaders(undefined, { Accept: "application/json" })
  );

  const contentType = response.headers.get("content-type") ?? "";
  const rawBody = await response.text();
  const trimmedBody = rawBody.trim();

  if (!response.ok) {
    const preview = trimmedBody ? buildPreviewSnippet(trimmedBody) : undefined;
    throw new ArchiveSearchResponseError(
      `Archive API responded with status ${response.status}.`,
      {
        retryable: response.status >= 500,
        preview,
        contentType,
        kind: "http-status"
      }
    );
  }

  if (!trimmedBody) {
    throw new ArchiveSearchResponseError("Archive API returned an empty response body.", {
      retryable: true,
      kind: "empty-body"
    });
  }

  if (isHtmlLikeResponse(trimmedBody, contentType)) {
    const preview = buildPreviewSnippet(trimmedBody);
    throw new ArchiveSearchResponseError("Archive API returned HTML instead of JSON.", {
      retryable: true,
      preview,
      contentType,
      kind: "html-response"
    });
  }

  try {
    return JSON.parse(trimmedBody) as ArchiveSearchResponse;
  } catch (error) {
    const preview = buildPreviewSnippet(trimmedBody);
    throw new ArchiveSearchResponseError("Archive API returned malformed JSON.", {
      retryable: true,
      preview,
      contentType,
      kind: "malformed-json"
    });
  }
}

async function executeArchiveSearchAttempts(
  attempts: ArchiveSearchAttempt[]
): Promise<{ payload: ArchiveSearchResponse; attempt: ArchiveSearchAttempt }> {
  let lastError: unknown = null;

  for (let index = 0; index < attempts.length; index++) {
    const attempt = attempts[index];
    const isLastAttempt = index === attempts.length - 1;
    try {
      const payload = await fetchArchiveSearchAttempt(attempt);
      logArchiveConnectivitySuccess();
      return { payload, attempt };
    } catch (error) {
      lastError = error;
      const retryable =
        !isLastAttempt &&
        ((error instanceof ArchiveSearchResponseError && error.retryable) || isNetworkError(error));
      const context =
        error instanceof ArchiveSearchResponseError
          ? { message: error.message, preview: error.preview, contentType: error.contentType }
          : { error };

      if (retryable) {
        console.warn(
          `Archive search attempt failed (${attempt.description}). Retrying with a sanitized query variant.`,
          {
            ...context,
            query: attempt.query
          }
        );
        continue;
      }

      console.warn(`Archive search attempt failed (${attempt.description}).`, {
        ...context,
        query: attempt.query
      });
      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Archive search attempts exhausted.");
}

function performLocalArchiveSearch(
  query: string,
  page: number,
  rows: number,
  filters: { mediaType?: string; yearFrom?: string; yearTo?: string }
): ArchiveSearchResponse {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  const requestedMediaType = filters.mediaType?.toLowerCase() ?? "";
  const requestedYearFrom = filters.yearFrom ? Number.parseInt(filters.yearFrom, 10) : null;
  const requestedYearTo = filters.yearTo ? Number.parseInt(filters.yearTo, 10) : null;

  const matches = SAMPLE_ARCHIVE_DOCS.filter((doc) => {
    if (requestedMediaType && doc.mediatype?.toLowerCase() !== requestedMediaType) {
      return false;
    }

    const year = resolveDocumentYear(doc);
    if (requestedYearFrom !== null && (year === null || year < requestedYearFrom)) {
      return false;
    }
    if (requestedYearTo !== null && (year === null || year > requestedYearTo)) {
      return false;
    }

    if (tokens.length === 0) {
      return true;
    }

    const haystack = gatherSearchableText(doc).toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });

  const safePage = Number.isFinite(page) && page > 0 ? page : 1;
  const safeRows = Number.isFinite(rows) && rows > 0 ? rows : 20;
  const startIndex = (safePage - 1) * safeRows;

  const docs = matches.slice(startIndex, startIndex + safeRows).map((doc) => attachArchiveLinks({ ...doc }));

  return {
    response: {
      docs,
      numFound: matches.length,
      start: startIndex
    },
    fallback: true
  };
}

const routes: Record<string, Record<string, RouteHandler>> = {
  GET: {
    "/health": ({ res }) => {
      sendJson(res, 200, { status: "ok" });
    },
    "/api/search": handleSearch,
    "/api/searchArchive": handleSearch,
    "/api/wayback": handleWayback,
    "/api/status": handleStatus,
    "/api/metadata": handleMetadata,
    "/api/cdx": handleCdx,
    "/api/scrape": handleScrape
  },
  POST: {
    "/api/save": handleSave
  }
};

const server = createServer(async (req, res) => {
  setCorsHeaders(res);

  if (!req.method) {
    sendJson(res, 400, { error: "Missing HTTP method." });
    return;
  }

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (!req.url) {
    sendJson(res, 404, { error: "Not found." });
    return;
  }

  const url = parseRequestUrl(req);
  const methodRoutes = routes[req.method];

  if (!methodRoutes) {
    res.setHeader("Allow", Object.keys(routes).join(","));
    sendJson(res, 405, { error: "Method not allowed." });
    return;
  }

  const handler = methodRoutes[url.pathname];
  if (!handler) {
    sendJson(res, 404, { error: "Not found." });
    return;
  }

  try {
    await handler({ req, res, url });
  } catch (error) {
    console.error("Unhandled error while processing request", error);
    sendJson(res, 500, {
      error: "Internal server error.",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

async function handleSearch({ res, url }: HandlerContext): Promise<void> {
  const query = url.searchParams.get("q")?.trim();
  if (!query) {
    sendJson(res, 400, { error: "Missing required query parameter 'q'." });
    return;
  }

  const pageParam = url.searchParams.get("page") ?? "1";
  const rowsParam = url.searchParams.get("rows") ?? "20";
  const page = Number.parseInt(pageParam, 10);
  const rows = Number.parseInt(rowsParam, 10);
  const safePage = Number.isFinite(page) && page > 0 ? page : 1;
  const safeRows = Number.isFinite(rows) && rows > 0 ? rows : 20;

  const mediaTypeParam = url.searchParams.get("mediaType")?.trim().toLowerCase() ?? "";
  const yearFromParam = url.searchParams.get("yearFrom")?.trim() ?? "";
  const yearToParam = url.searchParams.get("yearTo")?.trim() ?? "";

  if (mediaTypeParam && !ALLOWED_MEDIA_TYPES.has(mediaTypeParam)) {
    sendJson(res, 400, {
      error: "Invalid media type filter.",
      details:
        "Supported media types include texts, audio, movies, image, software, web, data, collection, etree, and tvnews."
    });
    return;
  }

  if (yearFromParam && !YEAR_PATTERN.test(yearFromParam)) {
    sendJson(res, 400, {
      error: "Invalid start year.",
      details: "Year filters must be four-digit values (e.g., 1999)."
    });
    return;
  }

  if (yearToParam && !YEAR_PATTERN.test(yearToParam)) {
    sendJson(res, 400, {
      error: "Invalid end year.",
      details: "Year filters must be four-digit values (e.g., 2008)."
    });
    return;
  }

  if (yearFromParam && yearToParam && Number(yearFromParam) > Number(yearToParam)) {
    sendJson(res, 400, {
      error: "Invalid year range.",
      details: "The start year cannot be greater than the end year."
    });
    return;
  }

  let data: ArchiveSearchResponse | null = null;
  let usedFallback = false;
  let lastSearchError: unknown = null;
  let lastAttempt: ArchiveSearchAttempt | null = null;

  try {
    const attempts = buildArchiveSearchAttempts(query, safePage, safeRows, {
      mediaType: mediaTypeParam,
      yearFrom: yearFromParam,
      yearTo: yearToParam
    });
    const result = await executeArchiveSearchAttempts(attempts);
    data = result.payload;
    lastAttempt = result.attempt;
  } catch (error) {
    console.warn("Error fetching Internet Archive search results", error);
    lastSearchError = error;
  }

  if (!data) {
    if (!shouldUseOfflineFallback(lastSearchError)) {
      if (lastSearchError) {
        sendJson(res, 502, {
          error: "Unable to retrieve Internet Archive search results.",
          details: lastSearchError instanceof Error ? lastSearchError.message : String(lastSearchError)
        });
      } else {
        sendJson(res, 502, {
          error: "No Internet Archive search data returned.",
          details: "The upstream search API responded without a payload."
        });
      }
      return;
    }

    data = performLocalArchiveSearch(query, safePage, safeRows, {
      mediaType: mediaTypeParam,
      yearFrom: yearFromParam,
      yearTo: yearToParam
    });
    usedFallback = true;
    const fallbackInfo = describeArchiveFallback(lastSearchError);
    data.fallback_reason = fallbackInfo.reason;
    data.fallback_message = fallbackInfo.message;
    console.warn(
      `Archive search is operating in offline mode (${fallbackInfo.reason}).`,
      {
        message: fallbackInfo.message,
        originalError:
          lastSearchError instanceof Error ? lastSearchError.message : lastSearchError ?? "unknown"
      }
    );
  }

  if (
    data &&
    !usedFallback &&
    lastAttempt &&
    lastAttempt.description !== "primary search with fuzzy expansion"
  ) {
    data.search_strategy = lastAttempt.description;
    if (lastAttempt.query && lastAttempt.query.trim()) {
      data.search_strategy_query = lastAttempt.query.trim();
    }
  }

  const docsRaw = data.response?.docs;
  const docs = Array.isArray(docsRaw) ? (docsRaw as Array<Record<string, unknown>>) : [];
  const combinedTexts: string[] = [];
  const normalizedDocs = docs.map((doc) => {
    if (doc && typeof doc === "object") {
      const record = doc as Record<string, unknown>;
      const textualFields: string[] = [];
      const possibleFields: Array<unknown> = [
        record.title,
        record.description,
        record.identifier,
        record.creator
      ];

      const withLinks = attachArchiveLinks(record);

      for (const field of possibleFields) {
        if (typeof field === "string") {
          textualFields.push(field);
        } else if (Array.isArray(field)) {
          for (const entry of field) {
            if (typeof entry === "string") {
              textualFields.push(entry);
            }
          }
        }
      }

      const combinedText = textualFields.join(" ");
      if (combinedText) {
        combinedTexts.push(combinedText);
      }
      return { ...withLinks, nsfw: isNSFWContent(combinedText) };
    }

    return doc;
  });

  const summaryResults: ArchiveSearchResultSummary[] = normalizedDocs.map((doc) => {
    const record = doc && typeof doc === "object" ? (doc as Record<string, unknown>) : {};
    const identifier = coerceSingleString(record.identifier) ?? "";
    const title = coerceText(record.title) ?? identifier;
    const description = coerceText(record.description) ?? "";
    const mediatype = coerceSingleString(record.mediatype);
    const creatorText = coerceText(record.creator);
    const yearValue =
      coerceSingleString(record.year) ??
      coerceSingleString(record.date) ??
      coerceSingleString(record.publicdate);
    const linksRecord =
      record.links && typeof record.links === "object"
        ? (record.links as Record<string, unknown>)
        : null;
    const archiveUrl =
      coerceSingleString(record.archive_url) ??
      coerceSingleString(linksRecord ? linksRecord["archive"] : undefined) ??
      (identifier ? `https://archive.org/details/${encodeURIComponent(identifier)}` : null);
    const originalUrl =
      coerceSingleString(record.original_url) ??
      coerceSingleString(record.originalurl) ??
      coerceSingleString(linksRecord ? linksRecord["original"] : undefined);
    const downloadsValue = coerceNumber(record.downloads);

    return {
      identifier,
      title,
      description,
      mediatype: mediatype ?? null,
      year: yearValue ?? null,
      creator: creatorText ?? null,
      archive_url: archiveUrl,
      original_url: originalUrl,
      downloads: downloadsValue,
    };
  });

  if (data.response) {
    data.response = {
      ...data.response,
      docs: normalizedDocs
    };
  } else {
    data.response = {
      docs: normalizedDocs,
      numFound: normalizedDocs.length,
      start: 0
    };
  }

  if (combinedTexts.length > 0) {
    spellCorrector.learnFromText(combinedTexts.join(" "));
  }

  let spellcheck: SpellcheckResult | null = null;

  if (query.length > 0) {
    const result = spellCorrector.checkQuery(query);
    const trimmedCorrected = result.correctedQuery.trim();
    const trimmedOriginal = result.originalQuery.trim();
    if (
      trimmedCorrected.length > 0 &&
      trimmedOriginal.length > 0 &&
      trimmedCorrected.toLowerCase() !== trimmedOriginal.toLowerCase()
    ) {
      spellcheck = result;
    }
  }

  const payload: Record<string, unknown> = {
    ...data,
    spellcheck,
    results: summaryResults,
    pagination: {
      page: safePage,
      rows: safeRows,
      total: data.response?.numFound ?? summaryResults.length
    }
  };

  if (usedFallback) {
    payload.fallback = true;
  } else {
    if ("fallback" in payload) {
      delete (payload as Record<string, unknown>).fallback;
    }
    if ("fallback_reason" in payload) {
      delete (payload as Record<string, unknown>).fallback_reason;
    }
    if ("fallback_message" in payload) {
      delete (payload as Record<string, unknown>).fallback_message;
    }
  }

  sendJson(res, 200, payload);
}

async function handleMetadata({ res, url }: HandlerContext): Promise<void> {
  const identifier = url.searchParams.get("identifier")?.trim();
  if (!identifier) {
    sendJson(res, 400, { error: "Missing required query parameter 'identifier'." });
    return;
  }

  const requestUrl = `${METADATA_ENDPOINT_BASE}${encodeURIComponent(identifier)}`;

  let metadataError: unknown;

  try {
    const response = await fetch(requestUrl, applyDefaultHeaders(undefined, { Accept: "application/json" }));
    if (!response.ok) {
      throw new Error(`Metadata API responded with status ${response.status}`);
    }

    const payload = (await response.json()) as ArchiveMetadataResponse;
    sendJson(res, 200, payload);
    return;
  } catch (error) {
    console.warn("Metadata API request failed", error);
    metadataError = error;
  }

  if (!shouldUseOfflineFallback(metadataError)) {
    sendJson(res, 502, {
      error: "Unable to retrieve metadata for the requested identifier.",
      details:
        metadataError instanceof Error
          ? metadataError.message
          : metadataError
          ? String(metadataError)
          : "The Internet Archive metadata service is unavailable."
    });
    return;
  }

  const fallback = getSampleMetadata(identifier);
  if (!fallback) {
    sendJson(res, 502, {
      error: "Unable to retrieve metadata for the requested identifier.",
      details: "The Internet Archive metadata service is unavailable and no offline record exists."
    });
    return;
  }

  sendJson(res, 200, fallback);
}

async function handleCdx({ res, url }: HandlerContext): Promise<void> {
  const targetUrl = url.searchParams.get("url")?.trim();
  if (!targetUrl) {
    sendJson(res, 400, { error: "Missing required query parameter 'url'." });
    return;
  }

  const limitParam = url.searchParams.get("limit") ?? "25";
  const limitValue = Number.parseInt(limitParam, 10);
  const safeLimit = Number.isFinite(limitValue) && limitValue > 0 ? Math.min(limitValue, 200) : 25;

  const requestUrl = new URL(CDX_SEARCH_ENDPOINT);
  requestUrl.searchParams.set("url", targetUrl);
  requestUrl.searchParams.set("output", "json");
  requestUrl.searchParams.set("limit", String(safeLimit));
  requestUrl.searchParams.set("fl", "timestamp,original,mimetype,statuscode,digest,length");
  requestUrl.searchParams.append("filter", "statuscode:200");
  requestUrl.searchParams.set("collapse", "digest");

  let cdxError: unknown;

  try {
    const response = await fetch(requestUrl, applyDefaultHeaders(undefined, { Accept: "application/json" }));
    if (!response.ok) {
      throw new Error(`CDX API responded with status ${response.status}`);
    }

    const raw = (await response.json()) as Array<unknown>;
    const snapshots: CdxSnapshot[] = [];

    if (Array.isArray(raw)) {
      for (const row of raw) {
        if (!Array.isArray(row)) {
          continue;
        }

        const [timestamp, original, mime, status, digest, length] = row as Array<unknown>;
        if (typeof timestamp !== "string" || typeof original !== "string") {
          continue;
        }

        snapshots.push({
          timestamp,
          original,
          mime: typeof mime === "string" ? mime : "",
          status: typeof status === "string" ? status : typeof status === "number" ? String(status) : "",
          digest: typeof digest === "string" ? digest : undefined,
          length:
            typeof length === "number"
              ? length
              : typeof length === "string"
              ? Number.parseInt(length, 10)
              : undefined
        });
      }
    }

    sendJson(res, 200, { snapshots });
    return;
  } catch (error) {
    console.warn("CDX API request failed", error);
    cdxError = error;
  }

  if (!shouldUseOfflineFallback(cdxError)) {
    sendJson(res, 502, {
      error: "Unable to retrieve CDX snapshots for the requested URL.",
      details:
        cdxError instanceof Error
          ? cdxError.message
          : cdxError
          ? String(cdxError)
          : "The Wayback Machine CDX service is unavailable."
    });
    return;
  }

  const fallback = getSampleCdxSnapshots(targetUrl);
  if (!fallback) {
    sendJson(res, 502, {
      error: "Unable to retrieve CDX snapshots for the requested URL.",
      details: "The Wayback Machine CDX service is unavailable and no offline timeline exists."
    });
    return;
  }

  sendJson(res, 200, fallback);
}

async function handleScrape({ res, url }: HandlerContext): Promise<void> {
  const query = url.searchParams.get("query")?.trim();
  if (!query) {
    sendJson(res, 400, { error: "Missing required query parameter 'query'." });
    return;
  }

  const countParam = url.searchParams.get("count") ?? "5";
  const countValue = Number.parseInt(countParam, 10);
  const safeCount = Number.isFinite(countValue) && countValue > 0 ? Math.min(countValue, 50) : 5;
  const fields = url.searchParams.getAll("field");
  const sorts = url.searchParams.getAll("sort");

  const requestUrl = new URL(SCRAPE_SEARCH_ENDPOINT);
  requestUrl.searchParams.set("query", query);
  requestUrl.searchParams.set("count", String(safeCount));

  const requestedFields = fields.length > 0 ? fields : ["identifier", "title", "mediatype", "description", "downloads", "publicdate"];
  for (const field of requestedFields) {
    requestUrl.searchParams.append("fields[]", field);
  }

  for (const sort of sorts) {
    requestUrl.searchParams.append("sorts[]", sort);
  }

  let scrapeError: unknown;

  try {
    const response = await fetch(requestUrl, applyDefaultHeaders(undefined, { Accept: "application/json" }));
    if (!response.ok) {
      throw new Error(`Scrape API responded with status ${response.status}`);
    }

    const payload = (await response.json()) as { items?: ScrapeItem[]; count?: number; total?: number };
    const itemsRaw = Array.isArray(payload.items) ? payload.items : [];
    const items = itemsRaw.map((item) => attachArchiveLinks({ ...item })) as ScrapeItem[];
    const total = typeof payload.total === "number" ? payload.total : typeof payload.count === "number" ? payload.count : items.length;

    sendJson(res, 200, { items, total, query });
    return;
  } catch (error) {
    console.warn("Scrape API request failed", error);
    scrapeError = error;
  }

  if (!shouldUseOfflineFallback(scrapeError)) {
    sendJson(res, 502, {
      error: "Unable to retrieve highlight results from the Internet Archive.",
      details:
        scrapeError instanceof Error
          ? scrapeError.message
          : scrapeError
          ? String(scrapeError)
          : "The Internet Archive scrape service is unavailable."
    });
    return;
  }

  const fallback = getSampleScrapeResults(query);
  const items = fallback.items.map((item) => attachArchiveLinks({ ...item })) as ScrapeItem[];
  sendJson(res, 200, { ...fallback, items });
}

async function handleWayback({ res, url }: HandlerContext): Promise<void> {
  const targetUrl = url.searchParams.get("url")?.trim();
  if (!targetUrl) {
    sendJson(res, 400, { error: "Missing required query parameter 'url'." });
    return;
  }

  const requestUrl = new URL(WAYBACK_AVAILABILITY_ENDPOINT);
  requestUrl.searchParams.set("url", targetUrl);

  try {
    const response = await fetch(requestUrl, applyDefaultHeaders(undefined, { Accept: "application/json" }));
    if (!response.ok) {
      throw new Error(`Wayback API responded with status ${response.status}`);
    }

    const data = await response.json();
    sendJson(res, 200, data);
  } catch (error) {
    console.error("Error fetching Wayback Machine availability", error);
    sendJson(res, 502, {
      error: "Failed to retrieve Wayback Machine availability.",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

async function handleStatus({ res, url }: HandlerContext): Promise<void> {
  const targetUrl = url.searchParams.get("url")?.trim();
  if (!targetUrl) {
    sendJson(res, 400, { error: "Missing required query parameter 'url'." });
    return;
  }

  try {
    const status = await evaluateLinkStatus(targetUrl);
    sendJson(res, 200, { status });
  } catch (error) {
    console.error("Error evaluating link status", error);
    sendJson(res, 500, {
      error: "Unable to evaluate link status.",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

async function handleSave({ req, res }: HandlerContext): Promise<void> {
  let payload: unknown;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }

    console.error("Error reading request body", error);
    sendJson(res, 400, { error: "Unable to read request body." });
    return;
  }

  const urlValue =
    typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>).url : undefined;
  const targetUrl = typeof urlValue === "string" ? urlValue.trim() : "";

  if (!targetUrl) {
    sendJson(res, 400, { error: "Missing required field 'url' in request body." });
    return;
  }

  if (!/^https?:\/\//i.test(targetUrl)) {
    sendJson(res, 400, { error: "The provided URL must start with http:// or https://" });
    return;
  }

  const saveUrl = `${SAVE_PAGE_NOW_ENDPOINT}${encodeURI(targetUrl)}`;

  try {
    const response = await fetch(
      saveUrl,
      applyDefaultHeaders({
        method: "GET",
        redirect: "manual"
      })
    );

    const contentLocation = response.headers.get("content-location");
    const locationHeader = response.headers.get("location");
    const snapshotPath = contentLocation ?? locationHeader ?? undefined;
    const snapshotUrl = snapshotPath
      ? snapshotPath.startsWith("http")
        ? snapshotPath
        : `https://web.archive.org${snapshotPath}`
      : undefined;

    const success = response.status >= 200 && response.status < 400;

    if (!success) {
      const message = `Save Page Now responded with status ${response.status}`;
      sendJson(res, 502, {
        success: false,
        error: message,
        snapshotUrl
      });
      return;
    }

    sendJson(res, 200, {
      success: true,
      snapshotUrl,
      message: snapshotUrl
        ? "Snapshot request accepted by Save Page Now."
        : "Snapshot request sent to Save Page Now. Check back shortly for availability."
    });
  } catch (error) {
    console.error("Error requesting Save Page Now snapshot", error);
    sendJson(res, 502, {
      success: false,
      error: "Failed to contact the Save Page Now service.",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

const port = Number.parseInt(getEnv("PORT") ?? "4000", 10);

if (nodeEnv !== "test") {
  server.listen(port, () => {
    console.log(`Alexandria Browser backend listening on port ${port}`);
  });
}

export default server;
