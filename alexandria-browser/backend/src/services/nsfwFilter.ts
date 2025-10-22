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

function classifyStrings(values: string[]): NSFWClassification {
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

export function classifyText(input: string | string[]): NSFWClassification {
  if (Array.isArray(input)) {
    return classifyStrings(input.filter((entry) => typeof entry === "string") as string[]);
  }
  return classifyStrings(typeof input === "string" ? [input] : []);
}

export function classifyRecord(record: Record<string, unknown>): NSFWClassification {
  return classifyStrings(collectStrings(record));
}

export function annotateRecord<T extends Record<string, unknown>>(record: T): T & {
  nsfw: boolean;
  nsfwLevel?: NSFWSeverity;
  nsfwMatches?: string[];
} {
  const classification = classifyRecord(record);
  const next: Record<string, unknown> = { ...record, nsfw: classification.flagged };
  if (classification.severity) {
    next.nsfwLevel = classification.severity;
  }
  if (classification.matches.length > 0) {
    next.nsfwMatches = classification.matches;
  }
  return next as T & { nsfw: boolean; nsfwLevel?: NSFWSeverity; nsfwMatches?: string[] };
}

export function isNSFWContent(text: string = ""): boolean {
  return classifyText(text).flagged;
}
