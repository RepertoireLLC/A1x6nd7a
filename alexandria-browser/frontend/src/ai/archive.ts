import { getWaybackAvailability, searchArchive } from "../api/archive";
import type { ArchiveSearchDoc, NSFWFilterMode, SearchFilters } from "../types";

export interface IAItem {
  identifier: string;
  title?: string;
  mediatype?: string;
  year?: string;
  creator?: string;
  subject?: string[];
  description?: string;
  wayback?: { available: boolean; closestUrl?: string; timestamp?: string };
}

interface ParsedPlan {
  topic?: string;
  mediatypes: string[];
  years?: string;
  include: string[];
  exclude: string[];
}

interface IAQuery {
  query: string;
  filters: SearchFilters;
  rows: number;
}

const VALID_MEDIA_TYPES = new Set(["texts", "audio", "movies", "software", "image", "web"]);

function parsePlan(plan?: string): ParsedPlan {
  if (!plan) {
    return { mediatypes: [], include: [], exclude: [] };
  }

  const parsed: ParsedPlan = { mediatypes: [], include: [], exclude: [] };
  const lines = plan
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const [rawKey, ...rest] = line.split(":");
    if (!rawKey || rest.length === 0) {
      continue;
    }
    const key = rawKey.toLowerCase().trim();
    const value = rest.join(":").trim();
    if (!value) {
      continue;
    }

    if (key === "topic") {
      parsed.topic = value;
    } else if (key === "mediatypes") {
      const parts = value
        .split(/[,\s]+/)
        .map((part) => part.trim().toLowerCase())
        .filter((part) => VALID_MEDIA_TYPES.has(part));
      parsed.mediatypes.push(...parts);
    } else if (key === "years") {
      if (value.toLowerCase() !== "any") {
        parsed.years = value;
      }
    } else if (key === "filters") {
      const segments = value.split(/[;,]+/).map((segment) => segment.trim());
      for (const segment of segments) {
        if (!segment) {
          continue;
        }
        if (/^(-|exclude)/i.test(segment)) {
          parsed.exclude.push(segment.replace(/^(-|exclude[:\s]+)/i, "").trim());
        } else {
          parsed.include.push(segment.replace(/^include[:\s]+/i, "").trim());
        }
      }
    }
  }

  parsed.mediatypes = Array.from(new Set(parsed.mediatypes));
  return parsed;
}

function detectMediaTypes(input: string): string[] {
  const text = input.toLowerCase();
  const output = new Set<string>();
  if (/\b(pdf|book|scan|manuscript|text|article|magazine)s?\b/.test(text)) {
    output.add("texts");
  }
  if (/\b(audio|recording|podcast|music|spoken)\b/.test(text)) {
    output.add("audio");
  }
  if (/\b(video|movie|film|footage|tv)\b/.test(text)) {
    output.add("movies");
  }
  if (/\b(software|rom|iso|game|emulator)\b/.test(text)) {
    output.add("software");
  }
  if (/\b(image|photo|picture|photograph|poster)\b/.test(text)) {
    output.add("image");
  }
  if (/\bweb\b/.test(text) || /\bwebsite|site|capture|wayback\b/.test(text)) {
    output.add("web");
  }
  return Array.from(output);
}

function sanitizePhrase(value: string): string {
  return value
    .replace(/"/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildTerms(topic: string | undefined, fallback: string): string[] {
  if (topic) {
    return [sanitizePhrase(topic)];
  }
  return fallback
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeYearRange(plan: ParsedPlan, userText: string): {
  queryClause: string | null;
  from: string;
  to: string;
} {
  let from = "";
  let to = "";

  if (plan.years) {
    const normalized = plan.years.replace(/\s+/g, "");
    if (/^\d{4}\.\.\d{4}$/.test(normalized)) {
      const [start, end] = normalized.split("..");
      from = start;
      to = end;
      return { queryClause: `year:[${start} TO ${end}]`, from, to };
    }
    if (/^(\d{4})-(\d{4})$/.test(normalized)) {
      const [, start, end] = normalized.match(/^(\d{4})-(\d{4})$/)!;
      from = start;
      to = end;
      return { queryClause: `year:[${start} TO ${end}]`, from, to };
    }
    if (/^\d{4}$/.test(normalized)) {
      from = normalized;
      to = normalized;
      return { queryClause: `year:${normalized}`, from, to };
    }
  }

  const matches = userText.match(/\b(1[5-9]\d{2}|20\d{2})\b/g);
  if (matches && matches.length > 0) {
    if (matches.length === 1) {
      from = matches[0];
      to = matches[0];
      return { queryClause: `year:${matches[0]}`, from, to };
    }
    const years = matches.map((value) => Number.parseInt(value, 10)).sort((a, b) => a - b);
    from = String(years[0]);
    to = String(years[years.length - 1]);
    return { queryClause: `year:[${years[0]} TO ${years[years.length - 1]}]`, from, to };
  }

  return { queryClause: null, from, to };
}

function buildFilterClauses(include: string[], exclude: string[]): string[] {
  const clauses: string[] = [];
  for (const item of include) {
    const sanitized = sanitizePhrase(item);
    if (!sanitized) {
      continue;
    }
    clauses.push(`(${JSON.stringify(sanitized)})`);
  }
  for (const item of exclude) {
    const sanitized = sanitizePhrase(item);
    if (!sanitized) {
      continue;
    }
    clauses.push(`NOT (${JSON.stringify(sanitized)})`);
  }
  return clauses;
}

/**
 * Build an Internet Archive query payload that will be executed via the backend proxy.
 */
export function buildIAQuery(
  userText: string,
  nsfwMode: NSFWFilterMode,
  aiPlan?: string
): IAQuery {
  const plan = parsePlan(aiPlan);
  const combinedMedia = new Set<string>(plan.mediatypes);
  detectMediaTypes(`${userText} ${plan.topic ?? ""}`).forEach((type) => combinedMedia.add(type));
  const mediatypes = Array.from(combinedMedia);
  const terms = buildTerms(plan.topic, userText);

  const clauses: string[] = [];
  if (terms.length > 0) {
    clauses.push(terms.map((term) => `(${JSON.stringify(term)})`).join(" AND "));
  }
  const filterClauses = buildFilterClauses(plan.include, plan.exclude);
  clauses.push(...filterClauses);

  if (mediatypes.length > 0) {
    const mediaClause = mediatypes.map((type) => `mediatype:${type}`).join(" OR ");
    clauses.push(`(${mediaClause})`);
  }

  const { queryClause: yearClause, from: yearFrom, to: yearTo } = normalizeYearRange(plan, userText);
  if (yearClause) {
    clauses.push(yearClause);
  }

  if (nsfwMode === "nsfw-only") {
    clauses.push(
      "(subject:adult OR subject:nsfw OR subject:porn OR title:porn OR description:porn OR collection:erotica)"
    );
  }

  const query = clauses.length > 0 ? clauses.join(" AND ") : "*:*";

  const filters: SearchFilters = {
    mediaType: mediatypes.length === 1 ? mediatypes[0] : "all",
    yearFrom,
    yearTo,
    language: "",
    sourceTrust: "any",
    availability: "any",
    collection: "",
    uploader: "",
    subject: "",
    nsfwMode,
  };

  return {
    query,
    filters,
    rows: 50,
  };
}

export async function fetchIAResults(
  params: IAQuery,
  page: number
): Promise<{ items: IAItem[]; more: boolean }> {
  const result = await searchArchive(params.query, page, params.rows, params.filters, { aiMode: false });
  if (!result.ok) {
    const message = result.error?.message?.trim() || "AI-assisted search failed.";
    throw new Error(message);
  }

  const archive = result.data.archive ?? {};
  const response = archive.response;
  const docs = Array.isArray(response?.docs) ? (response.docs as ArchiveSearchDoc[]) : [];
  const startIndex = typeof response?.start === "number" ? response.start : Math.max(0, (page - 1) * params.rows);
  const numFound = typeof response?.numFound === "number" ? response.numFound : null;

  const items = await Promise.all(docs.map((doc) => hydrateArchiveDoc(doc)));

  const more = numFound === null ? docs.length === params.rows : startIndex + docs.length < numFound;
  return { items, more };
}

export async function waybackAvailable(url: string): Promise<{
  available: boolean;
  closestUrl?: string;
  timestamp?: string;
}> {
  const result = await getWaybackAvailability(url);
  if (!result.ok) {
    return { available: false };
  }

  const closest = result.data.archived_snapshots?.closest;
  if (!closest || closest.available === false) {
    return { available: false };
  }

  return {
    available: true,
    closestUrl: closest.url,
    timestamp: closest.timestamp,
  };
}

function coerceFirstString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const candidate = coerceFirstString(entry);
      if (candidate) {
        return candidate;
      }
    }
  }
  return undefined;
}

function coerceStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const entries = value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry.length > 0);
    return entries.length > 0 ? entries : undefined;
  }
  if (typeof value === "string") {
    const parts = value
      .split(/[,;]+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    return parts.length > 0 ? parts : undefined;
  }
  return undefined;
}

function normalizeDescription(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const text = value
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter((entry) => entry.length > 0)
      .join(" ");
    return text.length > 0 ? text : undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  return undefined;
}

function extractWaybackFromDoc(doc: ArchiveSearchDoc): IAItem["wayback"] | undefined {
  const explicit = coerceFirstString((doc as Record<string, unknown>).wayback_url ?? doc.links?.wayback);
  if (explicit) {
    return { available: true, closestUrl: explicit };
  }
  return undefined;
}

async function hydrateArchiveDoc(doc: ArchiveSearchDoc): Promise<IAItem> {
  const base: IAItem = {
    identifier: doc.identifier,
    title: coerceFirstString(doc.title),
    mediatype: coerceFirstString(doc.mediatype),
    year: coerceFirstString(doc.year ?? doc.date ?? doc.publicdate),
    creator: coerceFirstString(doc.creator),
    subject: coerceStringArray(doc.subject ?? doc.subjects),
    description: normalizeDescription(doc.description),
  };

  const existingWayback = extractWaybackFromDoc(doc);
  if (existingWayback) {
    base.wayback = existingWayback;
    return base;
  }

  if (base.mediatype === "web") {
    base.wayback = await waybackAvailable(`https://archive.org/details/${doc.identifier}`);
  }

  return base;
}
