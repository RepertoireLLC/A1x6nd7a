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

interface RelevanceAnalysis {
  score: number;
  keywordCoverage: number;
  titleAccuracy: number;
  descriptionStrength: number;
  metadataSupport: number;
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

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000;
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

function computeRelevance(fieldTexts: FieldTexts, normalizedQuery: string, keywords: string[]): RelevanceAnalysis {
  let rawScore = 0;

  const normalizedKeywords = keywords
    .map((keyword) => keyword.toLowerCase().trim())
    .filter((keyword) => keyword.length > 0);
  const uniqueKeywords = Array.from(new Set(normalizedKeywords));
  const matchedKeywords = new Set<string>();
  const coverageMetrics: Partial<Record<keyof FieldTexts, number>> = {};
  const keywordCount = uniqueKeywords.length;

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

    let fieldDirectMatches = 0;
    let fieldFuzzyScore = 0;

    for (const keyword of uniqueKeywords) {
      const occurrences = countOccurrences(normalizedField, keyword);
      if (occurrences > 0) {
        rawScore += occurrences * config.keywordBase * config.weight;
        if (occurrences > 1) {
          rawScore += (occurrences - 1) * 0.05 * config.weight;
        }
        matchedKeywords.add(keyword);
        fieldDirectMatches += 1;
        continue;
      }

      const fuzzyScore = computeFuzzyMatchScore(words, keyword, config);
      if (fuzzyScore > 0) {
        rawScore += fuzzyScore;
        matchedKeywords.add(keyword);
        fieldFuzzyScore += fuzzyScore;
      }
    }

    rawScore += computeProximityBonus(words, uniqueKeywords, config.weight);

    let coverage = 0;
    if (keywordCount > 0) {
      const normalizationBase = config.fuzzyBase * config.weight || 1;
      const normalizedFuzzy = fieldFuzzyScore > 0 ? Math.min(1, fieldFuzzyScore / normalizationBase) : 0;
      coverage = clamp((fieldDirectMatches + normalizedFuzzy * 0.6) / keywordCount, 0, 1);
    }
    coverageMetrics[field] = coverage;
  }

  const score = clamp(1 - Math.exp(-rawScore), 0, 1);
  const keywordCoverage = keywordCount > 0 ? matchedKeywords.size / keywordCount : 0;
  const titleAccuracy = coverageMetrics.title ?? 0;
  const descriptionStrength = coverageMetrics.description ?? 0;
  const metadataSupport = Math.max(coverageMetrics.metadata ?? 0, coverageMetrics.fulltext ?? 0);

  return {
    score,
    keywordCoverage,
    titleAccuracy,
    descriptionStrength,
    metadataSupport,
  };
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

function extractYearsFromQuery(query: string): number[] {
  if (!query) {
    return [];
  }
  const matches = query.matchAll(/(1[0-9]{3}|20[0-9]{2}|2100)s?/gi);
  const years = new Set<number>();
  for (const match of matches) {
    const value = match[1];
    if (value) {
      years.add(Number.parseInt(value, 10));
    }
  }
  return [...years];
}

function gatherYearCandidates(doc: ArchiveSearchDoc): number[] {
  const extras = doc as Record<string, unknown>;
  const yearValues = [doc.year, doc.date, doc.publicdate, extras.public_date, extras.publicDate];
  const candidates: number[] = [];
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
  return candidates;
}

function scoreHistoricalValue(doc: ArchiveSearchDoc, fieldTexts: FieldTexts): number {
  const candidates = gatherYearCandidates(doc);
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

function scoreDateRelevance(doc: ArchiveSearchDoc, context: TruthScoringContext): number {
  const queryYears = extractYearsFromQuery(context.originalQuery);
  const candidates = gatherYearCandidates(doc);

  if (queryYears.length === 0) {
    return candidates.length > 0 ? 0.6 : 0.5;
  }

  if (candidates.length === 0) {
    return 0.2;
  }

  const now = new Date().getUTCFullYear();
  let bestScore = 0.25;

  for (const candidate of candidates) {
    for (const targetYear of queryYears) {
      const diff = Math.abs(candidate - targetYear);
      let score = 0.25;
      if (diff === 0) {
        score = 1;
      } else if (diff <= 1) {
        score = 0.9;
      } else if (diff <= 3) {
        score = 0.8;
      } else if (diff <= 5) {
        score = 0.7;
      } else if (diff <= 10) {
        score = 0.55;
      } else if (diff <= 25) {
        score = 0.4;
      }

      if (candidate > now + 1) {
        score = Math.min(score, 0.2);
      }

      if (score > bestScore) {
        bestScore = score;
      }
    }
  }

  return clamp(bestScore, 0, 1);
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

function hasStructuredData(value: unknown): boolean {
  if (!value) {
    return false;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => hasStructuredData(entry));
  }
  if (typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length > 0;
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

function scoreCompleteness(doc: ArchiveSearchDoc, fieldTexts: FieldTexts): number {
  const extras = doc as Record<string, unknown>;
  const checks: Array<[unknown, number]> = [
    [doc.title, 1],
    [fieldTexts.description, 1],
    [fieldTexts.metadata, 0.8],
    [fieldTexts.fulltext, 0.6],
    [doc.mediatype, 0.5],
    [doc.creator, 0.5],
    [doc.collection ?? extras.collection, 0.4],
    [doc.subject ?? extras.subject ?? doc.subjects, 0.4],
    [doc.language ?? extras.languages ?? extras.lang, 0.35],
    [doc.publicdate ?? doc.year ?? doc.date, 0.4],
    [doc.thumbnail, 0.3],
    [doc.links, 0.25],
    [doc.original_url ?? extras.original ?? extras.originalurl, 0.25],
    [extras.files_count, 0.2],
    [extras.item_size, 0.15],
  ];

  let available = 0;
  let total = 0;

  for (const [value, weight] of checks) {
    if (weight <= 0) {
      continue;
    }
    total += weight;
    if (hasStructuredData(value)) {
      available += weight;
    }
  }

  if (total <= 0) {
    return 0.5;
  }

  return clamp(available / total, 0, 1);
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
  const relevanceAnalysis = computeRelevance(fieldTexts, context.normalizedQuery, context.keywords);
  const relevance = context.originalQuery ? relevanceAnalysis.score : 0.2;
  const authenticity = scoreAuthenticity(doc, fieldTexts);
  const historicalValue = scoreHistoricalValue(doc, fieldTexts);
  const transparency = scoreTransparency(doc, fieldTexts);
  const completeness = scoreCompleteness(doc, fieldTexts);
  const dateRelevance = scoreDateRelevance(doc, context);
  const keywordCoverage = clamp(
    context.originalQuery ? relevanceAnalysis.keywordCoverage : 0,
    0,
    1,
  );

  const combined = clamp(
    relevance * 0.32 +
      authenticity * 0.22 +
      historicalValue * 0.1 +
      transparency * 0.1 +
      completeness * 0.1 +
      dateRelevance * 0.08 +
      keywordCoverage * 0.08,
    0,
    1,
  );
  // TODO: Future AI-enhanced ranking here.

  const normalizedScore = combined > 0 ? combined : relevance;

  const breakdown: SearchScoreBreakdown = {
    authenticity: roundScore(authenticity),
    historicalValue: roundScore(historicalValue),
    transparency: roundScore(transparency),
    relevance: roundScore(relevance),
    combinedScore: roundScore(normalizedScore),
    trustLevel: determineTrustLevel(authenticity),
    titleAccuracy: roundScore(relevanceAnalysis.titleAccuracy),
    descriptionStrength: roundScore(relevanceAnalysis.descriptionStrength),
    keywordCoverage: roundScore(keywordCoverage),
    dateRelevance: roundScore(dateRelevance),
    completeness: roundScore(completeness),
  };

  return { score: breakdown.combinedScore, breakdown };
}

