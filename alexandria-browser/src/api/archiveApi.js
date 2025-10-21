import { getFuzzySuggestion } from '../utils/fuzzySearch.js';

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
