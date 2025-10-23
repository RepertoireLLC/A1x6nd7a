const MEDIA_TYPE_ALIASES = {
  texts: 'texts',
  text: 'texts',
  book: 'texts',
  books: 'texts',
  literature: 'texts',
  audio: 'audio',
  sound: 'audio',
  music: 'audio',
  spokenword: 'audio',
  movies: 'movies',
  movie: 'movies',
  video: 'movies',
  videos: 'movies',
  film: 'movies',
  films: 'movies',
  image: 'image',
  images: 'image',
  photo: 'image',
  photos: 'image',
  picture: 'image',
  pictures: 'image',
  software: 'software',
  program: 'software',
  programs: 'software',
  app: 'software',
  apps: 'software',
  web: 'web',
  website: 'web',
  websites: 'web',
  html: 'web',
  data: 'data',
  dataset: 'data',
  datasets: 'data',
  statistics: 'data',
  stats: 'data',
  collection: 'collection',
  collections: 'collection',
  etree: 'etree',
  tvnews: 'tvnews'
};

const MEDIA_TYPE_KEYS = ['mediatype', 'mediaType', 'media_type', 'type'];

const BASE_FIELD_CONFIG = {
  title: { weight: 1, keywordBase: 0.7, fuzzyBase: 0.3 },
  description: { weight: 0.85, keywordBase: 0.55, fuzzyBase: 0.25 },
  metadata: { weight: 0.6, keywordBase: 0.45, fuzzyBase: 0.22 },
  fulltext: { weight: 0.4, keywordBase: 0.3, fuzzyBase: 0.18 }
};

const MEDIA_TYPE_FIELD_OVERRIDES = {
  texts: {
    description: { weight: 0.95, keywordBase: 0.6 },
    fulltext: { weight: 0.65, keywordBase: 0.45, fuzzyBase: 0.2 }
  },
  audio: {
    description: { weight: 0.9, keywordBase: 0.6 },
    metadata: { weight: 0.75, keywordBase: 0.5 }
  },
  movies: {
    description: { weight: 0.95, keywordBase: 0.6 },
    metadata: { weight: 0.7, keywordBase: 0.5 }
  },
  image: {
    title: { weight: 1.05, keywordBase: 0.78 },
    description: { weight: 0.6, keywordBase: 0.5 },
    metadata: { weight: 0.9, keywordBase: 0.6 }
  },
  software: {
    description: { weight: 0.8, keywordBase: 0.58 },
    metadata: { weight: 0.85, keywordBase: 0.58, fuzzyBase: 0.26 }
  },
  web: {
    metadata: { weight: 0.68, keywordBase: 0.5 },
    fulltext: { weight: 0.5, keywordBase: 0.35 }
  },
  data: {
    metadata: { weight: 0.82, keywordBase: 0.6 },
    description: { weight: 0.72, keywordBase: 0.52 }
  }
};

const PROXIMITY_BONUS = [
  { distance: 3, bonus: 0.2 },
  { distance: 6, bonus: 0.12 },
  { distance: 10, bonus: 0.08 }
];

const STOP_WORDS = new Set([
  'a',
  'about',
  'above',
  'after',
  'again',
  'against',
  'all',
  'am',
  'an',
  'and',
  'any',
  'are',
  'as',
  'at',
  'be',
  'because',
  'been',
  'before',
  'being',
  'below',
  'between',
  'both',
  'but',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'doing',
  'down',
  'during',
  'each',
  'few',
  'for',
  'from',
  'further',
  'had',
  'has',
  'have',
  'having',
  'he',
  'her',
  'here',
  'hers',
  'herself',
  'him',
  'himself',
  'his',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'itself',
  'just',
  'me',
  'more',
  'most',
  'my',
  'myself',
  'no',
  'nor',
  'not',
  'now',
  'of',
  'off',
  'on',
  'once',
  'only',
  'or',
  'other',
  'our',
  'ours',
  'ourselves',
  'out',
  'over',
  'own',
  'same',
  'she',
  'should',
  'so',
  'some',
  'such',
  'than',
  'that',
  'the',
  'their',
  'theirs',
  'them',
  'themselves',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'through',
  'to',
  'too',
  'under',
  'until',
  'up',
  'very',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'while',
  'who',
  'whom',
  'why',
  'with',
  'would',
  'you',
  'your',
  'yours',
  'yourself',
  'yourselves'
]);

const TRUSTED_COLLECTIONS = new Set([
  'smithsonian',
  'library_of_congress',
  'gutenberg',
  'naropa',
  'prelinger',
  'opensource_audio',
  'americanlibraries',
  'americana',
  'biodiversity',
  'brooklynmuseum',
  'getty',
  'moa',
  'thomasjeffersonlibrary',
  'universallibrary',
  'usnationalarchives',
  'wellcomelibrary'
]);

const INSTITUTION_KEYWORDS = [
  'library',
  'university',
  'museum',
  'archives',
  'archive',
  'institution',
  'college',
  'press',
  'society',
  'foundation',
  'historical',
  'history',
  'national',
  'government',
  'gov',
  'federal',
  'state',
  'city',
  'county',
  'records',
  'official',
  'academy',
  'research'
];

const PRIMARY_SOURCE_HINTS = [
  'manuscript',
  'manuscripts',
  'diary',
  'diaries',
  'letter',
  'letters',
  'journal',
  'journals',
  'log',
  'logs',
  'transcript',
  'transcripts',
  'minutes',
  'primary source',
  'primary-source',
  'official record',
  'official records',
  'official report',
  'official reports',
  'original publication',
  'first-hand',
  'first hand'
];

const TRUSTED_TLDS = ['.gov', '.mil', '.edu', '.museum', '.int'];

function clamp(value, min, max) {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function normalizeWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function stripHtml(input) {
  return String(input || '').replace(/<[^>]+>/g, ' ');
}

function normalizeForScoring(text) {
  return normalizeWhitespace(stripHtml(String(text || '')).toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' '));
}

function tokenize(text) {
  const normalized = normalizeForScoring(text);
  if (!normalized) return [];
  return normalized.split(' ').filter(Boolean);
}

function countOccurrences(text, term) {
  if (!text || !term) return 0;
  const haystack = text.toLowerCase();
  const needle = term.toLowerCase();
  if (!haystack.includes(needle)) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function levenshteinDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array(cols).fill(0));

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
          matrix[i - 1][j - 1] + 1
        );
      }
    }
  }

  return matrix[a.length][b.length];
}

function computeFuzzyMatchScore(words, keyword, config) {
  if (!keyword || words.length === 0) return 0;
  const normalizedKeyword = keyword.toLowerCase();
  let bestScore = 0;

  for (const word of words) {
    if (word === normalizedKeyword) continue;
    const distance = levenshteinDistance(word, normalizedKeyword);
    if (distance === 0 || distance > 2) continue;
    const maxLength = Math.max(word.length, normalizedKeyword.length) || 1;
    const closeness = 1 - distance / maxLength;
    if (closeness <= 0.35) continue;
    const bonus = Math.max(0.1, closeness * config.fuzzyBase) * config.weight;
    if (bonus > bestScore) {
      bestScore = bonus;
    }
  }

  return bestScore;
}

function computeProximityBonus(words, keywords, weight) {
  if (keywords.length < 2 || words.length === 0) return 0;
  const keywordSet = new Set(keywords.map((keyword) => keyword.toLowerCase()));
  const positions = [];

  words.forEach((word, index) => {
    keywordSet.forEach((keyword) => {
      if (word === keyword || word.includes(keyword)) {
        positions.push({ keyword, index });
      }
    });
  });

  if (positions.length < 2) return 0;

  let minDistance = Infinity;
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = i + 1; j < positions.length; j += 1) {
      if (positions[i].keyword === positions[j].keyword) continue;
      const distance = Math.abs(positions[i].index - positions[j].index);
      if (distance < minDistance) {
        minDistance = distance;
      }
    }
  }

  if (!Number.isFinite(minDistance)) return 0;

  for (const { distance, bonus } of PROXIMITY_BONUS) {
    if (minDistance <= distance) {
      return bonus * weight;
    }
  }

  return 0;
}

function appendValue(target, value) {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    const normalized = normalizeWhitespace(stripHtml(value));
    if (normalized) target.push(normalized);
    return;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    target.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      appendValue(target, entry);
    }
    return;
  }
  if (typeof value === 'object') {
    for (const entry of Object.values(value)) {
      appendValue(target, entry);
    }
  }
}

function normalizeMediaTypeValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return null;
    return MEDIA_TYPE_ALIASES[normalized] || normalized;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const normalized = normalizeMediaTypeValue(entry);
      if (normalized) return normalized;
    }
  }
  return null;
}

function extractMediaType(record) {
  if (!record || typeof record !== 'object') return null;
  for (const key of MEDIA_TYPE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      const normalized = normalizeMediaTypeValue(record[key]);
      if (normalized) return normalized;
    }
  }
  return null;
}

function createBaseFieldConfig() {
  return {
    title: { ...BASE_FIELD_CONFIG.title },
    description: { ...BASE_FIELD_CONFIG.description },
    metadata: { ...BASE_FIELD_CONFIG.metadata },
    fulltext: { ...BASE_FIELD_CONFIG.fulltext }
  };
}

function resolveFieldConfig(record) {
  const config = createBaseFieldConfig();
  const mediaType = extractMediaType(record);
  if (!mediaType) return config;

  const overrides = MEDIA_TYPE_FIELD_OVERRIDES[mediaType];
  if (!overrides) return config;

  for (const [field, override] of Object.entries(overrides)) {
    if (!override) continue;
    config[field] = { ...config[field], ...override };
  }

  return config;
}

function buildFieldTexts(record) {
  const titleParts = [];
  appendValue(titleParts, record.title || record.identifier);
  if (titleParts.length === 0 && record.identifier) {
    appendValue(titleParts, record.identifier);
  }

  const descriptionParts = [];
  appendValue(descriptionParts, record.description);

  const metadataParts = [];
  appendValue(metadataParts, record.creator);
  appendValue(metadataParts, record.collection);
  appendValue(metadataParts, record.language);
  appendValue(metadataParts, record.subject);
  appendValue(metadataParts, record.tags);
  appendValue(metadataParts, record.keywords);
  appendValue(metadataParts, record.topic);
  appendValue(metadataParts, record.topics);
  appendValue(metadataParts, record.publisher);
  appendValue(metadataParts, record.contributor);
  appendValue(metadataParts, record.series);
  appendValue(metadataParts, record.identifier);

  const fullTextParts = [];
  appendValue(fullTextParts, record.fulltext);
  appendValue(fullTextParts, record.text);

  return {
    title: normalizeWhitespace(titleParts.join(' ')),
    description: normalizeWhitespace(descriptionParts.join(' ')),
    metadata: normalizeWhitespace(metadataParts.join(' ')),
    fulltext: normalizeWhitespace(fullTextParts.join(' '))
  };
}

function normalizeList(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .filter((entry) => typeof entry === 'string')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[,;\n]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
  }
  return [];
}

function extractKeywords(query) {
  const normalized = normalizeForScoring(query);
  if (!normalized) return [];
  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length === 0) return [];
  const filtered = tokens.filter((token) => token.length > 2 && !STOP_WORDS.has(token));
  const source = filtered.length > 0 ? filtered : tokens;
  const keywords = [];
  const seen = new Set();
  for (const token of source) {
    if (!seen.has(token)) {
      seen.add(token);
      keywords.push(token);
      if (keywords.length >= 24) break;
    }
  }
  return keywords;
}

function computeRelevance(fieldTexts, context, configMap = BASE_FIELD_CONFIG) {
  if (!context.normalizedQuery && context.keywords.length === 0) {
    return 0.2;
  }

  let rawScore = 0;

  for (const [field, text] of Object.entries(fieldTexts)) {
    if (!text) continue;
    const config = configMap[field] || BASE_FIELD_CONFIG[field];
    if (!config) continue;
    const normalizedField = normalizeForScoring(text);
    if (!normalizedField) continue;
    const words = tokenize(normalizedField);

    if (context.normalizedQuery && normalizedField.includes(context.normalizedQuery)) {
      rawScore += 1 * config.weight;
    }

    for (const keyword of context.keywords) {
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

    rawScore += computeProximityBonus(words, context.keywords, config.weight);
  }

  return clamp(1 - Math.exp(-rawScore), 0, 1);
}

function toArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .filter((entry) => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(/[,;\n]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function scoreAuthenticity(record, fieldTexts) {
  let score = 0;
  const collections = toArray(record.collection).map((value) => value.toLowerCase());
  const uniqueCollections = new Set(collections);

  uniqueCollections.forEach((entry) => {
    if (TRUSTED_COLLECTIONS.has(entry)) {
      score += 0.45;
    }
    if (INSTITUTION_KEYWORDS.some((keyword) => entry.includes(keyword))) {
      score += 0.12;
    }
  });

  const creatorText = Array.isArray(record.creator) ? record.creator.join(' ') : record.creator || '';
  if (creatorText) {
    const lowered = creatorText.toLowerCase();
    if (INSTITUTION_KEYWORDS.some((keyword) => lowered.includes(keyword))) {
      score += 0.18;
    }
  }

  const publisherValue = typeof record.publisher === 'string' ? record.publisher : '';
  if (publisherValue) {
    const lowered = publisherValue.toLowerCase();
    if (INSTITUTION_KEYWORDS.some((keyword) => lowered.includes(keyword))) {
      score += 0.15;
    }
  }

  const originalUrl =
    typeof record.original_url === 'string'
      ? record.original_url
      : typeof record.originalurl === 'string'
      ? record.originalurl
      : null;
  if (originalUrl) {
    try {
      const url = new URL(originalUrl);
      const host = url.hostname.toLowerCase();
      if (TRUSTED_TLDS.some((ending) => host.endsWith(ending))) {
        score += 0.3;
      }
      if (host.includes('archive.org')) {
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

function extractYear(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 1000 && value <= 3000) {
      return Math.trunc(value);
    }
    return null;
  }
  if (typeof value === 'string') {
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

function scoreHistoricalValue(record, fieldTexts) {
  const candidates = [];
  const yearValues = [record.year, record.date, record.publicdate, record.public_date, record.publicDate];
  for (const value of yearValues) {
    const year = extractYear(value);
    if (year !== null) {
      candidates.push(year);
    }
  }
  if (candidates.length === 0) {
    const identifierYear = extractYear(record.identifier);
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

function hasMeaningfulText(value) {
  if (!value) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.some((entry) => typeof entry === 'string' && entry.trim().length > 0);
  return false;
}

function scoreTransparency(record, fieldTexts) {
  let signals = 0;
  let total = 0;

  const checks = [
    [record.creator, 1],
    [record.description, 1],
    [record.publisher, 1],
    [record.contributor, 1],
    [record.language, 1],
    [record.subject, 1],
    [record.tags, 1],
    [record.keywords, 1],
    [record.source, 1],
    [record.references, 1]
  ];

  for (const [value, weight] of checks) {
    if (weight <= 0) continue;
    total += weight;
    if (hasMeaningfulText(value)) {
      signals += weight;
    }
  }

  if (hasMeaningfulText(fieldTexts.metadata)) {
    signals += 1;
    total += 1;
  }

  if (record.links && typeof record.links === 'object') {
    signals += 0.5;
    total += 0.5;
  }

  let score = total > 0 ? signals / total : 0.35;
  const descriptionText = fieldTexts.description.toLowerCase();
  if (descriptionText.includes('http') || descriptionText.includes('doi') || descriptionText.includes('isbn')) {
    score += 0.1;
  }

  return clamp(score, 0, 1);
}

function determineTrustLevel(authenticity) {
  if (authenticity >= 0.6) return 'high';
  if (authenticity >= 0.4) return 'medium';
  return 'low';
}

function createTruthScoringContext(query) {
  const trimmed = typeof query === 'string' ? query.trim() : '';
  return {
    normalizedQuery: normalizeForScoring(trimmed),
    keywords: extractKeywords(trimmed)
  };
}

export function scoreRecordTruth(record, context) {
  const fieldTexts = buildFieldTexts(record);
  const fieldConfig = resolveFieldConfig(record);
  const relevance = computeRelevance(fieldTexts, context, fieldConfig);
  const authenticity = scoreAuthenticity(record, fieldTexts);
  const historicalValue = scoreHistoricalValue(record, fieldTexts);
  const transparency = scoreTransparency(record, fieldTexts);

  const combined = clamp(
    relevance * 0.4 + authenticity * 0.3 + historicalValue * 0.15 + transparency * 0.15,
    0,
    1
  );
  const normalizedScore = combined > 0 ? combined : relevance;
  const trustLevel = determineTrustLevel(authenticity);

  return {
    score: Math.round(normalizedScore * 1000) / 1000,
    breakdown: {
      authenticity: Math.round(authenticity * 1000) / 1000,
      historicalValue: Math.round(historicalValue * 1000) / 1000,
      transparency: Math.round(transparency * 1000) / 1000,
      relevance: Math.round(relevance * 1000) / 1000,
      combinedScore: Math.round(normalizedScore * 1000) / 1000,
      trustLevel
    },
    trustLevel
  };
}

export function createTruthContext(query) {
  return createTruthScoringContext(query);
}

export function determineAvailability(record) {
  const originalUrl = typeof record.original_url === 'string' ? record.original_url : record.originalurl;
  if (typeof originalUrl === 'string' && originalUrl.trim()) {
    return 'online';
  }
  const links = record.links && typeof record.links === 'object' ? record.links : null;
  if (links) {
    const original = typeof links.original === 'string' ? links.original : null;
    if (original && original.trim()) {
      return 'online';
    }
    const wayback = typeof links.wayback === 'string' ? links.wayback : null;
    if (wayback && wayback.trim()) {
      return 'archived-only';
    }
  }
  return 'archived-only';
}

export function extractLanguage(record) {
  const languageField = record.language || record.languages || record.lang;
  if (!languageField) {
    return null;
  }
  if (typeof languageField === 'string' && languageField.trim()) {
    return languageField;
  }
  if (Array.isArray(languageField)) {
    for (const entry of languageField) {
      if (typeof entry === 'string' && entry.trim()) {
        return entry;
      }
    }
  }
  return null;
}
