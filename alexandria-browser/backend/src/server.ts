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
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";

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

type ArchiveSearchResponse = Record<string, unknown> & {
  response?: {
    docs?: Array<Record<string, unknown>>;
    numFound?: number;
    start?: number;
  };
  fallback?: boolean;
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
    originalFromRecord ?? record["original"] ?? record["url"]
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
    if (wayback && (typeof next["wayback_url"] !== "string" || (next["wayback_url"] as string).length === 0)) {
      next["wayback_url"] = wayback;
    }
  }

  if (!hasExistingThumbnail && thumbnail) {
    next["thumbnail"] = thumbnail;
  }

  return next;
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

function configureArchiveProxyAgent(): void {
  const proxyUrl = resolveProxyUrl();
  if (!proxyUrl) {
    return;
  }

  try {
    const agent = new EnvHttpProxyAgent({
      httpProxy: proxyUrl,
      httpsProxy: proxyUrl,
      noProxy: resolveNoProxyList() ?? undefined
    });
    setGlobalDispatcher(agent);
    console.info("Archive HTTP client configured to route through the detected proxy endpoint.");
  } catch (error) {
    console.warn("Failed to configure proxy agent for archive requests.", error);
  }
}

function resolveProxyUrl(): string | null {
  const candidates = [
    "ARCHIVE_HTTP_PROXY",
    "ARCHIVE_HTTPS_PROXY",
    "ARCHIVE_PROXY",
    "https_proxy",
    "HTTPS_PROXY",
    "http_proxy",
    "HTTP_PROXY"
  ];

  for (const candidate of candidates) {
    const value = getEnv(candidate);
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

function resolveNoProxyList(): string | null {
  const candidates = ["NO_PROXY", "no_proxy"];

  for (const candidate of candidates) {
    const value = getEnv(candidate);
    if (value && value.trim().length > 0) {
      return value.trim();
    }
  }

  return null;
}

const nodeEnv = getEnv("NODE_ENV") ?? "development";
const offlineFallbackEnv = getEnv("ENABLE_OFFLINE_FALLBACK");
const offlineFallbackEnabled = offlineFallbackEnv === "true";

configureArchiveProxyAgent();

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
  if (offlineFallbackEnabled) {
    return true;
  }
  return isNetworkError(error);
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

  const requestUrl = new URL(ARCHIVE_SEARCH_ENDPOINT);
  const tokens = query.split(/\s+/).filter(Boolean);
  const fuzzyClause = tokens.map((token) => `${token}~`).join(" ");
  const searchExpression = fuzzyClause ? `(${query}) OR (${fuzzyClause})` : query;

  const filterExpressions: string[] = [];
  if (mediaTypeParam) {
    filterExpressions.push(`mediatype:(${mediaTypeParam})`);
  }

  if (yearFromParam || yearToParam) {
    const yearFromValue = yearFromParam || "*";
    const yearToValue = yearToParam || "*";
    filterExpressions.push(`year:[${yearFromValue} TO ${yearToValue}]`);
  }

  const combinedQuery = [searchExpression, ...filterExpressions]
    .filter((part) => part && part.length > 0)
    .map((part) => `(${part})`)
    .join(" AND ");

  requestUrl.searchParams.set("q", combinedQuery.length > 0 ? combinedQuery : searchExpression);
  requestUrl.searchParams.set("output", "json");
  requestUrl.searchParams.set("page", String(safePage));
  requestUrl.searchParams.set("rows", String(safeRows));
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
      "publicdate"
    ].join(",")
  );

  let data: ArchiveSearchResponse | null = null;
  let usedFallback = false;
  let lastSearchError: unknown;

  try {
    const response = await fetch(requestUrl, applyDefaultHeaders(undefined, { Accept: "application/json" }));
    if (!response.ok) {
      throw new Error(`Archive API responded with status ${response.status}`);
    }

    data = (await response.json()) as ArchiveSearchResponse;
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

    data = {
      response: {
        docs: [],
        numFound: 0,
        start: (safePage - 1) * safeRows
      },
      fallback: true
    } satisfies ArchiveSearchResponse;
    usedFallback = true;
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
    spellcheck
  };

  if (usedFallback) {
    payload.fallback = true;
  } else if ("fallback" in payload) {
    delete (payload as Record<string, unknown>).fallback;
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
