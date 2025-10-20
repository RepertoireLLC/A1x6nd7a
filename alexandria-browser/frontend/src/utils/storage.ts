import type {
  BookmarkEntry,
  SearchHistoryEntry,
  StoredSettings
} from "../types";

const SETTINGS_KEY = "alexandria-browser-settings";
const HISTORY_KEY = "alexandria-browser-history";
const BOOKMARKS_KEY = "alexandria-browser-bookmarks";

const DEFAULT_SETTINGS: StoredSettings = {
  theme: "light",
  filterNSFW: true,
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
  return readJSON(SETTINGS_KEY, DEFAULT_SETTINGS);
}

/**
 * Persist the provided application settings snapshot.
 */
export function saveSettings(settings: StoredSettings) {
  writeJSON(SETTINGS_KEY, settings);
}

/**
 * Fetch the saved search history entries.
 */
export function loadHistory(): SearchHistoryEntry[] {
  return readJSON(HISTORY_KEY, []);
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
