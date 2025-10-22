const STORAGE_KEY = 'alexandria_browser_settings';

const NSFW_MODE_VALUES = ['safe', 'moderate', 'off', 'only'];

const DEFAULT_SETTINGS = Object.freeze({
  nsfwMode: 'safe',
  nsfwFiltering: true,
  pageSize: 10
});

function isValidMode(mode) {
  return typeof mode === 'string' && NSFW_MODE_VALUES.includes(mode.toLowerCase());
}

function resolveMode(preferred, fallbackBoolean) {
  if (isValidMode(preferred)) {
    return preferred.toLowerCase();
  }
  if (typeof fallbackBoolean === 'boolean') {
    return fallbackBoolean ? 'safe' : 'off';
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
    const nsfwFiltering = nsfwMode !== 'off';
    return {
      nsfwMode,
      nsfwFiltering,
      pageSize: Number.isFinite(pageSizeValue) && pageSizeValue > 0 ? pageSizeValue : DEFAULT_SETTINGS.pageSize
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
  const settings = {
    nsfwMode,
    nsfwFiltering: nsfwMode !== 'off',
    pageSize: Number.isFinite(pageSizeValue) && pageSizeValue > 0 ? pageSizeValue : DEFAULT_SETTINGS.pageSize
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
