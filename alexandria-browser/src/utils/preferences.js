const PREFERENCES_KEY = 'alexandria_preferences';
let cachedPreferences = null;

function getStorage() {
  try {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    return localStorage;
  } catch (error) {
    console.warn('Preferences storage is not available', error); // FIX: Surface storage availability issues without breaking execution.
    return null;
  }
}

function readPreferences() {
  if (cachedPreferences) {
    return cachedPreferences;
  }

  const storage = getStorage();
  if (!storage) {
    cachedPreferences = {};
    return cachedPreferences;
  }

  try {
    const raw = storage.getItem(PREFERENCES_KEY);
    cachedPreferences = raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.warn('Unable to parse stored preferences', error); // FIX: Avoid crashing when corrupt data is encountered in storage.
    cachedPreferences = {};
  }

  return cachedPreferences;
}

function writePreferences(nextPreferences) {
  const storage = getStorage();
  if (!storage) {
    cachedPreferences = nextPreferences;
    return cachedPreferences;
  }

  try {
    storage.setItem(PREFERENCES_KEY, JSON.stringify(nextPreferences));
    cachedPreferences = nextPreferences;
  } catch (error) {
    console.warn('Unable to persist preferences', error); // FIX: Fail gracefully when storage quota or access issues occur.
    cachedPreferences = nextPreferences;
  }

  return cachedPreferences;
}

export function loadPreferences() {
  return { ...readPreferences() }; // ADD: Provide a defensive copy so callers cannot mutate the cached object directly.
}

export function savePreferences(update) {
  const current = readPreferences();
  const next = { ...current, ...update };
  return writePreferences(next); // ADD: Merge updates with existing preferences while keeping the cache in sync.
}
