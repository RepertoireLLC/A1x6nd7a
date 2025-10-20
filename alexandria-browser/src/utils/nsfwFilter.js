const STORAGE_KEY = 'alexandria_nsfw_keywords';
let cachedKeywords = null;
let cachedOverrides = null;
let baseKeywordsCache = null;

function normalizeList(list = []) {
  return Array.from(new Set(list.map((item) => item.toLowerCase()).filter(Boolean)));
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

async function loadBaseKeywords() {
  if (baseKeywordsCache) return baseKeywordsCache;
  try {
    const response = await fetch('./src/config/nsfwKeywords.json');
    if (!response.ok) throw new Error('Failed to load NSFW keywords');
    const data = await response.json();
    baseKeywordsCache = normalizeList(data.keywords || []);
  } catch (error) {
    console.error('Unable to load NSFW keyword list:', error);
    baseKeywordsCache = [];
  }
  return baseKeywordsCache;
}

async function loadKeywords() {
  if (cachedKeywords) return cachedKeywords;
  if (!cachedOverrides) {
    cachedOverrides = readFromStorage();
  }
  const baseKeywords = await loadBaseKeywords();
  const filteredBase = baseKeywords.filter((keyword) => !cachedOverrides.removed.includes(keyword));
  cachedKeywords = normalizeList([...filteredBase, ...cachedOverrides.custom]);
  return cachedKeywords;
}

function containsKeyword(text, keywords) {
  if (!text) return false;
  const normalized = text.toLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword));
}

/**
 * Marks results that should be blocked based on the NSFW keyword list.
 * @param {Array} results
 * @param {boolean} enabled
 * @returns {Promise<Array>}
 */
export async function applyNSFWFilter(results, enabled) {
  const safeResults = Array.isArray(results) ? results : [];

  if (!enabled) {
    return safeResults.map((result) => ({ ...result, nsfw: false }));
  }

  const keywords = await loadKeywords();
  return safeResults.map((result) => {
    const isBlocked = containsKeyword(result.title, keywords) ||
      containsKeyword(result.description, keywords) ||
      containsKeyword(result.identifier, keywords) ||
      containsKeyword(result.originalUrl, keywords);

    return { ...result, nsfw: isBlocked };
  });
}

export async function toggleKeyword(word, action = 'add') {
  const normalized = word.trim().toLowerCase();
  if (!normalized) {
    return loadKeywords();
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
  cachedKeywords = null;
  return loadKeywords();
}

export async function getKeywords() {
  return loadKeywords();
}
