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

function append(values: string[], input: unknown) {
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
      append(values, entry);
    }
  }
}

function collectStrings(record: Record<string, unknown>): string[] {
  const values: string[] = [];
  append(values, record.title);
  append(values, record.description);
  append(values, record.identifier);
  append(values, record.mediatype);
  append(values, record.creator);
  append(values, record.collection);
  append(values, record.subject);
  append(values, record.tags);
  append(values, record.keywords);
  append(values, record.topic);
  append(values, record.topics);
  append(values, record.originalUrl);
  append(values, record.original_url);
  append(values, record.archiveUrl);
  append(values, record.archive_url);

  const metadata = record.metadata;
  if (metadata && typeof metadata === "object") {
    const data = metadata as Record<string, unknown>;
    append(values, data.tags);
    append(values, data.subject);
    append(values, data.keywords);
    append(values, data.topic);
    append(values, data.topics);
  }

  const links = record.links;
  if (links && typeof links === "object") {
    const linkRecord = links as Record<string, unknown>;
    append(values, linkRecord.archive);
    append(values, linkRecord.original);
  }

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
