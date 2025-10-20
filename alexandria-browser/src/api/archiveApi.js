import { getFuzzySuggestion } from '../utils/fuzzySearch.js';

const BASE_URL = 'https://archive.org/advancedsearch.php';
const METADATA_URL = 'https://archive.org/metadata/';

function extractSuggestion(spellcheck) {
  if (!spellcheck?.suggestions) return null;
  const entries = spellcheck.suggestions;
  for (let i = 0; i < entries.length; i += 2) {
    const data = entries[i + 1];
    const suggestionList = data?.suggestion;
    if (Array.isArray(suggestionList) && suggestionList.length > 0) {
      return suggestionList[0];
    }
  }
  return null;
}

function sanitizeText(value) {
  if (!value) return '';
  if (Array.isArray(value)) {
    return sanitizeText(value[0]);
  }
  const text = String(value).replace(/<[^>]+>/g, ' ');
  return text.replace(/\s+/g, ' ').trim();
}

function buildQuery(query, page, rows) {
  const params = new URLSearchParams();
  params.set('q', query || '');
  params.set('page', String(page));
  params.set('rows', String(rows));
  params.set('output', 'json');
  ['identifier', 'title', 'description', 'creator', 'downloads', 'originalurl'].forEach((field) => {
    params.append('fl[]', field);
  });
  params.append('spellcheck', 'true');
  return `${BASE_URL}?${params.toString()}`;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Archive API error: ${response.status}`);
  }
  return response.json();
}

async function fetchOriginalUrl(identifier) {
  try {
    const metadata = await fetchJson(`${METADATA_URL}${encodeURIComponent(identifier)}`);
    return metadata?.metadata?.originalurl || null;
  } catch (error) {
    console.warn('Unable to resolve original URL for', identifier, error);
    return null;
  }
}

export async function searchArchive(query, page = 1, rows = 10) {
  if (!query) {
    return { total: 0, results: [], suggestion: null };
  }

  const url = buildQuery(query, page, rows);
  const payload = await fetchJson(url);
  const docs = payload?.response?.docs ?? [];
  const suggestionFromApi = extractSuggestion(payload?.spellcheck);

  const datasetForFuzzy = docs.map((doc) => sanitizeText(doc.title) || doc.identifier);
  const fallbackSuggestion = getFuzzySuggestion(query, datasetForFuzzy);

  const results = await Promise.all(
    docs.map(async (doc) => {
      const identifier = doc.identifier;
      const archiveUrl = `https://archive.org/details/${identifier}`;
      const originalUrl = doc.originalurl || await fetchOriginalUrl(identifier);
      const cleanTitle = sanitizeText(doc.title) || identifier;
      const rawDescription = sanitizeText(doc.description) || sanitizeText(doc.creator) || 'No description available.';
      const description = rawDescription.length > 260 ? `${rawDescription.slice(0, 257)}…` : rawDescription;

      return {
        identifier,
        title: cleanTitle,
        description,
        archiveUrl,
        originalUrl,
        downloads: doc.downloads ?? 0
      };
    })
  );

  return {
    total: payload?.response?.numFound ?? results.length,
    results,
    suggestion: suggestionFromApi || fallbackSuggestion
  };
}
