import { stripDiacritics } from "./textNormalization";

const WILDCARD_MIN_LENGTH = 4;
const MAX_SYNONYMS_PER_TOKEN = 4;
const MAX_SUGGESTIONS = 5;

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

export type QueryTokens = {
  original: string[];
  normalized: string[];
};

export function tokenizeQuery(query: string): QueryTokens {
  const normalized = stripDiacritics(query)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

  return { original: query.split(/\s+/).filter(Boolean), normalized };
}

export function expandWithWildcards(tokens: readonly string[]): string[] {
  const wildcards: string[] = [];
  for (const token of tokens) {
    if (token.length >= WILDCARD_MIN_LENGTH) {
      wildcards.push(`${token}*`);
    }
  }
  return wildcards;
}

export function lookupSynonyms(token: string): string[] {
  const direct = SYNONYM_DICTIONARY[token];
  if (!direct || direct.length === 0) {
    return [];
  }
  const unique = new Set<string>();
  for (const entry of direct) {
    unique.add(entry);
  }
  return Array.from(unique).slice(0, MAX_SYNONYMS_PER_TOKEN);
}

export function expandSynonyms(tokens: readonly string[]): string[] {
  const synonyms: string[] = [];
  for (const token of tokens) {
    for (const synonym of lookupSynonyms(token)) {
      synonyms.push(synonym);
    }
  }
  return synonyms;
}

export function buildHybridSearchExpression(query: string, includeFuzzy: boolean): string {
  const sanitized = query.trim();
  if (!sanitized) {
    return sanitized;
  }

  const { normalized } = tokenizeQuery(sanitized);
  const segments: string[] = [`(${sanitized})`];

  if (includeFuzzy && normalized.length > 0) {
    const fuzzyClause = normalized.map((token) => `${token}~`).join(" ");
    if (fuzzyClause.trim()) {
      segments.push(`(${fuzzyClause})`);
    }
  }

  const wildcardTokens = expandWithWildcards(normalized);
  if (wildcardTokens.length > 0) {
    segments.push(`(${wildcardTokens.join(" ")})`);
  }

  const synonymTokens = expandSynonyms(normalized);
  if (synonymTokens.length > 0) {
    const synonymClause = synonymTokens.map((token) => `"${token}"`).join(" OR ");
    if (synonymClause.trim()) {
      segments.push(`(${synonymClause})`);
    }
  }

  const uniqueSegments = segments.filter((segment, index, array) => array.indexOf(segment) === index);
  return uniqueSegments.join(" OR ");
}

export function suggestAlternativeQueries(query: string): string[] {
  const { normalized } = tokenizeQuery(query);
  if (normalized.length === 0) {
    return [];
  }

  const suggestions = new Set<string>();

  for (const token of normalized) {
    const synonyms = lookupSynonyms(token);
    if (synonyms.length > 0) {
      for (const synonym of synonyms) {
        const suggestion = normalized
          .map((entry) => (entry === token ? synonym : entry))
          .join(" ");
        if (suggestion.trim().toLowerCase() !== query.trim().toLowerCase()) {
          suggestions.add(suggestion);
        }
        if (suggestions.size >= MAX_SUGGESTIONS) {
          return Array.from(suggestions);
        }
      }
    }
  }

  const wildcardSuggestion = normalized
    .map((token) => (token.length >= WILDCARD_MIN_LENGTH ? `${token}*` : token))
    .join(" ");
  if (wildcardSuggestion.trim() && wildcardSuggestion !== query.trim()) {
    suggestions.add(wildcardSuggestion);
  }

  return Array.from(suggestions).slice(0, MAX_SUGGESTIONS);
}

export function getSynonymDictionary(): Record<string, readonly string[]> {
  return SYNONYM_DICTIONARY;
}
