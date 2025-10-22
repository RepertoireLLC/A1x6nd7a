const STORAGE_KEY = 'alexandria_nsfw_keywords';

export const NSFW_MODES = Object.freeze({
  SAFE: 'safe',
  MODERATE: 'moderate',
  OFF: 'off',
  ONLY: 'only'
});

const DEFAULT_KEYWORD_SETS = Object.freeze({
  explicit: [],
  mild: []
});

let cachedKeywordData = null;
let cachedOverrides = null;
let baseKeywordsCache = null;

function normalizeList(list = []) {
  return Array.from(new Set(list.map((item) => (typeof item === 'string' ? item.toLowerCase() : '')).filter(Boolean)));
}

function readFromStorage() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return { custom: [], removed: [] };
    }
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed)) {
      return { custom: normalizeList(parsed), removed: [] };
    }
    const custom = normalizeList(parsed?.custom);
    const removed = normalizeList(parsed?.removed);
    return { custom, removed };
  } catch (error) {
    console.warn('Unable to read NSFW keywords from storage', error);
    return { custom: [], removed: [] };
  }
}

function saveToStorage(overrides) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch (error) {
    console.warn('Unable to persist NSFW keywords', error);
  }
}

function normalizeKeywordPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return { ...DEFAULT_KEYWORD_SETS };
  }

  if (Array.isArray(payload.keywords)) {
    const keywords = normalizeList(payload.keywords);
    return { explicit: keywords, mild: [] };
  }

  if (payload.categories && typeof payload.categories === 'object') {
    const categories = payload.categories;
    const explicit = normalizeList(categories.explicit || categories.hard || categories.high || []);
    const mildSource = categories.mild || categories.soft || categories.moderate || [];
    const mild = normalizeList(mildSource);
    return { explicit, mild };
  }

  return { ...DEFAULT_KEYWORD_SETS };
}

async function loadBaseKeywords() {
  if (baseKeywordsCache) return baseKeywordsCache;
  try {
    const response = await fetch('./src/config/nsfwKeywords.json');
    if (!response.ok) throw new Error('Failed to load NSFW keywords');
    const data = await response.json();
    baseKeywordsCache = normalizeKeywordPayload(data);
  } catch (error) {
    console.error('Unable to load NSFW keyword list:', error);
    baseKeywordsCache = { ...DEFAULT_KEYWORD_SETS };
  }
  return baseKeywordsCache;
}

async function loadKeywordData() {
  if (cachedKeywordData) return cachedKeywordData;

  if (!cachedOverrides) {
    cachedOverrides = readFromStorage();
  }

  const base = await loadBaseKeywords();
  const removed = cachedOverrides.removed ?? [];
  const custom = cachedOverrides.custom ?? [];

  const filteredExplicit = base.explicit.filter((keyword) => !removed.includes(keyword));
  const filteredMild = base.mild.filter((keyword) => !removed.includes(keyword));

  const explicit = normalizeList([...filteredExplicit, ...custom]);
  const explicitSet = new Set(explicit);
  const mild = normalizeList(filteredMild.filter((keyword) => !explicitSet.has(keyword)));
  const combined = normalizeList([...explicit, ...mild]);

  cachedKeywordData = { explicit, mild, all: combined };
  return cachedKeywordData;
}

function normalizeMode(mode) {
  if (typeof mode !== 'string') {
    return NSFW_MODES.SAFE;
  }
  const normalized = mode.toLowerCase();
  if (normalized === NSFW_MODES.MODERATE) return NSFW_MODES.MODERATE;
  if (normalized === NSFW_MODES.OFF || normalized === 'none' || normalized === 'no_filter') {
    return NSFW_MODES.OFF;
  }
  if (normalized === NSFW_MODES.ONLY || normalized === 'only_nsfw') {
    return NSFW_MODES.ONLY;
  }
  return NSFW_MODES.SAFE;
}

function collectCandidateStrings(entry) {
  if (!entry || typeof entry !== 'object') {
    return [];
  }

  const values = [];
  const append = (value) => {
    if (!value) return;
    if (typeof value === 'string') {
      values.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        append(item);
      }
    }
  };

  append(entry.title);
  append(entry.description);
  append(entry.identifier);
  append(entry.mediatype);
  append(entry.originalUrl || entry.original_url || entry.original);
  append(entry.archiveUrl || entry.archive_url || entry.archive);
  append(entry.creator);
  append(entry.collection);
  append(entry.subject);
  append(entry.tags);
  append(entry.keywords);

  if (entry.metadata && typeof entry.metadata === 'object') {
    const metadata = entry.metadata;
    append(metadata.tags);
    append(metadata.subject);
    append(metadata.keywords);
    append(metadata.topic);
    append(metadata.topics);
  }

  if (entry.links && typeof entry.links === 'object') {
    append(entry.links.archive);
    append(entry.links.original);
    append(entry.links.wayback);
  }

  return values;
}

function classifyEntry(entry, keywordData) {
  const explicitMatches = new Set();
  const mildMatches = new Set();

  for (const value of collectCandidateStrings(entry)) {
    const normalized = value.toLowerCase();
    for (const keyword of keywordData.explicit) {
      if (normalized.includes(keyword)) {
        explicitMatches.add(keyword);
      }
    }
    for (const keyword of keywordData.mild) {
      if (normalized.includes(keyword)) {
        mildMatches.add(keyword);
      }
    }
  }

  if (explicitMatches.size > 0) {
    return {
      flagged: true,
      severity: 'explicit',
      matches: Array.from(new Set([...explicitMatches, ...mildMatches]))
    };
  }

  if (mildMatches.size > 0) {
    return {
      flagged: true,
      severity: 'mild',
      matches: Array.from(mildMatches)
    };
  }

  return { flagged: false, severity: null, matches: [] };
}

function shouldIncludeEntry(classification, mode) {
  if (mode === NSFW_MODES.ONLY) {
    return classification.flagged;
  }
  if (mode === NSFW_MODES.SAFE) {
    return !classification.flagged;
  }
  if (mode === NSFW_MODES.MODERATE) {
    return classification.severity !== 'explicit';
  }
  return true;
}

/**
 * Marks and filters results based on the configured NSFW mode.
 * @param {Array} results
 * @param {string} mode
 * @returns {Promise<Array>}
 */
export async function applyNSFWFilter(results, mode) {
  const safeResults = Array.isArray(results) ? results : [];
  const keywordData = await loadKeywordData();
  const normalizedMode = normalizeMode(mode);

  return safeResults.reduce((accumulator, entry) => {
    const classification = classifyEntry(entry, keywordData);
    const enriched = { ...entry, nsfw: classification.flagged };
    if (classification.severity) {
      enriched.nsfwLevel = classification.severity;
    } else if ('nsfwLevel' in enriched) {
      delete enriched.nsfwLevel;
    }
    if (classification.matches.length > 0) {
      enriched.nsfwMatches = classification.matches;
    } else if ('nsfwMatches' in enriched) {
      delete enriched.nsfwMatches;
    }

    if (shouldIncludeEntry(classification, normalizedMode)) {
      accumulator.push(enriched);
    }

    return accumulator;
  }, []);
}

export async function toggleKeyword(word, action = 'add') {
  const normalized = word.trim().toLowerCase();
  if (!normalized) {
    const data = await loadKeywordData();
    return data.all;
  }

  if (!cachedOverrides) {
    cachedOverrides = readFromStorage();
  }

  if (action === 'remove') {
    if (cachedOverrides.custom.includes(normalized)) {
      cachedOverrides.custom = cachedOverrides.custom.filter((item) => item !== normalized);
    } else if (!cachedOverrides.removed.includes(normalized)) {
      cachedOverrides.removed = [...cachedOverrides.removed, normalized];
    }
  } else {
    if (!cachedOverrides.custom.includes(normalized)) {
      cachedOverrides.custom = [...cachedOverrides.custom, normalized];
    }
    cachedOverrides.removed = cachedOverrides.removed.filter((item) => item !== normalized);
  }

  saveToStorage(cachedOverrides);
  cachedKeywordData = null;
  const data = await loadKeywordData();
  return data.all;
}

export async function getKeywords() {
  const data = await loadKeywordData();
  return data.all;
}
