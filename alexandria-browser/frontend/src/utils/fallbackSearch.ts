import { SAMPLE_ARCHIVE_DOCS } from "../data/sampleArchiveDocs";
import type { ArchiveDocLinks, ArchiveSearchDoc, ArchiveSearchResponse, SearchFilters } from "../types";
import {
  buildRelevanceContext,
  computeDocTextSignals,
  gatherSearchableText,
  sortDocsByRelevance
} from "./relevance";

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

function resolveDocumentYear(doc: ArchiveSearchDoc): number | null {
  const candidates: Array<unknown> = [doc.year, doc.date, doc.publicdate];
  for (const candidate of candidates) {
    const year = extractYearValue(candidate);
    if (year !== null) {
      return year;
    }
  }
  return null;
}

function computeArchiveLinks(identifier: string, existing?: ArchiveDocLinks): ArchiveDocLinks {
  if (existing?.archive) {
    const wayback = existing.wayback ?? `https://web.archive.org/web/*/${existing.archive}`;
    return { ...existing, wayback };
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

function enrichDoc(doc: ArchiveSearchDoc): ArchiveSearchDoc {
  const links = computeArchiveLinks(doc.identifier, doc.links);
  const thumbnail = computeThumbnail(doc.identifier, doc.thumbnail);
  const archiveUrl = doc.archive_url ?? links.archive;
  const originalUrl = doc.original_url ?? links.original ?? undefined;
  const waybackUrl = doc.wayback_url ?? links.wayback ?? undefined;

  return {
    ...doc,
    links,
    archive_url: archiveUrl,
    ...(originalUrl ? { original_url: originalUrl } : {}),
    ...(waybackUrl ? { wayback_url: waybackUrl } : {}),
    ...(thumbnail ? { thumbnail } : {})
  };
}

export function performFallbackArchiveSearch(
  query: string,
  page: number,
  rows: number,
  filters: SearchFilters
): ArchiveSearchResponse {
  const context = buildRelevanceContext(query);
  const tokens = context.tokens;

  const requestedMediaTypeRaw = filters.mediaType?.toLowerCase().trim() ?? "";
  const requestedMediaType = requestedMediaTypeRaw && requestedMediaTypeRaw !== "all" ? requestedMediaTypeRaw : null;
  const requestedYearFrom = filters.yearFrom ? Number.parseInt(filters.yearFrom, 10) : null;
  const requestedYearTo = filters.yearTo ? Number.parseInt(filters.yearTo, 10) : null;
  const candidateEntries = SAMPLE_ARCHIVE_DOCS.map((doc) => {
    const enriched = enrichDoc({ ...doc });
    const signals = computeDocTextSignals(enriched, context);
    const year = resolveDocumentYear(doc);
    const haystack = gatherSearchableText(enriched);
    return { doc: enriched, signals, year, haystack };
  });

  const filtered = candidateEntries.filter((entry) => {
    if (requestedMediaType && (entry.doc.mediatype?.toLowerCase() ?? "") !== requestedMediaType) {
      return false;
    }

    if (requestedYearFrom !== null || requestedYearTo !== null) {
      const year = entry.year;
      if (requestedYearFrom !== null && (year === null || year < requestedYearFrom)) {
        return false;
      }
      if (requestedYearTo !== null && (year === null || year > requestedYearTo)) {
        return false;
      }
    }

    if (tokens.length === 0) {
      return true;
    }

    if (entry.signals.coverage > 0) {
      return true;
    }

    // As a final fallback, attempt a substring match against the combined text to surface close results.
    return entry.haystack.includes(context.normalizedQuery);
  });

  const safePage = Number.isFinite(page) && page > 0 ? page : 1;
  const safeRows = Number.isFinite(rows) && rows > 0 ? rows : 20;
  const startIndex = (safePage - 1) * safeRows;

  const orderedDocs = sortDocsByRelevance(
    filtered.map((entry) => entry.doc),
    query
  );

  const docs = orderedDocs.slice(startIndex, startIndex + safeRows);

  const hasTokens = tokens.length > 0;
  const hasPartialMatches = hasTokens && filtered.some((entry) => entry.signals.coverage > 0 && entry.signals.coverage < tokens.length);
  const transformations = ["offline-dataset"];
  if (hasPartialMatches) {
    transformations.push("partial-token-match");
  }

  return {
    response: {
      docs,
      numFound: filtered.length,
      start: startIndex
    },
    fallback: true,
    spellcheck: null,
    search_strategy: "offline relevance fallback",
    ...(hasPartialMatches
      ? { search_notice: "No exact results. Showing closest matches:" }
      : {}),
    ...(transformations.length > 0 ? { search_transformations: transformations } : {})
  };
}
