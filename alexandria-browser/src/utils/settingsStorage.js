const STORAGE_KEY = 'alexandria_browser_settings';

const DEFAULT_SETTINGS = Object.freeze({
  nsfwFiltering: true,
  pageSize: 10
});

function readSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_SETTINGS };
    }
    const parsed = JSON.parse(raw);
    const pageSizeValue = Number(parsed?.pageSize);
    return {
      nsfwFiltering:
        typeof parsed?.nsfwFiltering === 'boolean' ? parsed.nsfwFiltering : DEFAULT_SETTINGS.nsfwFiltering,
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
  const settings = {
    nsfwFiltering:
      typeof next?.nsfwFiltering === 'boolean' ? next.nsfwFiltering : DEFAULT_SETTINGS.nsfwFiltering,
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
