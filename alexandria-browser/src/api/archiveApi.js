import { getFuzzySuggestion } from '../utils/fuzzySearch.js';

const DEFAULT_API_BASE_URL = 'http://localhost:4000';

function resolveApiBaseUrl() {
  if (typeof window === 'undefined') {
    return DEFAULT_API_BASE_URL;
  }

  const { hostname, protocol, port } = window.location;
  const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(hostname);

  if (isLocalhost) {
    return DEFAULT_API_BASE_URL;
  }

  if (protocol === 'http:' || protocol === 'https:') {
    const resolvedPort = port ? `:${port}` : '';
    return `${protocol}//${hostname}${resolvedPort}`;
  }

  return DEFAULT_API_BASE_URL;
}

const API_BASE_URL = resolveApiBaseUrl().replace(/\/$/, '');

function buildSearchUrl(query, page, rows) {
  const url = new URL('/api/searchArchive', `${API_BASE_URL}/`);
  url.searchParams.set('q', query);
  url.searchParams.set('page', String(page));
  url.searchParams.set('rows', String(rows));
  return url.toString();
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
  const response = await fetch(url);
  if (!response.ok) {
    let message = `Archive API error: ${response.status}`;
    try {
      const payload = await response.json();
      if (payload && typeof payload.error === 'string') {
        message = payload.error;
      }
    } catch (error) {
      console.warn('Unable to parse error payload', error);
    }
    throw new Error(message);
  }
  return response.json();
}

export async function searchArchive(query, page = 1, rows = 10) {
  const trimmed = query.trim();
  if (!trimmed) {
    return { total: 0, results: [], suggestion: null };
  }

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

    const title = sanitizeText(doc.title || fallbackDoc.title || identifier) || identifier;
    const description = sanitizeText(doc.description || fallbackDoc.description);
    const mediatype = pickString(doc.mediatype, fallbackDoc.mediatype);

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

    return {
      identifier,
      title,
      description: description || 'No description available.',
      archiveUrl,
      originalUrl: originalUrl || null,
      downloads,
      mediatype: mediatype || 'unknown',
      nsfw: Boolean(fallbackDoc.nsfw)
    };
  });

  const datasetForFuzzy = results.map((doc) => doc.title || doc.identifier);
  const suggestionFromSpellcheck = extractSuggestion(payload?.spellcheck);
  const fallbackSuggestion = getFuzzySuggestion(trimmed, datasetForFuzzy);

  const total =
    (payload?.pagination && typeof payload.pagination.total === 'number'
      ? payload.pagination.total
      : payload?.response?.numFound) ?? results.length;

  return {
    total,
    results,
    suggestion: suggestionFromSpellcheck || fallbackSuggestion
  };
}
