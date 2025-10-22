import { tokenizeQuery, expandSynonyms, getSynonymDictionary } from "./queryExpansion";
import { stripDiacritics } from "./textNormalization";

type Availability = "online" | "archived-only" | "offline";

type TrustLevel = "high" | "medium" | "low";

export interface SearchScoreBreakdown {
  keywordRelevance: number;
  semanticRelevance: number;
  documentQuality: number;
  popularityScore: number;
  combinedScore: number;
}

export interface ResultAnalysis {
  breakdown: SearchScoreBreakdown;
  availability: Availability;
  trustLevel: TrustLevel;
  language: string | null;
}

const MAX_TOKEN_SAMPLE = 80;

export function scoreArchiveRecord(record: Record<string, unknown>, query: string): ResultAnalysis {
  const textTokens = gatherDocumentTokens(record);
  const textTokenSet = new Set(textTokens);
  const { normalized: queryTokens } = tokenizeQuery(query);

  const keywordRelevance = computeKeywordRelevance(queryTokens, textTokenSet);
  const semanticRelevance = computeSemanticRelevance(queryTokens, textTokenSet);
  const documentQuality = computeDocumentQuality(record);
  const popularityScore = computePopularityScore(record);

  const combinedScore = clamp(
    keywordRelevance * 0.5 + semanticRelevance * 0.3 + documentQuality * 0.1 + popularityScore * 0.1,
    0,
    1
  );

  return {
    breakdown: {
      keywordRelevance: formatScore(keywordRelevance),
      semanticRelevance: formatScore(semanticRelevance),
      documentQuality: formatScore(documentQuality),
      popularityScore: formatScore(popularityScore),
      combinedScore: formatScore(combinedScore),
    },
    availability: determineAvailability(record),
    trustLevel: determineTrustLevel(record, popularityScore),
    language: extractLanguage(record),
  };
}

function gatherDocumentTokens(record: Record<string, unknown>): string[] {
  const values: string[] = [];

  const append = (input: unknown) => {
    if (!input) {
      return;
    }
    if (typeof input === "string") {
      values.push(input);
      return;
    }
    if (Array.isArray(input)) {
      for (const entry of input) {
        append(entry);
      }
    }
  };

  append(record.title);
  append(record.description);
  append(record.identifier);
  append(record.creator);
  append(record.subject);
  append(record.collection);
  append(record.keywords);
  append(record.tags);
  append(record.topic);
  append(record.topics);

  const metadata = record.metadata;
  if (metadata && typeof metadata === "object") {
    const data = metadata as Record<string, unknown>;
    append(data.title);
    append(data.description);
    append(data.subject);
    append(data.keywords);
  }

  const combined = stripDiacritics(values.join(" ")).toLowerCase();
  const tokens = combined
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  if (tokens.length <= MAX_TOKEN_SAMPLE) {
    return tokens;
  }

  return tokens.slice(0, MAX_TOKEN_SAMPLE);
}

function computeKeywordRelevance(queryTokens: string[], docTokens: Set<string>): number {
  if (queryTokens.length === 0 || docTokens.size === 0) {
    return 0;
  }
  let matches = 0;
  for (const token of queryTokens) {
    if (docTokens.has(token)) {
      matches += 1;
    }
  }
  return matches / queryTokens.length;
}

function computeSemanticRelevance(queryTokens: string[], docTokens: Set<string>): number {
  if (queryTokens.length === 0 || docTokens.size === 0) {
    return 0;
  }

  const synonymMap = new Map<string, string[]>();
  for (const token of queryTokens) {
    synonymMap.set(token, expandSynonyms([token]));
  }

  let scoreTotal = 0;
  for (const token of queryTokens) {
    let best = docTokens.has(token) ? 1 : 0;

    const tokenSynonyms = synonymMap.get(token) ?? [];
    for (const synonym of tokenSynonyms) {
      if (docTokens.has(synonym)) {
        best = Math.max(best, 0.85);
        break;
      }
    }

    if (best < 1) {
      for (const candidate of docTokens) {
        const similarity = computeTokenSimilarity(token, candidate);
        if (similarity > best) {
          best = similarity;
        }
        if (best >= 0.99) {
          break;
        }
      }
    }

    scoreTotal += best;
  }

  const average = scoreTotal / queryTokens.length;
  return clamp(average, 0, 1);
}

function computeDocumentQuality(record: Record<string, unknown>): number {
  let score = 0;
  if (hasString(record.title)) {
    score += 0.25;
  }
  if (hasString(record.description)) {
    score += 0.25;
  }
  if (hasString(record.creator)) {
    score += 0.2;
  }
  if (hasString(record.year) || hasString(record.date) || hasString(record.publicdate)) {
    score += 0.15;
  }
  if (hasString(record.thumbnail) || hasString(record.image)) {
    score += 0.1;
  }
  if (hasString(record.original_url) || hasString(record.originalurl)) {
    score += 0.05;
  }
  return clamp(score, 0, 1);
}

function computePopularityScore(record: Record<string, unknown>): number {
  const downloads = extractNumber(record.downloads);
  if (!downloads || downloads <= 0) {
    return 0;
  }
  const normalized = Math.log10(downloads + 1) / 4;
  return clamp(normalized, 0, 1);
}

function determineAvailability(record: Record<string, unknown>): Availability {
  const originalUrl = coerceString(record.original_url) ?? coerceString(record.originalurl);
  if (originalUrl) {
    return "online";
  }
  const links = record.links && typeof record.links === "object" ? (record.links as Record<string, unknown>) : null;
  if (links) {
    const linkOriginal = coerceString(links.original);
    if (linkOriginal) {
      return "online";
    }
    const wayback = coerceString(links.wayback);
    if (wayback) {
      return "archived-only";
    }
  }
  return "archived-only";
}

function determineTrustLevel(record: Record<string, unknown>, popularity: number): TrustLevel {
  const collectionValues = normalizeList(record.collection);
  const curatedCollections = new Set([
    "smithsonian",
    "library_of_congress",
    "gutenberg",
    "naropa",
    "prelinger",
    "opensource_audio",
  ]);

  let score = popularity;
  for (const collection of collectionValues) {
    if (curatedCollections.has(collection)) {
      score += 0.3;
    }
  }

  if (score >= 0.8) {
    return "high";
  }
  if (score >= 0.4) {
    return "medium";
  }
  return "low";
}

function extractLanguage(record: Record<string, unknown>): string | null {
  const languageField = record.language ?? record.languages ?? record.lang;
  if (!languageField) {
    return null;
  }
  if (typeof languageField === "string") {
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

function computeTokenSimilarity(a: string, b: string): number {
  if (a === b) {
    return 1;
  }
  const distance = levenshteinDistance(a, b);
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) {
    return 1;
  }
  const similarity = 1 - distance / maxLen;
  return clamp(similarity, 0, 1);
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  const aLength = a.length;
  const bLength = b.length;

  for (let i = 0; i <= bLength; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= aLength; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= bLength; i++) {
    for (let j = 1; j <= aLength; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[bLength][aLength];
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
      .split(/[,;]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0);
  }
  return [];
}

function hasString(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => typeof entry === "string" && entry.trim().length > 0);
  }
  return false;
}

function extractNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number.parseFloat(trimmed.replace(/[,\s]+/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function coerceString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function formatScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function getQuerySynonyms(): Record<string, readonly string[]> {
  return getSynonymDictionary();
}
