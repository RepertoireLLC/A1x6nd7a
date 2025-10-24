import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type JSX
} from "react";

import { BrowserNav } from "./components/BrowserNav";
import { SearchBar } from "./components/SearchBar";
import { Sidebar } from "./components/Sidebar";
import { ResultsList } from "./components/ResultsList";
import { SettingsPanel } from "./components/SettingsPanel";
import { LiveStatusCard } from "./components/LiveStatusCard";
import { WaybackAvailabilityCard } from "./components/WaybackAvailabilityCard";
import { AiAssistantPanel } from "./components/AiAssistantPanel";
import { AiChatPanel } from "./components/AiChatPanel";
import {
  searchArchive,
  checkLinkStatus,
  requestSaveSnapshot,
  fetchArchiveMetadata,
  fetchCdxSnapshots,
  scrapeArchive,
  getWaybackAvailability,
  submitReport
} from "./api/archive";
import { fetchAIStatus, submitAIQuery, type AIQueryContext } from "./api/ai";
import {
  loadBookmarks,
  loadHistory,
  loadSettings,
  resetStoredSettings,
  saveBookmarks,
  saveHistory,
  saveSettings,
  loadBlacklist,
  saveBlacklist
} from "./utils/storage";
import { useDebouncedValue } from "./utils/hooks";
import { isLikelyUrl, isYearValid, normalizeYear } from "./utils/validators";
import type {
  ArchiveMetadataResponse,
  ArchiveSearchDoc,
  ArchiveSearchResponse,
  BookmarkEntry,
  CdxResponse,
  LinkStatus,
  ScrapeItem,
  SearchHistoryEntry,
  SpellcheckCorrection,
  StoredSettings,
  NSFWFilterMode,
  WaybackAvailabilityResponse,
  AISummaryStatus,
  AISummarySource,
  BackendAISummaryStatus,
  AIAvailabilityStatus,
  AIChatMessage,
  AIDocumentHelperStatus
} from "./types";
import { ItemDetailsPanel } from "./components/ItemDetailsPanel";
import type { ReportSubmissionPayload } from "./reporting";
import { annotateDocs, annotateScrapeItems, applyNSFWModeToScrape, shouldIncludeDoc } from "./utils/nsfw";
import { filterByNSFWMode as filterDocsByNSFWMode, getNSFWMode as resolveUserNSFWMode } from "./utils/nsfwMode";
import { mergeRankedResults } from "./utils/relevance";

function parseBackendAIStatus(value: unknown): BackendAISummaryStatus | null {
  if (value === "success" || value === "unavailable" || value === "error") {
    return value;
  }
  return null;
}

function extractDocSummaryText(description: ArchiveSearchDoc["description"] | undefined): string | null {
  if (!description) {
    return null;
  }

  if (typeof description === "string") {
    return description;
  }

  if (Array.isArray(description)) {
    return description.join(" ");
  }

  return null;
}

function createAiChatMessage(role: AIChatMessage["role"], content: string, error = false): AIChatMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    role,
    content,
    createdAt: Date.now(),
    error,
  };
}

const RESULTS_PER_PAGE_OPTIONS = [10, 20, 50];
const MEDIA_TYPE_OPTIONS = [
  { value: "all", label: "All media" },
  { value: "texts", label: "Texts" },
  { value: "audio", label: "Audio" },
  { value: "movies", label: "Video" },
  { value: "image", label: "Images" },
  { value: "software", label: "Software" },
  { value: "web", label: "Web" },
  { value: "data", label: "Data" }
] as const;

const LANGUAGE_OPTIONS = [
  { value: "", label: "All languages" },
  { value: "english", label: "English" },
  { value: "spanish", label: "Spanish" },
  { value: "french", label: "French" },
  { value: "german", label: "German" }
] as const;

const SOURCE_TRUST_OPTIONS = [
  { value: "any", label: "All sources" },
  { value: "high", label: "High trust" },
  { value: "medium", label: "Standard" },
  { value: "low", label: "Community" }
] as const;

const AVAILABILITY_OPTIONS = [
  { value: "any", label: "Any availability" },
  { value: "online", label: "Online" },
  { value: "archived-only", label: "Archived only" }
] as const;

interface SaveMeta {
  label: string;
  disabled: boolean;
  message: string | null;
  tone?: "success" | "error" | "info";
  snapshotUrl?: string;
}

const DEFAULT_SAVE_META: SaveMeta = {
  label: "Save to Archive",
  disabled: false,
  message: null,
  tone: "info"
};

interface NormalizedSearchFilters {
  mediaType: string;
  yearFrom: string;
  yearTo: string;
  language: string;
  sourceTrust: string;
  availability: string;
  collection: string;
  uploader: string;
  subject: string;
  nsfwMode: NSFWFilterMode;
}

interface SearchSessionCache {
  key: string;
  query: string;
  rows: number;
  filters: NormalizedSearchFilters;
  aiEnabled: boolean;
  pages: Map<number, ArchiveSearchResponse>;
  lastAccessed: number;
}

const MAX_CACHED_PAGES = 6;
const MAX_SESSION_CACHE = 6;
const DETAIL_CACHE_LIMIT = 24;
const STATUS_CACHE_LIMIT = 120;
const WAYBACK_CACHE_LIMIT = 80;

const METADATA_CACHE_TTL = 10 * 60 * 1000;
const TIMELINE_CACHE_TTL = 10 * 60 * 1000;
const RELATED_CACHE_TTL = 5 * 60 * 1000;
const STATUS_CACHE_TTL = 2 * 60 * 1000;
const WAYBACK_CACHE_TTL = 5 * 60 * 1000;

interface CachedMetadataEntry {
  payload: ArchiveMetadataResponse;
  timestamp: number;
}

interface CachedTimelineEntry {
  payload: CdxResponse;
  timestamp: number;
}

interface CachedRelatedEntry {
  items: ScrapeItem[];
  fallback: boolean;
  timestamp: number;
}

interface CachedStatusEntry {
  status: LinkStatus;
  timestamp: number;
}

interface CachedWaybackEntry {
  payload: WaybackAvailabilityResponse | null;
  timestamp: number;
}

function pruneTimedCache<T extends { timestamp: number }>(cache: Map<string, T>, limit: number) {
  if (cache.size <= limit) {
    return;
  }

  const entries = Array.from(cache.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp);
  for (const [key] of entries) {
    if (cache.size <= limit) {
      break;
    }
    cache.delete(key);
  }
}

function buildSearchCacheKey(
  query: string,
  rows: number,
  filters: NormalizedSearchFilters,
  aiEnabled: boolean
): string {
  return [
    query.toLowerCase(),
    rows,
    filters.mediaType,
    filters.yearFrom,
    filters.yearTo,
    filters.language,
    filters.sourceTrust,
    filters.availability,
    filters.collection,
    filters.uploader,
    filters.subject,
    filters.nsfwMode,
    aiEnabled ? "1" : "0"
  ].join("|");
}

/**
 * Alexandria Browser root application component orchestrating layout and data fetching.
 */
function App() {
  const initialSettings = useRef<StoredSettings | null>(null);
  if (initialSettings.current === null) {
    initialSettings.current = loadSettings();
  }

  const settings = initialSettings.current;

  const [theme, setTheme] = useState<"light" | "dark">(() => settings.theme);
  const [nsfwMode, setNsfwMode] = useState<NSFWFilterMode>(
    () => settings.nsfwMode ?? (settings.filterNSFW ? "safe" : "unrestricted")
  );
  const [nsfwAcknowledged, setNsfwAcknowledged] = useState<boolean>(() => Boolean(settings.nsfwAcknowledged));
  const [query, setQuery] = useState(() => settings.lastQuery);
  const [activeQuery, setActiveQuery] = useState<string | null>(() =>
    settings.lastQuery ? settings.lastQuery : null
  );
  const [results, setResults] = useState<ArchiveSearchDoc[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [totalResults, setTotalResults] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [loadedPages, setLoadedPages] = useState<number[]>([]);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(() => Boolean(settings.lastQuery));
  const [resultsPerPage, setResultsPerPage] = useState(() => settings.resultsPerPage);
  const [mediaType, setMediaType] = useState(() => settings.mediaType);
  const [yearFrom, setYearFrom] = useState(() => settings.yearFrom);
  const [yearTo, setYearTo] = useState(() => settings.yearTo);
  const [language, setLanguage] = useState(() => settings.language);
  const [sourceTrust, setSourceTrust] = useState(() => settings.sourceTrust);
  const [availability, setAvailability] = useState(() => settings.availability);
  const [collection, setCollection] = useState(() => settings.collection ?? "");
  const [uploader, setUploader] = useState(() => settings.uploader ?? "");
  const [subject, setSubject] = useState(() => settings.subject ?? "");
  const [statuses, setStatuses] = useState<Record<string, LinkStatus>>({});
  const [saveMeta, setSaveMeta] = useState<Record<string, SaveMeta>>({});
  const [suggestedQuery, setSuggestedQuery] = useState<string | null>(null);
  const [suggestionCorrections, setSuggestionCorrections] = useState<SpellcheckCorrection[]>([]);
  const [aiOriginalQuery, setAiOriginalQuery] = useState<string | null>(null);
  const [aiRefinedQuery, setAiRefinedQuery] = useState<string | null>(null);
  const [aiRefinementTopics, setAiRefinementTopics] = useState<string[]>([]);
  const [aiAssistantEnabled, setAiAssistantEnabled] = useState(() => Boolean(settings.aiAssistantEnabled));
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiSummaryStatus, setAiSummaryStatus] = useState<AISummaryStatus>(() =>
    settings.aiAssistantEnabled ? "unavailable" : "disabled"
  );
  const [aiSummaryError, setAiSummaryError] = useState<string | null>(null);
  const [aiSummaryNotice, setAiSummaryNotice] = useState<string | null>(null);
  const [aiSummarySource, setAiSummarySource] = useState<AISummarySource | null>(null);
  const [aiPanelCollapsed, setAiPanelCollapsed] = useState(false);
  const [aiAvailability, setAiAvailability] = useState<AIAvailabilityStatus>(() =>
    settings.aiAssistantEnabled ? "unknown" : "disabled"
  );
  const [aiChatMessages, setAiChatMessages] = useState<AIChatMessage[]>([]);
  const [aiChatSending, setAiChatSending] = useState(false);
  const [aiChatError, setAiChatError] = useState<string | null>(null);
  const [aiNavigationLoading, setAiNavigationLoading] = useState(false);
  const [aiDocHelperStatus, setAiDocHelperStatus] = useState<AIDocumentHelperStatus>(() =>
    settings.aiAssistantEnabled ? "idle" : "disabled"
  );
  const [aiDocHelperMessage, setAiDocHelperMessage] = useState<string | null>(null);
  const [aiDocHelperError, setAiDocHelperError] = useState<string | null>(null);
  const initialHistory = useRef<SearchHistoryEntry[]>(loadHistory());
  const initialBookmarks = useRef<BookmarkEntry[]>(loadBookmarks());
  const initialBlacklist = useRef<string[]>(loadBlacklist());
  const [history, setHistory] = useState<SearchHistoryEntry[]>(() => initialHistory.current);
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>(() => initialBookmarks.current);
  const [blacklist, setBlacklist] = useState<string[]>(() => initialBlacklist.current);
  const [historyIndex, setHistoryIndex] = useState<number>(() => {
    if (!settings.lastQuery) {
      return -1;
    }
    const position = initialHistory.current.findIndex((entry) => entry.query === settings.lastQuery);
    return position >= 0 ? position : 0;
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"bookmarks" | "history" | "settings" | "assistant">(
    "bookmarks"
  );
  const [liveStatus, setLiveStatus] = useState<LinkStatus | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<ArchiveSearchDoc | null>(null);
  const [metadataState, setMetadataState] = useState<{
    data: ArchiveMetadataResponse | null;
    loading: boolean;
    error: string | null;
  }>({ data: null, loading: false, error: null });
  const [timelineState, setTimelineState] = useState<{
    data: CdxResponse | null;
    loading: boolean;
    error: string | null;
  }>({ data: null, loading: false, error: null });
  const [relatedItems, setRelatedItems] = useState<ScrapeItem[]>([]);
  const [relatedFallback, setRelatedFallback] = useState(false);
  const [relatedError, setRelatedError] = useState<string | null>(null);
  const [waybackDetails, setWaybackDetails] = useState<WaybackAvailabilityResponse | null>(null);
  const [waybackError, setWaybackError] = useState<string | null>(null);
  const [alternateSuggestions, setAlternateSuggestions] = useState<string[]>([]);
  const [filterNotice, setFilterNotice] = useState<string | null>(null);

  const resultsContainerRef = useRef<HTMLDivElement | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const bootstrapped = useRef(false);
  const blacklistRef = useRef<string[]>(initialBlacklist.current);
  const searchSessionRef = useRef<SearchSessionCache | null>(null);
  const searchCacheRef = useRef<Map<string, SearchSessionCache>>(new Map());
  const metadataCacheRef = useRef<Map<string, CachedMetadataEntry>>(new Map());
  const timelineCacheRef = useRef<Map<string, CachedTimelineEntry>>(new Map());
  const relatedCacheRef = useRef<Map<string, CachedRelatedEntry>>(new Map());
  const statusCacheRef = useRef<Map<string, CachedStatusEntry>>(new Map());
  const waybackCacheRef = useRef<Map<string, CachedWaybackEntry>>(new Map());
  const searchAbortRef = useRef<AbortController | null>(null);
  const autoSearchReadyRef = useRef(settings.lastQuery ? false : true);
  const lastAutoQueryRef = useRef<string | null>(null);
  const debouncedQuery = useDebouncedValue(query, 350);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    const settingsPayload: StoredSettings = {
      theme,
      filterNSFW: nsfwMode !== "unrestricted",
      nsfwMode,
      nsfwAcknowledged,
      lastQuery: activeQuery ?? "",
      resultsPerPage,
      mediaType,
      yearFrom,
      yearTo,
      language,
      sourceTrust,
      availability,
      collection,
      uploader,
      subject,
      aiAssistantEnabled
    };
    saveSettings(settingsPayload);
  }, [
    theme,
    nsfwMode,
    nsfwAcknowledged,
    activeQuery,
    resultsPerPage,
    mediaType,
    yearFrom,
    yearTo,
    language,
    sourceTrust,
    availability,
    collection,
    uploader,
    subject,
    aiAssistantEnabled
  ]);

  useEffect(() => {
    saveHistory(history);
  }, [history]);

  useEffect(() => {
    saveBookmarks(bookmarks);
  }, [bookmarks]);

  useEffect(() => {
    if (!aiAssistantEnabled) {
      return;
    }

    let cancelled = false;

    const evaluateStatus = async () => {
      const statusResult = await fetchAIStatus();
      if (cancelled) {
        return;
      }

      if (!statusResult.ok) {
        setAiAvailability("error");
        return;
      }

      const { enabled, outcome, models, directoryAccessible } = statusResult.data;

      if (!enabled || outcome.status === "disabled") {
        setAiAvailability("disabled");
        return;
      }

      if (!directoryAccessible && models.length === 0) {
        setAiAvailability("unavailable");
        return;
      }

      switch (outcome.status) {
        case "error":
          setAiAvailability("error");
          return;
        case "missing-model":
          setAiAvailability("unavailable");
          return;
        case "blocked":
          setAiAvailability("unavailable");
          return;
        default:
          break;
      }

      if (models.length === 0) {
        setAiAvailability("unavailable");
        return;
      }

      setAiAvailability("ready");
    };

    void evaluateStatus();

    return () => {
      cancelled = true;
    };
  }, [aiAssistantEnabled]);

  useEffect(() => {
    blacklistRef.current = blacklist;
    saveBlacklist(blacklist);
  }, [blacklist]);

  useEffect(() => {
    if (!aiAssistantEnabled) {
      setAiSummary(null);
      setAiSummaryStatus("disabled");
      setAiSummaryError(null);
      setAiSummaryNotice(null);
      setAiSummarySource(null);
      setAiPanelCollapsed(false);
    } else if (aiSummaryStatus === "disabled") {
      setAiSummaryStatus("unavailable");
      setAiSummaryNotice(null);
      setAiSummarySource(null);
    }
  }, [aiAssistantEnabled, aiSummaryStatus, aiAvailability]);

  useEffect(() => {
    if (blacklist.length === 0) {
      return;
    }

    const blacklistSet = new Set(blacklist);

    setResults((current) => current.filter((doc) => !blacklistSet.has(doc.identifier)));
    setStatuses((previous) => {
      const next = { ...previous };
      let changed = false;
      for (const identifier of blacklistSet) {
        if (identifier in next) {
          delete next[identifier];
          changed = true;
        }
      }
      return changed ? next : previous;
    });
    setSaveMeta((previous) => {
      const next: typeof previous = { ...previous };
      let changed = false;
      for (const identifier of blacklistSet) {
        if (identifier in next) {
          delete next[identifier];
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [blacklist]);

  useEffect(() => {
    if (!selectedDoc) {
      setMetadataState({ data: null, loading: false, error: null });
      setTimelineState({ data: null, loading: false, error: null });
      setRelatedItems([]);
      setRelatedFallback(false);
      setRelatedError(null);
      return;
    }

    let cancelled = false;
    const now = Date.now();
    const identifier = selectedDoc.identifier;

    const cachedMetadata = metadataCacheRef.current.get(identifier);
    const metadataFresh = cachedMetadata ? now - cachedMetadata.timestamp < METADATA_CACHE_TTL : false;
    if (cachedMetadata) {
      setMetadataState({ data: cachedMetadata.payload, loading: !metadataFresh, error: null });
    } else {
      setMetadataState({ data: null, loading: true, error: null });
    }

    if (!metadataFresh) {
      void fetchArchiveMetadata(identifier).then((result) => {
        if (cancelled) {
          return;
        }
        if (result.ok) {
          const entry: CachedMetadataEntry = { payload: result.data, timestamp: Date.now() };
          metadataCacheRef.current.set(identifier, entry);
          pruneTimedCache(metadataCacheRef.current, DETAIL_CACHE_LIMIT);
          setMetadataState({ data: entry.payload, loading: false, error: null });
        } else {
          setMetadataState((previous) => ({
            data: previous.data,
            loading: false,
            error: result.error.message,
          }));
        }
      });
    }

    const archiveUrl =
      selectedDoc.archive_url ??
      selectedDoc.links?.archive ??
      `https://archive.org/details/${encodeURIComponent(identifier)}`;
    const timelineKey = archiveUrl;
    const cachedTimeline = timelineCacheRef.current.get(timelineKey);
    const timelineFresh = cachedTimeline ? now - cachedTimeline.timestamp < TIMELINE_CACHE_TTL : false;
    if (cachedTimeline) {
      setTimelineState({ data: cachedTimeline.payload, loading: !timelineFresh, error: null });
    } else {
      setTimelineState({ data: null, loading: true, error: null });
    }

    if (!timelineFresh) {
      void fetchCdxSnapshots(archiveUrl, 80).then((result) => {
        if (cancelled) {
          return;
        }
        if (result.ok) {
          const entry: CachedTimelineEntry = { payload: result.data, timestamp: Date.now() };
          timelineCacheRef.current.set(timelineKey, entry);
          pruneTimedCache(timelineCacheRef.current, DETAIL_CACHE_LIMIT);
          setTimelineState({ data: entry.payload, loading: false, error: null });
        } else {
          setTimelineState((previous) => ({
            data: previous.data,
            loading: false,
            error: result.error.message,
          }));
        }
      });
    }

    const collections = Array.isArray(selectedDoc.collection)
      ? selectedDoc.collection
      : selectedDoc.collection
      ? [selectedDoc.collection]
      : [];
    const primaryCollection = collections[0];
    const query = primaryCollection
      ? `collection:${primaryCollection}`
      : selectedDoc.mediatype
      ? `mediatype:(${selectedDoc.mediatype})`
      : selectedDoc.title ?? identifier;

    const cachedRelated = relatedCacheRef.current.get(identifier);
    const relatedFresh = cachedRelated ? now - cachedRelated.timestamp < RELATED_CACHE_TTL : false;
    if (cachedRelated) {
      setRelatedItems(cachedRelated.items);
      setRelatedFallback(cachedRelated.fallback);
      setRelatedError(null);
    } else {
      setRelatedItems([]);
      setRelatedFallback(false);
      setRelatedError(null);
    }

    if (!relatedFresh) {
      void scrapeArchive(query, 6).then((result) => {
        if (cancelled) {
          return;
        }
        if (result.ok) {
          const filtered = result.data.items.filter((item) => item.identifier !== identifier);
          const annotated = annotateScrapeItems(filtered);
          setRelatedItems(annotated);
          const fallbackFlag = Boolean(result.data.fallback);
          setRelatedFallback(fallbackFlag);
          setRelatedError(null);
          const entry: CachedRelatedEntry = { items: annotated, fallback: fallbackFlag, timestamp: Date.now() };
          relatedCacheRef.current.set(identifier, entry);
          pruneTimedCache(relatedCacheRef.current, DETAIL_CACHE_LIMIT);
        } else {
          if (cachedRelated) {
            setRelatedItems(cachedRelated.items);
            setRelatedFallback(cachedRelated.fallback);
          } else {
            setRelatedItems([]);
            setRelatedFallback(false);
          }
          setRelatedError(result.error.message);
        }
      });
    }

    return () => {
      cancelled = true;
    };
  }, [selectedDoc]);

  useEffect(() => {
    if (!aiAssistantEnabled) {
      setAiAvailability("disabled");
      setAiDocHelperStatus("disabled");
      return;
    }

    switch (aiSummaryStatus) {
      case "success":
        setAiAvailability("ready");
        break;
      case "error":
        setAiAvailability("error");
        break;
      case "unavailable":
        setAiAvailability("unavailable");
        break;
      case "disabled":
        setAiAvailability("disabled");
        break;
      case "loading":
        setAiAvailability("unknown");
        break;
      default:
        if (aiAvailability === "disabled") {
          setAiAvailability("unknown");
        }
        break;
    }
  }, [aiAssistantEnabled, aiSummaryStatus]);

  const suggestionList = useMemo(() => {
    const historyQueries = history.map((entry) => entry.query);
    const bookmarkTitles = bookmarks.map((bookmark) => bookmark.title || bookmark.identifier);
    return [...historyQueries, ...bookmarkTitles];
  }, [history, bookmarks]);

  const filteredResults = useMemo(() => filterDocsByNSFWMode(results, nsfwMode), [results, nsfwMode]);
  const filteredRelatedItems = useMemo(
    () => applyNSFWModeToScrape(relatedItems, nsfwMode),
    [relatedItems, nsfwMode]
  );

  const scrollToPage = useCallback(
    (pageNumber: number) => {
      const container = resultsContainerRef.current;
      if (!container) {
        return;
      }

      const targetIndex = Math.max(0, (pageNumber - 1) * resultsPerPage);

      const attemptScroll = (attempt = 0) => {
        if (targetIndex === 0) {
          container.scrollTo({ top: 0, behavior: "smooth" });
          return;
        }

        const targetElement = container.querySelector<HTMLElement>(
          `[data-result-index="${targetIndex}"]`
        );

        if (targetElement) {
          const containerRect = container.getBoundingClientRect();
          const elementRect = targetElement.getBoundingClientRect();
          const offset = elementRect.top - containerRect.top + container.scrollTop;
          container.scrollTo({ top: offset, behavior: "smooth" });
          return;
        }

        if (attempt < 3) {
          if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
            window.requestAnimationFrame(() => attemptScroll(attempt + 1));
          } else {
            setTimeout(() => attemptScroll(attempt + 1), 16);
          }
          return;
        }

        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      };

      attemptScroll();
    },
    [resultsPerPage]
  );

  const performSearch = useCallback(
    async (
      searchQuery: string,
      pageNumber: number,
      options?: { recordHistory?: boolean; rowsOverride?: number; preferCache?: boolean; cancelOngoing?: boolean }
    ): Promise<boolean> => {
      const rows = options?.rowsOverride ?? resultsPerPage;
      const safeQuery = searchQuery.trim();
      const isFirstPage = pageNumber === 1;
      const shouldRecordHistory = options?.recordHistory ?? true;
      const preferCache = options?.preferCache ?? false;

      if (!safeQuery) {
        if (isFirstPage) {
          setError("Please enter a search query.");
          setFallbackNotice(null);
          setAlternateSuggestions([]);
          setFilterNotice(null);
        } else {
          setLoadMoreError("Please enter a search query.");
        }
        return false;
      }

      const normalizedYearFrom = normalizeYear(yearFrom);
      const normalizedYearTo = normalizeYear(yearTo);
      const normalizedLanguage = language.trim();
      const normalizedSourceTrust = sourceTrust.trim();
      const normalizedAvailability = availability.trim();
      const normalizedCollection = collection.trim();
      const normalizedUploader = uploader.trim();
      const normalizedSubject = subject.trim();

      const normalizedFilters: NormalizedSearchFilters = {
        mediaType,
        yearFrom: normalizedYearFrom,
        yearTo: normalizedYearTo,
        language: normalizedLanguage,
        sourceTrust: normalizedSourceTrust,
        availability: normalizedAvailability,
        collection: normalizedCollection,
        uploader: normalizedUploader,
        subject: normalizedSubject,
        nsfwMode
      };

      const cacheKey = buildSearchCacheKey(safeQuery, rows, normalizedFilters, aiAssistantEnabled);
      const cacheMap = searchCacheRef.current;
      const now = Date.now();
      let session = cacheMap.get(cacheKey) ?? null;
      const sessionMatches = session?.key === cacheKey;
      const cachedPayload = sessionMatches ? session?.pages.get(pageNumber) : undefined;
      const useCachedPayload = Boolean(preferCache && cachedPayload);
      const shouldCancelOngoing = options?.cancelOngoing ?? isFirstPage;

      const pruneSearchCache = () => {
        if (cacheMap.size <= MAX_SESSION_CACHE) {
          return;
        }
        const entries = [...cacheMap.values()].sort((a, b) => a.lastAccessed - b.lastAccessed);
        while (cacheMap.size > MAX_SESSION_CACHE && entries.length > 0) {
          const entry = entries.shift();
          if (entry && entry.key !== cacheKey) {
            cacheMap.delete(entry.key);
          }
        }
      };

      if (!sessionMatches || !session) {
        session = {
          key: cacheKey,
          query: safeQuery,
          rows,
          filters: normalizedFilters,
          aiEnabled: aiAssistantEnabled,
          pages: session?.pages ?? new Map(),
          lastAccessed: now
        };
      } else {
        session.query = safeQuery;
        session.rows = rows;
        session.filters = normalizedFilters;
        session.aiEnabled = aiAssistantEnabled;
        session.lastAccessed = now;
      }

      searchSessionRef.current = session;
      cacheMap.set(cacheKey, session);
      pruneSearchCache();

      const handleFailure = (message: string) => {
        if (isFirstPage) {
          searchSessionRef.current = null;
          cacheMap.delete(cacheKey);
          setError(message);
          setFallbackNotice(null);
          setResults([]);
          setTotalResults(null);
          setTotalPages(null);
          setPage(1);
          setStatuses({});
          setSaveMeta({});
          setSuggestedQuery(null);
          setSuggestionCorrections([]);
          setLiveStatus(null);
          setAlternateSuggestions([]);
          setFilterNotice(null);
          setLoadedPages([]);
          setReachedEnd(true);
          if (aiAssistantEnabled) {
            setAiSummary(null);
            setAiSummaryStatus("error");
            setAiSummaryError(message);
            setAiSummaryNotice(null);
            setAiSummarySource(null);
            setAiAvailability("error");
            setAiChatError(message);
          } else {
            setAiSummary(null);
            setAiSummaryStatus("disabled");
            setAiSummaryError(null);
            setAiSummaryNotice(null);
            setAiSummarySource(null);
            setAiAvailability("disabled");
          }
        } else {
          setLoadMoreError(message);
        }
      };

      if (isFirstPage) {
        setIsLoading(true);
        setError(null);
        setFallbackNotice(null);
        setAlternateSuggestions([]);
        setFilterNotice(null);
        setResults([]);
        setTotalResults(null);
        setTotalPages(null);
        setStatuses({});
        setSaveMeta({});
        setLoadMoreError(null);
        setLoadedPages([]);
        setReachedEnd(false);
      } else {
        setIsLoadingMore(true);
        setLoadMoreError(null);
      }

      setSelectedDoc(null);
      setMetadataState({ data: null, loading: false, error: null });
      setTimelineState({ data: null, loading: false, error: null });
      setRelatedItems([]);
      setRelatedFallback(false);
      setRelatedError(null);
      setFilterNotice(null);
      if (isFirstPage) {
        setAlternateSuggestions([]);
      }
      if (aiAssistantEnabled) {
        if (isFirstPage) {
          setAiSummaryStatus("loading");
          setAiSummary(null);
          setAiSummaryError(null);
          setAiSummaryNotice(null);
          setAiSummarySource(null);
          setAiAvailability("unknown");
          setAiChatError(null);
        }
      } else if (isFirstPage) {
        setAiSummaryStatus("disabled");
        setAiSummary(null);
        setAiSummaryError(null);
        setAiSummaryNotice(null);
        setAiSummarySource(null);
        setAiAvailability("disabled");
      }
      setAiDocHelperStatus(aiAssistantEnabled ? "idle" : "disabled");
      setAiDocHelperMessage(null);
      setAiDocHelperError(null);

      const fetchFilters = {
        mediaType,
        yearFrom: normalizedYearFrom,
        yearTo: normalizedYearTo,
        language: normalizedLanguage,
        sourceTrust: normalizedSourceTrust,
        availability: normalizedAvailability,
        collection: normalizedCollection,
        uploader: normalizedUploader,
        subject: normalizedSubject,
        nsfwMode
      };

      try {
        if (!isYearValid(yearFrom) || !isYearValid(yearTo)) {
          throw new Error("Year filters must be four-digit values (e.g., 1999).");
        }
        if (normalizedYearFrom && normalizedYearTo && Number(normalizedYearFrom) > Number(normalizedYearTo)) {
          throw new Error("The start year cannot be later than the end year.");
        }

        const abortController = useCachedPayload ? null : new AbortController();
        if (!useCachedPayload && shouldCancelOngoing && searchAbortRef.current) {
          searchAbortRef.current.abort();
        }
        if (!useCachedPayload && abortController) {
          searchAbortRef.current = abortController;
        }

        const result = useCachedPayload
          ? { ok: true as const, data: cachedPayload!, status: 200 }
          : await searchArchive(safeQuery, pageNumber, rows, fetchFilters, {
              aiMode: aiAssistantEnabled,
              signal: abortController?.signal,
            });

        if (!result.ok) {
          if (result.error.type === "abort") {
            return false;
          }
          console.warn("Archive search failed", result.error);
          const message = result.error.message?.trim() || "Search request failed. Please try again later.";
          handleFailure(message);
          return false;
        }

        const payload = result.data;
        const archivePayload = payload.archive ?? {
          response: { docs: [], numFound: null, start: 0 },
        };
        const normalizedOriginalQuery =
          typeof payload.originalQuery === "string" ? payload.originalQuery.trim() : "";
        const normalizedFinalQuery =
          typeof payload.finalQuery === "string" ? payload.finalQuery.trim() : "";
        const refinedCategories = Array.isArray(payload.refinement?.categories)
          ? payload.refinement!.categories
              .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
              .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index)
          : [];
        const refinedSuggestions = Array.isArray(payload.refinement?.suggestions)
          ? payload.refinement!.suggestions
              .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
              .filter((entry, index, array) => entry.length > 0 && array.indexOf(entry) === index)
          : [];
        const refinementTopics = [...refinedSuggestions, ...refinedCategories].filter(
          (entry, index, array) => entry.length > 0 && array.indexOf(entry) === index
        );

        if (
          aiAssistantEnabled &&
          payload.refinedByAI &&
          normalizedOriginalQuery &&
          normalizedFinalQuery &&
          normalizedFinalQuery.toLowerCase() !== normalizedOriginalQuery.toLowerCase()
        ) {
          setAiOriginalQuery(normalizedOriginalQuery);
          setAiRefinedQuery(normalizedFinalQuery);
          setAiRefinementTopics(refinementTopics);
        } else if (isFirstPage) {
          setAiOriginalQuery(normalizedOriginalQuery || null);
          setAiRefinedQuery(null);
          setAiRefinementTopics([]);
        }

        const session = searchSessionRef.current;
        if (session) {
          if (!useCachedPayload) {
            session.pages.set(pageNumber, payload);
            if (session.pages.size > MAX_CACHED_PAGES) {
              const keys = [...session.pages.keys()].sort((a, b) => a - b);
              for (const key of keys) {
                if (session.pages.size <= MAX_CACHED_PAGES) {
                  break;
                }
                if (key !== pageNumber) {
                  session.pages.delete(key);
                }
              }
            }
          }
          session.lastAccessed = Date.now();
          cacheMap.set(cacheKey, session);
        }

        if (aiAssistantEnabled) {
          const hasStatusField = Object.prototype.hasOwnProperty.call(archivePayload, "ai_summary_status");
          const backendStatus = parseBackendAIStatus(archivePayload.ai_summary_status);
          const rawSummary =
            typeof archivePayload.ai_summary === "string" ? archivePayload.ai_summary.trim() : "";
          const summaryText = rawSummary.length > 0 ? rawSummary : null;
          let nextStatus: AISummaryStatus = summaryText ? "success" : "unavailable";

          if (backendStatus) {
            nextStatus = backendStatus;
            if (backendStatus === "success" && !summaryText) {
              nextStatus = "unavailable";
            }
          }

          let nextError: string | null = null;
          const rawError =
            typeof archivePayload.ai_summary_error === "string"
              ? archivePayload.ai_summary_error.trim()
              : "";
          if (nextStatus === "error") {
            nextError = rawError || "AI assistant could not summarize this query.";
          } else if (nextStatus === "unavailable") {
            if (rawError) {
              nextError = rawError;
            } else if (!hasStatusField) {
              nextError = "AI assistant unavailable while connecting directly to the Internet Archive.";
            } else {
              nextError = null;
            }
          }

          const rawNotice =
            typeof archivePayload.ai_summary_notice === "string"
              ? archivePayload.ai_summary_notice.trim()
              : "";
          const summaryNotice = rawNotice.length > 0 ? rawNotice : null;
          const rawSource =
            typeof archivePayload.ai_summary_source === "string"
              ? archivePayload.ai_summary_source.trim().toLowerCase()
              : "";
          const summarySource: AISummarySource | null =
            rawSource === "model" || rawSource === "heuristic" ? (rawSource as AISummarySource) : null;

          if (summaryText) {
            nextStatus = "success";
          }

          setAiSummary(summaryText);
          setAiSummaryStatus(nextStatus);
          setAiSummaryError(nextError);
          setAiSummaryNotice(summaryNotice);
          setAiSummarySource(summarySource);
          if (nextStatus === "success") {
            setAiAvailability("ready");
            setAiChatError(null);
          } else if (nextStatus === "error") {
            setAiAvailability("error");
            setAiChatError(nextError);
          } else if (nextStatus === "unavailable") {
            setAiAvailability("unavailable");
            if (nextError) {
              setAiChatError(nextError);
            }
          }
        } else {
          setAiSummary(null);
          setAiSummaryStatus("disabled");
          setAiSummaryError(null);
          setAiSummaryNotice(null);
          setAiSummarySource(null);
          setAiAvailability("disabled");
        }

        if (archivePayload.fallback) {
          const fallbackReason = archivePayload.fallback_reason?.trim() ?? "";
          const fallbackMessage =
            archivePayload.fallback_message?.trim() ??
            (fallbackReason === "network-error"
              ? "Working offline — showing a limited built-in dataset because the Internet Archive could not be reached."
              : fallbackReason === "html-response" || fallbackReason === "malformed-json"
              ? "Working offline — showing a limited built-in dataset because the Internet Archive returned an invalid response."
              : "Working offline — showing a limited built-in dataset while the Internet Archive search service is unavailable.");
          setFallbackNotice(fallbackMessage);
          if (fallbackReason) {
            console.warn("Archive search is relying on offline data due to:", fallbackReason);
          }
        } else if (
          archivePayload.search_strategy &&
          archivePayload.search_strategy !== "primary search with fuzzy expansion"
        ) {
          const simplifiedQuery = archivePayload.search_strategy_query?.trim();
          const strategyMessage = simplifiedQuery
            ? `Recovered from an unexpected Internet Archive response by retrying with the simplified query "${simplifiedQuery}". Results may be broader than usual.`
            : "Recovered from an unexpected Internet Archive response by retrying with a simplified query. Results may be broader than usual.";
          setFallbackNotice(strategyMessage);
        } else if (isFirstPage) {
          setFallbackNotice(null);
        }

        const docs = archivePayload.response?.docs ?? [];
        const numFound = archivePayload.response?.numFound ?? null;
        const altQueries = Array.isArray(archivePayload.alternate_queries)
          ? archivePayload.alternate_queries
              .map((item) => (typeof item === "string" ? item.trim() : ""))
              .filter((item, index, array) => item.length > 0 && array.indexOf(item) === index)
          : [];
        setAlternateSuggestions(altQueries);

        const originalCount =
          typeof archivePayload.original_numFound === "number" &&
          Number.isFinite(archivePayload.original_numFound)
            ? archivePayload.original_numFound
            : null;
        const filteredCountValue =
          typeof archivePayload.filtered_count === "number" && Number.isFinite(archivePayload.filtered_count)
            ? archivePayload.filtered_count
            : typeof numFound === "number" && Number.isFinite(numFound)
            ? numFound
            : null;

        if (
          originalCount !== null &&
          filteredCountValue !== null &&
          filteredCountValue < originalCount
        ) {
          const hiddenByFilters = originalCount - filteredCountValue;
          setFilterNotice(
            hiddenByFilters === 1
              ? "1 result hidden by the current filters."
              : `${hiddenByFilters} results hidden by the current filters.`
          );
        } else if (isFirstPage) {
          setFilterNotice(null);
        }
        const hiddenIdentifiers =
          blacklistRef.current.length > 0 ? new Set(blacklistRef.current) : null;
        const visibleDocs = hiddenIdentifiers
          ? docs.filter((doc) => !hiddenIdentifiers.has(doc.identifier))
          : docs;

        const annotatedDocs = annotateDocs(visibleDocs);
        setResults((previous) => mergeRankedResults(isFirstPage ? [] : previous, annotatedDocs, safeQuery));
        setTotalResults(numFound);
        setTotalPages(numFound !== null ? Math.max(1, Math.ceil(numFound / rows)) : null);
        setPage(pageNumber);
        setHasSearched(true);
        setLoadedPages((previous) => {
          if (isFirstPage) {
            return [pageNumber];
          }
          if (previous.includes(pageNumber)) {
            return previous;
          }
          return [...previous, pageNumber].sort((a, b) => a - b);
        });
        const defaultStatus: LinkStatus = archivePayload.fallback ? "offline" : "checking";
        if (isFirstPage) {
          setStatuses(() => {
            const next: Record<string, LinkStatus> = {};
            for (const doc of annotatedDocs) {
              next[doc.identifier] = defaultStatus;
            }
            return next;
          });
          setSaveMeta(() => {
            const next: Record<string, SaveMeta> = {};
            for (const doc of annotatedDocs) {
              next[doc.identifier] = { ...DEFAULT_SAVE_META };
            }
            return next;
          });
        } else {
          setStatuses((previous) => {
            const next = { ...previous };
            for (const doc of annotatedDocs) {
              if (!next[doc.identifier]) {
                next[doc.identifier] = defaultStatus;
              }
            }
            return next;
          });
          setSaveMeta((previous) => {
            const next = { ...previous };
            for (const doc of annotatedDocs) {
              if (!next[doc.identifier]) {
                next[doc.identifier] = { ...DEFAULT_SAVE_META };
              }
            }
            return next;
          });
        }

        const suggestion = archivePayload.spellcheck;
        if (
          suggestion &&
          suggestion.correctedQuery &&
          suggestion.originalQuery &&
          suggestion.correctedQuery.trim().toLowerCase() !== suggestion.originalQuery.trim().toLowerCase()
        ) {
          setSuggestedQuery(suggestion.correctedQuery.trim());
          setSuggestionCorrections(suggestion.corrections ?? []);
        } else if (isFirstPage) {
          setSuggestedQuery(null);
          setSuggestionCorrections([]);
        }

        if (shouldRecordHistory) {
          setHistory((previous) => {
            const entry: SearchHistoryEntry = { query: safeQuery, timestamp: Date.now() };
            return [entry, ...previous.filter((item) => item.query !== safeQuery)].slice(0, 50);
          });
          setHistoryIndex(0);
        }

        if (isFirstPage && resultsContainerRef.current) {
          resultsContainerRef.current.scrollTo({ top: 0, behavior: "smooth" });
        }

        if (archivePayload.fallback) {
          setLiveStatus(null);
          setWaybackDetails(null);
          setWaybackError(null);
        } else if (isFirstPage && isLikelyUrl(safeQuery)) {
          const now = Date.now();
          const statusEntry = statusCacheRef.current.get(safeQuery);
          const statusFresh = statusEntry ? now - statusEntry.timestamp < STATUS_CACHE_TTL : false;
          const availabilityEntry = waybackCacheRef.current.get(safeQuery);
          const availabilityFresh = availabilityEntry ? now - availabilityEntry.timestamp < WAYBACK_CACHE_TTL : false;

          if (statusFresh) {
            setLiveStatus(statusEntry.status);
          } else {
            setLiveStatus("checking");
          }

          if (availabilityFresh) {
            setWaybackDetails(availabilityEntry.payload);
          } else {
            setWaybackDetails(null);
          }
          setWaybackError(null);

          const errors: string[] = [];
          const fetchTasks: Promise<void>[] = [];

          if (!statusFresh) {
            fetchTasks.push(
              (async () => {
                const statusResult = await checkLinkStatus(safeQuery);
                if (statusResult.ok) {
                  const entry: CachedStatusEntry = { status: statusResult.data, timestamp: Date.now() };
                  statusCacheRef.current.set(safeQuery, entry);
                  pruneTimedCache(statusCacheRef.current, STATUS_CACHE_LIMIT);
                  setLiveStatus(entry.status);
                } else {
                  console.warn("Failed to check live status", statusResult.error);
                  setLiveStatus("offline");
                  if (statusResult.error.message) {
                    errors.push(statusResult.error.message);
                  }
                }
              })()
            );
          }

          if (!availabilityFresh) {
            fetchTasks.push(
              (async () => {
                const availabilityResult = await getWaybackAvailability(safeQuery);
                if (availabilityResult.ok) {
                  const entry: CachedWaybackEntry = { payload: availabilityResult.data, timestamp: Date.now() };
                  waybackCacheRef.current.set(safeQuery, entry);
                  pruneTimedCache(waybackCacheRef.current, WAYBACK_CACHE_LIMIT);
                  setWaybackDetails(entry.payload);
                } else {
                  console.warn("Failed to load Wayback availability", availabilityResult.error);
                  setWaybackDetails(null);
                  if (availabilityResult.error.message) {
                    errors.push(availabilityResult.error.message);
                  }
                }
              })()
            );
          }

          if (fetchTasks.length > 0) {
            await Promise.all(fetchTasks);
            setWaybackError(errors.length > 0 ? errors.join(" · ") : null);
          } else {
            setWaybackError(null);
          }
        } else if (isFirstPage) {
          setLiveStatus(null);
          setWaybackDetails(null);
          setWaybackError(null);
        }

        const reachedLastPage =
          annotatedDocs.length === 0 ||
          (numFound !== null ? pageNumber * rows >= numFound : annotatedDocs.length < rows);
        if (reachedLastPage) {
          setReachedEnd(true);
        } else {
          setReachedEnd(false);
        }
      } catch (fetchError) {
        console.error(fetchError);
        const fallbackMessage = "Search request failed. Please try again later.";
        let message = fetchError instanceof Error ? fetchError.message : String(fetchError);
        if (message && /unexpected token/i.test(message)) {
          message = "Invalid response from Internet Archive. Please try again later.";
        }
        if (message && message.includes("<!doctype")) {
          message = "Invalid response from Internet Archive. Please try again later.";
        }
        if (!message || !message.trim()) {
          message = fallbackMessage;
        }
        handleFailure(message);
      } finally {
        if (!useCachedPayload && searchAbortRef.current === abortController) {
          searchAbortRef.current = null;
        }
        if (isFirstPage) {
          setIsLoading(false);
        } else {
          setIsLoadingMore(false);
        }
      }

      return useCachedPayload;
    },
    [
      resultsPerPage,
      mediaType,
      yearFrom,
      yearTo,
      language,
      sourceTrust,
      availability,
      collection,
      uploader,
      subject,
      nsfwMode,
      aiAssistantEnabled
    ]
  );

  useEffect(() => {
    const trimmed = debouncedQuery.trim();
    if (!autoSearchReadyRef.current || isLoading || isLoadingMore) {
      return;
    }
    if (!trimmed) {
      lastAutoQueryRef.current = null;
      return;
    }
    if (trimmed === (activeQuery ?? "")) {
      lastAutoQueryRef.current = trimmed;
      return;
    }
    if (trimmed === lastAutoQueryRef.current) {
      return;
    }

    lastAutoQueryRef.current = trimmed;
    void performSearch(trimmed, 1, {
      recordHistory: false,
      preferCache: true,
      cancelOngoing: true,
    });
  }, [debouncedQuery, activeQuery, performSearch, isLoading, isLoadingMore]);

  const highestLoadedPage = useMemo(
    () => (loadedPages.length > 0 ? Math.max(...loadedPages) : 0),
    [loadedPages]
  );
  const totalResultsLoaded = results.length;
  const hasMoreResults = useMemo(
    () =>
      hasSearched &&
      !reachedEnd &&
      (totalPages === null || highestLoadedPage < totalPages) &&
      (totalResults === null || totalResultsLoaded < totalResults),
    [hasSearched, reachedEnd, totalPages, highestLoadedPage, totalResults, totalResultsLoaded]
  );

  const handleClearAiChat = useCallback(() => {
    setAiChatMessages([]);
    setAiChatError(null);
  }, []);

  const handleSendAiChat = useCallback(
    async (rawInput: string, mode: "chat" | "navigation" = "chat") => {
      if (!aiAssistantEnabled) {
        setAiChatError("Enable AI Mode to use the AI assistant.");
        return;
      }

      const trimmed = rawInput.trim();
      if (!trimmed) {
        return;
      }

      const userMessage = createAiChatMessage("user", trimmed);
      const chatHistory = aiChatMessages
        .filter((message) => message.role === "assistant" || message.role === "user")
        .map((message) => ({
          role: message.role === "assistant" ? "assistant" : "user",
          content: message.content,
        }));

      setAiChatMessages((previous) => [...previous, userMessage]);
      setAiChatSending(true);
      setAiChatError(null);

      const effectiveQuery = activeQuery || query;
      const context: AIQueryContext = {};
      if (effectiveQuery) {
        context.activeQuery = effectiveQuery;
      }
      if (history.length > 0) {
        context.navigationTrail = history
          .slice(0, 5)
          .map((entry) => entry.query)
          .filter((value) => value.trim().length > 0);
      }
      if (selectedDoc) {
        const docTitle = selectedDoc.title || selectedDoc.identifier;
        context.documentTitle = docTitle;
        const docSummary = extractDocSummaryText(selectedDoc.description);
        if (docSummary) {
          context.documentSummary = docSummary.slice(0, 400);
        }
        const docUrl =
          selectedDoc.archive_url ?? selectedDoc.links?.archive ?? selectedDoc.original_url ?? undefined;
        if (docUrl) {
          context.currentUrl = docUrl;
        }
      }

      try {
        const result = await submitAIQuery({
          message: trimmed,
          mode,
          query: effectiveQuery,
          context: Object.keys(context).length > 0 ? context : undefined,
          history: chatHistory,
          nsfwMode: resolveUserNSFWMode(nsfwMode),
        });

        if (!result.ok) {
          const errorMessage = result.error.message?.trim() || "AI assistant request failed.";
          setAiChatError(errorMessage);
          setAiAvailability("error");
          setAiChatMessages((previous) => [...previous, createAiChatMessage("system", errorMessage, true)]);
          return;
        }

        const data = result.data;
        const replyText = data.reply?.trim() ?? "";

        if (replyText) {
          setAiChatMessages((previous) => [...previous, createAiChatMessage("assistant", replyText)]);
        }

        if (data.status === "success") {
          setAiAvailability("ready");
          setAiChatError(null);
        } else if (data.status === "unavailable") {
          setAiAvailability("unavailable");
          if (data.error) {
            setAiChatError(data.error);
            setAiChatMessages((previous) => [...previous, createAiChatMessage("system", data.error, true)]);
          }
        } else if (data.status === "disabled") {
          setAiAvailability("disabled");
          if (data.error) {
            setAiChatError(data.error);
          }
        } else if (data.status === "error") {
          const errorMessage = data.error?.trim() || "AI assistant encountered an error.";
          setAiAvailability("error");
          setAiChatError(errorMessage);
          setAiChatMessages((previous) => [...previous, createAiChatMessage("system", errorMessage, true)]);
        }
      } finally {
        setAiChatSending(false);
      }
    },
    [aiAssistantEnabled, aiChatMessages, activeQuery, query, history, selectedDoc, nsfwMode]
  );

  const handleRequestNavigationTips = useCallback(async () => {
    if (!aiAssistantEnabled) {
      setAiChatError("Enable AI Mode to request navigation tips.");
      return;
    }

    const baseQuery = activeQuery || query;
    const navigationPrompt = baseQuery
      ? `Provide two concise navigation suggestions for continuing research on "${baseQuery}".`
      : "Provide navigation suggestions for my current research topic.";

    setAiNavigationLoading(true);
    await handleSendAiChat(navigationPrompt, "navigation");
    setAiNavigationLoading(false);
  }, [aiAssistantEnabled, activeQuery, query, handleSendAiChat]);

  useEffect(() => {
    if (!selectedDoc) {
      setAiDocHelperMessage(null);
      setAiDocHelperError(null);
      setAiDocHelperStatus(aiAssistantEnabled ? "idle" : "disabled");
      return;
    }

    setAiDocHelperMessage(null);
    setAiDocHelperError(null);
    setAiDocHelperStatus(aiAssistantEnabled ? "idle" : "disabled");
  }, [selectedDoc, aiAssistantEnabled]);

  const handleAskAiAboutDocument = useCallback(async () => {
    if (!aiAssistantEnabled || !selectedDoc) {
      return;
    }

    setAiDocHelperStatus("loading");
    setAiDocHelperError(null);

    const effectiveQuery = activeQuery || query;
    const context: AIQueryContext = {
      documentTitle: selectedDoc.title || selectedDoc.identifier,
    };
    const summaryText = extractDocSummaryText(selectedDoc.description);
    if (summaryText) {
      context.documentSummary = summaryText.slice(0, 500);
    }
    const docUrl = selectedDoc.archive_url ?? selectedDoc.links?.archive ?? selectedDoc.original_url ?? undefined;
    if (docUrl) {
      context.currentUrl = docUrl;
    }
    if (effectiveQuery) {
      context.activeQuery = effectiveQuery;
    }

    const result = await submitAIQuery({
      message: "Summarize the selected archive item and explain how it relates to the research topic.",
      mode: "document",
      query: effectiveQuery,
      context,
      nsfwMode: resolveUserNSFWMode(nsfwMode),
    });

    if (!result.ok) {
      const errorMessage = result.error.message?.trim() || "AI helper unavailable for this item.";
      setAiDocHelperStatus("error");
      setAiDocHelperError(errorMessage);
      return;
    }

    const data = result.data;
    const replyText = data.reply?.trim() ?? "";

    if (data.status === "success" && replyText) {
      setAiDocHelperStatus("success");
      setAiDocHelperMessage(replyText);
      setAiDocHelperError(null);
      return;
    }

    if (data.status === "unavailable") {
      setAiDocHelperStatus("unavailable");
      setAiDocHelperError(data.error ?? "Local AI model unavailable for document summaries.");
      return;
    }

    if (data.status === "disabled") {
      setAiDocHelperStatus("disabled");
      setAiDocHelperError(data.error ?? "AI helper disabled by configuration.");
      return;
    }

    setAiDocHelperStatus("error");
    setAiDocHelperError(data.error ?? "AI helper could not generate a response.");
  }, [aiAssistantEnabled, selectedDoc, activeQuery, query, nsfwMode]);

  useEffect(() => {
    if (bootstrapped.current || !settings.lastQuery) {
      if (!settings.lastQuery) {
        autoSearchReadyRef.current = true;
      }
      return;
    }
    bootstrapped.current = true;
    setActiveQuery(settings.lastQuery);
    void performSearch(settings.lastQuery, 1, {
      recordHistory: false,
      rowsOverride: settings.resultsPerPage,
    }).finally(() => {
      autoSearchReadyRef.current = true;
    });
  }, [performSearch, settings.lastQuery, settings.resultsPerPage]);

  useEffect(() => {
    if (filteredResults.length === 0 || fallbackNotice) {
      return;
    }

    let cancelled = false;
    const now = Date.now();
    const cachedUpdates: Array<[string, LinkStatus]> = [];
    const pendingByUrl = new Map<string, string[]>();

    for (const doc of filteredResults) {
      const targetUrl =
        doc.archive_url ??
        doc.links?.archive ??
        `https://archive.org/details/${encodeURIComponent(doc.identifier)}`;
      const cacheEntry = statusCacheRef.current.get(targetUrl);
      const fresh = cacheEntry ? now - cacheEntry.timestamp < STATUS_CACHE_TTL : false;

      if (cacheEntry && fresh) {
        cachedUpdates.push([doc.identifier, cacheEntry.status]);
        continue;
      }

      const identifiers = pendingByUrl.get(targetUrl);
      if (identifiers) {
        identifiers.push(doc.identifier);
      } else {
        pendingByUrl.set(targetUrl, [doc.identifier]);
      }
    }

    if (cachedUpdates.length > 0) {
      setStatuses((previous) => {
        const next = { ...previous };
        for (const [identifier, status] of cachedUpdates) {
          next[identifier] = status;
        }
        return next;
      });
    }

    if (pendingByUrl.size === 0) {
      return () => {
        cancelled = true;
      };
    }

    const loadStatuses = async () => {
      const entries = Array.from(pendingByUrl.entries());
      const results = await Promise.all(
        entries.map(async ([targetUrl, identifiers]) => {
          const statusResult = await checkLinkStatus(targetUrl);
          if (statusResult.ok) {
            const entry: CachedStatusEntry = { status: statusResult.data, timestamp: Date.now() };
            statusCacheRef.current.set(targetUrl, entry);
            pruneTimedCache(statusCacheRef.current, STATUS_CACHE_LIMIT);
            return { identifiers, status: entry.status };
          }

          console.warn("Status check failed", statusResult.error);
          return { identifiers, status: "offline" as LinkStatus };
        })
      );

      if (cancelled) {
        return;
      }

      const updates: Array<[string, LinkStatus]> = [];
      for (const { identifiers, status } of results) {
        for (const identifier of identifiers) {
          updates.push([identifier, status]);
        }
      }

      if (updates.length === 0) {
        return;
      }

      setStatuses((previous) => {
        const next = { ...previous };
        for (const [identifier, status] of updates) {
          next[identifier] = status;
        }
        return next;
      });
    };

    void loadStatuses();
    return () => {
      cancelled = true;
    };
  }, [filteredResults, fallbackNotice]);

  useEffect(() => {
    if (selectedDoc && !shouldIncludeDoc(selectedDoc, nsfwMode)) {
      setSelectedDoc(null);
    }
  }, [selectedDoc, nsfwMode]);

  const handleSubmit = async () => {
    const trimmed = query.trim();
    if (!trimmed) {
      return;
    }
    setQuery(trimmed);
    setActiveQuery(trimmed);
    await performSearch(trimmed, 1);
  };

  const handlePageChange = async (direction: "previous" | "next") => {
    if (!activeQuery || isLoading || isLoadingMore) {
      return;
    }
    const nextPage = direction === "next" ? page + 1 : page - 1;
    if (nextPage < 1) {
      return;
    }
    if (totalPages !== null && nextPage > totalPages) {
      return;
    }

    await performSearch(activeQuery, nextPage, { recordHistory: false, preferCache: true });
    scrollToPage(nextPage);
  };

  const handleLoadMore = useCallback(async () => {
    if (!activeQuery || isLoading || isLoadingMore || !hasMoreResults) {
      return;
    }
    const nextPage = highestLoadedPage > 0 ? highestLoadedPage + 1 : 1;
    if (totalPages !== null && nextPage > totalPages) {
      return;
    }
    await performSearch(activeQuery, nextPage, { recordHistory: false });
  }, [
    activeQuery,
    isLoading,
    isLoadingMore,
    hasMoreResults,
    highestLoadedPage,
    totalPages,
    performSearch
  ]);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    const container = resultsContainerRef.current;
    if (!sentinel || !container) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          if (!hasMoreResults || isLoading || isLoadingMore) {
            return;
          }
          void handleLoadMore();
        }
      },
      { root: container, rootMargin: "200px" }
    );
    observer.observe(sentinel);
    return () => {
      observer.disconnect();
    };
  }, [handleLoadMore, hasMoreResults, isLoading, isLoadingMore]);

  const handleResultsPerPageChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = Number(event.target.value);
    if (!RESULTS_PER_PAGE_OPTIONS.includes(value)) {
      return;
    }
    setResultsPerPage(value);
    if (activeQuery) {
      void performSearch(activeQuery, 1, { recordHistory: false, rowsOverride: value });
    }
  };

  const handleMediaTypeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setMediaType(event.target.value);
  };

  const handleLanguageChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setLanguage(event.target.value);
  };

  const handleSourceTrustChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setSourceTrust(event.target.value);
  };

  const handleAvailabilityChange = (event: ChangeEvent<HTMLSelectElement>) => {
    setAvailability(event.target.value);
  };

  const handleYearFromChange = (event: ChangeEvent<HTMLInputElement>) => {
    setYearFrom(event.target.value);
  };

  const handleYearToChange = (event: ChangeEvent<HTMLInputElement>) => {
    setYearTo(event.target.value);
  };

  const handleCollectionChange = (event: ChangeEvent<HTMLInputElement>) => {
    setCollection(event.target.value);
  };

  const handleUploaderChange = (event: ChangeEvent<HTMLInputElement>) => {
    setUploader(event.target.value);
  };

  const handleSubjectChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSubject(event.target.value);
  };

  const applyFilters = () => {
    if (!activeQuery) {
      return;
    }
    void performSearch(activeQuery, 1, { recordHistory: false });
  };

  const bookmarkedIdentifiers = useMemo(() => new Set(bookmarks.map((item) => item.identifier)), [bookmarks]);

  const toggleBookmark = (identifier: string, doc: ArchiveSearchDoc) => {
    setBookmarks((previous) => {
      if (previous.some((bookmark) => bookmark.identifier === identifier)) {
        return previous.filter((bookmark) => bookmark.identifier !== identifier);
      }
      const entry: BookmarkEntry = {
        identifier,
        title: doc.title || doc.identifier,
        mediatype: doc.mediatype,
        addedAt: Date.now(),
        archiveUrl: doc.archive_url ?? doc.links?.archive
      };
      return [entry, ...previous];
    });
  };

  const removeBookmark = (identifier: string) => {
    setBookmarks((previous) => previous.filter((bookmark) => bookmark.identifier !== identifier));
  };

  const openDetails = (doc: ArchiveSearchDoc) => {
    setSelectedDoc(doc);
  };

  const closeDetails = () => {
    setSelectedDoc(null);
  };

  const handleSaveSnapshot = async (identifier: string, archiveUrl: string) => {
    if (!archiveUrl) {
      setSaveMeta((previous) => ({
        ...previous,
        [identifier]: {
          label: "Save to Archive",
          disabled: false,
          message: "Archive URL unavailable for this record.",
          tone: "error"
        }
      }));
      return;
    }
    setSaveMeta((previous) => ({
      ...previous,
      [identifier]: {
        label: "Saving…",
        disabled: true,
        message: "Submitting snapshot request…",
        tone: "info"
      }
    }));
    const result = await requestSaveSnapshot(archiveUrl);
    if (!result.ok) {
      console.warn("Save Page Now failed", result.error);
      setSaveMeta((previous) => ({
        ...previous,
        [identifier]: {
          label: "Try again",
          disabled: false,
          message: result.error.message || "Unable to contact Save Page Now.",
          tone: "error"
        }
      }));
      return;
    }

    const response = result.data;
    setSaveMeta((previous) => ({
      ...previous,
      [identifier]: {
        label: "Save to Archive",
        disabled: false,
        message: response.success
          ? response.message ?? "Snapshot request accepted."
          : response.error ?? "Save Page Now reported an error.",
        snapshotUrl: response.snapshotUrl,
        tone: response.success ? "success" : "error"
      }
    }));
  };

  const handleReportSubmission = useCallback(
    async (payload: ReportSubmissionPayload) => {
      const result = await submitReport(payload);
      if (!result.ok) {
        throw new Error(result.error.message || "Report submission failed.");
      }

      setBlacklist((previous) => {
        if (previous.includes(payload.identifier)) {
          return previous;
        }
        return [...previous, payload.identifier];
      });

      setResults((current) => current.filter((doc) => doc.identifier !== payload.identifier));
      setStatuses((previous) => {
        if (!(payload.identifier in previous)) {
          return previous;
        }
        const next = { ...previous };
        delete next[payload.identifier];
        return next;
      });
      setSaveMeta((previous) => {
        if (!(payload.identifier in previous)) {
          return previous;
        }
        const next = { ...previous };
        delete next[payload.identifier];
        return next;
      });
    },
    [submitReport]
  );

  const handleSuggestionClick = (nextQuery: string) => {
    setQuery(nextQuery);
    setActiveQuery(nextQuery);
    void performSearch(nextQuery, 1);
  };

  const handleRemoveHistoryItem = useCallback((targetQuery: string) => {
    setHistory((previous) => {
      const targetIndex = previous.findIndex((entry) => entry.query === targetQuery);
      if (targetIndex === -1) {
        return previous;
      }

      const nextHistory = [
        ...previous.slice(0, targetIndex),
        ...previous.slice(targetIndex + 1)
      ];

      setHistoryIndex((prevIndex) => {
        if (prevIndex < 0) {
          return prevIndex;
        }

        const nextLength = nextHistory.length;
        if (nextLength === 0) {
          return -1;
        }

        if (prevIndex > targetIndex) {
          return prevIndex - 1;
        }

        if (prevIndex === targetIndex) {
          return Math.min(prevIndex, nextLength - 1);
        }

        return prevIndex;
      });

      return nextHistory;
    });
  }, []);

  const goBack = () => {
    if (history.length === 0 || historyIndex === history.length - 1) {
      return;
    }
    const nextIndex = historyIndex + 1;
    const entry = history[nextIndex];
    setHistoryIndex(nextIndex);
    setQuery(entry.query);
    setActiveQuery(entry.query);
    void performSearch(entry.query, 1, { recordHistory: false });
  };

  const goForward = () => {
    if (historyIndex <= 0) {
      return;
    }
    const nextIndex = historyIndex - 1;
    const entry = history[nextIndex];
    setHistoryIndex(nextIndex);
    setQuery(entry.query);
    setActiveQuery(entry.query);
    void performSearch(entry.query, 1, { recordHistory: false });
  };

  const refresh = () => {
    if (activeQuery) {
      void performSearch(activeQuery, page, { recordHistory: false });
    }
  };

  const goHome = () => {
    setQuery("");
    setActiveQuery(null);
    setResults([]);
    setTotalPages(null);
    setTotalResults(null);
    setSuggestedQuery(null);
    setSuggestionCorrections([]);
    setHasSearched(false);
    setLiveStatus(null);
    setSelectedDoc(null);
    setAlternateSuggestions([]);
    setFilterNotice(null);
    setFallbackNotice(null);
    setAiSummary(null);
    setAiSummaryError(null);
    setAiSummaryStatus(aiAssistantEnabled ? "unavailable" : "disabled");
    setAiSummaryNotice(null);
    setAiSummarySource(null);
    setAiPanelCollapsed(false);
    searchSessionRef.current = null;
  };

  const clearHistory = () => {
    setHistory([]);
    setHistoryIndex(-1);
  };

  const clearBookmarks = () => {
    setBookmarks([]);
  };

  // ADD: Provide a one-click way to restore all persisted preferences to their defaults.
  const resetPreferences = () => {
    const defaults = resetStoredSettings();
    initialSettings.current = defaults;
    setTheme(defaults.theme);
    setNsfwMode(defaults.nsfwMode ?? (defaults.filterNSFW ? "safe" : "unrestricted"));
    setNsfwAcknowledged(Boolean(defaults.nsfwAcknowledged));
    setResultsPerPage(defaults.resultsPerPage);
    setMediaType(defaults.mediaType);
    setYearFrom(defaults.yearFrom);
    setYearTo(defaults.yearTo);
    setLanguage(defaults.language);
    setSourceTrust(defaults.sourceTrust);
    setAvailability(defaults.availability);
    setCollection(defaults.collection ?? "");
    setUploader(defaults.uploader ?? "");
    setSubject(defaults.subject ?? "");
    setPage(1);
    setError(null);
    setIsLoading(false);
    setResults([]);
    setStatuses({});
    setSaveMeta({});
    setTotalResults(null);
    setTotalPages(null);
    setSuggestedQuery(null);
    setSuggestionCorrections([]);
    setLiveStatus(null);
    setSelectedDoc(null);
    setAlternateSuggestions([]);
    setFilterNotice(null);
    setFallbackNotice(null);
    const trimmedQuery = defaults.lastQuery.trim();
    setQuery(trimmedQuery);
    setActiveQuery(null);
    setHasSearched(false);
    setHistoryIndex(-1);
    autoSearchReadyRef.current = trimmedQuery ? false : true;
    setAiAssistantEnabled(Boolean(defaults.aiAssistantEnabled));
    setAiSummary(null);
    setAiSummaryStatus(defaults.aiAssistantEnabled ? "unavailable" : "disabled");
    setAiSummaryError(null);
    setAiSummaryNotice(null);
    setAiSummarySource(null);
    setAiPanelCollapsed(false);
    setAiAvailability(defaults.aiAssistantEnabled ? "unknown" : "disabled");
    setAiChatMessages([]);
    setAiChatSending(false);
    setAiChatError(null);
    setAiNavigationLoading(false);
    setAiDocHelperStatus(defaults.aiAssistantEnabled ? "idle" : "disabled");
    setAiDocHelperMessage(null);
    setAiDocHelperError(null);
    searchSessionRef.current = null;
  };

  const handleToggleAiAssistant = (enabled: boolean) => {
    setAiAssistantEnabled(enabled);
    if (enabled) {
      setAiSummaryStatus("unavailable");
      setAiPanelCollapsed(false);
      setAiSummaryNotice(null);
      setAiSummarySource(null);
      setAiAvailability("unknown");
      setAiDocHelperStatus("idle");
      setSidebarTab("assistant");
      setAiOriginalQuery(null);
      setAiRefinedQuery(null);
      setAiRefinementTopics([]);
    } else {
      setAiSummary(null);
      setAiSummaryError(null);
      setAiSummaryStatus("disabled");
      setAiSummaryNotice(null);
      setAiSummarySource(null);
      setAiAvailability("disabled");
      setAiChatMessages([]);
      setAiChatSending(false);
      setAiChatError(null);
      setAiNavigationLoading(false);
      setAiDocHelperStatus("disabled");
      setAiDocHelperMessage(null);
      setAiDocHelperError(null);
      setAiOriginalQuery(null);
      setAiRefinedQuery(null);
      setAiRefinementTopics([]);
    }
  };

  const handleChangeNSFWMode = useCallback(
    (mode: NSFWFilterMode) => {
      if (mode === nsfwMode) {
        return;
      }

      if (mode === "safe") {
        setNsfwMode("safe");
        return;
      }

      const confirmed =
        typeof window !== "undefined"
          ? window.confirm(
              "This setting may display adult or explicit material. Please confirm you are 18 years or older before proceeding."
            )
          : false;

      if (confirmed) {
        setNsfwAcknowledged(true);
        setNsfwMode(mode);
      } else {
        setNsfwAcknowledged(false);
        setNsfwMode("safe");
      }
    },
    [nsfwMode]
  );

  const suggestionElements: JSX.Element[] = [];

  if (
    aiAssistantEnabled &&
    aiRefinedQuery &&
    aiOriginalQuery &&
    aiRefinedQuery.toLowerCase() !== aiOriginalQuery.toLowerCase()
  ) {
    suggestionElements.push(
      <div key="ai-refinement" className="spellcheck-suggestion" role="note">
        AI interpreted "{aiOriginalQuery}" as{" "}
        <button
          type="button"
          className="spellcheck-button"
          onClick={() => handleSuggestionClick(aiRefinedQuery)}
        >
          {aiRefinedQuery}
        </button>
        {aiRefinementTopics.length > 0 ? (
          <span className="spellcheck-details">
            Focus: {aiRefinementTopics.slice(0, 3).join(", ")}
          </span>
        ) : null}
      </div>
    );
  }

  if (suggestedQuery) {
    suggestionElements.push(
      <div key="spellcheck" className="spellcheck-suggestion" role="note">
        Did you mean{" "}
        <button
          type="button"
          className="spellcheck-button"
          onClick={() => handleSuggestionClick(suggestedQuery)}
        >
          {suggestedQuery}
        </button>
        {suggestionCorrections.length > 0 ? (
          <span className="spellcheck-details">
            (
            {suggestionCorrections.map((item) => `${item.original} → ${item.corrected}`).join(", ")})
          </span>
        ) : null}
      </div>
    );
  }

  const alternateCandidates = alternateSuggestions.filter((item) =>
    !suggestedQuery || item.toLowerCase() !== suggestedQuery.toLowerCase()
  );

  if (alternateCandidates.length > 0) {
    suggestionElements.push(
      <div key="alternates" className="spellcheck-suggestion" role="note">
        Try also{" "}
        {alternateCandidates.slice(0, 3).map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="spellcheck-button"
            onClick={() => handleSuggestionClick(suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>
    );
  }

  const suggestionNode = suggestionElements.length > 0 ? <>{suggestionElements}</> : null;

  const settingsPanel = (
    <SettingsPanel
      theme={theme}
      nsfwMode={nsfwMode}
      onToggleTheme={() => setTheme((previous) => (previous === "light" ? "dark" : "light"))}
      onChangeNSFWMode={handleChangeNSFWMode}
      onClearHistory={clearHistory}
      onClearBookmarks={clearBookmarks}
      onResetPreferences={resetPreferences}
      aiAssistantEnabled={aiAssistantEnabled}
      onToggleAI={handleToggleAiAssistant}
    />
  );

  const assistantPanel = (
    <AiChatPanel
      enabled={aiAssistantEnabled}
      availability={aiAvailability}
      messages={aiChatMessages}
      isSending={aiChatSending}
      onSend={(message) => {
        void handleSendAiChat(message);
      }}
      onClear={handleClearAiChat}
      onRequestNavigation={() => {
        void handleRequestNavigationTips();
      }}
      navigationLoading={aiNavigationLoading}
      error={aiChatError}
    />
  );

  // FIX: Require a valid history pointer before enabling the Back button to avoid false positives after resets.
  const canGoBack = history.length > 0 && historyIndex >= 0 && historyIndex < history.length - 1;
  const canGoForward = history.length > 0 && historyIndex > 0;
  const canRefresh = Boolean(activeQuery) && !isLoading;

  const combinedNotice = useMemo(() => {
    if (fallbackNotice && filterNotice) {
      return `${fallbackNotice} ${filterNotice}`;
    }
    return fallbackNotice ?? filterNotice;
  }, [fallbackNotice, filterNotice]);

  return (
    <div className="app-shell">
      <header className="hero">
        <h1>Alexandria Browser</h1>
        <p className="tagline">Preserve Everything · No Gatekeepers · Serve the Seeker · Build Open and Forkable</p>
      </header>

      <BrowserNav
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        canRefresh={canRefresh}
        onBack={goBack}
        onForward={goForward}
        onRefresh={refresh}
        onHome={goHome}
        onOpenLibrary={() => setSidebarOpen(true)}
      >
        <SearchBar
          value={query}
          suggestions={suggestionList}
          onChange={setQuery}
          onSubmit={handleSubmit}
          onSelectSuggestion={handleSuggestionClick}
          isLoading={isLoading}
        />
      </BrowserNav>

      <div className="search-panel harmonia-card">
        <div className="filter-row" role="group" aria-label="Search filters">
          <label>
            <span>Media type</span>
            <select value={mediaType} onChange={handleMediaTypeChange}>
              {MEDIA_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Results per page</span>
            <select value={resultsPerPage} onChange={handleResultsPerPageChange}>
              {RESULTS_PER_PAGE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Language</span>
            <select value={language} onChange={handleLanguageChange}>
              {LANGUAGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Source trust</span>
            <select value={sourceTrust} onChange={handleSourceTrustChange}>
              {SOURCE_TRUST_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Availability</span>
            <select value={availability} onChange={handleAvailabilityChange}>
              {AVAILABILITY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Collection</span>
            <input
              type="text"
              value={collection}
              onChange={handleCollectionChange}
              placeholder="e.g. nasa"
            />
          </label>
          <label>
            <span>Uploader</span>
            <input
              type="text"
              value={uploader}
              onChange={handleUploaderChange}
              placeholder="Uploader handle"
            />
          </label>
          <label>
            <span>Subject tags</span>
            <input
              type="text"
              value={subject}
              onChange={handleSubjectChange}
              placeholder="Comma-separated"
            />
          </label>
          <label>
            <span>NSFW mode</span>
            <select value={nsfwMode} onChange={(event) => handleChangeNSFWMode(event.target.value as NSFWFilterMode)}>
              <option value="safe">Safe</option>
              <option value="moderate">Moderate</option>
              <option value="unrestricted">No Restriction</option>
              <option value="nsfw-only">NSFW Only</option>
            </select>
          </label>
          <div className="year-filters">
            <label>
              <span>From</span>
              <input
                type="text"
                value={yearFrom}
                onChange={handleYearFromChange}
                placeholder="YYYY"
                aria-invalid={!isYearValid(yearFrom)}
              />
            </label>
            <label>
              <span>To</span>
              <input
                type="text"
                value={yearTo}
                onChange={handleYearToChange}
                placeholder="YYYY"
                aria-invalid={!isYearValid(yearTo)}
              />
            </label>
            <button type="button" onClick={applyFilters} disabled={!activeQuery}>
              Apply filters
            </button>
          </div>
        </div>
        {!isYearValid(yearFrom) || !isYearValid(yearTo) ? (
          <p className="field-error" role="alert">
            Year filters must be four-digit values (e.g., 1999). Clear the field to search all dates.
          </p>
        ) : null}
      </div>

      <AiAssistantPanel
        enabled={aiAssistantEnabled}
        status={aiSummaryStatus}
        summary={aiSummary}
        error={aiSummaryError}
        notice={aiSummaryNotice}
        source={aiSummarySource}
        collapsed={aiPanelCollapsed}
        onToggleCollapse={() => setAiPanelCollapsed((previous) => !previous)}
      />

      {liveStatus ? (
        <LiveStatusCard url={activeQuery ?? query} status={liveStatus} wayback={waybackDetails} />
      ) : null}
      {waybackDetails || waybackError ? (
        <WaybackAvailabilityCard url={activeQuery ?? query} payload={waybackDetails} error={waybackError} />
      ) : null}

      <section className="results-container" aria-live="polite" ref={resultsContainerRef}>
        <ResultsList
          results={filteredResults}
          statuses={statuses}
          nsfwMode={nsfwMode}
          isLoading={isLoading}
          error={error}
          hasSearched={hasSearched}
          page={page}
          totalPages={totalPages}
          totalResults={totalResults}
          resultsPerPage={resultsPerPage}
          onPageChange={handlePageChange}
          onToggleBookmark={toggleBookmark}
          onOpenDetails={openDetails}
          bookmarkedIds={bookmarkedIdentifiers}
          onSaveSnapshot={handleSaveSnapshot}
          saveMeta={saveMeta}
          onReport={handleReportSubmission}
          suggestionNode={suggestionNode}
          notice={combinedNotice}
          viewMode={mediaType === "image" ? "images" : "default"}
          isLoadingMore={isLoadingMore}
          loadMoreError={loadMoreError}
          onLoadMore={handleLoadMore}
          hasMore={hasMoreResults}
          loadedPages={loadedPages.length}
          loadMoreRef={loadMoreSentinelRef}
        />
      </section>

      <Sidebar
        isOpen={sidebarOpen}
        activeTab={sidebarTab}
        onClose={() => setSidebarOpen(false)}
        onSelectTab={setSidebarTab}
        bookmarks={bookmarks}
      history={history}
      onSelectHistoryItem={(value) => {
        setSidebarOpen(false);
        handleSuggestionClick(value);
      }}
      onRemoveHistoryItem={handleRemoveHistoryItem}
      onRemoveBookmark={removeBookmark}
      settingsPanel={settingsPanel}
      assistantPanel={assistantPanel}
      showAssistantTab={aiAssistantEnabled}
    />

      {selectedDoc ? (
        <ItemDetailsPanel
          doc={selectedDoc}
          metadata={metadataState.data}
          metadataLoading={metadataState.loading}
          metadataError={metadataState.error}
          timeline={timelineState.data}
          timelineLoading={timelineState.loading}
          timelineError={timelineState.error}
          relatedItems={filteredRelatedItems}
          relatedFallback={relatedFallback}
          relatedError={relatedError}
          onClose={closeDetails}
          aiEnabled={aiAssistantEnabled}
          aiHelperStatus={aiDocHelperStatus}
          aiHelperMessage={aiDocHelperMessage}
          aiHelperError={aiDocHelperError}
          onRequestAiHelper={() => {
            void handleAskAiAboutDocument();
          }}
        />
      ) : null}
    </div>
  );
}

export default App;
