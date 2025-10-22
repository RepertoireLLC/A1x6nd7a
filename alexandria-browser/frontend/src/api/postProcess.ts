import type {
  ArchiveSearchDoc,
  ArchiveSearchResponse,
  SearchFilters,
  SearchScoreBreakdown,
  SourceTrustLevel
} from "../types";

type LinkStatus = "online" | "archived-only" | "offline";

const SYNONYM_DICTIONARY: Record<string, readonly string[]> = {
  book: ["books", "text", "manuscript", "volume"],
  books: ["book", "texts", "library"],
  history: ["historical", "archives", "past", "record"],
  archive: ["archives", "library", "repository"],
  archives: ["archive", "library", "repository"],
  document: ["documents", "record", "manuscript"],
  documents: ["document", "records", "files"],
  video: ["film", "movies", "footage"],
  movies: ["video", "films", "cinema"],
  audio: ["sound", "recording", "music"],
  music: ["audio", "recording", "sound"],
  image: ["images", "photo", "photograph", "picture"],
  images: ["image", "photos", "photographs", "pictures"],
  data: ["dataset", "statistics", "records"],
  dataset: ["data", "datasets", "collection"],
  climate: ["weather", "environment", "meteorology"],
  science: ["scientific", "research", "study"],
  technology: ["tech", "computing", "digital"],
  newspaper: ["news", "press", "journal"],
  news: ["newspaper", "press", "journalism"],
  education: ["learning", "teaching", "academic"],
  lecture: ["lectures", "talk", "presentation"],
  lectures: ["lecture", "talks", "presentations"],
  poetry: ["poem", "literature", "verse"],
  software: ["program", "application", "code"],
  game: ["games", "gaming", "playable"],
  games: ["game", "gaming", "playable"],
};

const CURATED_COLLECTIONS = new Set([
  "smithsonian",
  "library_of_congress",
  "gutenberg",
  "naropa",
  "prelinger",
  "opensource_audio",
]);

export function postProcessDirectSearchPayload(
  payload: ArchiveSearchResponse,
  query: string,
  filters: SearchFilters
): ArchiveSearchResponse {
  const response = payload.response ?? {};
  const docs = Array.isArray(response.docs) ? response.docs : [];

  const annotatedDocs = docs.map((doc) => annotateDoc(doc, query));
  const filteredDocs = annotatedDocs.filter((doc) => matchesClientFilters(doc, filters));

  const originalCount =
    typeof response.numFound === "number" && Number.isFinite(response.numFound)
      ? response.numFound
      : docs.length;

  const filteredCount = filteredDocs.length;

  return {
    ...payload,
    response: {
      ...response,
      docs: filteredDocs,
      numFound: filteredCount,
    },
    original_numFound: originalCount,
    filtered_count: filteredCount,
  };
}

function annotateDoc(doc: ArchiveSearchDoc, query: string): ArchiveSearchDoc {
  const analysis = scoreDocument(doc, query);
  const language = analysis.language ?? (typeof doc.language === "string" ? doc.language : null);

  return {
    ...doc,
    score: analysis.breakdown.combinedScore,
    score_breakdown: analysis.breakdown,
    availability: analysis.availability,
    source_trust: analysis.trustLevel,
    language,
  };
}

function scoreDocument(doc: ArchiveSearchDoc, query: string): {
  breakdown: SearchScoreBreakdown;
  availability: LinkStatus;
  trustLevel: SourceTrustLevel;
  language: string | null;
} {
  const tokens = gatherDocumentTokens(doc);
  const tokenSet = new Set(tokens);
  const queryTokens = tokenizeQuery(query);

  const keywordRelevance = computeKeywordRelevance(queryTokens, tokenSet);
  const semanticRelevance = computeSemanticRelevance(queryTokens, tokenSet);
  const documentQuality = computeDocumentQuality(doc);
  const popularityScore = computePopularityScore(doc.downloads);

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
    availability: determineAvailability(doc),
    trustLevel: determineTrustLevel(doc, popularityScore),
    language: extractLanguage(doc),
  };
}

function gatherDocumentTokens(doc: ArchiveSearchDoc): string[] {
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

  append(doc.title);
  append(doc.description);
  append(doc.identifier);
  append(doc.creator);
  append(doc.collection);

  const combined = stripDiacritics(values.join(" ")).toLowerCase();
  return combined
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
    .slice(0, 80);
}

function tokenizeQuery(query: string): string[] {
  return stripDiacritics(query)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
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

  let total = 0;
  for (const token of queryTokens) {
    let best = docTokens.has(token) ? 1 : 0;

    const synonyms = expandSynonyms([token]);
    for (const synonym of synonyms) {
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

    total += best;
  }

  return clamp(total / queryTokens.length, 0, 1);
}

function computeDocumentQuality(doc: ArchiveSearchDoc): number {
  let score = 0;
  if (hasString(doc.title)) {
    score += 0.25;
  }
  if (hasString(doc.description)) {
    score += 0.25;
  }
  if (hasString(doc.creator)) {
    score += 0.2;
  }
  if (hasString(doc.year) || hasString(doc.date) || hasString(doc.publicdate)) {
    score += 0.15;
  }
  if (hasString(doc.thumbnail)) {
    score += 0.1;
  }
  if (hasString(doc.original_url) || hasString((doc as Record<string, unknown>).originalurl)) {
    score += 0.05;
  }
  return clamp(score, 0, 1);
}

function computePopularityScore(downloads: ArchiveSearchDoc["downloads"]): number {
  const value = extractNumber(downloads);
  if (!value || value <= 0) {
    return 0;
  }
  const normalized = Math.log10(value + 1) / 4;
  return clamp(normalized, 0, 1);
}

function determineAvailability(doc: ArchiveSearchDoc): LinkStatus {
  if (doc.original_url) {
    return "online";
  }
  const links = doc.links;
  if (links) {
    if (links.original) {
      return "online";
    }
    if (links.wayback) {
      return "archived-only";
    }
  }
  return "archived-only";
}

function determineTrustLevel(doc: ArchiveSearchDoc, popularity: number): SourceTrustLevel {
  const collections = normalizeList(doc.collection);
  let score = popularity;
  for (const entry of collections) {
    if (CURATED_COLLECTIONS.has(entry)) {
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

function extractLanguage(doc: ArchiveSearchDoc): string | null {
  const languageField = doc.language ?? (doc as Record<string, unknown>).languages ?? (doc as Record<string, unknown>).lang;
  if (!languageField) {
    return null;
  }
  if (typeof languageField === "string" && languageField.trim()) {
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

function matchesClientFilters(doc: ArchiveSearchDoc, filters: SearchFilters): boolean {
  const languageFilter = filters.language.trim().toLowerCase();
  if (languageFilter) {
    const languageValues = normalizeList(doc.language ?? (doc as Record<string, unknown>).languages ?? (doc as Record<string, unknown>).lang);
    if (languageValues.length === 0) {
      return false;
    }
    if (!languageValues.some((entry) => entry.includes(languageFilter) || entry.startsWith(languageFilter))) {
      return false;
    }
  }

  const sourceTrustFilter = filters.sourceTrust.trim().toLowerCase();
  if (sourceTrustFilter && sourceTrustFilter !== "any") {
    const trustValue = (doc.source_trust ?? doc.source_trust_level ?? "").toString().toLowerCase();
    if (!trustValue || trustValue !== sourceTrustFilter) {
      return false;
    }
  }

  const availabilityFilter = filters.availability.trim().toLowerCase();
  if (availabilityFilter && availabilityFilter !== "any") {
    const availabilityValue = (doc.availability ?? "").toString().toLowerCase();
    if (!availabilityValue || availabilityValue !== availabilityFilter) {
      return false;
    }
  }

  const nsfwMode = filters.nsfwMode;
  if (nsfwMode && nsfwMode !== "off") {
    const isFlagged = doc.nsfw === true;
    const severity = (doc.nsfwLevel ?? doc.nsfw_level ?? "").toString().toLowerCase();

    if (nsfwMode === "only") {
      return isFlagged;
    }

    if (nsfwMode === "safe" && isFlagged) {
      return false;
    }

    if (nsfwMode === "moderate" && severity === "explicit") {
      return false;
    }
  }

  return true;
}

function expandSynonyms(tokens: string[]): string[] {
  const synonyms: string[] = [];
  for (const token of tokens) {
    const entries = SYNONYM_DICTIONARY[token];
    if (entries) {
      for (const entry of entries) {
        synonyms.push(entry);
      }
    }
  }
  return synonyms;
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
  return clamp(1 - distance / maxLen, 0, 1);
}

function levenshteinDistance(a: string, b: string): number {
  const rows = b.length + 1;
  const cols = a.length + 1;
  const matrix = Array.from({ length: rows }, (_, rowIndex) => new Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i++) {
    matrix[i][0] = i;
  }
  for (let j = 0; j < cols; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
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

  return matrix[rows - 1][cols - 1];
}

function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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
