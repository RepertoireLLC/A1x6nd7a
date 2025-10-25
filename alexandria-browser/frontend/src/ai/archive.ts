import type { NSFWFilterMode } from "../types";

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
  q: string;
  fields: string[];
  sort: string[];
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

function buildYearClause(plan: ParsedPlan, userText: string): string | null {
  if (plan.years) {
    const normalized = plan.years.replace(/\s+/g, "");
    if (/^\d{4}\.\.\d{4}$/.test(normalized)) {
      const [start, end] = normalized.split("..");
      return `year:[${start} TO ${end}]`;
    }
    if (/^(\d{4})-(\d{4})$/.test(normalized)) {
      const [, start, end] = normalized.match(/^(\d{4})-(\d{4})$/)!;
      return `year:[${start} TO ${end}]`;
    }
    if (/^\d{4}$/.test(normalized)) {
      return `year:${normalized}`;
    }
  }

  const matches = userText.match(/\b(1[5-9]\d{2}|20\d{2})\b/g);
  if (matches && matches.length > 0) {
    if (matches.length === 1) {
      return `year:${matches[0]}`;
    }
    const years = matches.map((value) => Number.parseInt(value, 10)).sort((a, b) => a - b);
    return `year:[${years[0]} TO ${years[years.length - 1]}]`;
  }

  return null;
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
 * Build an Internet Archive advancedsearch query using AI-derived plan data and heuristics.
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

  const yearClause = buildYearClause(plan, userText);
  if (yearClause) {
    clauses.push(yearClause);
  }

  if (nsfwMode === "nsfw-only") {
    clauses.push(
      "(subject:adult OR subject:nsfw OR subject:porn OR title:porn OR description:porn OR collection:erotica)"
    );
  }

  const q = clauses.length > 0 ? clauses.join(" AND ") : "*:*";

  return {
    q,
    fields: ["identifier", "title", "mediatype", "year", "creator", "subject", "description"],
    sort: ["downloads desc", "date desc"],
    rows: 50
  };
}

export async function fetchIAResults(
  params: IAQuery,
  page: number
): Promise<{ items: IAItem[]; more: boolean }> {
  const url = new URL("https://archive.org/advancedsearch.php");
  url.searchParams.set("q", params.q);
  url.searchParams.set("output", "json");
  url.searchParams.set("rows", String(params.rows));
  url.searchParams.set("page", String(page));
  url.searchParams.set("fields", params.fields.join(","));
  params.sort.forEach((value) => url.searchParams.append("sort[]", value));

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw new Error(`IA search failed with status ${response.status}`);
  }
  const json = (await response.json()) as {
    response?: { docs?: any[]; numFound?: number };
  };
  const docs = json.response?.docs ?? [];

  const items = await Promise.all(
    docs.map(async (doc) => {
      const item: IAItem = {
        identifier: doc.identifier,
        title: doc.title,
        mediatype: doc.mediatype,
        year: doc.year,
        creator: Array.isArray(doc.creator) ? doc.creator.join(", ") : doc.creator,
        subject: Array.isArray(doc.subject)
          ? doc.subject
          : doc.subject
          ? [doc.subject]
          : undefined,
        description: Array.isArray(doc.description)
          ? doc.description.join(" ")
          : typeof doc.description === "string"
          ? doc.description
          : undefined
      };

      if (item.mediatype === "web") {
        item.wayback = await waybackAvailable(`https://archive.org/details/${item.identifier}`).catch(() => ({
          available: false
        }));
      }

      return item;
    })
  );

  const total = json.response?.numFound ?? 0;
  const loaded = page * params.rows;
  return {
    items,
    more: loaded < total
  };
}

export async function waybackAvailable(url: string): Promise<{
  available: boolean;
  closestUrl?: string;
  timestamp?: string;
}> {
  const api = new URL("https://archive.org/wayback/available");
  api.searchParams.set("url", url);
  const response = await fetch(api.toString());
  if (!response.ok) {
    return { available: false };
  }
  const json = await response.json();
  const closest = json?.archived_snapshots?.closest;
  if (!closest) {
    return { available: false };
  }
  return {
    available: true,
    closestUrl: closest.url,
    timestamp: closest.timestamp
  };
}
