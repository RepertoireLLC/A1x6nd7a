/**
 * Shared type definitions for the Alexandria Browser frontend.
 * These interfaces mirror the payloads returned by the backend API
 * so components can rely on a consistent shape when exchanging data.
 */
export type NSFWSeverity = "mild" | "explicit";

export type NSFWFilterMode = "safe" | "moderate" | "off" | "only";

export type NSFWUserMode = "safe" | "moderate" | "unrestricted" | "only-nsfw";

export type SourceTrustLevel = "high" | "medium" | "low";

export type BackendAISummaryStatus = "success" | "unavailable" | "error";

export type AISummaryStatus = BackendAISummaryStatus | "disabled" | "loading";

export type AISummarySource = "model" | "heuristic";

export type AIAvailabilityStatus = "unknown" | "ready" | "unavailable" | "error" | "disabled";

export type AIChatRole = "user" | "assistant" | "system";

export interface AIChatMessage {
  id: string;
  role: AIChatRole;
  content: string;
  createdAt: number;
  error?: boolean;
}

export type AIDocumentHelperStatus = "idle" | "loading" | "success" | "error" | "unavailable" | "disabled";

export interface SearchScoreBreakdown {
  keywordRelevance: number;
  semanticRelevance: number;
  documentQuality: number;
  popularityScore: number;
  combinedScore: number;
}

export interface ArchiveSearchDoc {
  identifier: string;
  title?: string;
  description?: string | string[];
  mediatype?: string;
  year?: string;
  date?: string;
  publicdate?: string;
  creator?: string | string[];
  collection?: string | string[];
  nsfw?: boolean;
  nsfwLevel?: NSFWSeverity;
  nsfw_level?: NSFWSeverity;
  nsfwMatches?: string[];
  nsfw_matches?: string[];
  links?: ArchiveDocLinks;
  thumbnail?: string;
  archive_url?: string;
  original_url?: string;
  wayback_url?: string;
  downloads?: number | string | null;
  score?: number | null;
  score_breakdown?: SearchScoreBreakdown;
  availability?: LinkStatus;
  source_trust?: SourceTrustLevel | null;
  source_trust_level?: SourceTrustLevel | null;
  language?: string | string[] | null;
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
  alternate_queries?: string[];
  original_numFound?: number | null;
  filtered_count?: number | null;
  page_original_count?: number | null;
  page_filtered_count?: number | null;
  page_hidden_count?: number | null;
  ai_summary?: string | null;
  ai_summary_status?: BackendAISummaryStatus;
  ai_summary_error?: string | null;
  ai_summary_source?: AISummarySource;
  ai_summary_notice?: string | null;
  ai_search_interpretation?: string | null;
  ai_search_keywords?: string[];
  ai_search_refined_query?: string | null;
  ai_search_collection_hint?: string | null;
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
  score?: number | null;
  score_breakdown?: SearchScoreBreakdown;
  availability?: LinkStatus | null;
  source_trust?: SourceTrustLevel | null;
  language?: string | null;
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
  nsfw?: boolean;
  nsfwLevel?: NSFWSeverity;
  nsfwMatches?: string[];
}

export interface ScrapeResponse {
  items: ScrapeItem[];
  total: number;
  fallback?: boolean;
  query: string;
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
  nsfwMode: NSFWFilterMode;
  nsfwAcknowledged: boolean;
  lastQuery: string;
  resultsPerPage: number;
  mediaType: string;
  yearFrom: string;
  yearTo: string;
  language: string;
  sourceTrust: string;
  availability: string;
  aiAssistantEnabled?: boolean;
}

export interface SearchFilters {
  mediaType: string;
  yearFrom: string;
  yearTo: string;
  language: string;
  sourceTrust: string;
  availability: string;
  nsfwMode: NSFWFilterMode;
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
