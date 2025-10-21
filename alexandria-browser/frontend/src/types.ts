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
  score?: number | string | null;
  year?: string;
  date?: string;
  publicdate?: string;
  creator?: string | string[];
  collection?: string | string[];
  subject?: string | string[];
  tags?: string | string[];
  topic?: string | string[];
  keywords?: string | string[];
  nsfw?: boolean;
  links?: ArchiveDocLinks;
  thumbnail?: string;
  archive_url?: string;
  original_url?: string;
  wayback_url?: string;
  downloads?: number | string | null;
}

export interface ArchiveDocLinks {
  archive: string;
  original?: string | null;
  wayback?: string | null;
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
  fallback?: boolean;
  fallback_reason?: string;
  fallback_message?: string;
  results?: ArchiveSearchResultSummary[];
  pagination?: SearchPagination;
  search_strategy?: string;
  search_strategy_query?: string;
  search_notice?: string | null;
  search_transformations?: string[];
  sanitized_query?: string | null;
  connection_mode?: "backend" | "direct" | "offline";
}

export interface ArchiveSearchResultSummary {
  identifier: string;
  title: string;
  description: string;
  mediatype: string | null;
  year: string | null;
  creator: string | null;
  archive_url: string | null;
  original_url: string | null;
  downloads: number | null;
}

export interface SearchPagination {
  page: number;
  rows: number;
  total: number | null;
}

export type LinkStatus = "online" | "archived-only" | "offline" | "checking";

export interface SavePageResponse {
  success?: boolean;
  snapshotUrl?: string;
  message?: string;
  error?: string;
  details?: string;
}

export interface ArchiveMetadataFile {
  name: string;
  format?: string;
  size?: number;
  mtime?: string;
}

export interface ArchiveMetadataResponse {
  metadata?: Record<string, unknown>;
  files?: ArchiveMetadataFile[];
  fallback?: boolean;
}

export interface CdxSnapshot {
  timestamp: string;
  original: string;
  status: string;
  mime: string;
  digest?: string;
  length?: number;
}

export interface CdxResponse {
  snapshots: CdxSnapshot[];
  fallback?: boolean;
}

export interface ScrapeItem {
  identifier: string;
  title?: string;
  mediatype?: string;
  description?: string;
  publicdate?: string;
  downloads?: number;
  links?: ArchiveDocLinks;
  archive_url?: string;
  original_url?: string;
  wayback_url?: string;
}

export interface ScrapeResponse {
  items: ScrapeItem[];
  total: number;
  fallback?: boolean;
  query: string;
}

export interface SiteImageEntry {
  timestamp: string;
  original: string;
  mime: string;
  status: string;
  length?: number;
  archived_url: string;
  image_url: string;
  thumbnail_url: string;
}

export interface SiteImageResponse {
  items: SiteImageEntry[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  query: string;
  scope: "host" | "path";
  total?: number;
  site: string;
  fallback?: boolean;
}

export interface WaybackAvailabilitySnapshot {
  available?: boolean;
  url?: string;
  timestamp?: string;
  status?: string;
}

export interface WaybackAvailabilityResponse {
  url?: string;
  archived_snapshots?: {
    closest?: WaybackAvailabilitySnapshot;
    [key: string]: WaybackAvailabilitySnapshot | undefined;
  };
  [key: string]: unknown;
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
  archiveUrl?: string;
}
