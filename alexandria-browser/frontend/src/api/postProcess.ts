import type {
  ArchiveSearchDoc,
  ArchiveSearchResponse,
  SearchFilters,
} from "../types";
import {
  createTruthScoringContext,
  scoreArchiveDocTruth,
} from "../utils/truthRanking";

const CURATED_COLLECTIONS = new Set([
  "smithsonian",
  "library_of_congress",
  "gutenberg",
  "naropa",
  "prelinger",
  "opensource_audio",
]);

export function postProcessDirectSearchPayload(
  payload: ArchiveSearchResponse,
  query: string,
  filters: SearchFilters,
): ArchiveSearchResponse {
  const response = payload.response ?? {};
  const docs = Array.isArray(response.docs) ? response.docs : [];
  const context = createTruthScoringContext(query);

  const annotatedDocs = docs.map((doc) => annotateDoc(doc, context));
  const filteredDocs = annotatedDocs.filter((doc) => matchesClientFilters(doc, filters));

  const originalCount =
    typeof response.numFound === "number" && Number.isFinite(response.numFound)
      ? response.numFound
      : docs.length;

  const filteredCount = filteredDocs.length;

  return {
    ...payload,
    response: {
      ...response,
      docs: filteredDocs,
      numFound: filteredCount,
    },
    original_numFound: originalCount,
    filtered_count: filteredCount,
  };
}

function annotateDoc(doc: ArchiveSearchDoc, context = createTruthScoringContext("")): ArchiveSearchDoc {
  const { score, breakdown } = scoreArchiveDocTruth(doc, context);
  const availability = determineAvailability(doc);
  const language = extractLanguage(doc);

  return {
    ...doc,
    score,
    score_breakdown: breakdown,
    availability,
    source_trust: breakdown.trustLevel,
    language,
  };
}

function determineAvailability(doc: ArchiveSearchDoc): "online" | "archived-only" | "offline" {
  if (doc.original_url) {
    return "online";
  }
  const links = doc.links;
  if (links) {
    if (links.original) {
      return "online";
    }
    if (links.wayback) {
      return "archived-only";
    }
  }
  return "archived-only";
}

function extractLanguage(doc: ArchiveSearchDoc): string | null {
  const languageField = doc.language ?? (doc as Record<string, unknown>).languages ?? (doc as Record<string, unknown>).lang;
  if (!languageField) {
    return null;
  }
  if (typeof languageField === "string" && languageField.trim()) {
    return languageField;
  }
  if (Array.isArray(languageField)) {
    for (const entry of languageField) {
      if (typeof entry === "string" && entry.trim()) {
        return entry;
      }
    }
  }
  return null;
}

function matchesClientFilters(doc: ArchiveSearchDoc, filters: SearchFilters): boolean {
  const languageFilter = filters.language.trim().toLowerCase();
  if (languageFilter) {
    const languageValues = normalizeList(doc.language ?? (doc as Record<string, unknown>).languages ?? (doc as Record<string, unknown>).lang);
    if (languageValues.length === 0) {
      return false;
    }
    if (!languageValues.some((entry) => entry.includes(languageFilter) || entry.startsWith(languageFilter))) {
      return false;
    }
  }

  const sourceTrustFilter = filters.sourceTrust.trim().toLowerCase();
  if (sourceTrustFilter && sourceTrustFilter !== "any") {
    const trustValue = (doc.source_trust ?? doc.source_trust_level ?? "").toString().toLowerCase();
    if (!trustValue || trustValue !== sourceTrustFilter) {
      return false;
    }
  }

  const availabilityFilter = filters.availability.trim().toLowerCase();
  if (availabilityFilter && availabilityFilter !== "any") {
    const availabilityValue = (doc.availability ?? "").toString().toLowerCase();
    if (!availabilityValue || availabilityValue !== availabilityFilter) {
      return false;
    }
  }

  const nsfwMode = filters.nsfwMode;
  if (nsfwMode && nsfwMode !== "off") {
    const isFlagged = doc.nsfw === true;
    const severity = (doc.nsfwLevel ?? doc.nsfw_level ?? "").toString().toLowerCase();

    if (nsfwMode === "only") {
      return isFlagged;
    }

    if (nsfwMode === "safe" && isFlagged) {
      return false;
    }

    if (nsfwMode === "moderate" && severity === "explicit") {
      return false;
    }
  }

  const collections = normalizeList(doc.collection);
  if (filters.sourceTrust.trim().toLowerCase() === "high" && collections.length > 0) {
    const hasCurated = collections.some((entry) => CURATED_COLLECTIONS.has(entry));
    if (!hasCurated) {
      return false;
    }
  }

  return true;
}

function normalizeList(value: unknown): string[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : ""))
      .filter((entry) => entry.length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(/[,;\n]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0);
  }
  return [];
}
