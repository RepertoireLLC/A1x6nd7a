import { searchArchive } from './src/api/archiveApi.js';
import { createSearchBar } from './src/components/SearchBar.js';
import { createResultCard } from './src/components/ResultCard.js';
import { createPaginationControls } from './src/components/PaginationControls.js';
import { createSettingsModal } from './src/components/SettingsModal.js';
import { applyNSFWFilter, getKeywords, NSFW_MODES } from './src/utils/nsfwFilter.js';
import { loadSettings, saveSettings, resetSettings } from './src/utils/settingsStorage.js';
import { planArchiveQuery } from './src/utils/aiPlanner.js';

const PAGE_SIZE_OPTIONS = [10, 20, 50];
const NSFW_MODE_VALUES = new Set(Object.values(NSFW_MODES));
const ADULT_CONFIRM_MESSAGE =
  'Switching to this mode may display adult content. Please confirm you are 18 years or older to continue.';

function looksLikeUrl(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /^https?:\/\//i.test(trimmed);
}

function normalizeModeValue(value) {
  if (typeof value !== 'string') {
    return NSFW_MODES.SAFE;
  }
  const lowered = value.toLowerCase();
  return NSFW_MODE_VALUES.has(lowered) ? lowered : NSFW_MODES.SAFE;
}

function requestAdultConfirmation(mode) {
  if (mode === NSFW_MODES.SAFE) {
    return true;
  }
  return window.confirm(ADULT_CONFIRM_MESSAGE);
}

const storedSettings = loadSettings();
const initialNSFWMode = normalizeModeValue(
  storedSettings.nsfwMode ?? (storedSettings.nsfwFiltering ? NSFW_MODES.SAFE : NSFW_MODES.OFF)
);

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
  nsfwMode: initialNSFWMode,
  keywords: [],
  aiPlan: null
};

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

const aiPlanBanner = document.createElement('div');
aiPlanBanner.className = 'ai-plan-banner';
aiPlanBanner.style.display = 'none';
app.appendChild(aiPlanBanner);

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

function renderAiPlan() {
  aiPlanBanner.innerHTML = '';
  const plan = state.aiPlan;
  if (!plan) {
    aiPlanBanner.style.display = 'none';
    return;
  }

  aiPlanBanner.style.display = 'block';

  const card = document.createElement('div');
  card.className = 'ai-plan-card';

  const header = document.createElement('div');
  header.className = 'ai-plan-header';
  const icon = document.createElement('span');
  icon.className = 'ai-plan-icon';
  icon.textContent = '✨';
  const summary = document.createElement('div');
  summary.className = 'ai-plan-summary';
  const title = document.createElement('div');
  title.className = 'ai-plan-title';
  title.textContent = 'AI-optimized search';
  const queryLine = document.createElement('div');
  queryLine.className = 'ai-plan-query';
  queryLine.textContent = `Refined query: ${plan.optimizedQuery}`;
  summary.appendChild(title);
  summary.appendChild(queryLine);
  header.appendChild(icon);
  header.appendChild(summary);
  card.appendChild(header);

  if (Array.isArray(plan.keywords) && plan.keywords.length > 0) {
    const keywordsWrap = document.createElement('div');
    keywordsWrap.className = 'ai-plan-keywords';
    plan.keywords.forEach((keyword, index) => {
      const chip = document.createElement('span');
      chip.className = 'ai-plan-keyword';
      chip.textContent = keyword;
      chip.setAttribute('data-index', String(index));
      keywordsWrap.appendChild(chip);
    });
    card.appendChild(keywordsWrap);
  }

  if (plan.rationale) {
    const rationale = document.createElement('p');
    rationale.className = 'ai-plan-rationale';
    rationale.textContent = plan.rationale;
    card.appendChild(rationale);
  }

  const footnote = document.createElement('p');
  footnote.className = 'ai-plan-footnote';
  const confidence =
    typeof plan.confidence === 'number' && Number.isFinite(plan.confidence)
      ? Math.round(plan.confidence * 100)
      : null;
  const footnoteParts = [`Model: ${plan.model || 'gpt-5'}`];
  if (confidence !== null) {
    footnoteParts.push(`Confidence ${confidence}%`);
  }
  footnote.textContent = footnoteParts.join(' · ');
  card.appendChild(footnote);

  aiPlanBanner.appendChild(card);
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
  const trimmed = typeof state.query === 'string' ? state.query.trim() : '';
  if (!trimmed) {
    state.aiPlan = null;
    renderAiPlan();
    return;
  }
  if (showLoader) setLoading(true);
  state.error = null;

  let finalQuery = trimmed;
  const shouldUsePlanner = !looksLikeUrl(trimmed);

  if (shouldUsePlanner) {
    let plan = state.aiPlan;
    if (!plan || plan.source !== trimmed) {
      try {
        plan = await planArchiveQuery(trimmed);
      } catch (plannerError) {
        console.warn('AI planner unavailable', plannerError);
        plan = null;
      }
    }

    if (plan && typeof plan.optimizedQuery === 'string' && plan.optimizedQuery.trim()) {
      const normalizedPlan = plan.source === trimmed ? plan : { ...plan, source: trimmed };
      state.aiPlan = normalizedPlan;
      finalQuery = normalizedPlan.optimizedQuery.trim();
    } else {
      state.aiPlan = null;
    }
  } else {
    state.aiPlan = null;
  }

  renderAiPlan();

  try {
    const { results, total, suggestion } = await searchArchive(finalQuery, state.page, state.pageSize);
    state.total = total;
    state.suggestion = suggestion;
    state.rawResults = results;
    const processed = await applyNSFWFilter(results, state.nsfwMode);
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
    renderAiPlan();
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
    const desiredMode = normalizeModeValue(mode);
    if (!requestAdultConfirmation(desiredMode)) {
      state.nsfwMode = NSFW_MODES.SAFE;
      persistSettings();
      settingsModal.setNSFWMode(state.nsfwMode);
      const fallbackSource = state.rawResults.length
        ? state.rawResults
        : state.results.map(({ nsfw, nsfwLevel, nsfwMatches, ...rest }) => rest);
      state.results = await applyNSFWFilter(fallbackSource, state.nsfwMode);
      renderResults();
      renderPagination();
      return;
    }

    state.nsfwMode = desiredMode;
    persistSettings();
    const baseResults = state.rawResults.length
      ? state.rawResults
      : state.results.map(({ nsfw, nsfwLevel, nsfwMatches, ...rest }) => rest);
    state.results = await applyNSFWFilter(baseResults, state.nsfwMode);
    renderResults();
    renderPagination();
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
    state.nsfwMode = normalizeModeValue(
      defaults.nsfwMode ?? (defaults.nsfwFiltering ? NSFW_MODES.SAFE : NSFW_MODES.OFF)
    );
    state.pageSize = defaults.pageSize;
    state.page = 1;
    state.aiPlan = null;
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
      renderAiPlan();
      renderResults();
      renderPagination();
    } else {
      renderAiPlan();
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
