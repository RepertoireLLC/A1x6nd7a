import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent
} from "react";

import { BrowserNav } from "./components/BrowserNav";
import { SearchBar } from "./components/SearchBar";
import { Sidebar } from "./components/Sidebar";
import { SearchResults } from "./components/SearchResults";
import { SettingsPanel } from "./components/SettingsPanel";
import { LiveStatusCard } from "./components/LiveStatusCard";
import { WaybackAvailabilityCard } from "./components/WaybackAvailabilityCard";
import {
  searchArchive,
  checkLinkStatus,
  requestSaveSnapshot,
  fetchArchiveMetadata,
  fetchCdxSnapshots,
  scrapeArchive,
  getWaybackAvailability,
  fetchSiteImages
} from "./api/archive";
import {
  loadBookmarks,
  loadHistory,
  loadSettings,
  resetStoredSettings,
  saveBookmarks,
  saveHistory,
  saveSettings
} from "./utils/storage";
import { isYearValid, normalizeYear, normalizeUrlInput } from "./utils/validators";
import type {
  ArchiveMetadataResponse,
  ArchiveSearchDoc,
  BookmarkEntry,
  CdxResponse,
  LinkStatus,
  ScrapeItem,
  SearchHistoryEntry,
  SpellcheckCorrection,
  StoredSettings,
  WaybackAvailabilityResponse,
  SiteImageEntry
} from "./types";
import { ItemDetailsPanel } from "./components/ItemDetailsPanel";
import { SettingsProvider } from "./context/SettingsContext";
import { SiteImageGallery } from "./components/SiteImageGallery";

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

const RESULTS_TAB_ID = "search-results-tab";
const RESULTS_PANEL_ID = "search-results-panel";
const IMAGES_TAB_ID = "site-images-tab";
const IMAGES_PANEL_ID = "site-images-panel";

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

function normalizeSearchInput(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function mergeSiteImageEntries(previous: SiteImageEntry[], incoming: SiteImageEntry[]): SiteImageEntry[] {
  if (previous.length === 0) {
    return incoming;
  }

  const seen = new Set(previous.map((entry) => `${entry.timestamp}|${entry.original}`));
  const merged = [...previous];
  for (const entry of incoming) {
    const key = `${entry.timestamp}|${entry.original}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(entry);
    }
  }
  return merged;
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
  const [filterNSFW, setFilterNSFW] = useState(() => settings.filterNSFW);
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
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);
  const [searchNotice, setSearchNotice] = useState<string | null>(null);
  const [connectionMode, setConnectionMode] = useState<"backend" | "direct" | "offline">("backend");
  const [hasSearched, setHasSearched] = useState(() => Boolean(settings.lastQuery));
  const [resultsPerPage, setResultsPerPage] = useState(() => settings.resultsPerPage);
  const [mediaType, setMediaType] = useState(() => settings.mediaType);
  const [yearFrom, setYearFrom] = useState(() => settings.yearFrom);
  const [yearTo, setYearTo] = useState(() => settings.yearTo);
  const [statuses, setStatuses] = useState<Record<string, LinkStatus>>({});
  const [saveMeta, setSaveMeta] = useState<Record<string, SaveMeta>>({});
  const [suggestedQuery, setSuggestedQuery] = useState<string | null>(null);
  const [suggestionCorrections, setSuggestionCorrections] = useState<SpellcheckCorrection[]>([]);
  const initialHistory = useRef<SearchHistoryEntry[]>(loadHistory());
  const initialBookmarks = useRef<BookmarkEntry[]>(loadBookmarks());
  const [history, setHistory] = useState<SearchHistoryEntry[]>(() => initialHistory.current);
  const [bookmarks, setBookmarks] = useState<BookmarkEntry[]>(() => initialBookmarks.current);
  const [historyIndex, setHistoryIndex] = useState<number>(() => {
    if (!settings.lastQuery) {
      return -1;
    }
    const position = initialHistory.current.findIndex((entry) => entry.query === settings.lastQuery);
    return position >= 0 ? position : 0;
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"bookmarks" | "history" | "settings">("bookmarks");
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
  const [siteImages, setSiteImages] = useState<SiteImageEntry[]>([]);
  const [siteImagesQuery, setSiteImagesQuery] = useState<string | null>(null);
  const [siteImagesPage, setSiteImagesPage] = useState(1);
  const [siteImagesHasMore, setSiteImagesHasMore] = useState(false);
  const [siteImagesLoading, setSiteImagesLoading] = useState(false);
  const [siteImagesError, setSiteImagesError] = useState<string | null>(null);
  const [siteImagesScope, setSiteImagesScope] = useState<"host" | "path">("host");
  const [siteImagesFallback, setSiteImagesFallback] = useState(false);
  const [siteImagesTotal, setSiteImagesTotal] = useState<number | undefined>(undefined);
  const [siteImagesSite, setSiteImagesSite] = useState<string>("");
  const [activeResultsTab, setActiveResultsTab] = useState<"results" | "images">("results");

  const resultsContainerRef = useRef<HTMLDivElement | null>(null);
  const siteImagesRequestId = useRef(0);
  const bootstrapped = useRef(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    const settingsPayload: StoredSettings = {
      theme,
      filterNSFW,
      lastQuery: activeQuery ?? "",
      resultsPerPage,
      mediaType,
      yearFrom,
      yearTo
    };
    saveSettings(settingsPayload);
  }, [theme, filterNSFW, activeQuery, resultsPerPage, mediaType, yearFrom, yearTo]);

  useEffect(() => {
    saveHistory(history);
  }, [history]);

  useEffect(() => {
    saveBookmarks(bookmarks);
  }, [bookmarks]);

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

    setMetadataState((previous) => ({ ...previous, loading: true, error: null }));
    void fetchArchiveMetadata(selectedDoc.identifier)
      .then((payload) => {
        if (!cancelled) {
          setMetadataState({ data: payload, loading: false, error: null });
        }
      })
      .catch((metadataError) => {
        if (!cancelled) {
          setMetadataState({
            data: null,
            loading: false,
            error: metadataError instanceof Error ? metadataError.message : String(metadataError)
          });
        }
      });

    const archiveUrl =
      selectedDoc.archive_url ??
      selectedDoc.links?.archive ??
      `https://archive.org/details/${encodeURIComponent(selectedDoc.identifier)}`;

    setTimelineState((previous) => ({ ...previous, loading: true, error: null }));
    void fetchCdxSnapshots(archiveUrl, 80)
      .then((payload) => {
        if (!cancelled) {
          setTimelineState({ data: payload, loading: false, error: null });
        }
      })
      .catch((timelineError) => {
        if (!cancelled) {
          setTimelineState({
            data: null,
            loading: false,
            error: timelineError instanceof Error ? timelineError.message : String(timelineError)
          });
        }
      });

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
      : selectedDoc.title ?? selectedDoc.identifier;

    setRelatedError(null);
    setRelatedFallback(false);
    void scrapeArchive(query, 6)
      .then((payload) => {
        if (!cancelled) {
          const filtered = payload.items.filter((item) => item.identifier !== selectedDoc.identifier);
          setRelatedItems(filtered);
          setRelatedFallback(Boolean(payload.fallback));
        }
      })
      .catch((relatedErr) => {
        if (!cancelled) {
          setRelatedItems([]);
          setRelatedFallback(false);
          setRelatedError(relatedErr instanceof Error ? relatedErr.message : String(relatedErr));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedDoc]);

  const suggestionList = useMemo(() => {
    const historyQueries = history.map((entry) => entry.query);
    const bookmarkTitles = bookmarks.map((bookmark) => bookmark.title || bookmark.identifier);
    return [...historyQueries, ...bookmarkTitles];
  }, [history, bookmarks]);

  const loadSiteImages = useCallback(
    async (targetUrl: string, pageToLoad: number, append: boolean) => {
      const requestId = siteImagesRequestId.current + 1;
      siteImagesRequestId.current = requestId;
      setSiteImagesLoading(true);
      if (!append) {
        setSiteImagesError(null);
        setSiteImagesHasMore(false);
        setSiteImagesFallback(false);
        setSiteImagesTotal(undefined);
        if (pageToLoad === 1) {
          setSiteImagesPage(1);
        }
      }

      try {
        const payload = await fetchSiteImages(targetUrl, pageToLoad);
        if (siteImagesRequestId.current !== requestId) {
          return;
        }

        setSiteImagesError(null);
        setSiteImagesScope(payload.scope);
        setSiteImagesSite(payload.site);
        setSiteImagesFallback(Boolean(payload.fallback));
        setSiteImagesTotal(payload.total);
        setSiteImagesPage(payload.page);
        setSiteImagesHasMore(Boolean(payload.hasMore));
        const nextItems = Array.isArray(payload.items) ? payload.items : [];
        setSiteImages((previous) =>
          append ? mergeSiteImageEntries(previous, nextItems) : nextItems
        );
      } catch (error) {
        if (siteImagesRequestId.current !== requestId) {
          return;
        }

        const message = error instanceof Error ? error.message : String(error);
        setSiteImagesError(message);
        if (!append) {
          setSiteImages([]);
          setSiteImagesHasMore(false);
          setSiteImagesFallback(false);
          setSiteImagesSite("");
          setSiteImagesTotal(undefined);
        }
      } finally {
        if (siteImagesRequestId.current === requestId) {
          setSiteImagesLoading(false);
        }
      }
    },
    []
  );

  const performSearch = useCallback(
    async (searchQuery: string, pageNumber: number, options?: { recordHistory?: boolean; rowsOverride?: number }) => {
      const rows = options?.rowsOverride ?? resultsPerPage;
      const safeQuery = normalizeSearchInput(searchQuery);
      if (!safeQuery) {
        setError("Please enter a search query.");
        setFallbackNotice(null);
        setSearchNotice(null);
        return;
      }

      setIsLoading(true);
      setError(null);
      setFallbackNotice(null);
      setSearchNotice(null);
      setSelectedDoc(null);
      setMetadataState({ data: null, loading: false, error: null });
      setTimelineState({ data: null, loading: false, error: null });
      setRelatedItems([]);
      setRelatedFallback(false);
      setRelatedError(null);

      const normalizedYearFrom = normalizeYear(yearFrom);
      const normalizedYearTo = normalizeYear(yearTo);

      const normalizedUrl = normalizeUrlInput(safeQuery);
      if (normalizedUrl) {
        const isNewSiteQuery = normalizedUrl !== siteImagesQuery;
        const shouldRefreshImages = pageNumber === 1 || isNewSiteQuery;
        setSiteImagesQuery(normalizedUrl);
        if (isNewSiteQuery) {
          setActiveResultsTab("images");
        }
        if (shouldRefreshImages) {
          siteImagesRequestId.current += 1;
          setSiteImagesError(null);
          setSiteImages([]);
          setSiteImagesHasMore(false);
          setSiteImagesFallback(false);
          setSiteImagesTotal(undefined);
          setSiteImagesSite("");
          setSiteImagesPage(1);
          setSiteImagesLoading(true);
          void loadSiteImages(normalizedUrl, 1, false);
        }
      } else {
        setActiveResultsTab("results");
        siteImagesRequestId.current += 1;
        setSiteImagesQuery(null);
        setSiteImages([]);
        setSiteImagesHasMore(false);
        setSiteImagesError(null);
        setSiteImagesFallback(false);
        setSiteImagesTotal(undefined);
        setSiteImagesSite("");
        setSiteImagesPage(1);
        setSiteImagesLoading(false);
      }

      try {
        if (!isYearValid(yearFrom) || !isYearValid(yearTo)) {
          throw new Error("Year filters must be four-digit values (e.g., 1999).");
        }
        if (normalizedYearFrom && normalizedYearTo && Number(normalizedYearFrom) > Number(normalizedYearTo)) {
          throw new Error("The start year cannot be later than the end year.");
        }

        const payload = await searchArchive(safeQuery, pageNumber, rows, {
          mediaType,
          yearFrom: normalizedYearFrom,
          yearTo: normalizedYearTo
        });

        const nextConnectionMode =
          payload.connection_mode ?? (payload.fallback ? "offline" : "backend");
        setConnectionMode(nextConnectionMode);

        if (payload.fallback) {
          const fallbackReason = payload.fallback_reason?.trim() ?? "";
          const fallbackMessage =
            payload.fallback_message?.trim() ??
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
          payload.search_strategy &&
          payload.search_strategy !== "primary search with fuzzy expansion"
        ) {
          const simplifiedQuery = payload.search_strategy_query?.trim();
          const strategyMessage = simplifiedQuery
            ? `Recovered from an unexpected Internet Archive response by retrying with the simplified query "${simplifiedQuery}". Results may be broader than usual.`
            : "Recovered from an unexpected Internet Archive response by retrying with a simplified query. Results may be broader than usual.";
          setFallbackNotice(strategyMessage);
        }

        if (nextConnectionMode === "direct" && !payload.fallback) {
          setFallbackNotice((previous) =>
            previous ??
            "Connected directly to the Internet Archive after the Alexandria proxy was unreachable. Some features may be limited until the proxy returns."
          );
        }

        const docs = payload.response?.docs ?? [];
        const normalizedMediaType = mediaType.trim().toLowerCase();
        const filteredDocs =
          normalizedMediaType && normalizedMediaType !== "all"
            ? docs.filter((doc) => (doc.mediatype ?? "").toString().toLowerCase() === normalizedMediaType)
            : docs;
        const filteredOutCount = docs.length - filteredDocs.length;

        const rawNumFound = payload.response?.numFound;
        const hasNumericTotal = typeof rawNumFound === "number" && Number.isFinite(rawNumFound);
        const totalMatches = hasNumericTotal ? (rawNumFound as number) : filteredDocs.length;

        const baseNotice = payload.search_notice?.trim() ?? null;
        let noticeText = baseNotice;
        if (normalizedMediaType && normalizedMediaType !== "all" && filteredOutCount > 0) {
          const mediaLabel =
            MEDIA_TYPE_OPTIONS.find((option) => option.value === normalizedMediaType)?.label ??
            normalizedMediaType;
          const loweredLabel = mediaLabel.toLowerCase();
          const removalMessage =
            filteredOutCount === 1
              ? `Removed 1 result that was not categorized as ${loweredLabel}.`
              : `Removed ${filteredOutCount} results that were not categorized as ${loweredLabel}.`;
          noticeText = noticeText ? `${noticeText} ${removalMessage}` : removalMessage;
        }
        setSearchNotice(noticeText);

        const safeRows = rows > 0 ? rows : 20;

        setResults(filteredDocs);
        setTotalResults(totalMatches);
        setTotalPages(
          hasNumericTotal ? Math.max(1, Math.ceil((totalMatches || 1) / safeRows)) : null
        );
        setPage(pageNumber);
        setHasSearched(true);
        setStatuses(() => {
          const next: Record<string, LinkStatus> = {};
          const defaultStatus: LinkStatus =
            payload.fallback || nextConnectionMode !== "backend" ? "offline" : "checking";
          for (const doc of filteredDocs) {
            next[doc.identifier] = defaultStatus;
          }
          return next;
        });
        setSaveMeta(() => {
          const next: Record<string, SaveMeta> = {};
          for (const doc of filteredDocs) {
            next[doc.identifier] = { ...DEFAULT_SAVE_META };
          }
          return next;
        });

        const suggestion = payload.spellcheck;
        if (
          suggestion &&
          suggestion.correctedQuery &&
          suggestion.originalQuery &&
          suggestion.correctedQuery.trim().toLowerCase() !== suggestion.originalQuery.trim().toLowerCase()
        ) {
          setSuggestedQuery(suggestion.correctedQuery.trim());
          setSuggestionCorrections(suggestion.corrections ?? []);
        } else {
          setSuggestedQuery(null);
          setSuggestionCorrections([]);
        }

        if (options?.recordHistory ?? true) {
          setHistory((previous) => {
            const entry: SearchHistoryEntry = { query: safeQuery, timestamp: Date.now() };
            return [entry, ...previous.filter((item) => item.query !== safeQuery)].slice(0, 50);
          });
          setHistoryIndex(0);
        }

        if (resultsContainerRef.current) {
          resultsContainerRef.current.scrollTo({ top: 0, behavior: "smooth" });
        }

        if (payload.fallback || nextConnectionMode !== "backend") {
          setLiveStatus(null);
          setWaybackDetails(null);
          setWaybackError(null);
        } else if (normalizedUrl) {
          setLiveStatus("checking");
          setWaybackDetails(null);
          setWaybackError(null);
          try {
            const [status, availability] = await Promise.all([
              checkLinkStatus(normalizedUrl),
              getWaybackAvailability(normalizedUrl)
            ]);
            setLiveStatus(status);
            setWaybackDetails(availability);
          } catch (statusError) {
            console.warn("Failed to check live status", statusError);
            setLiveStatus("offline");
            setWaybackError(statusError instanceof Error ? statusError.message : String(statusError));
          }
        } else {
          setLiveStatus(null);
          setWaybackDetails(null);
          setWaybackError(null);
        }
      } catch (fetchError) {
        console.error(fetchError);
        setConnectionMode("backend");
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
        setError(message);
        setFallbackNotice(null);
        setSearchNotice(null);
        setResults([]);
        setTotalResults(null);
        setTotalPages(null);
        setStatuses({});
        setSaveMeta({});
        setSuggestedQuery(null);
        setSuggestionCorrections([]);
        setLiveStatus(null);
      } finally {
        setIsLoading(false);
      }
    },
    [resultsPerPage, mediaType, yearFrom, yearTo, loadSiteImages, siteImagesQuery]
  );

  useEffect(() => {
    if (bootstrapped.current || !settings.lastQuery) {
      return;
    }
    bootstrapped.current = true;
    setActiveQuery(settings.lastQuery);
    void performSearch(settings.lastQuery, 1, { recordHistory: false, rowsOverride: settings.resultsPerPage });
  }, [performSearch, settings.lastQuery, settings.resultsPerPage]);

  const handleLoadMoreSiteImages = useCallback(() => {
    if (!siteImagesQuery || siteImagesLoading || !siteImagesHasMore) {
      return;
    }
    void loadSiteImages(siteImagesQuery, siteImagesPage + 1, true);
  }, [siteImagesQuery, siteImagesLoading, siteImagesHasMore, siteImagesPage, loadSiteImages]);

  const handleRefreshSiteImages = useCallback(() => {
    if (!siteImagesQuery) {
      return;
    }
    siteImagesRequestId.current += 1;
    void loadSiteImages(siteImagesQuery, 1, false);
  }, [siteImagesQuery, loadSiteImages]);

  useEffect(() => {
    if (results.length === 0 || fallbackNotice || connectionMode !== "backend") {
      return;
    }
    let cancelled = false;

    const loadStatuses = async () => {
      const pairs = await Promise.all(
        results.map(async (doc) => {
          const targetUrl =
            doc.archive_url ??
            doc.links?.archive ??
            `https://archive.org/details/${encodeURIComponent(doc.identifier)}`;
          try {
            const status = await checkLinkStatus(targetUrl);
            return [doc.identifier, status] as const;
          } catch (errorStatus) {
            console.warn("Status check failed", errorStatus);
            return [doc.identifier, "offline"] as const;
          }
        })
      );
      if (!cancelled) {
        setStatuses((previous) => {
          const next = { ...previous };
          for (const [identifier, status] of pairs) {
            next[identifier] = status;
          }
          return next;
        });
      }
    };

    void loadStatuses();
    return () => {
      cancelled = true;
    };
  }, [results, fallbackNotice, connectionMode]);

  const handleSubmit = async (submitted: string) => {
    const normalized = normalizeSearchInput(submitted);
    if (!normalized) {
      return;
    }
    setQuery(normalized);
    setActiveQuery(normalized);
    await performSearch(normalized, 1);
  };

  const handlePageChange = async (direction: "previous" | "next") => {
    if (!activeQuery) {
      return;
    }
    const nextPage = direction === "next" ? page + 1 : page - 1;
    if (nextPage < 1) {
      return;
    }
    if (totalPages !== null && nextPage > totalPages) {
      return;
    }
    await performSearch(activeQuery, nextPage, { recordHistory: false });
  };

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

  const handleYearFromChange = (event: ChangeEvent<HTMLInputElement>) => {
    setYearFrom(event.target.value);
  };

  const handleYearToChange = (event: ChangeEvent<HTMLInputElement>) => {
    setYearTo(event.target.value);
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
    try {
      const response = await requestSaveSnapshot(archiveUrl);
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
    } catch (saveError) {
      console.error("Save Page Now failed", saveError);
      setSaveMeta((previous) => ({
        ...previous,
        [identifier]: {
          label: "Try again",
          disabled: false,
          message: "Unable to contact Save Page Now.",
          tone: "error"
        }
      }));
    }
  };

  const handleSuggestionClick = (nextQuery: string) => {
    const normalized = normalizeSearchInput(nextQuery);
    if (!normalized) {
      return;
    }
    setQuery(normalized);
    setActiveQuery(normalized);
    void performSearch(normalized, 1);
  };

  const goBack = () => {
    if (history.length === 0 || historyIndex === history.length - 1) {
      return;
    }
    const nextIndex = historyIndex + 1;
    const entry = history[nextIndex];
    const normalized = normalizeSearchInput(entry.query);
    setHistoryIndex(nextIndex);
    setQuery(normalized);
    setActiveQuery(normalized);
    void performSearch(normalized, 1, { recordHistory: false });
  };

  const goForward = () => {
    if (historyIndex <= 0) {
      return;
    }
    const nextIndex = historyIndex - 1;
    const entry = history[nextIndex];
    const normalized = normalizeSearchInput(entry.query);
    setHistoryIndex(nextIndex);
    setQuery(normalized);
    setActiveQuery(normalized);
    void performSearch(normalized, 1, { recordHistory: false });
  };

  const refresh = () => {
    if (activeQuery) {
      void performSearch(activeQuery, page, { recordHistory: false });
    }
  };

  const goHome = () => {
    setQuery("");
    setActiveQuery(null);
    setActiveResultsTab("results");
    setResults([]);
    setTotalPages(null);
    setTotalResults(null);
    setSuggestedQuery(null);
    setSuggestionCorrections([]);
    setHasSearched(false);
    setLiveStatus(null);
    setSelectedDoc(null);
    setSearchNotice(null);
    siteImagesRequestId.current += 1;
    setSiteImagesQuery(null);
    setSiteImages([]);
    setSiteImagesError(null);
    setSiteImagesHasMore(false);
    setSiteImagesLoading(false);
    setSiteImagesFallback(false);
    setSiteImagesTotal(undefined);
    setSiteImagesSite("");
    setSiteImagesScope("host");
    setSiteImagesPage(1);
  };

  const clearHistory = () => {
    setHistory([]);
    setHistoryIndex(-1);
  };

  const deleteHistoryEntry = useCallback((entry: SearchHistoryEntry) => {
    setHistory((previous) => {
      const index = previous.findIndex(
        (item) => item.timestamp === entry.timestamp && item.query === entry.query
      );
      if (index === -1) {
        return previous;
      }
      const next = [...previous.slice(0, index), ...previous.slice(index + 1)];
      setHistoryIndex((currentIndex) => {
        if (currentIndex < 0) {
          return next.length > 0 ? currentIndex : -1;
        }
        if (index < currentIndex) {
          return currentIndex - 1;
        }
        if (index === currentIndex) {
          return next.length > 0 ? Math.min(currentIndex, next.length - 1) : -1;
        }
        return currentIndex;
      });
      return next;
    });
  }, []);

  const clearBookmarks = () => {
    setBookmarks([]);
  };

  // ADD: Provide a one-click way to restore all persisted preferences to their defaults.
  const resetPreferences = () => {
    const defaults = resetStoredSettings();
    initialSettings.current = defaults;
    setTheme(defaults.theme);
    setFilterNSFW(defaults.filterNSFW);
    setResultsPerPage(defaults.resultsPerPage);
    setMediaType(defaults.mediaType);
    setYearFrom(defaults.yearFrom);
    setYearTo(defaults.yearTo);
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
    const trimmedQuery = defaults.lastQuery.trim();
    setQuery(trimmedQuery);
    setActiveQuery(null);
    setActiveResultsTab("results");
    setHasSearched(false);
    setHistoryIndex(-1);
    siteImagesRequestId.current += 1;
    setSiteImagesQuery(null);
    setSiteImages([]);
    setSiteImagesError(null);
    setSiteImagesHasMore(false);
    setSiteImagesLoading(false);
    setSiteImagesFallback(false);
    setSiteImagesTotal(undefined);
    setSiteImagesSite("");
    setSiteImagesScope("host");
    setSiteImagesPage(1);
  };

  const suggestionNode = suggestedQuery ? (
    <div className="spellcheck-suggestion" role="note">
      Did you mean
      {" "}
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
  ) : null;

  const settingsPanel = (
    <SettingsPanel
      theme={theme}
      filterNSFW={filterNSFW}
      onToggleTheme={() => setTheme((previous) => (previous === "light" ? "dark" : "light"))}
      onToggleNSFW={setFilterNSFW}
      onClearHistory={clearHistory}
      onClearBookmarks={clearBookmarks}
      onResetPreferences={resetPreferences}
    />
  );

  // FIX: Require a valid history pointer before enabling the Back button to avoid false positives after resets.
  const canGoBack = history.length > 0 && historyIndex >= 0 && historyIndex < history.length - 1;
  const canGoForward = history.length > 0 && historyIndex > 0;
  const canRefresh = Boolean(activeQuery) && !isLoading;

  return (
    <SettingsProvider filterNSFW={filterNSFW} setFilterNSFW={setFilterNSFW}>
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

      {liveStatus ? <LiveStatusCard url={activeQuery ?? query} status={liveStatus} /> : null}
      {waybackDetails || waybackError ? (
        <WaybackAvailabilityCard url={activeQuery ?? query} payload={waybackDetails} error={waybackError} />
      ) : null}

      <section className="results-container" aria-live="polite" ref={resultsContainerRef}>
        {siteImagesQuery ? (
          <div className="results-tabs" role="tablist" aria-label="Search result views">
            <button
              type="button"
              id={RESULTS_TAB_ID}
              role="tab"
              aria-selected={activeResultsTab === "results"}
              aria-controls={RESULTS_PANEL_ID}
              className={`results-tab${activeResultsTab === "results" ? " results-tab--active" : ""}`}
              onClick={() => setActiveResultsTab("results")}
              tabIndex={activeResultsTab === "results" ? 0 : -1}
            >
              Results
            </button>
            <button
              type="button"
              id={IMAGES_TAB_ID}
              role="tab"
              aria-selected={activeResultsTab === "images"}
              aria-controls={IMAGES_PANEL_ID}
              className={`results-tab${activeResultsTab === "images" ? " results-tab--active" : ""}`}
              onClick={() => setActiveResultsTab("images")}
              tabIndex={activeResultsTab === "images" ? 0 : -1}
            >
              Archived images
            </button>
          </div>
        ) : null}
        <div
          className="results-pane"
          id={RESULTS_PANEL_ID}
          role={siteImagesQuery ? "tabpanel" : undefined}
          aria-labelledby={siteImagesQuery ? RESULTS_TAB_ID : undefined}
          hidden={siteImagesQuery ? activeResultsTab !== "results" : false}
        >
          <SearchResults
            results={results}
            statuses={statuses}
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
            suggestionNode={suggestionNode}
            fallbackNotice={fallbackNotice}
            searchNotice={searchNotice}
          />
        </div>
        {siteImagesQuery ? (
          <div
            className="results-pane"
            id={IMAGES_PANEL_ID}
            role="tabpanel"
            aria-labelledby={IMAGES_TAB_ID}
            hidden={activeResultsTab !== "images"}
          >
            <SiteImageGallery
              items={siteImages}
              query={siteImagesQuery}
              site={siteImagesSite}
              scope={siteImagesScope}
              page={siteImagesPage}
              total={siteImagesTotal}
              isLoading={siteImagesLoading}
              error={siteImagesError}
              hasMore={siteImagesHasMore}
              fallback={siteImagesFallback}
              onLoadMore={handleLoadMoreSiteImages}
              onRefresh={handleRefreshSiteImages}
            />
          </div>
        ) : null}
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
        onDeleteHistoryItem={deleteHistoryEntry}
        onRemoveBookmark={removeBookmark}
        settingsPanel={settingsPanel}
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
          relatedItems={relatedItems}
          relatedFallback={relatedFallback}
          relatedError={relatedError}
          onClose={closeDetails}
        />
      ) : null}
      </div>
    </SettingsProvider>
  );
}

export default App;
