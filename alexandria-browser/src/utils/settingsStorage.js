const STORAGE_KEY = 'alexandria_browser_settings';

const NSFW_MODE_VALUES = ['safe', 'moderate', 'unrestricted', 'nsfw-only'];

const DEFAULT_SETTINGS = Object.freeze({
  nsfwMode: 'safe',
  nsfwFiltering: true,
  nsfwAcknowledged: false,
  pageSize: 10,
  aiSearchEnabled: false
});

// Convert legacy stored values into the expanded toggle vocabulary.
function normalizeModeValue(mode) {
  if (typeof mode !== 'string') {
    return null;
  }
  const lowered = mode.toLowerCase();
  if (NSFW_MODE_VALUES.includes(lowered)) {
    return lowered;
  }
  if (['off', 'none', 'no_filter'].includes(lowered)) {
    return 'unrestricted';
  }
  if (['only', 'only_nsfw', 'nsfw'].includes(lowered)) {
    return 'nsfw-only';
  }
  return null;
}

function resolveMode(preferred, fallbackBoolean) {
  const normalizedPreferred = normalizeModeValue(preferred);
  if (normalizedPreferred) {
    return normalizedPreferred;
  }
  if (typeof fallbackBoolean === 'boolean') {
    return fallbackBoolean ? 'safe' : 'unrestricted';
  }
  return DEFAULT_SETTINGS.nsfwMode;
}

function readSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_SETTINGS };
    }
    const parsed = JSON.parse(raw);
    const pageSizeValue = Number(parsed?.pageSize);
    const nsfwMode = resolveMode(parsed?.nsfwMode, parsed?.nsfwFiltering);
    const nsfwAcknowledged = Boolean(parsed?.nsfwAcknowledged);
    const resolvedMode = nsfwAcknowledged ? nsfwMode : DEFAULT_SETTINGS.nsfwMode;
    const nsfwFiltering = resolvedMode !== 'unrestricted';
    return {
      nsfwMode: resolvedMode,
      nsfwFiltering,
      nsfwAcknowledged,
      pageSize: Number.isFinite(pageSizeValue) && pageSizeValue > 0 ? pageSizeValue : DEFAULT_SETTINGS.pageSize,
      aiSearchEnabled: Boolean(parsed?.aiSearchEnabled)
    };
  } catch (error) {
    console.warn('Failed to read saved settings, using defaults.', error);
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn('Unable to persist settings to localStorage', error);
  }
}

export function loadSettings() {
  return readSettings();
}

export function saveSettings(next) {
  const pageSizeValue = Number(next?.pageSize);
  const nsfwMode = resolveMode(next?.nsfwMode, next?.nsfwFiltering);
  const nsfwAcknowledged = Boolean(next?.nsfwAcknowledged);
  const settings = {
    nsfwMode,
    nsfwFiltering: nsfwMode !== 'unrestricted',
    nsfwAcknowledged,
    pageSize: Number.isFinite(pageSizeValue) && pageSizeValue > 0 ? pageSizeValue : DEFAULT_SETTINGS.pageSize,
    aiSearchEnabled: Boolean(next?.aiSearchEnabled)
  };
  writeSettings(settings);
  return settings;
}

export function resetSettings() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('Unable to clear stored settings', error);
  }
  return { ...DEFAULT_SETTINGS };
}

export { DEFAULT_SETTINGS };
