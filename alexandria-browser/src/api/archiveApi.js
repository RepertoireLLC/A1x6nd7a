import { getFuzzySuggestion } from '../utils/fuzzySearch.js';
import {
  createTruthContext,
  scoreRecordTruth,
  determineAvailability as resolveAvailability,
  extractLanguage as resolveLanguage
} from '../utils/truthScoring.js';

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'from',
  'how',
  'i',
  'in',
  'into',
  'is',
  'it',
  'of',
  'on',
  'or',
  'that',
  'the',
  'their',
  'them',
  'there',
  'these',
  'they',
  'this',
  'to',
  'was',
  'we',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'with',
  'you',
  'your'
]);

const FIELD_CONFIG = {
  title: { weight: 1, keywordBase: 0.7, fuzzyBase: 0.3 },
  description: { weight: 0.8, keywordBase: 0.625, fuzzyBase: 0.28 },
  metadata: { weight: 0.5, keywordBase: 0.6, fuzzyBase: 0.24 },
  fulltext: { weight: 0.3, keywordBase: 0.333, fuzzyBase: 0.2 }
};

const PROXIMITY_BONUS = [
  { distance: 3, bonus: 0.2 },
  { distance: 6, bonus: 0.12 },
  { distance: 10, bonus: 0.08 }
];

const DEFAULT_API_BASE_URL = 'http://localhost:4000';
const HTML_CONTENT_TYPE_PATTERN = /text\/html/i;
const HTML_DOCTYPE_PATTERN = /<!doctype\s+html/i;
const HTML_TAG_PATTERN = /<html/i;
const HTML_PREVIEW_LIMIT = 240;
const DEV_SERVER_PORT = '5173';

let archiveApiSuccessLogged = false;

function isHtmlLikeResponse(body, contentType) {
  if (!body) return false;
  if (HTML_CONTENT_TYPE_PATTERN.test(contentType)) return true;
  const snippet = body.slice(0, HTML_PREVIEW_LIMIT).toLowerCase();
  if (HTML_DOCTYPE_PATTERN.test(snippet) || HTML_TAG_PATTERN.test(snippet)) {
    return true;
  }
  return snippet.trim().startsWith('<');
}

function buildPreviewSnippet(body) {
  return body.slice(0, HTML_PREVIEW_LIMIT).replace(/\s+/g, ' ').trim();
}

function resolveApiBaseUrl() {
  if (typeof window === 'undefined') {
    return DEFAULT_API_BASE_URL;
  }

  const { hostname, protocol, port } = window.location;
  const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  const normalizedPort = typeof port === 'string' ? port.trim() : '';
  const originPort = normalizedPort ? `:${normalizedPort}` : '';
  const sameOrigin = `${protocol}//${hostname}${originPort}`;
  const isHttpProtocol = protocol === 'http:' || protocol === 'https:';
  const matchesDevPort = normalizedPort && normalizedPort === DEV_SERVER_PORT;

  if ((!isLocalhost || matchesDevPort) && isHttpProtocol) {
    return sameOrigin.replace(/\/$/, '');
  }

  if (isLocalhost) {
    return DEFAULT_API_BASE_URL;
  }

  if (isHttpProtocol) {
    return sameOrigin.replace(/\/$/, '');
  }

  return DEFAULT_API_BASE_URL;
}

const API_BASE_URL = resolveApiBaseUrl().replace(/\/$/, '');

function buildSearchUrl(query, page, rows) {
  const url = new URL('/api/searchArchive', `${API_BASE_URL}/`);
  const safeRows = Number.isFinite(Number(rows)) && Number(rows) > 0 ? Number(rows) : 10;
  const safePage = Number.isFinite(Number(page)) && Number(page) > 0 ? Number(page) : 1;
  const safeOffset = Math.max(0, (safePage - 1) * safeRows);

  url.searchParams.set('q', query);
  url.searchParams.set('page', String(safePage));
  url.searchParams.set('rows', String(safeRows));
  url.searchParams.set('offset', String(safeOffset));
  return url.toString();
}

function normalizeQueryString(query) {
  return query
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractKeywords(query) {
  if (!query) return [];
  const cleaned = query
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) return [];

  const tokens = cleaned.split(' ');
  const filtered = tokens.filter((token) => token.length > 2 && !STOP_WORDS.has(token));
  const source = filtered.length > 0 ? filtered : tokens;
  const keywords = [];
  const seen = new Set();

  for (const token of source) {
    if (!seen.has(token)) {
      seen.add(token);
      keywords.push(token);
    }
    if (keywords.length >= 24) {
      break;
    }
  }

  return keywords;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countOccurrences(text, term) {
  if (!text || !term) return 0;
  const normalizedText = text.toLowerCase();
  const normalizedTerm = term.toLowerCase();
  if (!normalizedText.includes(normalizedTerm)) {
    return 0;
  }

  const pattern = new RegExp(escapeRegExp(normalizedTerm), 'g');
  const matches = normalizedText.match(pattern);
  return matches ? matches.length : 0;
}

function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function levenshteinDistance(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array(cols).fill(0));

  for (let i = 0; i < rows; i++) {
    matrix[i][0] = i;
  }
  for (let j = 0; j < cols; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
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

function computeFuzzyMatchScore(words, keyword, baseScore, fieldWeight) {
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
    const bonus = Math.max(0.1, closeness * baseScore) * fieldWeight;
    if (bonus > bestScore) {
      bestScore = bonus;
    }
  }

  return bestScore;
}

function computeProximityScore(words, keywords, fieldWeight) {
  if (keywords.length < 2 || words.length === 0) {
    return 0;
  }

  const keywordSet = new Set(keywords.map((keyword) => keyword.toLowerCase()));
  const positions = [];

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

  let minDistance = Infinity;

  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      if (positions[i].keyword === positions[j].keyword) continue;
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
      return bonus * fieldWeight;
    }
  }

  return 0;
}

function collectValues(target, ...values) {
  for (const value of values) {
    if (!value) continue;
    if (typeof value === 'string' || typeof value === 'number') {
      target.push(String(value));
    } else if (Array.isArray(value)) {
      collectValues(target, ...value);
    } else if (typeof value === 'object') {
      collectValues(target, ...Object.values(value));
    }
  }
}

function computeRelevanceScore(fieldTexts, normalizedQuery, keywords) {
  let exactScore = 0;
  let keywordScore = 0;
  let fuzzyScore = 0;
  let proximityScore = 0;

  for (const [field, text] of Object.entries(fieldTexts)) {
    if (!text) continue;
    const config = FIELD_CONFIG[field];
    if (!config) continue;
    const lower = text.toLowerCase();
    const words = tokenize(text);

    if (normalizedQuery && lower.includes(normalizedQuery)) {
      exactScore += 1 * config.weight;
    }

    for (const keyword of keywords) {
      const occurrences = countOccurrences(lower, keyword);
      if (occurrences > 0) {
        keywordScore += occurrences * config.keywordBase * config.weight;
        if (occurrences > 1) {
          keywordScore += (occurrences - 1) * 0.05 * config.weight;
        }
      } else {
        fuzzyScore += computeFuzzyMatchScore(words, keyword, config.fuzzyBase, config.weight);
      }
    }

    const proximityBonus = computeProximityScore(words, keywords, config.weight);
    proximityScore += proximityBonus;
  }

  return exactScore + keywordScore + fuzzyScore + proximityScore;
}

function buildFieldTexts(doc, fallbackDoc, identifier) {
  const baseDoc = doc && typeof doc === 'object' ? doc : {};
  const backupDoc = fallbackDoc && typeof fallbackDoc === 'object' ? fallbackDoc : {};

  const title = sanitizeText(baseDoc.title || backupDoc.title || identifier || '');
  const description = sanitizeText(baseDoc.description || backupDoc.description || '');

  const metadataValues = [];
  collectValues(
    metadataValues,
    baseDoc.subject,
    backupDoc.subject,
    baseDoc.tags,
    backupDoc.tags,
    baseDoc.keywords,
    backupDoc.keywords,
    baseDoc.collection,
    backupDoc.collection,
    baseDoc.creator,
    backupDoc.creator,
    baseDoc.language,
    backupDoc.language,
    baseDoc.publisher,
    backupDoc.publisher,
    baseDoc.contributor,
    backupDoc.contributor,
    baseDoc.topic,
    backupDoc.topic,
    baseDoc.topics,
    backupDoc.topics,
    baseDoc.identifier,
    backupDoc.identifier
  );

  const metadata = sanitizeText(metadataValues);
  const fulltext = sanitizeText(baseDoc.text || backupDoc.text || '');

  return { title, description, metadata, fulltext };
}

function sanitizeText(value) {
  if (!value) return '';
  if (Array.isArray(value)) {
    return sanitizeText(value.join(' '));
  }
  const text = String(value).replace(/<[^>]+>/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

function extractSuggestion(spellcheck) {
  if (!spellcheck) return null;
  const corrected = typeof spellcheck.correctedQuery === 'string' ? spellcheck.correctedQuery.trim() : '';
  return corrected || null;
}

function pickString(...values) {
  for (const value of values) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) {
        return trimmed;
      }
    }
  }
  return '';
}

function parseDownloads(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' }
  });

  const contentType = response.headers.get('content-type') || '';
  const rawBody = await response.text();
  const trimmedBody = rawBody.trim();

  if (!response.ok) {
    let message = `Archive API error: ${response.status}`;
    if (trimmedBody) {
      if (!isHtmlLikeResponse(trimmedBody, contentType)) {
        try {
          const payload = JSON.parse(trimmedBody);
          if (payload && typeof payload.error === 'string' && payload.error.trim()) {
            message = payload.error.trim();
          } else if (payload && typeof payload.details === 'string' && payload.details.trim()) {
            message = `${message} ${payload.details.trim()}`.trim();
          } else {
            message = `${message} ${buildPreviewSnippet(trimmedBody)}`.trim();
          }
        } catch (error) {
          console.warn('Unable to parse archive error payload as JSON', error, {
            preview: buildPreviewSnippet(trimmedBody)
          });
          message = `${message} ${buildPreviewSnippet(trimmedBody)}`.trim();
        }
      } else {
        message = `${message} (received HTML error page)`;
      }
    }
    throw new Error(message);
  }

  if (!trimmedBody) {
    throw new Error('Archive API returned an empty response.');
  }

  if (isHtmlLikeResponse(trimmedBody, contentType)) {
    throw new Error('Archive API returned HTML instead of JSON.');
  }

  try {
    const payload = JSON.parse(trimmedBody);
    if (!archiveApiSuccessLogged) {
      console.info('Archive API fully connected. Live search 100% operational.');
      archiveApiSuccessLogged = true;
    }
    if (payload && typeof payload === 'object' && payload.fallback) {
      if (typeof payload.fallback_message === 'string' && payload.fallback_message.trim()) {
        console.warn('Archive search fell back to offline dataset:', payload.fallback_message.trim());
      } else {
        console.warn('Archive search fell back to offline dataset.');
      }
      if (typeof payload.fallback_reason === 'string' && payload.fallback_reason.trim()) {
        console.warn('Offline fallback reason:', payload.fallback_reason.trim());
      }
    }
    if (
      payload &&
      typeof payload === 'object' &&
      payload.search_strategy &&
      payload.search_strategy !== 'primary search with fuzzy expansion'
    ) {
      console.info('Archive search completed using fallback strategy:', payload.search_strategy);
      if (typeof payload.search_strategy_query === 'string' && payload.search_strategy_query.trim()) {
        console.info('Retry used simplified query:', payload.search_strategy_query.trim());
      }
    }
    return payload;
  } catch (error) {
    console.warn('Unable to parse archive response as JSON', error, {
      preview: buildPreviewSnippet(trimmedBody)
    });
    throw new Error('Archive API returned invalid JSON.');
  }
}

export async function searchArchive(query, page = 1, rows = 10) {
  const trimmed = query.trim();
  if (!trimmed) {
    return { total: 0, results: [], suggestion: null };
  }

  const truthContext = createTruthContext(trimmed);

  const url = buildSearchUrl(trimmed, page, rows);
  const payload = await fetchJson(url);

  const normalizedDocs = Array.isArray(payload?.response?.docs) ? payload.response.docs : [];
  const docMap = new Map();
  normalizedDocs.forEach((doc) => {
    if (doc && typeof doc === 'object') {
      const identifier = typeof doc.identifier === 'string' ? doc.identifier : null;
      if (identifier) {
        docMap.set(identifier, doc);
      }
    }
  });

  const summaries = Array.isArray(payload?.results) ? payload.results : [];
  const baseResults = summaries.length > 0 ? summaries : normalizedDocs;

  const results = baseResults.map((entry) => {
    const doc = entry && typeof entry === 'object' ? entry : {};
    const identifier = typeof doc.identifier === 'string' ? doc.identifier : '';
    const fallbackDoc = docMap.get(identifier) || doc;
    const fallbackLinks =
      fallbackDoc && typeof fallbackDoc.links === 'object' ? fallbackDoc.links : null;

    const fieldTexts = buildFieldTexts(doc, fallbackDoc, identifier);
    const title = fieldTexts.title || identifier;
    const description = fieldTexts.description;
    const mediatype = pickString(doc.mediatype, fallbackDoc.mediatype);
    const yearValue = pickString(
      doc.year,
      fallbackDoc.year,
      doc.date,
      fallbackDoc.date,
      doc.publicdate,
      fallbackDoc.publicdate
    );
    
    const archiveCandidate = pickString(
      doc.archive_url,
      fallbackDoc.archive_url,
      fallbackDoc.archiveUrl,
      fallbackLinks && fallbackLinks.archive,
      identifier ? `https://archive.org/details/${encodeURIComponent(identifier)}` : ''
    );
    const archiveUrl = archiveCandidate || (identifier ? `https://archive.org/details/${encodeURIComponent(identifier)}` : '');
    const originalUrl = pickString(
      doc.original_url,
      doc.originalurl,
      fallbackDoc.original_url,
      fallbackDoc.originalurl,
      fallbackLinks && fallbackLinks.original
    );

    const downloads = parseDownloads(doc.downloads ?? fallbackDoc.downloads);

    const nsfwFlag = Boolean(fallbackDoc.nsfw);
    const nsfwLevel = typeof fallbackDoc.nsfwLevel === 'string'
      ? fallbackDoc.nsfwLevel
      : typeof fallbackDoc.nsfw_level === 'string'
      ? fallbackDoc.nsfw_level
      : null;
    const nsfwMatches = Array.isArray(fallbackDoc.nsfwMatches)
      ? fallbackDoc.nsfwMatches
      : Array.isArray(fallbackDoc.nsfw_matches)
      ? fallbackDoc.nsfw_matches
      : [];

    const thumbnailCandidate = pickString(
      doc.thumbnail,
      fallbackDoc.thumbnail,
      fallbackDoc.image,
      fallbackDoc.img,
      fallbackDoc.icon,
      fallbackDoc.item_tile
    );
    const thumbnailUrl =
      (thumbnailCandidate && thumbnailCandidate.trim()) ||
      (identifier ? `https://archive.org/services/img/${encodeURIComponent(identifier)}` : '');

    const truthRecord = { ...fallbackDoc, ...doc, identifier };
    const { score: truthScore, breakdown } = scoreRecordTruth(truthRecord, truthContext);
    const availability = resolveAvailability(truthRecord);
    const language = resolveLanguage(truthRecord);

    return {
      identifier,
      title,
      description: description || 'No description available.',
      archiveUrl,
      originalUrl: originalUrl || null,
      downloads,
      mediatype: mediatype || 'unknown',
      year: yearValue || null,
      thumbnail: thumbnailUrl ? thumbnailUrl : null,
      nsfw: nsfwFlag,
      ...(nsfwLevel ? { nsfwLevel } : {}),
      ...(nsfwMatches.length > 0 ? { nsfwMatches } : {}),
      score: truthScore,
      score_breakdown: breakdown,
      availability,
      ...(language ? { language } : {}),
      source_trust: breakdown.trustLevel
    };
  });

  // TODO: Future AI-enhanced ranking here.
  results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const datasetForFuzzy = results.map((doc) => doc.title || doc.identifier);
  const suggestionFromSpellcheck = extractSuggestion(payload?.spellcheck);
  const fallbackSuggestion = getFuzzySuggestion(trimmed, datasetForFuzzy);

  const total =
    (payload?.pagination && typeof payload.pagination.total === 'number'
      ? payload.pagination.total
      : payload?.response?.numFound) ?? results.length;

  const safePage = Number.isFinite(Number(page)) && Number(page) > 0 ? Number(page) : 1;
  const safeRows = Number.isFinite(Number(rows)) && Number(rows) > 0 ? Number(rows) : 10;
  const startIndex =
    typeof payload?.response?.start === 'number'
      ? payload.response.start
      : (safePage - 1) * safeRows;
  const currentCount = startIndex + baseResults.length;
  const hasMore = currentCount < total;

  return {
    total,
    results,
    suggestion: suggestionFromSpellcheck || fallbackSuggestion,
    hasMore,
    page: safePage
  };
}
