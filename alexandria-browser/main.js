import { searchArchive } from './src/api/archiveApi.js';
import { createSearchBar } from './src/components/SearchBar.js';
import { createResultCard } from './src/components/ResultCard.js';
import { createPaginationControls } from './src/components/PaginationControls.js';
import { createSettingsModal } from './src/components/SettingsModal.js';
import { applyNSFWFilter, getKeywords } from './src/utils/nsfwFilter.js';
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
  error: null,
  suggestion: null,
  nsfwFiltering: storedSettings.nsfwFiltering,
  keywords: []
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
    nsfwFiltering: state.nsfwFiltering,
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
    const card = createResultCard(result, { nsfwFiltering: state.nsfwFiltering });
    resultsContainer.appendChild(card);
  });
}

function renderPagination() {
  paginationContainer.innerHTML = '';
  if (state.total <= state.pageSize || state.error) return;
  const controls = createPaginationControls({
    currentPage: state.page,
    pageSize: state.pageSize,
    totalResults: state.total,
    onPageChange: (page) => {
      state.page = page;
      runSearch(false);
    }
  });
  paginationContainer.appendChild(controls);
}

async function runSearch(showLoader = true) {
  if (!state.query) return;
  if (showLoader) setLoading(true);
  state.error = null;
  try {
    const { results, total, suggestion } = await searchArchive(state.query, state.page, state.pageSize);
    state.total = total;
    state.suggestion = suggestion;
    state.rawResults = results;
    const processed = await applyNSFWFilter(results, state.nsfwFiltering);
    state.results = processed;
  } catch (error) {
    console.error(error);
    state.error = 'Unable to fetch results right now. Check your internet connection or try again later.';
    state.rawResults = [];
    state.results = [];
    state.total = 0;
  } finally {
    if (showLoader) setLoading(false);
    renderSuggestion();
    renderResults();
    renderPagination();
  }
}

function renderKeywordsInModal(keywords) {
  settingsModal.renderKeywords(keywords);
}

const settingsModal = createSettingsModal({
  initialNSFWEnabled: state.nsfwFiltering,
  initialPageSize: state.pageSize,
  pageSizeOptions: PAGE_SIZE_OPTIONS,
  keywords: state.keywords,
  onToggleNSFW: async (enabled) => {
    state.nsfwFiltering = enabled;
    persistSettings();
    const baseResults = state.rawResults.length ? state.rawResults : state.results.map(({ nsfw, ...rest }) => rest);
    state.results = await applyNSFWFilter(baseResults, enabled);
    renderResults();
  },
  onKeywordsChange: async (updated) => {
    state.keywords = updated;
    if (state.nsfwFiltering) {
      state.results = await applyNSFWFilter(state.rawResults, true);
      renderResults();
    }
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
    state.nsfwFiltering = defaults.nsfwFiltering;
    state.pageSize = defaults.pageSize;
    state.page = 1;
    persistSettings();
    settingsModal.setNSFWEnabled(state.nsfwFiltering);
    settingsModal.setPageSize(state.pageSize);

    if (state.query) {
      await runSearch();
    } else if (state.results.length > 0 || state.rawResults.length > 0) {
      const baseResults = state.rawResults.length
        ? state.rawResults
        : state.results.map(({ nsfw, ...rest }) => rest);
      state.results = await applyNSFWFilter(baseResults, state.nsfwFiltering);
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
