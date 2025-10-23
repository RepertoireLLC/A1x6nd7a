import type { ArchiveSearchDoc, SearchScoreBreakdown } from "../types";

interface FieldTexts {
  title: string;
  description: string;
  metadata: string;
  fulltext: string;
}

export interface TruthScoringContext {
  readonly originalQuery: string;
  readonly normalizedQuery: string;
  readonly keywords: string[];
}

export interface TruthScoreResult {
  score: number;
  breakdown: SearchScoreBreakdown;
}

const STOP_WORDS = new Set<string>([
  "a",
  "about",
  "above",
  "after",
  "again",
  "against",
  "all",
  "am",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "because",
  "been",
  "before",
  "being",
  "below",
  "between",
  "both",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "doing",
  "down",
  "during",
  "each",
  "few",
  "for",
  "from",
  "further",
  "had",
  "has",
  "have",
  "having",
  "he",
  "her",
  "here",
  "hers",
  "herself",
  "him",
  "himself",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "itself",
  "just",
  "me",
  "more",
  "most",
  "my",
  "myself",
  "no",
  "nor",
  "not",
  "now",
  "of",
  "off",
  "on",
  "once",
  "only",
  "or",
  "other",
  "our",
  "ours",
  "ourselves",
  "out",
  "over",
  "own",
  "same",
  "she",
  "should",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "themselves",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "too",
  "under",
  "until",
  "up",
  "very",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "whom",
  "why",
  "with",
  "would",
  "you",
  "your",
  "yours",
  "yourself",
  "yourselves",
]);

const FIELD_CONFIG = {
  title: { weight: 1, keywordBase: 0.7, fuzzyBase: 0.3 },
  description: { weight: 0.85, keywordBase: 0.55, fuzzyBase: 0.25 },
  metadata: { weight: 0.6, keywordBase: 0.45, fuzzyBase: 0.22 },
  fulltext: { weight: 0.4, keywordBase: 0.3, fuzzyBase: 0.18 },
} as const;

const PROXIMITY_BONUS = [
  { distance: 3, bonus: 0.2 },
  { distance: 6, bonus: 0.12 },
  { distance: 10, bonus: 0.08 },
] as const;

const TRUSTED_COLLECTIONS = new Set([
  "smithsonian",
  "library_of_congress",
  "gutenberg",
  "naropa",
  "prelinger",
  "opensource_audio",
  "americanlibraries",
  "americana",
  "biodiversity",
  "brooklynmuseum",
  "getty",
  "moa",
  "thomasjeffersonlibrary",
  "universallibrary",
  "usnationalarchives",
  "wellcomelibrary",
]);

const INSTITUTION_KEYWORDS = [
  "library",
  "university",
  "museum",
  "archives",
  "archive",
  "institution",
  "college",
  "press",
  "society",
  "foundation",
  "historical",
  "history",
  "national",
  "government",
  "gov",
  "federal",
  "state",
  "city",
  "county",
  "records",
  "official",
  "academy",
  "research",
  "library",
];

const PRIMARY_SOURCE_HINTS = [
  "manuscript",
  "manuscripts",
  "diary",
  "diaries",
  "letter",
  "letters",
  "journal",
  "journals",
  "log",
  "logs",
  "transcript",
  "transcripts",
  "minutes",
  "primary source",
  "primary-source",
  "official record",
  "official records",
  "official report",
  "official reports",
  "original publication",
  "first-hand",
  "first hand",
];

const TRUSTED_TLDS = [
  ".gov",
  ".mil",
  ".edu",
  ".museum",
  ".int",
];

const MAX_KEYWORDS = 24;

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]+>/g, " ");
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeForScoring(text: string): string {
  return normalizeWhitespace(stripHtml(text).toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " "));
}

function appendValue(target: string[], value: unknown): void {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value === "string") {
    const normalized = normalizeWhitespace(stripHtml(value));
    if (normalized) {
      target.push(normalized);
    }
    return;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    target.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      appendValue(target, entry);
    }
    return;
  }
  if (typeof value === "object") {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      appendValue(target, entry);
    }
  }
}

function buildFieldTexts(doc: ArchiveSearchDoc): FieldTexts {
  const titleParts: string[] = [];
  appendValue(titleParts, doc.title ?? doc.identifier);
  if (titleParts.length === 0 && doc.identifier) {
    appendValue(titleParts, doc.identifier);
  }

  const descriptionParts: string[] = [];
  appendValue(descriptionParts, doc.description);

  const metadataParts: string[] = [];
  appendValue(metadataParts, doc.creator);
  appendValue(metadataParts, doc.collection);
  appendValue(metadataParts, doc.language);

  const docExtras = doc as Record<string, unknown>;
  appendValue(metadataParts, docExtras.subject);
  appendValue(metadataParts, docExtras.tags);
  appendValue(metadataParts, docExtras.keywords);
  appendValue(metadataParts, docExtras.topic);
  appendValue(metadataParts, docExtras.topics);
  appendValue(metadataParts, docExtras.publisher);
  appendValue(metadataParts, docExtras.contributor);
  appendValue(metadataParts, docExtras.series);
  appendValue(metadataParts, doc.identifier);

  const fullTextParts: string[] = [];
  appendValue(fullTextParts, docExtras.fulltext);
  appendValue(fullTextParts, docExtras.text);

  return {
    title: normalizeWhitespace(titleParts.join(" ")),
    description: normalizeWhitespace(descriptionParts.join(" ")),
    metadata: normalizeWhitespace(metadataParts.join(" ")),
    fulltext: normalizeWhitespace(fullTextParts.join(" ")),
  };
}

function normalizeQueryString(query: string): string {
  return normalizeForScoring(query);
}

function extractKeywords(query: string): string[] {
  const normalized = normalizeQueryString(query);
  if (!normalized) {
    return [];
  }

  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.length === 0) {
    return [];
  }

  const filtered = tokens.filter((token) => token.length > 2 && !STOP_WORDS.has(token));
  const source = filtered.length > 0 ? filtered : tokens;
  const keywords: string[] = [];
  const seen = new Set<string>();

  for (const token of source) {
    if (!seen.has(token)) {
      seen.add(token);
      keywords.push(token);
      if (keywords.length >= MAX_KEYWORDS) {
        break;
      }
    }
  }

  return keywords;
}

function tokenize(text: string): string[] {
  const normalized = normalizeForScoring(text);
  if (!normalized) {
    return [];
  }
  return normalized.split(" ").filter(Boolean);
}

function countOccurrences(text: string, term: string): number {
  if (!text || !term) {
    return 0;
  }
  const haystack = text.toLowerCase();
  const needle = term.toLowerCase();
  if (!haystack.includes(needle)) {
    return 0;
  }
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let i = 0; i < rows; i += 1) {
    matrix[i][0] = i;
  }
  for (let j = 0; j < cols; j += 1) {
    matrix[0][j] = j;
  }

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + 1,
        );
      }
    }
  }

  return matrix[a.length][b.length];
}

function computeFuzzyMatchScore(words: string[], keyword: string, config: (typeof FIELD_CONFIG)[keyof typeof FIELD_CONFIG]): number {
  if (!keyword || words.length === 0) {
    return 0;
  }
  const normalizedKeyword = keyword.toLowerCase();
  let bestScore = 0;

  for (const word of words) {
    if (word === normalizedKeyword) {
      continue;
    }
    const distance = levenshteinDistance(word, normalizedKeyword);
    if (distance === 0 || distance > 2) {
      continue;
    }
    const maxLength = Math.max(word.length, normalizedKeyword.length) || 1;
    const closeness = 1 - distance / maxLength;
    if (closeness <= 0.35) {
      continue;
    }
    const bonus = Math.max(0.1, closeness * config.fuzzyBase) * config.weight;
    if (bonus > bestScore) {
      bestScore = bonus;
    }
  }

  return bestScore;
}

function computeProximityBonus(words: string[], keywords: string[], weight: number): number {
  if (keywords.length < 2 || words.length === 0) {
    return 0;
  }
  const keywordSet = new Set(keywords.map((keyword) => keyword.toLowerCase()));
  const positions: Array<{ keyword: string; index: number }> = [];

  words.forEach((word, index) => {
    keywordSet.forEach((keyword) => {
      if (word === keyword || word.includes(keyword)) {
        positions.push({ keyword, index });
      }
    });
  });

  if (positions.length < 2) {
    return 0;
  }

  let minDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = i + 1; j < positions.length; j += 1) {
      if (positions[i].keyword === positions[j].keyword) {
        continue;
      }
      const distance = Math.abs(positions[i].index - positions[j].index);
      if (distance < minDistance) {
        minDistance = distance;
      }
    }
  }

  if (!Number.isFinite(minDistance)) {
    return 0;
  }

  for (const { distance, bonus } of PROXIMITY_BONUS) {
    if (minDistance <= distance) {
      return bonus * weight;
    }
  }

  return 0;
}

function computeRelevance(fieldTexts: FieldTexts, normalizedQuery: string, keywords: string[]): number {
  let rawScore = 0;

  for (const [field, text] of Object.entries(fieldTexts) as Array<[keyof FieldTexts, string]>) {
    if (!text) {
      continue;
    }
    const config = FIELD_CONFIG[field as keyof typeof FIELD_CONFIG];
    if (!config) {
      continue;
    }
    const normalizedField = normalizeForScoring(text);
    if (!normalizedField) {
      continue;
    }
    const words = tokenize(normalizedField);

    if (normalizedQuery && normalizedField.includes(normalizedQuery)) {
      rawScore += 1 * config.weight;
    }

    for (const keyword of keywords) {
      const occurrences = countOccurrences(normalizedField, keyword);
      if (occurrences > 0) {
        rawScore += occurrences * config.keywordBase * config.weight;
        if (occurrences > 1) {
          rawScore += (occurrences - 1) * 0.05 * config.weight;
        }
      } else {
        rawScore += computeFuzzyMatchScore(words, keyword, config);
      }
    }

    rawScore += computeProximityBonus(words, keywords, config.weight);
  }

  return clamp(1 - Math.exp(-rawScore), 0, 1);
}

function toArray(value: unknown): string[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[,;\n]+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

function includesKeyword(source: string | string[] | undefined, keywords: string[]): boolean {
  if (!source) {
    return false;
  }
  const values = Array.isArray(source) ? source : [source];
  for (const value of values) {
    const lowered = value.toLowerCase();
    if (keywords.some((keyword) => lowered.includes(keyword))) {
      return true;
    }
  }
  return false;
}

function scoreAuthenticity(doc: ArchiveSearchDoc, fieldTexts: FieldTexts): number {
  let score = 0;
  const collectionValues = toArray(doc.collection).map((value) => value.toLowerCase());
  const uniqueCollections = new Set(collectionValues);

  uniqueCollections.forEach((entry) => {
    if (TRUSTED_COLLECTIONS.has(entry)) {
      score += 0.45;
    }
    if (INSTITUTION_KEYWORDS.some((keyword) => entry.includes(keyword))) {
      score += 0.12;
    }
  });

  const creatorText = Array.isArray(doc.creator) ? doc.creator.join(" ") : doc.creator ?? "";
  const publisherText = (doc as Record<string, unknown>).publisher;
  if (typeof creatorText === "string" && creatorText) {
    const lowered = creatorText.toLowerCase();
    if (INSTITUTION_KEYWORDS.some((keyword) => lowered.includes(keyword))) {
      score += 0.18;
    }
  }
  if (typeof publisherText === "string" && publisherText.trim()) {
    const lowered = publisherText.toLowerCase();
    if (INSTITUTION_KEYWORDS.some((keyword) => lowered.includes(keyword))) {
      score += 0.15;
    }
  }

  const docExtras = doc as Record<string, unknown>;
  const metadata = docExtras.metadata as Record<string, unknown> | undefined;
  if (metadata) {
    const metadataPublisher = metadata.publisher;
    if (typeof metadataPublisher === "string" && metadataPublisher.trim()) {
      const lowered = metadataPublisher.toLowerCase();
      if (INSTITUTION_KEYWORDS.some((keyword) => lowered.includes(keyword))) {
        score += 0.12;
      }
    }
  }

  const originalUrl = doc.original_url ?? (doc as Record<string, unknown>).originalurl;
  if (typeof originalUrl === "string" && originalUrl.trim()) {
    try {
      const url = new URL(originalUrl);
      const host = url.hostname.toLowerCase();
      if (TRUSTED_TLDS.some((ending) => host.endsWith(ending))) {
        score += 0.3;
      }
      if (host.includes("archive.org")) {
        score += 0.1;
      }
    } catch (error) {
      // ignore malformed URLs
    }
  }

  const fieldBundle = `${fieldTexts.title} ${fieldTexts.metadata}`.toLowerCase();
  if (PRIMARY_SOURCE_HINTS.some((hint) => fieldBundle.includes(hint))) {
    score += 0.1;
  }

  return clamp(score, 0, 1);
}

function extractYear(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 1000 && value <= 3000) {
      return Math.trunc(value);
    }
    return null;
  }
  if (typeof value === "string") {
    const match = value.match(/(1[0-9]{3}|20[0-9]{2}|2100)/);
    if (match) {
      const year = Number.parseInt(match[1], 10);
      if (year >= 1000 && year <= 3000) {
        return year;
      }
    }
  }
  return null;
}

function scoreHistoricalValue(doc: ArchiveSearchDoc, fieldTexts: FieldTexts): number {
  const candidates: number[] = [];
  const extras = doc as Record<string, unknown>;
  const yearValues = [doc.year, doc.date, doc.publicdate, extras.public_date, extras.publicDate];
  for (const value of yearValues) {
    const year = extractYear(value);
    if (year !== null) {
      candidates.push(year);
    }
  }
  if (candidates.length === 0) {
    const identifierYear = extractYear(doc.identifier);
    if (identifierYear !== null) {
      candidates.push(identifierYear);
    }
  }

  const now = new Date().getUTCFullYear();
  const year = candidates.length > 0 ? Math.min(...candidates) : null;
  let score = 0.35;
  if (year !== null) {
    const age = clamp(now - year, 0, 1000);
    if (age >= 150) {
      score = 1;
    } else if (age >= 120) {
      score = 0.9;
    } else if (age >= 80) {
      score = 0.75;
    } else if (age >= 50) {
      score = 0.6;
    } else if (age >= 30) {
      score = 0.45;
    } else if (age >= 10) {
      score = 0.35;
    } else {
      score = 0.25;
    }
  }

  const contextText = `${fieldTexts.description} ${fieldTexts.metadata}`.toLowerCase();
  if (PRIMARY_SOURCE_HINTS.some((hint) => contextText.includes(hint))) {
    score += 0.1;
  }

  return clamp(score, 0, 1);
}

function hasMeaningfulText(value: unknown): boolean {
  if (!value) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => typeof entry === "string" && entry.trim().length > 0);
  }
  return false;
}

function scoreTransparency(doc: ArchiveSearchDoc, fieldTexts: FieldTexts): number {
  let signals = 0;
  let total = 0;

  const extras = doc as Record<string, unknown>;

  const transparencyChecks: Array<[unknown, number]> = [
    [doc.creator, 1],
    [doc.description, 1],
    [extras.publisher, 1],
    [extras.contributor, 1],
    [doc.language, 1],
    [extras.subject, 1],
    [extras.tags, 1],
    [extras.keywords, 1],
    [extras.source, 1],
    [extras.references, 1],
  ];

  for (const [value, weight] of transparencyChecks) {
    if (weight <= 0) {
      continue;
    }
    total += weight;
    if (hasMeaningfulText(value)) {
      signals += weight;
    }
  }

  if (hasMeaningfulText(fieldTexts.metadata)) {
    signals += 1;
    total += 1;
  }

  if (doc.links && typeof doc.links === "object") {
    signals += 0.5;
    total += 0.5;
  }

  let score = total > 0 ? signals / total : 0.35;

  const descriptionText = fieldTexts.description.toLowerCase();
  if (descriptionText.includes("http") || descriptionText.includes("doi") || descriptionText.includes("isbn")) {
    score += 0.1;
  }

  return clamp(score, 0, 1);
}

function determineTrustLevel(authenticity: number): "high" | "medium" | "low" {
  if (authenticity >= 0.6) {
    return "high";
  }
  if (authenticity >= 0.4) {
    return "medium";
  }
  return "low";
}

export function createTruthScoringContext(query: string): TruthScoringContext {
  const trimmed = query.trim();
  return {
    originalQuery: trimmed,
    normalizedQuery: normalizeQueryString(trimmed),
    keywords: extractKeywords(trimmed),
  };
}

export function scoreArchiveDocTruth(doc: ArchiveSearchDoc, context: TruthScoringContext): TruthScoreResult {
  const fieldTexts = buildFieldTexts(doc);
  const relevance = context.originalQuery ? computeRelevance(fieldTexts, context.normalizedQuery, context.keywords) : 0.2;
  const authenticity = scoreAuthenticity(doc, fieldTexts);
  const historicalValue = scoreHistoricalValue(doc, fieldTexts);
  const transparency = scoreTransparency(doc, fieldTexts);

  const combined = clamp(
    relevance * 0.4 +
      authenticity * 0.3 +
      historicalValue * 0.15 +
      transparency * 0.15,
    0,
    1,
  );

  const normalizedScore = combined > 0 ? combined : relevance;

  const breakdown: SearchScoreBreakdown = {
    authenticity: Math.round(authenticity * 1000) / 1000,
    historicalValue: Math.round(historicalValue * 1000) / 1000,
    transparency: Math.round(transparency * 1000) / 1000,
    relevance: Math.round(relevance * 1000) / 1000,
    combinedScore: Math.round(normalizedScore * 1000) / 1000,
    trustLevel: determineTrustLevel(authenticity),
  };

  return { score: breakdown.combinedScore, breakdown };
}

