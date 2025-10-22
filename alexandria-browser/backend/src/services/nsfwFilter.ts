import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type NSFWSeverity = "mild" | "explicit";

export interface NSFWClassification {
  flagged: boolean;
  severity: NSFWSeverity | null;
  matches: string[];
}

interface KeywordConfig {
  categories?: {
    explicit?: unknown;
    mild?: unknown;
  };
}

interface KeywordSets {
  explicit: string[];
  mild: string[];
}

const KEYWORD_SETS = loadKeywordSets();
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

function normalizeSeverityValue(value: unknown): NSFWSeverity | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (EXPLICIT_SEVERITY_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return "explicit";
  }
  if (MILD_SEVERITY_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
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

function loadKeywordSets(): KeywordSets {
  const configPath = join(dirname(fileURLToPath(import.meta.url)), "../../../src/config/nsfwKeywords.json");
  try {
    const raw = readFileSync(configPath, "utf-8");
    const payload = JSON.parse(raw) as KeywordConfig;
    if (payload.categories && typeof payload.categories === "object") {
      const explicit = normalizeList(payload.categories.explicit);
      const mild = normalizeList(payload.categories.mild);
      const explicitSet = new Set(explicit);
      const filteredMild = mild.filter((keyword) => !explicitSet.has(keyword));
      return { explicit, mild: filteredMild };
    }
  } catch (error) {
    console.warn("Unable to load NSFW keyword configuration", error);
  }
  return { explicit: [], mild: [] };
}

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result = new Set<string>();
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim()) {
      result.add(entry.trim().toLowerCase());
    }
  }
  return Array.from(result);
}

function append(values: string[], input: unknown, seen: WeakSet<object>, depth = 0) {
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
      append(values, entry, seen, depth + 1);
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
      append(values, value, seen, depth + 1);
    }
  }
}

function collectStrings(record: Record<string, unknown>): string[] {
  const values: string[] = [];
  const seen = new WeakSet<object>();
  const appendValue = (input: unknown) => append(values, input, seen);

  appendValue(record.title);
  appendValue(record.description);
  appendValue(record.identifier);
  appendValue(record.mediatype);
  appendValue(record.creator);
  appendValue(record.collection);
  appendValue(record.subject);
  appendValue(record.tags);
  appendValue(record.keywords);
  appendValue(record.topic);
  appendValue(record.topics);
  appendValue(record.originalUrl);
  appendValue(record.original_url);
  appendValue(record.archiveUrl);
  appendValue(record.archive_url);
  appendValue(record.metadata);
  appendValue(record.links);

  return values;
}

function classifyStrings(values: string[], metadata: Record<string, unknown>): NSFWClassification {
  const explicitMatches = new Set<string>();
  const mildMatches = new Set<string>();

  for (const value of values) {
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

  const severityFromFlag = normalizeSeverityValue(metadata["nsfw"]);
  const existingSeverity =
    severityFromFlag ??
    normalizeSeverityValue(
      metadata["nsfwLevel"] ??
        metadata["nsfw_level"] ??
        metadata["nsfwSeverity"] ??
        metadata["nsfw_severity"]
    );
  const existingMatches = extractMatchList(
    metadata["nsfwMatches"] ?? metadata["nsfw_matches"] ?? metadata["nsfwTags"] ?? metadata["nsfw_tags"]
  );
  const flaggedByMetadata =
    isTruthyFlag(metadata["nsfw"]) || existingSeverity !== null || existingMatches.length > 0;

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

  return { flagged: true, severity, matches };
}

export function classifyText(input: string | string[]): NSFWClassification {
  const values = Array.isArray(input)
    ? input.filter((entry) => typeof entry === "string")
    : typeof input === "string"
    ? [input]
    : [];
  return classifyStrings(values, {});
}

export function classifyRecord(record: Record<string, unknown>): NSFWClassification {
  return classifyStrings(collectStrings(record), record);
}

export function annotateRecord<T extends Record<string, unknown>>(record: T): T & {
  nsfw: boolean;
  nsfwLevel?: NSFWSeverity;
  nsfwMatches?: string[];
} {
  const classification = classifyRecord(record);
  const next: Record<string, unknown> = { ...record };
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
  } else {
    if (next.nsfw) {
      next.nsfw = false;
    }
    if ("nsfwLevel" in next) {
      delete next.nsfwLevel;
    }
    if ("nsfwMatches" in next) {
      delete next.nsfwMatches;
    }
  }
  return next as T & { nsfw: boolean; nsfwLevel?: NSFWSeverity; nsfwMatches?: string[] };
}

export function isNSFWContent(text: string = ""): boolean {
  return classifyText(text).flagged;
}
