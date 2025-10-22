import type {
  BookmarkEntry,
  SearchHistoryEntry,
  StoredSettings,
  NSFWFilterMode
} from "../types";

const SETTINGS_KEY = "alexandria-browser-settings";
const HISTORY_KEY = "alexandria-browser-history";
const HISTORY_BOOTSTRAP_KEY = "alexandria-browser-history-cleared";
const BOOKMARKS_KEY = "alexandria-browser-bookmarks";
const REPORT_BLACKLIST_KEY = "alexandria-browser-report-blacklist";

// ADD: Default preference snapshot used when initializing or resetting stored settings.
const NSFW_MODE_VALUES: readonly NSFWFilterMode[] = ["safe", "moderate", "off", "only"];

function normalizeMode(value: unknown, fallback: unknown): NSFWFilterMode {
  if (typeof value === "string") {
    const lowered = value.toLowerCase();
    if (NSFW_MODE_VALUES.includes(lowered as NSFWFilterMode)) {
      return lowered as NSFWFilterMode;
    }
  }
  if (typeof fallback === "boolean") {
    return fallback ? "safe" : "off";
  }
  return "safe";
}

export const DEFAULT_SETTINGS: StoredSettings = {
  theme: "light",
  filterNSFW: true,
  nsfwMode: "safe",
  lastQuery: "",
  resultsPerPage: 20,
  mediaType: "all",
  yearFrom: "",
  yearTo: ""
};

/**
 * Safely read a JSON blob from localStorage.
 */
function readJSON<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const rawValue = window.localStorage.getItem(key);
    if (!rawValue) {
      return fallback;
    }
    return JSON.parse(rawValue) as T;
  } catch (error) {
    console.warn(`Failed to parse localStorage key ${key}`, error);
    return fallback;
  }
}

/**
 * Persist a JSON blob to localStorage.
 */
function writeJSON<T>(key: string, value: T) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Failed to save localStorage key ${key}`, error);
  }
}

/**
 * Retrieve stored application settings or default values.
 */
export function loadSettings(): StoredSettings {
  const stored = readJSON(SETTINGS_KEY, DEFAULT_SETTINGS as StoredSettings);
  const nsfwMode = normalizeMode((stored as Partial<StoredSettings>).nsfwMode, stored.filterNSFW);
  return {
    ...stored,
    nsfwMode,
    filterNSFW: nsfwMode !== "off"
  };
}

/**
 * Persist the provided application settings snapshot.
 */
export function saveSettings(settings: StoredSettings) {
  const nsfwMode = normalizeMode(settings.nsfwMode, settings.filterNSFW);
  writeJSON(SETTINGS_KEY, {
    ...settings,
    nsfwMode,
    filterNSFW: nsfwMode !== "off"
  });
}

/**
 * Fetch the saved search history entries.
 */
export function loadHistory(): SearchHistoryEntry[] {
  const history = readJSON(HISTORY_KEY, []);
  if (typeof window === "undefined") {
    return history;
  }

  try {
    const bootstrapped = window.localStorage.getItem(HISTORY_BOOTSTRAP_KEY);
    if (!bootstrapped) {
      window.localStorage.setItem(HISTORY_BOOTSTRAP_KEY, "true");
      if (history.length > 0) {
        writeJSON(HISTORY_KEY, []);
      }
      return [];
    }
  } catch (error) {
    console.warn("Failed to initialize stored history", error);
    return [];
  }

  return history;
}

/**
 * Persist the search history list.
 */
export function saveHistory(history: SearchHistoryEntry[]) {
  writeJSON(HISTORY_KEY, history);
}

/**
 * Retrieve bookmarked archive identifiers.
 */
export function loadBookmarks(): BookmarkEntry[] {
  return readJSON(BOOKMARKS_KEY, []);
}

/**
 * Persist bookmarked archive identifiers.
 */
export function saveBookmarks(bookmarks: BookmarkEntry[]) {
  writeJSON(BOOKMARKS_KEY, bookmarks);
}

export function loadBlacklist(): string[] {
  return readJSON(REPORT_BLACKLIST_KEY, [] as string[]);
}

export function saveBlacklist(blacklist: string[]) {
  writeJSON(REPORT_BLACKLIST_KEY, blacklist);
}

// ADD: Remove the persisted settings blob and return a fresh copy of default values.
export function resetStoredSettings(): StoredSettings {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(SETTINGS_KEY);
    } catch (error) {
      console.warn("Failed to clear saved settings", error);
    }
  }

  return { ...DEFAULT_SETTINGS };
}
