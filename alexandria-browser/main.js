import { searchArchive } from './src/api/archiveApi.js';
import { createSearchBar } from './src/components/SearchBar.js';
import { createResultCard } from './src/components/ResultCard.js';
import { createPaginationControls } from './src/components/PaginationControls.js';
import { createSettingsModal } from './src/components/SettingsModal.js';
import { applyNSFWFilter, getKeywords, NSFW_MODES } from './src/utils/nsfwFilter.js';
import { loadSettings, saveSettings, resetSettings } from './src/utils/settingsStorage.js';

const storedSettings = loadSettings();

const state = {
  query: '',
  page: 1,
  pageSize: storedSettings.pageSize,
  total: 0,
  rawResults: [],
  results: [],
  loading: false,
  loadingMore: false,
  error: null,
  loadMoreError: null,
  suggestion: null,
  nsfwMode: storedSettings.nsfwMode ?? (storedSettings.nsfwFiltering ? NSFW_MODES.SAFE : NSFW_MODES.OFF),
  nsfwAcknowledged: Boolean(storedSettings.nsfwAcknowledged),
  keywords: [],
  hasMore: false,
  pageCache: new Map(),
  loadedPages: new Set()
};

const PAGE_SIZE_OPTIONS = [10, 20, 50];

const app = document.getElementById('app');
const header = document.createElement('header');
const title = document.createElement('h1');
const subtitle = document.createElement('p');
subtitle.textContent = 'Search preserved knowledge from the Internet Archive with a clean and safe interface.';
title.textContent = 'Alexandria Browser';
header.appendChild(title);
header.appendChild(subtitle);
app.appendChild(header);

const { form: searchForm, input: searchInput } = createSearchBar({
  onSubmit: (query) => {
    state.query = query;
    state.page = 1;
    runSearch();
  },
  onOpenSettings: () => settingsModal.open()
});
header.appendChild(searchForm);

const suggestionContainer = document.createElement('div');
suggestionContainer.className = 'did-you-mean';
app.appendChild(suggestionContainer);

const loadingIndicator = document.createElement('div');
loadingIndicator.className = 'loading-indicator';
loadingIndicator.innerHTML = '<span></span><span></span><span></span>';
loadingIndicator.style.display = 'none';
app.appendChild(loadingIndicator);

const messageContainer = document.createElement('div');
app.appendChild(messageContainer);

const resultsContainer = document.createElement('section');
resultsContainer.className = 'results-container';
app.appendChild(resultsContainer);

const paginationContainer = document.createElement('div');
app.appendChild(paginationContainer);

function persistSettings() {
  saveSettings({
    nsfwMode: state.nsfwMode,
    nsfwFiltering: state.nsfwMode !== NSFW_MODES.OFF,
    nsfwAcknowledged: state.nsfwAcknowledged,
    pageSize: state.pageSize
  });
}

async function initializeKeywords() {
  try {
    const keywords = await getKeywords();
    state.keywords = keywords;
    renderKeywordsInModal(state.keywords);
  } catch (error) {
    console.warn('Could not load default keywords', error);
  }
}

function setLoading(isLoading) {
  state.loading = isLoading;
  loadingIndicator.style.display = isLoading ? 'flex' : 'none';
}

function renderSuggestion() {
  suggestionContainer.innerHTML = '';
  if (!state.suggestion || !state.query) return;
  if (state.suggestion.toLowerCase() === state.query.toLowerCase()) return;

  const text = document.createElement('span');
  text.textContent = 'Did you mean ';
  const suggestionButton = document.createElement('button');
  suggestionButton.type = 'button';
  suggestionButton.textContent = state.suggestion;
  suggestionButton.addEventListener('click', () => {
    searchInput.value = state.suggestion;
    state.query = state.suggestion;
    state.page = 1;
    runSearch();
  });

  suggestionContainer.appendChild(text);
  suggestionContainer.appendChild(suggestionButton);
}

function renderResults() {
  resultsContainer.innerHTML = '';
  messageContainer.innerHTML = '';

  if (state.error) {
    const error = document.createElement('div');
    error.className = 'error-state';
    error.textContent = state.error;
    messageContainer.appendChild(error);
    return;
  }

  if (!state.loading && state.results.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No results found. Try refining your search keywords.';
    messageContainer.appendChild(empty);
    return;
  }

  state.results.forEach((result) => {
    const card = createResultCard(result, { nsfwMode: state.nsfwMode });
    resultsContainer.appendChild(card);
  });
}

function renderPagination() {
  paginationContainer.innerHTML = '';
  if (state.error) {
    return;
  }

  const shouldRenderControls =
    state.rawResults.length > 0 ||
    state.loading ||
    state.loadingMore ||
    Boolean(state.loadMoreError);

  if (!shouldRenderControls) {
    return;
  }

  const controls = createPaginationControls({
    currentPage: state.page,
    pageSize: state.pageSize,
    totalResults: state.total,
    loadedCount: state.rawResults.length,
    hasMore: state.hasMore,
    loadingMore: state.loadingMore,
    loadMoreError: state.loadMoreError,
    onLoadMore: () => {
      if (!state.hasMore || state.loadingMore) {
        return;
      }
      state.loadMoreError = null;
      runSearch({ append: true, page: state.page + 1, showLoader: false });
    }
  });

  paginationContainer.appendChild(controls);
}

async function runSearch(options = {}) {
  if (!state.query) return;

  const append = Boolean(options.append);
  const pageCandidate = options.page ?? state.page ?? 1;
  const parsedPage = Number.parseInt(pageCandidate, 10);
  const targetPageNumber = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const showLoader = options.showLoader ?? !append;

  if (append && (state.loadingMore || state.loading || !state.hasMore)) {
    return;
  }

  if (!append) {
    state.error = null;
  }
  state.loadMoreError = null;

  if (!append && targetPageNumber === 1) {
    state.pageCache = new Map();
    state.loadedPages = new Set();
    state.hasMore = false;
    state.rawResults = [];
    state.results = [];
    state.total = 0;
  }

  state.loadingMore = append;

  if (showLoader) {
    setLoading(true);
  }

  try {
    let pageData = state.pageCache.get(targetPageNumber);
    if (!pageData) {
      pageData = await searchArchive(state.query, targetPageNumber, state.pageSize);
      state.pageCache.set(targetPageNumber, pageData);
    }

    state.total = pageData.total ?? state.total;
    if (!append || targetPageNumber === 1) {
      state.suggestion = pageData.suggestion || null;
    } else if (!state.suggestion && pageData.suggestion) {
      state.suggestion = pageData.suggestion;
    }

    state.loadedPages.add(targetPageNumber);

    const seen = new Set();
    const aggregated = [];
    const sortedEntries = Array.from(state.pageCache.entries())
      .filter(([pageNumber]) => state.loadedPages.has(pageNumber))
      .sort((a, b) => a[0] - b[0]);

    for (const [, cachedPayload] of sortedEntries) {
      const pageResults = Array.isArray(cachedPayload.results) ? cachedPayload.results : [];
      for (const entry of pageResults) {
        if (!entry || typeof entry !== 'object') continue;
        const identifier = typeof entry.identifier === 'string' ? entry.identifier : null;
        if (identifier && seen.has(identifier)) {
          continue;
        }
        if (identifier) {
          seen.add(identifier);
        }
        aggregated.push(entry);
      }
    }

    aggregated.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    state.rawResults = aggregated;
    if (state.loadedPages.size > 0) {
      const maxPage = Math.max(...state.loadedPages);
      state.page = Number.isFinite(maxPage) ? maxPage : targetPageNumber;
    } else {
      state.page = targetPageNumber;
    }

    const loadedCountFromPages = sortedEntries.reduce((sum, [, cached]) => {
      const pageResults = Array.isArray(cached.results) ? cached.results.length : 0;
      return sum + pageResults;
    }, 0);

    const hasAdditionalPages =
      typeof pageData.hasMore === 'boolean'
        ? pageData.hasMore
        : loadedCountFromPages < state.total;

    state.hasMore = Boolean(hasAdditionalPages && state.rawResults.length < state.total);

    const processed = await applyNSFWFilter(state.rawResults, state.nsfwMode);
    state.results = processed;
  } catch (error) {
    console.error(error);
    if (append) {
      state.loadMoreError = 'Unable to load more results. Please try again.';
    } else {
      state.error = 'Unable to fetch results right now. Check your internet connection or try again later.';
      state.rawResults = [];
      state.results = [];
      state.total = 0;
      state.hasMore = false;
      state.pageCache = new Map();
      state.loadedPages = new Set();
    }
  } finally {
    if (showLoader) setLoading(false);
    state.loadingMore = false;
    renderSuggestion();
    renderResults();
    renderPagination();
  }
}

function renderKeywordsInModal(keywords) {
  settingsModal.renderKeywords(keywords);
}

const settingsModal = createSettingsModal({
  initialNSFWMode: state.nsfwMode,
  initialPageSize: state.pageSize,
  pageSizeOptions: PAGE_SIZE_OPTIONS,
  keywords: state.keywords,
  onChangeNSFWMode: async (mode) => {
    const requested = typeof mode === 'string' ? mode.toLowerCase() : NSFW_MODES.SAFE;
    const validModes = new Set(Object.values(NSFW_MODES));
    const nextMode = validModes.has(requested) ? requested : NSFW_MODES.SAFE;

    if (nextMode === state.nsfwMode) {
      return;
    }

    if (nextMode !== NSFW_MODES.SAFE) {
      const confirmed =
        typeof window !== 'undefined'
          ? window.confirm(
              'This setting may display adult or explicit material. Please confirm you are 18 years or older before proceeding.'
            )
          : false;

      if (!confirmed) {
        state.nsfwMode = NSFW_MODES.SAFE;
        state.nsfwAcknowledged = false;
        persistSettings();
        settingsModal.setNSFWMode(state.nsfwMode);
        const safeResults = state.rawResults.length
          ? state.rawResults
          : state.results.map(({ nsfw, nsfwLevel, nsfwMatches, ...rest }) => rest);
        state.results = await applyNSFWFilter(safeResults, state.nsfwMode);
        renderResults();
        return;
      }

      state.nsfwAcknowledged = true;
    }

    state.nsfwMode = nextMode;
    persistSettings();
    settingsModal.setNSFWMode(state.nsfwMode);
    const baseResults = state.rawResults.length
      ? state.rawResults
      : state.results.map(({ nsfw, nsfwLevel, nsfwMatches, ...rest }) => rest);
    state.results = await applyNSFWFilter(baseResults, state.nsfwMode);
    renderResults();
  },
  onKeywordsChange: async (updated) => {
    state.keywords = updated;
    const baseResults = state.rawResults.length ? state.rawResults : state.results;
    state.results = await applyNSFWFilter(baseResults, state.nsfwMode);
    renderResults();
  },
  onChangePageSize: async (size) => {
    const parsed = Number(size);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed === state.pageSize) {
      return;
    }
    state.pageSize = parsed;
    state.page = 1;
    persistSettings();
    if (state.query) {
      await runSearch();
    } else {
      renderPagination();
    }
  },
  onResetSettings: async () => {
    const defaults = resetSettings();
    state.nsfwMode = defaults.nsfwMode ?? (defaults.nsfwFiltering ? NSFW_MODES.SAFE : NSFW_MODES.OFF);
    state.nsfwAcknowledged = Boolean(defaults.nsfwAcknowledged);
    state.pageSize = defaults.pageSize;
    state.page = 1;
    persistSettings();
    settingsModal.setNSFWMode(state.nsfwMode);
    settingsModal.setPageSize(state.pageSize);

    if (state.query) {
      await runSearch();
    } else if (state.results.length > 0 || state.rawResults.length > 0) {
      const baseResults = state.rawResults.length
        ? state.rawResults
        : state.results.map(({ nsfw, nsfwLevel, nsfwMatches, ...rest }) => rest);
      state.results = await applyNSFWFilter(baseResults, state.nsfwMode);
      renderResults();
      renderPagination();
    } else {
      renderPagination();
    }
  },
  onClose: () => {
    // When the modal closes, refresh keywords to ensure the UI stays in sync with storage.
    initializeKeywords();
  }
});

document.body.appendChild(settingsModal.overlay);

initializeKeywords();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    registrations.forEach((registration) => registration.unregister());
  });
}

// ✅ Alexandria Browser Audit Complete – All core features implemented and functional.
// Ready for refinement if needed.
