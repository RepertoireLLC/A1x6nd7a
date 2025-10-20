/**
 * Shared type definitions for the Alexandria Browser frontend.
 * These interfaces mirror the payloads returned by the backend API
 * so components can rely on a consistent shape when exchanging data.
 */
export interface ArchiveSearchDoc {
  identifier: string;
  title?: string;
  description?: string | string[];
  mediatype?: string;
  year?: string;
  date?: string;
  publicdate?: string;
  creator?: string | string[];
  nsfw?: boolean;
}

export interface SpellcheckCorrection {
  original: string;
  corrected: string;
}

export interface SpellcheckPayload {
  originalQuery: string;
  correctedQuery: string;
  corrections: SpellcheckCorrection[];
}

export interface ArchiveSearchResponse {
  response?: {
    docs?: ArchiveSearchDoc[];
    numFound?: number;
    start?: number;
  };
  spellcheck?: SpellcheckPayload | null;
}

export type LinkStatus = "online" | "archived-only" | "offline" | "checking";

export interface SavePageResponse {
  success?: boolean;
  snapshotUrl?: string;
  message?: string;
  error?: string;
  details?: string;
}

export interface StoredSettings {
  theme: "light" | "dark";
  filterNSFW: boolean;
  lastQuery: string;
  resultsPerPage: number;
  mediaType: string;
  yearFrom: string;
  yearTo: string;
}

export interface SearchFilters {
  mediaType: string;
  yearFrom: string;
  yearTo: string;
}

export interface SearchHistoryEntry {
  query: string;
  timestamp: number;
}

export interface BookmarkEntry {
  identifier: string;
  title: string;
  addedAt: number;
  mediatype?: string;
}
