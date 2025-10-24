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

import path from "node:path";

import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { ProxyAgent, setGlobalDispatcher } from "undici";

import { SAMPLE_ARCHIVE_DOCS, type SampleArchiveDoc } from "./data/sampleArchiveDocs";
import { SAMPLE_METADATA } from "./data/sampleMetadata";
import { SAMPLE_CDX_SNAPSHOTS } from "./data/sampleCdxSnapshots";
import { DEFAULT_SCRAPE_RESPONSE, SAMPLE_SCRAPE_RESULTS } from "./data/sampleScrapeResults";
import { annotateRecord, containsNSFW } from "./services/nsfwFilter";
import { buildHybridSearchExpression, suggestAlternativeQueries } from "./services/queryExpansion";
import { scoreArchiveRecord, type SearchScoreBreakdown } from "./services/resultScoring";
import {
  matchesAdvancedFilters,
  normalizeAvailability,
  normalizeSourceTrust,
  type ArchiveSearchFiltersInput,
  type LinkStatus,
  type NSFWFilterMode,
  type SourceTrustLevel
} from "./services/filtering";
import { getSpellCorrector, type SpellcheckResult } from "./services/spellCorrector";
import { isValidReportReason, sendReportEmail, type ReportSubmission } from "./services/reporting";
import {
  configureLocalAI,
  embedSearchText,
  generateAIResponse,
  generateContextualResponse,
  getLastAIOutcome,
  isLocalAIEnabled,
  initializeLocalAI,
  listAvailableLocalAIModels,
  refineSearchQuery,
  type LocalAIContextRequest,
  type LocalAIConversationTurn,
  type LocalAIModelInventory,
  type LocalAIOutcome,
} from "./ai/LocalAI";
import { buildHeuristicAISummary, type HeuristicDocSummary } from "./ai/heuristicSummaries";
import { loadRuntimeConfig } from "./config/runtimeConfig";
import {
  filterByNSFWMode,
  getNSFWMode as resolveUserNSFWMode,
  mapUserModeToFilterMode,
  type NSFWUserMode,
} from "./utils/nsfwMode";

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
  score?: number | null;
  score_breakdown?: SearchScoreBreakdown;
  availability?: LinkStatus | null;
  source_trust?: SourceTrustLevel | null;
  language?: string | null;
};

type SearchPagination = {
  page: number;
  rows: number;
  total: number | null;
};

const RERANK_EMBED_DOC_LIMIT = 40;

function vectorMagnitude(values: number[]): number {
  let sum = 0;
  for (const value of values) {
    sum += value * value;
  }
  return Math.sqrt(sum);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) {
    return 0;
  }
  const length = Math.min(a.length, b.length);
  let dot = 0;
  for (let index = 0; index < length; index += 1) {
    dot += a[index] * b[index];
  }
  const denom = vectorMagnitude(a) * vectorMagnitude(b);
  if (denom === 0) {
    return 0;
  }
  return dot / denom;
}

function computeKeywordBoost(tokens: string[], text: string): number {
  if (tokens.length === 0 || !text) {
    return 0;
  }
  const haystack = text.toLowerCase();
  let matches = 0;
  for (const token of tokens) {
    if (token.length < 3) {
      continue;
    }
    if (haystack.includes(token)) {
      matches += 1;
    }
  }
  if (matches === 0) {
    return 0;
  }
  return Math.min(0.25, matches / tokens.length);
}

function computeModeAdjustment(mode: NSFWUserMode, record: Record<string, unknown>): number {
  const flagged = record.nsfw === true;
  const severityRaw = record.nsfwLevel ?? record.nsfw_level;
  const severity = typeof severityRaw === "string" ? severityRaw.toLowerCase() : null;

  switch (mode) {
    case "safe":
      return flagged ? -0.8 : 0.15;
    case "moderate":
      return severity === "explicit" || severity === "violent" ? -0.45 : 0;
    case "nsfw-only":
      return flagged ? 0.4 : -0.6;
    default:
      return 0;
  }
}

async function rerankDocuments(
  docs: Array<Record<string, unknown>>,
  query: string,
  mode: NSFWUserMode
): Promise<Array<Record<string, unknown>>> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery || docs.length === 0) {
    return docs;
  }

  const tokens = trimmedQuery
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  let queryVector: number[] = [];
  try {
    queryVector = await embedSearchText(trimmedQuery);
  } catch (error) {
    console.warn("Unable to compute query embedding", error);
    return docs;
  }

  if (queryVector.length === 0) {
    return docs;
  }

  const limitedDocs = docs.slice(0, RERANK_EMBED_DOC_LIMIT);
  const scored = await Promise.all(
    limitedDocs.map(async (doc) => {
      const strings: string[] = [];
      const title = typeof doc.title === "string" ? doc.title : typeof doc["title"] === "string" ? (doc["title"] as string) : "";
      if (title) {
        strings.push(title);
      }
      const description = typeof doc.description === "string" ? doc.description : "";
      if (description) {
        strings.push(description);
      }
      const combined = strings.join(" ").trim();

      let similarity = 0;
      if (combined) {
        try {
          const docVector = await embedSearchText(combined);
          similarity = cosineSimilarity(queryVector, docVector);
        } catch (error) {
          console.warn("Unable to compute document embedding", error);
        }
      }

      const metadataScore =
        typeof doc.score === "number" && Number.isFinite(doc.score)
          ? (doc.score as number)
          : 0;
      const keywordBoost = computeKeywordBoost(tokens, combined || `${title}`);
      const modeAdjustment = computeModeAdjustment(mode, doc);
      const total = metadataScore * 0.55 + similarity * 0.35 + keywordBoost + modeAdjustment;

      return {
        doc,
        total,
        similarity,
        keywordBoost,
      };
    })
  );

  const remaining = docs.slice(RERANK_EMBED_DOC_LIMIT).map((doc) => ({ doc, total: 0, similarity: 0, keywordBoost: 0 }));
  const combinedScores = scored.concat(remaining);
  combinedScores.sort((a, b) => b.total - a.total);

  return combinedScores.map((entry) => {
    const next = { ...entry.doc } as Record<string, unknown>;
    next.semantic_score = entry.similarity;
    next.ai_rank_score = entry.total;
    next.keyword_boost = entry.keywordBoost;
    return next;
  });
}

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
  alternate_queries?: string[];
  original_numFound?: number | null;
  filtered_count?: number | null;
  ai_summary?: string | null;
  ai_summary_status?: AISummaryStatus;
  ai_summary_error?: string | null;
  ai_summary_source?: "model" | "heuristic";
  ai_summary_notice?: string | null;
};

type AISummaryStatus = "success" | "unavailable" | "error";

type AIQueryStatus = "success" | "unavailable" | "error" | "disabled";

type AIQueryResponsePayload = {
  status: AIQueryStatus;
  reply: string | null;
  error?: string | null;
  mode: LocalAIContextRequest["mode"];
  outcome?: LocalAIOutcome;
};

type AIStatusResponsePayload = {
  enabled: boolean;
  outcome: LocalAIOutcome;
  models: string[];
  modelPaths: string[];
  modelDirectory: string;
  directoryAccessible: boolean;
  directoryError?: string;
};

type LocalAIContextShape = NonNullable<LocalAIContextRequest["context"]>;

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

type WithArchiveLinkFields<T extends Record<string, unknown>> = T & {
  links?: ArchiveLinks;
  archive_url?: string;
  original_url?: string;
  originalurl?: string;
  wayback_url?: string;
  thumbnail?: string;
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

const runtimeConfig = loadRuntimeConfig();
const runtimeAiConfig = runtimeConfig.ai;

configureLocalAI({
  enabled: runtimeAiConfig.enabled,
  modelDirectory: runtimeAiConfig.modelDirectory,
  modelName: runtimeAiConfig.modelName,
  modelPath: runtimeAiConfig.modelPath,
});

if (runtimeAiConfig.enabled && runtimeAiConfig.autoInitialize) {
  void initializeLocalAI().then((outcome) => {
    if (outcome.status === "success" || outcome.status === "idle") {
      console.info(
        "Local AI initialized",
        outcome.modelPath ? `using model ${outcome.modelPath}` : "without an explicit model path"
      );
    } else if (outcome.status === "missing-model") {
      console.warn("Local AI auto-initialization skipped: no compatible model found.");
    } else if (outcome.status === "disabled") {
      console.info("Local AI auto-initialization skipped because the service is disabled.");
    } else {
      console.warn("Local AI auto-initialization encountered an issue.", outcome.message);
    }
  });
} else if (!runtimeAiConfig.enabled) {
  console.info("Local AI assistance disabled via server configuration.");
}

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

function attachArchiveLinks<T extends Record<string, unknown> & { identifier?: unknown }>(
  record: T
): WithArchiveLinkFields<T> {
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
    return record as WithArchiveLinkFields<T>;
  }

  const next: WithArchiveLinkFields<T> = { ...record } as WithArchiveLinkFields<T>;

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

function coerceLanguageValue(value: unknown): string | null {
  const values = collectStringValues(value);
  return values.length > 0 ? values[0] : null;
}

function coerceAvailabilityValue(value: unknown): LinkStatus | null {
  const text = coerceSingleString(value);
  const normalized = normalizeAvailability(text ?? undefined);
  if (!normalized || normalized === "any") {
    return null;
  }
  return normalized;
}

function coerceSourceTrustValue(value: unknown): SourceTrustLevel | null {
  const text = coerceSingleString(value);
  const normalized = normalizeSourceTrust(text ?? undefined);
  if (!normalized || normalized === "any") {
    return null;
  }
  return normalized;
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

function normalizeAIHistory(historyValue: unknown): LocalAIConversationTurn[] {
  if (!Array.isArray(historyValue)) {
    return [];
  }

  const normalized: LocalAIConversationTurn[] = [];
  for (const entry of historyValue) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const contentValue = record.content;
    if (typeof contentValue !== "string") {
      continue;
    }
    const trimmedContent = contentValue.trim();
    if (!trimmedContent) {
      continue;
    }
    const roleValue = typeof record.role === "string" ? record.role.trim().toLowerCase() : "user";
    const role: LocalAIConversationTurn["role"] = roleValue === "assistant" ? "assistant" : "user";
    normalized.push({ role, content: trimmedContent });
    if (normalized.length >= 6) {
      // Maintain a short rolling window to avoid overwhelming the model.
      normalized.splice(0, normalized.length - 6);
    }
  }

  return normalized;
}

function normalizeAIContext(contextValue: unknown): LocalAIContextRequest["context"] | undefined {
  if (!contextValue || typeof contextValue !== "object") {
    return undefined;
  }

  const record = contextValue as Record<string, unknown>;
  const context: LocalAIContextShape = {};

  if (typeof record.activeQuery === "string" && record.activeQuery.trim()) {
    context.activeQuery = record.activeQuery.trim();
  }
  if (typeof record.currentUrl === "string" && record.currentUrl.trim()) {
    context.currentUrl = record.currentUrl.trim();
  }
  const titleValue = typeof record.documentTitle === "string" ? record.documentTitle : record.title;
  if (typeof titleValue === "string" && titleValue.trim()) {
    context.documentTitle = titleValue.trim();
  }
  const summaryValue =
    typeof record.documentSummary === "string"
      ? record.documentSummary
      : typeof record.summary === "string"
      ? record.summary
      : typeof record.description === "string"
      ? record.description
      : undefined;
  if (typeof summaryValue === "string" && summaryValue.trim()) {
    context.documentSummary = summaryValue.trim();
  }
  const notesValue = typeof record.extraNotes === "string" ? record.extraNotes : record.notes;
  if (typeof notesValue === "string" && notesValue.trim()) {
    context.extraNotes = notesValue.trim();
  }

  const navigationValue = record.navigationTrail ?? record.trail ?? record.breadcrumbs;
  if (Array.isArray(navigationValue)) {
    const navigationTrail = navigationValue
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => Boolean(item));
    if (navigationTrail.length > 0) {
      context.navigationTrail = navigationTrail.slice(-5);
    }
  }

  return Object.keys(context).length > 0 ? context : undefined;
}

function normalizeAIMode(modeValue: unknown): LocalAIContextRequest["mode"] {
  if (typeof modeValue === "string") {
    const normalized = modeValue.trim().toLowerCase();
    if (normalized === "navigation" || normalized === "document" || normalized === "search" || normalized === "chat") {
      return normalized;
    }
  }

  return "chat";
}

function getEnv(name: string): string | undefined {
  const globalProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return globalProcess?.env?.[name];
}

const nodeEnv = getEnv("NODE_ENV") ?? "development";
const offlineFallbackEnv = getEnv("ENABLE_OFFLINE_FALLBACK");
const offlineFallbackEnabled =
  offlineFallbackEnv === "true" || (offlineFallbackEnv === undefined && nodeEnv !== "production");
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
  if (!sanitized) {
    return sanitized;
  }

  if (!includeFuzzy) {
    return sanitized;
  }

  return buildHybridSearchExpression(sanitized, includeFuzzy);
}

function buildFilterExpressions(filters: ArchiveSearchFiltersInput, includeFilters: boolean): string[] {
  if (!includeFilters) {
    return [];
  }

  const expressions: string[] = [];
  const mediaTypeValue = filters.mediaType?.trim() ?? "";
  const yearFromValue = filters.yearFrom?.trim() ?? "";
  const yearToValue = filters.yearTo?.trim() ?? "";
  const languageValue = filters.language?.trim() ?? "";
  const collectionValue = filters.collection?.trim() ?? "";
  const uploaderValue = filters.uploader?.trim() ?? "";
  const subjectValue = filters.subject?.trim() ?? "";

  if (mediaTypeValue) {
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

  const safeRows = Number.isFinite(rows) && rows > 0 ? rows : 20;
  const safePage = Number.isFinite(page) && page > 0 ? page : 1;
  const safeOffset = Math.max(0, (safePage - 1) * safeRows);

  const finalQuery =
    parts.length > 1
      ? parts.map((part) => (part.startsWith("(") && part.endsWith(")") ? part : `(${part})`)).join(" AND ")
      : parts[0] ?? baseExpression;

  requestUrl.searchParams.set("q", finalQuery);
  requestUrl.searchParams.set("output", "json");
  requestUrl.searchParams.set("page", String(safePage));
  requestUrl.searchParams.set("rows", String(safeRows));
  requestUrl.searchParams.set("start", String(safeOffset));
  requestUrl.searchParams.set("offset", String(safeOffset));
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
  const safeRows = Number.isFinite(rows) && rows > 0 ? rows : 20;
  const safePage = Number.isFinite(page) && page > 0 ? page : 1;

  const createAttempt = (
    description: string,
    queryValue: string,
    filterValue: ArchiveSearchFiltersInput,
    options: { includeFilters: boolean; includeFuzzy: boolean }
  ): ArchiveSearchAttempt => {
    const url = buildArchiveSearchRequestUrl(queryValue, safePage, safeRows, filterValue, options);
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
  filters: ArchiveSearchFiltersInput,
  offset?: number
): ArchiveSearchResponse {
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  const requestedMediaType = filters.mediaType?.toLowerCase() ?? "";
  const requestedYearFrom = filters.yearFrom ? Number.parseInt(filters.yearFrom, 10) : null;
  const requestedYearTo = filters.yearTo ? Number.parseInt(filters.yearTo, 10) : null;
  const requestedCollections = (filters.collection ?? "")
    .toLowerCase()
    .split(/[,\n]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  const requestedSubjects = (filters.subject ?? "")
    .toLowerCase()
    .split(/[,\n]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  const requestedUploader = (filters.uploader ?? "").toLowerCase().trim();

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

    if (requestedCollections.length > 0) {
      const collectionValues = Array.isArray(doc.collection)
        ? doc.collection
        : doc.collection
        ? [doc.collection]
        : [];
      const normalizedCollections = collectionValues
        .map((value) => (typeof value === "string" ? value.toLowerCase().trim() : ""))
        .filter((value) => value.length > 0);
      if (!requestedCollections.some((value) => normalizedCollections.includes(value))) {
        return false;
      }
    }

    if (requestedSubjects.length > 0) {
      const subjectCandidate = doc.subject;
      const subjectValues = Array.isArray(subjectCandidate)
        ? subjectCandidate
        : typeof subjectCandidate === "string"
        ? subjectCandidate.split(/[,;]+/)
        : [];
      const normalizedSubjects = subjectValues
        .map((value) => (typeof value === "string" ? value.toLowerCase().trim() : ""))
        .filter((value) => value.length > 0);
      if (!requestedSubjects.some((value) => normalizedSubjects.includes(value))) {
        return false;
      }
    }

    if (requestedUploader) {
      const uploaderCandidate = doc.uploader ?? doc.creator;
      const uploaderValues = Array.isArray(uploaderCandidate)
        ? uploaderCandidate
        : uploaderCandidate
        ? [uploaderCandidate]
        : [];
      const normalizedUploaders = uploaderValues
        .map((value) => (typeof value === "string" ? value.toLowerCase().trim() : ""))
        .filter((value) => value.length > 0);
      if (!normalizedUploaders.some((value) => value.includes(requestedUploader))) {
        return false;
      }
    }

    if (tokens.length === 0) {
      return true;
    }

    const haystack = gatherSearchableText(doc).toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });

  const safePage = Number.isFinite(page) && page > 0 ? page : 1;
  const safeRows = Number.isFinite(rows) && rows > 0 ? rows : 20;
  const safeOffset =
    typeof offset === "number" && Number.isFinite(offset) && offset >= 0
      ? Math.trunc(offset)
      : (safePage - 1) * safeRows;
  const startIndex = safeOffset;

  const docs = matches
    .slice(startIndex, startIndex + safeRows)
    .map((doc) => annotateRecord(attachArchiveLinks({ ...doc })));

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
    "/api/ai/status": handleAIStatus,
    "/api/metadata": handleMetadata,
    "/api/cdx": handleCdx,
    "/api/scrape": handleScrape
  },
  POST: {
    "/api/ai/query": handleAIQuery,
    "/api/report": handleReport,
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
  const offsetParam = url.searchParams.get("offset") ?? "";
  const page = Number.parseInt(pageParam, 10);
  const rows = Number.parseInt(rowsParam, 10);
  const offsetValue = Number.parseInt(offsetParam, 10);
  const safeRows = Number.isFinite(rows) && rows > 0 ? rows : 20;
  const hasValidOffset = Number.isFinite(offsetValue) && offsetValue >= 0;
  const safePage = hasValidOffset
    ? Math.max(1, Math.floor(offsetValue / safeRows) + 1)
    : Number.isFinite(page) && page > 0
    ? page
    : 1;
  const safeOffset = hasValidOffset ? offsetValue : (safePage - 1) * safeRows;

  const mediaTypeParam = url.searchParams.get("mediaType")?.trim().toLowerCase() ?? "";
  const yearFromParam = url.searchParams.get("yearFrom")?.trim() ?? "";
  const yearToParam = url.searchParams.get("yearTo")?.trim() ?? "";
  const languageParam = url.searchParams.get("language")?.trim() ?? "";
  const sourceTrustParam = url.searchParams.get("sourceTrust")?.trim().toLowerCase() ?? "";
  const availabilityParam = url.searchParams.get("availability")?.trim().toLowerCase() ?? "";
  const collectionParam = url.searchParams.get("collection")?.trim() ?? "";
  const uploaderParam = url.searchParams.get("uploader")?.trim() ?? "";
  const subjectParam = url.searchParams.get("subject")?.trim() ?? "";
  const nsfwModeInput = url.searchParams.get("nsfwMode");
  const nsfwUserMode: NSFWUserMode = resolveUserNSFWMode(nsfwModeInput ?? undefined);
  const nsfwModeParam = mapUserModeToFilterMode(nsfwUserMode);
  const aiModeParam = url.searchParams.get("ai")?.trim().toLowerCase() ?? "";
  const aiModeEnabled = ["1", "true", "yes", "on", "enabled"].includes(aiModeParam);

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

  let effectiveQuery = query;
  let aiRefinedQuery: string | null = null;

  if (aiModeEnabled) {
    try {
      const refined = await refineSearchQuery(query, nsfwUserMode);
      if (refined && refined.trim() && refined.trim().toLowerCase() !== query.toLowerCase()) {
        effectiveQuery = refined.trim();
        aiRefinedQuery = effectiveQuery;
      }
    } catch (error) {
      console.warn("AI refinement failed, falling back to user query", error);
      effectiveQuery = query;
    }
  }

  let data: ArchiveSearchResponse | null = null;
  let usedFallback = false;
  let lastSearchError: unknown = null;
  let lastAttempt: ArchiveSearchAttempt | null = null;
  let aiSummary: string | null = null;
  let aiSummaryStatus: AISummaryStatus | null = null;
  let aiSummaryError: string | null = null;
  let aiSummaryNotice: string | null = null;
  let aiSummarySource: "model" | "heuristic" | null = null;

  const filterConfig: ArchiveSearchFiltersInput = {
    mediaType: mediaTypeParam,
    yearFrom: yearFromParam,
    yearTo: yearToParam,
    language: languageParam,
    sourceTrust: sourceTrustParam,
    availability: availabilityParam,
    nsfwMode: nsfwModeParam,
    collection: collectionParam,
    uploader: uploaderParam,
    subject: subjectParam
  };

  try {
    const attempts = buildArchiveSearchAttempts(effectiveQuery, safePage, safeRows, filterConfig);
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

    data = performLocalArchiveSearch(effectiveQuery, safePage, safeRows, filterConfig, safeOffset);
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

  if (data?.response) {
    const responsePayload = data.response;
    const startValue =
      typeof responsePayload.start === "number" && Number.isFinite(responsePayload.start)
        ? responsePayload.start
        : safeOffset;
    responsePayload.start = startValue;
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

  const originalNumFound = data.response?.numFound ?? null;

  const docsRaw = data.response?.docs;
  const docs = Array.isArray(docsRaw) ? (docsRaw as Array<Record<string, unknown>>) : [];
  const combinedTexts: string[] = [];
  let normalizedDocs = docs.map((doc) => {
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
      const flagged = containsNSFW(withLinks);

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
      const annotated = annotateRecord(withLinks);
      if (flagged) {
        annotated.nsfw = true;
      }
      return annotated;
    }

    return doc;
  }) as Array<Record<string, unknown>>;

  const scoredDocs = normalizedDocs.map((doc) => {
    if (doc && typeof doc === "object") {
      const analysis = scoreArchiveRecord(doc, effectiveQuery);
      const enriched: Record<string, unknown> = {
        ...doc,
        score: analysis.breakdown.combinedScore,
        score_breakdown: analysis.breakdown,
        availability: analysis.availability,
        source_trust: analysis.trustLevel,
      };

      if (!enriched.source_trust_level) {
        enriched.source_trust_level = analysis.trustLevel;
      }

      if (analysis.language && !enriched.language) {
        enriched.language = analysis.language;
      }

      return enriched;
    }

    return doc;
  }) as Array<Record<string, unknown>>;

  const filteredDocs = scoredDocs.filter((doc) => {
    if (!doc || typeof doc !== "object") {
      return true;
    }
    return matchesAdvancedFilters(doc as Record<string, unknown>, filterConfig);
  }) as Array<Record<string, unknown>>;

  const nsfwAdjustedDocs = filterByNSFWMode(filteredDocs, nsfwUserMode);

  const rerankedDocs = await rerankDocuments(nsfwAdjustedDocs, effectiveQuery, nsfwUserMode);

  normalizedDocs = rerankedDocs;

  const scoreValues = rerankedDocs
    .map((doc) => {
      const raw = doc.score;
      if (typeof raw === "number" && Number.isFinite(raw)) {
        return raw;
      }
      if (typeof raw === "string") {
        const parsed = Number.parseFloat(raw.trim());
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    })
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const highestScore = scoreValues.length > 0 ? Math.max(...scoreValues) : 0;
  const alternateSuggestions =
    filteredDocs.length === 0 || highestScore < 0.35
      ? suggestAlternativeQueries(effectiveQuery)
      : [];

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
    let scoreValue: number | null = null;
    if (typeof record.score === "number" && Number.isFinite(record.score)) {
      scoreValue = record.score;
    } else if (typeof record.score === "string") {
      const parsedScore = Number.parseFloat(record.score.trim());
      if (Number.isFinite(parsedScore)) {
        scoreValue = parsedScore;
      }
    }
    const scoreBreakdown =
      record.score_breakdown && typeof record.score_breakdown === "object"
        ? (record.score_breakdown as SearchScoreBreakdown)
        : undefined;
    const availabilityValue = coerceAvailabilityValue(record.availability);
    const sourceTrustValue = coerceSourceTrustValue(record.source_trust ?? record.source_trust_level);
    const languageValue = coerceLanguageValue(record.language ?? record.languages ?? record.lang);

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
      score: scoreValue,
      score_breakdown: scoreBreakdown,
      availability: availabilityValue,
      source_trust: sourceTrustValue,
      language: languageValue,
    };
  });

  const filteredCount = normalizedDocs.length;

  const heuristicDocs: HeuristicDocSummary[] = summaryResults.map((doc) => ({
    identifier: doc.identifier,
    title: doc.title,
    description: doc.description,
    mediatype: doc.mediatype,
    year: doc.year,
    creator: doc.creator,
    language: doc.language ?? null,
    downloads: doc.downloads ?? null,
  }));

  const responseTotal =
    typeof originalNumFound === "number" && Number.isFinite(originalNumFound)
      ? originalNumFound
      : filteredCount;

  if (data.response) {
    data.response = {
      ...data.response,
      docs: normalizedDocs,
      numFound: responseTotal
    };
  } else {
    data.response = {
      docs: normalizedDocs,
      numFound: responseTotal,
      start: 0
    };
  }

  if (combinedTexts.length > 0) {
    spellCorrector.learnFromText(combinedTexts.join(" "));
  }

  let spellcheck: SpellcheckResult | null = null;

  if (effectiveQuery.length > 0) {
    const result = spellCorrector.checkQuery(effectiveQuery);
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
      total: responseTotal
    }
  };

  if (aiRefinedQuery) {
    payload.ai_refined_query = aiRefinedQuery;
  }

  if (alternateSuggestions.length > 0) {
    payload.alternate_queries = alternateSuggestions;
  }

  payload.original_numFound =
    typeof originalNumFound === "number" && Number.isFinite(originalNumFound)
      ? originalNumFound
      : responseTotal;
  payload.filtered_count = filteredCount;

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

  if (aiModeEnabled) {
    let aiOutcome: LocalAIOutcome | null = null;

    if (!runtimeAiConfig.enabled) {
      aiSummaryStatus = "unavailable";
      aiSummaryError = "Local AI assistance is disabled by the server configuration.";
      aiOutcome = { status: "disabled", message: aiSummaryError, modelPath: null };
    } else {
      try {
        const aiResponse = await generateAIResponse(effectiveQuery, { nsfwMode: nsfwUserMode });
        aiOutcome = getLastAIOutcome();
        const trimmed = typeof aiResponse === "string" ? aiResponse.trim() : "";
        if (trimmed) {
          aiSummary = trimmed;
          aiSummaryStatus = "success";
          aiSummaryError = null;
          aiSummarySource = "model";
        } else {
          if (aiOutcome.status === "error") {
            aiSummaryStatus = "error";
            aiSummaryError = aiOutcome.message ?? "Local AI encountered an unexpected error.";
          } else if (aiOutcome.status === "missing-model" || aiOutcome.status === "disabled") {
            aiSummaryStatus = "unavailable";
            aiSummaryError = aiOutcome.message ?? "Local AI model is not available on the server.";
          } else if (aiOutcome.status === "blocked") {
            aiSummaryStatus = "unavailable";
            aiSummaryError =
              aiOutcome.message ??
              (nsfwUserMode === "safe"
                ? "AI Mode: This content is hidden because Safe Search is enabled."
                : "AI suggestions are hidden due to the active NSFW mode.");
          } else {
            aiSummaryStatus = "unavailable";
            aiSummaryError = aiOutcome.message ?? null;
          }
        }
      } catch (error) {
        aiSummaryStatus = "error";
        aiSummaryError = error instanceof Error ? error.message : "Local AI failed to generate a response.";
      }
    }

    if (aiOutcome?.status !== "blocked") {
      const reason = aiSummaryError ?? aiOutcome?.message ?? null;
      if (!aiSummary || aiSummaryStatus !== "success") {
        const heuristic = buildHeuristicAISummary(effectiveQuery, heuristicDocs, nsfwUserMode, reason);
        if (heuristic) {
          aiSummary = heuristic.summary;
          aiSummaryStatus = "success";
          aiSummaryError = null;
          aiSummaryNotice = heuristic.notice;
          aiSummarySource = "heuristic";
        }
      }
    }

    payload.ai_summary = aiSummary;
    payload.ai_summary_status = aiSummaryStatus ?? "unavailable";
    if (aiSummaryError && aiSummaryError.trim()) {
      payload.ai_summary_error = aiSummaryError.trim();
    } else if ("ai_summary_error" in payload) {
      delete payload.ai_summary_error;
    }
    if (aiSummaryNotice && aiSummaryNotice.trim()) {
      payload.ai_summary_notice = aiSummaryNotice.trim();
    } else if ("ai_summary_notice" in payload) {
      delete payload.ai_summary_notice;
    }
    if (aiSummarySource) {
      payload.ai_summary_source = aiSummarySource;
    } else if ("ai_summary_source" in payload) {
      delete payload.ai_summary_source;
    }
  } else {
    if ("ai_summary" in payload) {
      delete payload.ai_summary;
    }
    if ("ai_summary_status" in payload) {
      delete payload.ai_summary_status;
    }
    if ("ai_summary_error" in payload) {
      delete payload.ai_summary_error;
    }
    if ("ai_summary_notice" in payload) {
      delete payload.ai_summary_notice;
    }
    if ("ai_summary_source" in payload) {
      delete payload.ai_summary_source;
    }
  }

  sendJson(res, 200, payload);
}

async function handleAIStatus({ res }: HandlerContext): Promise<void> {
  const enabled = isLocalAIEnabled();
  const inventory: LocalAIModelInventory = await listAvailableLocalAIModels();
  const outcome = getLastAIOutcome();
  const modelPaths = inventory.modelPaths;
  const models = modelPaths.map((modelPath) => path.basename(modelPath));

  const payload: AIStatusResponsePayload = {
    enabled,
    outcome,
    models,
    modelPaths,
    modelDirectory: inventory.modelDirectory,
    directoryAccessible: inventory.directoryAccessible,
  };

  if (inventory.directoryError) {
    payload.directoryError = inventory.directoryError;
  }

  sendJson(res, 200, payload);
}

async function handleAIQuery({ req, res }: HandlerContext): Promise<void> {
  let payload: unknown;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }
    console.error("Error reading AI request body", error);
    sendJson(res, 400, { error: "Unable to read request body." });
    return;
  }

  const data = (payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {}) ?? {};

  const messageCandidateFields: unknown[] = [data.message, data.prompt, data.question, data.query];
  let message = "";
  for (const candidate of messageCandidateFields) {
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (trimmed) {
        message = trimmed;
        break;
      }
    }
  }

  if (!message) {
    sendJson(res, 400, { error: "Missing required field 'message' in request body." });
    return;
  }

  const queryValue = typeof data.query === "string" ? data.query.trim() : "";
  const sanitizedQuery = queryValue || message;
  const mode = normalizeAIMode(data.mode);
  const history = normalizeAIHistory(data.history);
  const context = normalizeAIContext(data.context);
  const nsfwModeInput = typeof data.nsfwMode === "string" ? data.nsfwMode : undefined;
  const nsfwUserMode = resolveUserNSFWMode(nsfwModeInput);

  if (!runtimeAiConfig.enabled) {
    const disabledOutcome = getLastAIOutcome();
    const response: AIQueryResponsePayload = {
      status: "disabled",
      reply: null,
      error: disabledOutcome.message ?? "Local AI assistance is disabled by the server configuration.",
      mode,
      outcome: disabledOutcome,
    };
    sendJson(res, 200, response);
    return;
  }

  let reply: string | null = null;
  if (mode === "search") {
    reply = await generateAIResponse(sanitizedQuery, { nsfwMode: nsfwUserMode });
  } else {
    const request: LocalAIContextRequest = {
      mode,
      message,
      query: sanitizedQuery,
      context,
      history,
      nsfwMode: nsfwUserMode,
    };
    reply = await generateContextualResponse(request);
  }

  const outcome = getLastAIOutcome();
  let status: AIQueryStatus = "success";
  let errorMessage: string | null = null;

  if (outcome.status === "disabled") {
    status = "disabled";
    errorMessage = outcome.message ?? "Local AI assistance is disabled.";
  } else if (!reply) {
    if (outcome.status === "missing-model") {
      status = "unavailable";
      errorMessage = outcome.message ?? "Local AI model is not available.";
    } else if (outcome.status === "error") {
      status = "error";
      errorMessage = outcome.message ?? "Local AI failed to generate a response.";
    } else if (outcome.status === "blocked") {
      status = "unavailable";
      errorMessage =
        outcome.message ??
        (nsfwUserMode === "safe"
          ? "AI Mode: This content is hidden because Safe Search is enabled."
          : "AI suggestions are hidden due to the active NSFW mode.");
    } else {
      status = "unavailable";
      errorMessage = outcome.message ?? "Local AI response is unavailable.";
    }
  }

  const responsePayload: AIQueryResponsePayload = {
    status,
    reply: reply ?? null,
    mode,
    outcome,
  };

  if (errorMessage) {
    responsePayload.error = errorMessage;
  }

  sendJson(res, 200, responsePayload);
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
    const items = itemsRaw.map((item) => annotateRecord(attachArchiveLinks({ ...item })));
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
  const items = fallback.items.map((item) => annotateRecord(attachArchiveLinks({ ...item })));
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

async function handleReport({ req, res }: HandlerContext): Promise<void> {
  let payload: unknown;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }

    console.error("Error reading report request body", error);
    sendJson(res, 400, { error: "Unable to read request body." });
    return;
  }

  const data = (payload && typeof payload === "object" ? (payload as Record<string, unknown>) : null) ?? {};

  const identifierValue = data.identifier;
  const identifier = typeof identifierValue === "string" ? identifierValue.trim() : "";
  if (!identifier) {
    sendJson(res, 400, { error: "Missing required field 'identifier' in request body." });
    return;
  }

  const archiveUrlValue = data.archiveUrl;
  const archiveUrlRaw = typeof archiveUrlValue === "string" ? archiveUrlValue.trim() : "";
  if (!archiveUrlRaw) {
    sendJson(res, 400, { error: "Missing required field 'archiveUrl' in request body." });
    return;
  }

  let archiveUrl: string;
  try {
    const parsed = new URL(archiveUrlRaw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Report archive URL must use http or https.");
    }
    archiveUrl = parsed.toString();
  } catch (error) {
    console.warn("Invalid archive URL provided in report payload", error);
    sendJson(res, 400, { error: "Invalid archive URL provided for report." });
    return;
  }

  const reasonValue = data.reason;
  const reasonRaw = typeof reasonValue === "string" ? reasonValue.trim() : "";
  if (!reasonRaw) {
    sendJson(res, 400, { error: "Missing required field 'reason' in request body." });
    return;
  }

  if (!isValidReportReason(reasonRaw)) {
    sendJson(res, 400, { error: "Invalid report reason provided." });
    return;
  }

  const reason = reasonRaw as ReportSubmission["reason"];

  const messageValue = data.message;
  const messageRaw = typeof messageValue === "string" ? messageValue.trim() : "";
  if (messageRaw.length > 2000) {
    sendJson(res, 400, { error: "Optional message must be 2000 characters or fewer." });
    return;
  }

  const titleValue = data.title;
  const title = typeof titleValue === "string" ? titleValue.trim() : "";

  const submission: ReportSubmission = {
    identifier,
    archiveUrl,
    reason,
    message: messageRaw ? messageRaw : undefined,
    title: title ? title : undefined
  };

  try {
    const result = await sendReportEmail(submission);
    sendJson(res, 200, { success: true, messageId: result.messageId ?? null });
  } catch (error) {
    console.error("Failed to dispatch Alexandria Browser report email", error);
    sendJson(res, 502, {
      success: false,
      error: "Unable to submit report at this time.",
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
