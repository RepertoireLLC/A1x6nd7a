import type {
  ArchiveSearchDoc,
  NSFWFilterMode,
  NSFWSeverity,
  ScrapeItem
} from "../types";

import keywordPayload from "../../../src/config/nsfwKeywords.json" assert { type: "json" };

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
const MAX_COLLECTION_DEPTH = 6;

const EXPLICIT_SEVERITY_KEYWORDS = [
  "explicit",
  "hardcore",
  "xxx",
  "x-rated",
  "porn",
  "pornographic",
  "adult",
  "18+",
  "nsfw-explicit"
];

const MILD_SEVERITY_KEYWORDS = [
  "mild",
  "soft",
  "softcore",
  "soft-core",
  "soft core",
  "sensitive",
  "nsfw",
  "suggestive",
  "moderate"
];

function normalizeSeverityValue(input: unknown): NSFWSeverity | null {
  if (typeof input !== "string") {
    return null;
  }
  const value = input.trim().toLowerCase();
  if (!value) {
    return null;
  }
  if (EXPLICIT_SEVERITY_KEYWORDS.some((keyword) => value.includes(keyword))) {
    return "explicit";
  }
  if (MILD_SEVERITY_KEYWORDS.some((keyword) => value.includes(keyword))) {
    return "mild";
  }
  return null;
}

function isTruthyFlag(value: unknown): boolean {
  if (value === true) {
    return true;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "y";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0;
  }
  return false;
}

function extractMatchList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const seen = new Set<string>();
  const matches: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const trimmed = entry.trim();
    if (!trimmed) {
      continue;
    }
    const normalized = trimmed.toLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      matches.push(trimmed);
    }
  }
  return matches;
}

function mergeMatches(primary: string[], secondary: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const list of [primary, secondary]) {
    for (const entry of list) {
      if (typeof entry !== "string") {
        continue;
      }
      const normalized = entry.toLowerCase();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        result.push(entry);
      }
    }
  }
  return result;
}

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
    if (lowered === "only_nsfw") {
      return "only";
    }
    if (lowered === "none" || lowered === "no_filter") {
      return "off";
    }
  }
  return "safe";
}

function appendValue(values: string[], input: unknown, seen: WeakSet<object>, depth = 0) {
  if (input === null || input === undefined) {
    return;
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (trimmed) {
      values.push(trimmed);
    }
    return;
  }

  if (typeof input === "number") {
    if (Number.isFinite(input)) {
      values.push(String(input));
    }
    return;
  }

  if (typeof input === "bigint") {
    values.push(input.toString());
    return;
  }

  if (typeof input === "boolean") {
    return;
  }

  if (depth >= MAX_COLLECTION_DEPTH) {
    return;
  }

  if (Array.isArray(input)) {
    for (const entry of input) {
      appendValue(values, entry, seen, depth + 1);
    }
    return;
  }

  if (typeof input === "object") {
    if (input instanceof Date) {
      values.push(input.toISOString());
      return;
    }

    const candidate = input as Record<string, unknown>;
    if (seen.has(candidate)) {
      return;
    }
    seen.add(candidate);

    for (const value of Object.values(candidate)) {
      appendValue(values, value, seen, depth + 1);
    }
  }
}

function collectCandidateStrings(record: Record<string, unknown>): string[] {
  const values: string[] = [];
  const seen = new WeakSet<object>();
  const append = (input: unknown) => appendValue(values, input, seen);

  append(record.title);
  append(record.description);
  append(record.identifier);
  append(record.mediatype);
  append(record.creator);
  append(record.collection);
  append(record.subject);
  append(record.tags);
  append(record.keywords);
  append(record.topic);
  append(record.topics);
  append(record.originalUrl);
  append(record.original_url);
  append(record.archiveUrl);
  append(record.archive_url);
  append(record.metadata);
  append(record.links);

  return values;
}

function classifyRecord(record: Record<string, unknown>): Classification {
  const explicitMatches = new Set<string>();
  const mildMatches = new Set<string>();

  for (const value of collectCandidateStrings(record)) {
    const normalized = value.toLowerCase();
    for (const keyword of KEYWORD_SETS.explicit) {
      if (normalized.includes(keyword)) {
        explicitMatches.add(keyword);
      }
    }
    for (const keyword of KEYWORD_SETS.mild) {
      if (normalized.includes(keyword)) {
        mildMatches.add(keyword);
      }
    }
  }

  const severityFromFlag = normalizeSeverityValue(record["nsfw"]);
  const existingSeverity =
    severityFromFlag ??
    normalizeSeverityValue(
      record["nsfwLevel"] ?? record["nsfw_level"] ?? record["nsfwSeverity"] ?? record["nsfw_severity"]
    );
  const existingMatches = extractMatchList(
    record["nsfwMatches"] ?? record["nsfw_matches"] ?? record["nsfwTags"] ?? record["nsfw_tags"]
  );
  const flaggedByMetadata =
    isTruthyFlag(record["nsfw"]) || existingSeverity !== null || existingMatches.length > 0;

  const keywordFlagged = explicitMatches.size > 0 || mildMatches.size > 0;
  const keywordSeverity: NSFWSeverity | null =
    explicitMatches.size > 0 ? "explicit" : mildMatches.size > 0 ? "mild" : null;
  const keywordMatches = explicitMatches.size > 0
    ? Array.from(new Set([...explicitMatches, ...mildMatches]))
    : Array.from(mildMatches);

  const flagged = keywordFlagged || flaggedByMetadata;
  if (!flagged) {
    return { flagged: false, severity: null, matches: [] };
  }

  let severity: NSFWSeverity | null = keywordSeverity;
  if (existingSeverity) {
    if (existingSeverity === "explicit" || severity === "explicit") {
      severity = "explicit";
    } else {
      severity = existingSeverity;
    }
  } else if (!severity && flaggedByMetadata) {
    severity = "mild";
  }

  const matches = mergeMatches(keywordMatches, existingMatches);

  return {
    flagged: true,
    severity,
    matches
  };
}

function shouldInclude(classification: Classification, mode: NSFWFilterMode): boolean {
  if (mode === "only") {
    return classification.flagged;
  }
  if (mode === "safe") {
    return !classification.flagged;
  }
  if (mode === "moderate") {
    return classification.severity !== "explicit";
  }
  return true;
}

function annotateWithClassification<T extends Record<string, unknown>>(
  record: T,
  classification: Classification
): ClassifiedRecord<T> {
  const next = { ...record } as ClassifiedRecord<T>;
  if (classification.flagged) {
    next.nsfw = true;
    if (classification.severity) {
      next.nsfwLevel = classification.severity;
    } else if ("nsfwLevel" in next) {
      delete next.nsfwLevel;
    }
    if (classification.matches.length > 0) {
      next.nsfwMatches = classification.matches;
    } else if ("nsfwMatches" in next) {
      delete next.nsfwMatches;
    }
    return next;
  }

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

function annotateRecord<T extends Record<string, unknown>>(record: T): ClassifiedRecord<T> {
  const classification = classifyRecord(record);
  return annotateWithClassification(record, classification);
}

function filterByMode<T extends Record<string, unknown>>(items: T[], mode: NSFWFilterMode): ClassifiedRecord<T>[] {
  const normalized = normalizeMode(mode);
  const results: ClassifiedRecord<T>[] = [];
  for (const item of items) {
    const classification = classifyRecord(item);
    if (shouldInclude(classification, normalized)) {
      results.push(annotateWithClassification(item, classification));
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
  return shouldInclude(classifyRecord(doc), normalizeMode(mode));
}

export function countHiddenByMode(docs: ArchiveSearchDoc[], mode: NSFWFilterMode): number {
  const normalized = normalizeMode(mode);
  let hidden = 0;
  for (const doc of docs) {
    if (!shouldInclude(classifyRecord(doc), normalized)) {
      hidden += 1;
    }
  }
  return hidden;
}
