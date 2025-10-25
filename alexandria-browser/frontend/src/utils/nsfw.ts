import type {
  ArchiveSearchDoc,
  NSFWFilterMode,
  NSFWSeverity,
  ScrapeItem
} from "../types";

import keywordPayload from "../../../src/config/nsfwKeywords.json" assert { type: "json" };
import { detectKeywordMatches } from "./nsfwKeywordMatcher";

interface KeywordConfig {
  categories?: {
    explicit?: unknown;
    mild?: unknown;
  };
}

type ClassifiedRecord<T> = T & {
  nsfw?: boolean;
  nsfwLevel?: NSFWSeverity;
  nsfwMatches?: string[];
};

type Classification = {
  flagged: boolean;
  severity: NSFWSeverity | null;
  matches: string[];
};

const MODE_VALUES: readonly NSFWFilterMode[] = ["safe", "moderate", "off", "only"];

function normalizeList(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const next = new Set<string>();
  for (const value of input) {
    if (typeof value === "string" && value.trim()) {
      next.add(value.trim().toLowerCase());
    }
  }
  return Array.from(next);
}

function parseKeywordConfig(payload: KeywordConfig): { explicit: string[]; mild: string[] } {
  if (payload.categories && typeof payload.categories === "object") {
    const explicit = normalizeList(payload.categories.explicit);
    const mild = normalizeList(payload.categories.mild);
    const explicitSet = new Set(explicit);
    const filteredMild = mild.filter((keyword) => !explicitSet.has(keyword));
    return { explicit, mild: filteredMild };
  }

  return { explicit: [], mild: [] };
}

const KEYWORD_SETS = parseKeywordConfig(keywordPayload as KeywordConfig);

function normalizeMode(mode: NSFWFilterMode | string | undefined): NSFWFilterMode {
  if (typeof mode === "string") {
    const lowered = mode.toLowerCase();
    if (MODE_VALUES.includes(lowered as NSFWFilterMode)) {
      return lowered as NSFWFilterMode;
    }
    if (lowered === "unrestricted" || lowered === "none" || lowered === "no_filter") {
      return "off";
    }
    if (lowered === "only_nsfw" || lowered === "only-nsfw" || lowered === "nsfw") {
      return "only";
    }
  }
  return "safe";
}

function appendValue(values: string[], input: unknown) {
  if (!input) {
    return;
  }
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed) {
      values.push(trimmed);
    }
    return;
  }
  if (Array.isArray(input)) {
    for (const entry of input) {
      appendValue(values, entry);
    }
    return;
  }
}

function collectCandidateStrings(record: Record<string, unknown>): string[] {
  const values: string[] = [];

  appendValue(values, record.title);
  appendValue(values, record.description);
  appendValue(values, record.identifier);
  appendValue(values, record.mediatype);
  appendValue(values, record.creator);
  appendValue(values, record.collection);
  appendValue(values, record.subject);
  appendValue(values, record.tags);
  appendValue(values, record.keywords);
  appendValue(values, record.topic);
  appendValue(values, record.topics);
  appendValue(values, record.originalUrl);
  appendValue(values, record.original_url);
  appendValue(values, record.archiveUrl);
  appendValue(values, record.archive_url);

  const metadata = record.metadata;
  if (metadata && typeof metadata === "object") {
    const metadataRecord = metadata as Record<string, unknown>;
    appendValue(values, metadataRecord.tags);
    appendValue(values, metadataRecord.subject);
    appendValue(values, metadataRecord.keywords);
    appendValue(values, metadataRecord.topic);
    appendValue(values, metadataRecord.topics);
  }

  const links = record.links;
  if (links && typeof links === "object") {
    const linkRecord = links as Record<string, unknown>;
    appendValue(values, linkRecord.archive);
    appendValue(values, linkRecord.original);
  }

  return values;
}

function classifyRecord(record: Record<string, unknown>): Classification {
  const explicitMatches = new Set<string>();
  const mildMatches = new Set<string>();

  for (const value of collectCandidateStrings(record)) {
    const explicit = detectKeywordMatches(value, KEYWORD_SETS.explicit);
    for (const keyword of explicit) {
      explicitMatches.add(keyword);
    }

    const mild = detectKeywordMatches(value, KEYWORD_SETS.mild);
    for (const keyword of mild) {
      mildMatches.add(keyword);
    }
  }

  if (explicitMatches.size > 0) {
    return {
      flagged: true,
      severity: "explicit",
      matches: Array.from(new Set([...explicitMatches, ...mildMatches]))
    };
  }

  if (mildMatches.size > 0) {
    return {
      flagged: true,
      severity: "mild",
      matches: Array.from(mildMatches)
    };
  }

  return { flagged: false, severity: null, matches: [] };
}

function annotateRecord<T extends Record<string, unknown>>(record: T): ClassifiedRecord<T> {
  const existingLevel = record.nsfwLevel ?? record.nsfw_level;
  const existingMatches = Array.isArray((record as Record<string, unknown>).nsfwMatches)
    ? (record as Record<string, unknown>).nsfwMatches
    : Array.isArray((record as Record<string, unknown>).nsfw_matches)
    ? (record as Record<string, unknown>).nsfw_matches
    : undefined;

  if (typeof existingLevel === "string") {
    const severity = existingLevel as NSFWSeverity;
    const nsfw = record.nsfw === true || severity === "explicit" || severity === "mild";
    return {
      ...record,
      nsfw,
      nsfwLevel: severity,
      nsfwMatches: existingMatches ?? []
    } as ClassifiedRecord<T>;
  }

  const classification = classifyRecord(record);

  if (!classification.flagged) {
    const next = { ...record } as ClassifiedRecord<T>;
    if (next.nsfw) {
      next.nsfw = false;
    }
    if ("nsfwLevel" in next) {
      delete next.nsfwLevel;
    }
    if ("nsfwMatches" in next) {
      delete next.nsfwMatches;
    }
    return next;
  }

  const next = { ...record } as ClassifiedRecord<T>;
  next.nsfw = true;
  if (classification.severity) {
    next.nsfwLevel = classification.severity;
  }
  if (classification.matches.length > 0) {
    next.nsfwMatches = classification.matches;
  }
  return next;
}

function resolveSeverity(record: ClassifiedRecord<unknown>): NSFWSeverity | null {
  const value = record.nsfwLevel ?? (record as Record<string, unknown>).nsfw_level;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "explicit" || lowered === "mild") {
      return lowered as NSFWSeverity;
    }
  }
  return null;
}

function isFlagged(record: ClassifiedRecord<unknown>): boolean {
  const severity = resolveSeverity(record);
  if (severity === "explicit" || severity === "mild") {
    return true;
  }
  return record.nsfw === true;
}

function matchesMode(record: ClassifiedRecord<unknown>, mode: NSFWFilterMode): boolean {
  const severity = resolveSeverity(record);
  const flagged = isFlagged(record);

  if (mode === "only") {
    return flagged;
  }
  if (mode === "safe") {
    return !flagged;
  }
  if (mode === "moderate") {
    return severity !== "explicit";
  }
  return true;
}

function filterByMode<T extends Record<string, unknown>>(items: T[], mode: NSFWFilterMode): ClassifiedRecord<T>[] {
  const normalized = normalizeMode(mode);
  const results: ClassifiedRecord<T>[] = [];
  for (const item of items) {
    const annotated = annotateRecord(item);
    if (matchesMode(annotated, normalized)) {
      results.push(annotated);
    }
  }
  return results;
}

export function applyNSFWModeToDocs(docs: ArchiveSearchDoc[], mode: NSFWFilterMode): ArchiveSearchDoc[] {
  return filterByMode(docs, mode) as ArchiveSearchDoc[];
}

export function applyNSFWModeToScrape(items: ScrapeItem[], mode: NSFWFilterMode): ScrapeItem[] {
  return filterByMode(items, mode) as ScrapeItem[];
}

export function annotateDocs(docs: ArchiveSearchDoc[]): ArchiveSearchDoc[] {
  return docs.map((doc) => annotateRecord(doc));
}

export function annotateScrapeItems(items: ScrapeItem[]): ScrapeItem[] {
  return items.map((item) => annotateRecord(item));
}

export function shouldIncludeDoc(doc: ArchiveSearchDoc, mode: NSFWFilterMode): boolean {
  const annotated = annotateRecord(doc);
  return matchesMode(annotated, normalizeMode(mode));
}

export function countHiddenByMode(docs: ArchiveSearchDoc[], mode: NSFWFilterMode): number {
  const normalized = normalizeMode(mode);
  if (normalized === "off" || normalized === "only") {
    return 0;
  }
  let hidden = 0;
  for (const doc of docs) {
    const annotated = annotateRecord(doc);
    if (!matchesMode(annotated, normalized)) {
      hidden += 1;
    }
  }
  return hidden;
}
