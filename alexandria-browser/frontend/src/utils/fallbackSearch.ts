import { SAMPLE_ARCHIVE_DOCS } from "../data/sampleArchiveDocs";
import type { ArchiveDocLinks, ArchiveSearchDoc, ArchiveSearchResponse, SearchFilters } from "../types";

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

function gatherSearchableText(doc: ArchiveSearchDoc): string {
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
  return {
    ...doc,
    links,
    ...(thumbnail ? { thumbnail } : {})
  };
}

export function performFallbackArchiveSearch(
  query: string,
  page: number,
  rows: number,
  filters: SearchFilters
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

    if (requestedYearFrom !== null || requestedYearTo !== null) {
      const year = resolveDocumentYear(doc);
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

    const haystack = gatherSearchableText(doc).toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });

  const safePage = Number.isFinite(page) && page > 0 ? page : 1;
  const safeRows = Number.isFinite(rows) && rows > 0 ? rows : 20;
  const startIndex = (safePage - 1) * safeRows;

  const docs = matches.slice(startIndex, startIndex + safeRows).map((doc) => enrichDoc({ ...doc }));

  return {
    response: {
      docs,
      numFound: matches.length,
      start: startIndex
    },
    fallback: true,
    spellcheck: null
  };
}
