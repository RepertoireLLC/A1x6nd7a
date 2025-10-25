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
import { ResultsList } from "./components/ResultsList";
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
  submitReport
} from "./api/archive";
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
import { isLikelyUrl, isYearValid, normalizeYear } from "./utils/validators";
import type {
  AiSearchPlan,
  ArchiveMetadataResponse,
  ArchiveSearchDoc,
  BookmarkEntry,
  CdxResponse,
  LinkStatus,
  ScrapeItem,
  SearchHistoryEntry,
  SpellcheckCorrection,
  StoredSettings,
  NSFWFilterMode,
  WaybackAvailabilityResponse
} from "./types";
import { ItemDetailsPanel } from "./components/ItemDetailsPanel";
import type { ReportSubmissionPayload } from "./reporting";
import {
  annotateDocs,
  annotateScrapeItems,
  applyNSFWModeToDocs,
  applyNSFWModeToScrape,
  countHiddenByMode,
  shouldIncludeDoc
} from "./utils/nsfw";
import { planArchiveQuery } from "./utils/aiSearch";

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

const ADULT_CONFIRM_MESSAGE =
  "Switching to this mode may display adult content. Please confirm you are 18 years or older to continue.";

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
  const [nsfwMode, setNsfwMode] = useState<NSFWFilterMode>(() => settings.nsfwMode ?? (settings.filterNSFW ? "safe" : "off"));
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
  const [aiPlannerSummary, setAiPlannerSummary] = useState<AiSearchPlan | null>(null);

  const resultsContainerRef = useRef<HTMLDivElement | null>(null);
  const bootstrapped = useRef(false);
  const blacklistRef = useRef<string[]>(initialBlacklist.current);
  const aiPlannerRef = useRef<AiSearchPlan | null>(null);
  const aiPlannerSourceRef = useRef<string | null>(null);
  const resetAiPlanner = useCallback(() => {
    aiPlannerRef.current = null;
    aiPlannerSourceRef.current = null;
    setAiPlannerSummary(null);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    const settingsPayload: StoredSettings = {
      theme,
      filterNSFW: nsfwMode !== "off",
      nsfwMode,
      lastQuery: activeQuery ?? "",
      resultsPerPage,
      mediaType,
      yearFrom,
      yearTo
    };
    saveSettings(settingsPayload);
  }, [theme, nsfwMode, activeQuery, resultsPerPage, mediaType, yearFrom, yearTo]);

  useEffect(() => {
    saveHistory(history);
  }, [history]);

  useEffect(() => {
    saveBookmarks(bookmarks);
  }, [bookmarks]);

  useEffect(() => {
    blacklistRef.current = blacklist;
    saveBlacklist(blacklist);
  }, [blacklist]);

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

    setMetadataState((previous) => ({ ...previous, loading: true, error: null }));
    void fetchArchiveMetadata(selectedDoc.identifier).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setMetadataState({ data: result.data, loading: false, error: null });
      } else {
        setMetadataState({ data: null, loading: false, error: result.error.message });
      }
    });

    const archiveUrl =
      selectedDoc.archive_url ??
      selectedDoc.links?.archive ??
      `https://archive.org/details/${encodeURIComponent(selectedDoc.identifier)}`;

    setTimelineState((previous) => ({ ...previous, loading: true, error: null }));
    void fetchCdxSnapshots(archiveUrl, 80).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        setTimelineState({ data: result.data, loading: false, error: null });
      } else {
        setTimelineState({ data: null, loading: false, error: result.error.message });
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
    void scrapeArchive(query, 6).then((result) => {
      if (cancelled) {
        return;
      }
      if (result.ok) {
        const filtered = result.data.items.filter((item) => item.identifier !== selectedDoc.identifier);
        setRelatedItems(annotateScrapeItems(filtered));
        setRelatedFallback(Boolean(result.data.fallback));
        setRelatedError(null);
      } else {
        setRelatedItems([]);
        setRelatedFallback(false);
        setRelatedError(result.error.message);
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

  const filteredResults = useMemo(() => applyNSFWModeToDocs(results, nsfwMode), [results, nsfwMode]);
  const hiddenResultCount = useMemo(() => countHiddenByMode(results, nsfwMode), [results, nsfwMode]);
  const filteredRelatedItems = useMemo(
    () => applyNSFWModeToScrape(relatedItems, nsfwMode),
    [relatedItems, nsfwMode]
  );

  const performSearch = useCallback(
    async (
      searchQuery: string,
      pageNumber: number,
      options?: { recordHistory?: boolean; rowsOverride?: number; skipAiPlanner?: boolean }
    ) => {
      const rows = options?.rowsOverride ?? resultsPerPage;
      const safeQuery = searchQuery.trim();
      if (!safeQuery) {
        resetAiPlanner();
        setError("Please enter a search query.");
        setFallbackNotice(null);
        return;
      }

      setIsLoading(true);
      setError(null);
      setFallbackNotice(null);
      setSelectedDoc(null);
      setMetadataState({ data: null, loading: false, error: null });
      setTimelineState({ data: null, loading: false, error: null });
      setRelatedItems([]);
      setRelatedFallback(false);
      setRelatedError(null);

      const normalizedYearFrom = normalizeYear(yearFrom);
      const normalizedYearTo = normalizeYear(yearTo);
      const shouldUseAiPlanner = !isLikelyUrl(safeQuery) && options?.skipAiPlanner !== true;
      let planner: AiSearchPlan | null = aiPlannerRef.current;
      let finalQuery = safeQuery;

      if (shouldUseAiPlanner) {
        const isNewSource = aiPlannerSourceRef.current !== safeQuery;
        if (isNewSource) {
          aiPlannerSourceRef.current = safeQuery;
          aiPlannerRef.current = null;
          planner = null;
          setAiPlannerSummary(null);
        }

        if (!planner) {
          try {
            const planned = await planArchiveQuery(safeQuery);
            if (planned) {
              const normalizedPlan =
                planned.source === safeQuery ? planned : { ...planned, source: safeQuery };
              planner = normalizedPlan;
              aiPlannerRef.current = normalizedPlan;
              aiPlannerSourceRef.current = safeQuery;
              setAiPlannerSummary(normalizedPlan);
            } else if (isNewSource) {
              setAiPlannerSummary(null);
            }
          } catch (plannerError) {
            console.warn("AI query planner failed", plannerError);
            if (isNewSource) {
              setAiPlannerSummary(null);
            }
          }
        } else {
          setAiPlannerSummary(planner);
        }

        if (planner?.optimizedQuery.trim()) {
          finalQuery = planner.optimizedQuery.trim();
        }
      } else {
        aiPlannerRef.current = null;
        aiPlannerSourceRef.current = safeQuery;
        setAiPlannerSummary(null);
      }

      try {
        if (!isYearValid(yearFrom) || !isYearValid(yearTo)) {
          throw new Error("Year filters must be four-digit values (e.g., 1999).");
        }
        if (normalizedYearFrom && normalizedYearTo && Number(normalizedYearFrom) > Number(normalizedYearTo)) {
          throw new Error("The start year cannot be later than the end year.");
        }

        const result = await searchArchive(finalQuery, pageNumber, rows, {
          mediaType,
          yearFrom: normalizedYearFrom,
          yearTo: normalizedYearTo
        });

        if (!result.ok) {
          console.warn("Archive search failed", result.error);
          const message = result.error.message?.trim() || "Search request failed. Please try again later.";
          setError(message);
          setFallbackNotice(null);
          setResults([]);
          setTotalResults(null);
          setTotalPages(null);
          setStatuses({});
          setSaveMeta({});
          setSuggestedQuery(null);
          setSuggestionCorrections([]);
          setLiveStatus(null);
          return;
        }

        const payload = result.data;

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

        const docs = payload.response?.docs ?? [];
        const numFound = payload.response?.numFound ?? null;
        const hiddenIdentifiers =
          blacklistRef.current.length > 0 ? new Set(blacklistRef.current) : null;
        const visibleDocs = hiddenIdentifiers
          ? docs.filter((doc) => !hiddenIdentifiers.has(doc.identifier))
          : docs;

        const annotatedDocs = annotateDocs(visibleDocs);
        setResults(annotatedDocs);
        setTotalResults(numFound);
        setTotalPages(numFound !== null ? Math.max(1, Math.ceil(numFound / rows)) : null);
        setPage(pageNumber);
        setHasSearched(true);
        setStatuses(() => {
          const next: Record<string, LinkStatus> = {};
          const defaultStatus: LinkStatus = payload.fallback ? "offline" : "checking";
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

        if (payload.fallback) {
          setLiveStatus(null);
          setWaybackDetails(null);
          setWaybackError(null);
        } else if (isLikelyUrl(safeQuery)) {
          setLiveStatus("checking");
          setWaybackDetails(null);
          setWaybackError(null);
          const [statusResult, availabilityResult] = await Promise.all([
            checkLinkStatus(safeQuery),
            getWaybackAvailability(safeQuery)
          ]);

          let combinedError: string | null = null;

          if (statusResult.ok) {
            setLiveStatus(statusResult.data);
          } else {
            console.warn("Failed to check live status", statusResult.error);
            setLiveStatus("offline");
            combinedError = statusResult.error.message;
          }

          if (availabilityResult.ok) {
            setWaybackDetails(availabilityResult.data);
          } else {
            console.warn("Failed to load Wayback availability", availabilityResult.error);
            setWaybackDetails(null);
            combinedError = combinedError ?? availabilityResult.error.message;
          }

          setWaybackError(combinedError);
        } else {
          setLiveStatus(null);
          setWaybackDetails(null);
          setWaybackError(null);
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
        setError(message);
        setFallbackNotice(null);
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
    [resultsPerPage, mediaType, yearFrom, yearTo, resetAiPlanner]
  );

  useEffect(() => {
    if (bootstrapped.current || !settings.lastQuery) {
      return;
    }
    bootstrapped.current = true;
    setActiveQuery(settings.lastQuery);
    void performSearch(settings.lastQuery, 1, { recordHistory: false, rowsOverride: settings.resultsPerPage });
  }, [performSearch, settings.lastQuery, settings.resultsPerPage]);

  useEffect(() => {
    if (filteredResults.length === 0 || fallbackNotice) {
      return;
    }
    let cancelled = false;

    const loadStatuses = async () => {
      const pairs = await Promise.all(
        filteredResults.map(async (doc) => {
          const targetUrl =
            doc.archive_url ??
            doc.links?.archive ??
            `https://archive.org/details/${encodeURIComponent(doc.identifier)}`;
          const statusResult = await checkLinkStatus(targetUrl);
          if (statusResult.ok) {
            return [doc.identifier, statusResult.data] as const;
          }
          console.warn("Status check failed", statusResult.error);
          return [doc.identifier, "offline"] as const;
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
  }, [filteredResults, fallbackNotice]);

  useEffect(() => {
    if (selectedDoc && !shouldIncludeDoc(selectedDoc, nsfwMode)) {
      setSelectedDoc(null);
    }
  }, [selectedDoc, nsfwMode]);

  const handleSubmit = async () => {
    const trimmed = query.trim();
    if (!trimmed) {
      resetAiPlanner();
      return;
    }
    setQuery(trimmed);
    setActiveQuery(trimmed);
    await performSearch(trimmed, 1);
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
    resetAiPlanner();
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
    setNsfwMode(defaults.nsfwMode ?? (defaults.filterNSFW ? "safe" : "off"));
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
    resetAiPlanner();
    const trimmedQuery = defaults.lastQuery.trim();
    setQuery(trimmedQuery);
    setActiveQuery(null);
    setHasSearched(false);
    setHistoryIndex(-1);
  };

  const handleNSFWModeChange = useCallback(
    (nextMode: NSFWFilterMode) => {
      if (nextMode === nsfwMode) {
        return;
      }

      if (nextMode !== "safe") {
        const confirmed = window.confirm(ADULT_CONFIRM_MESSAGE);
        if (!confirmed) {
          setNsfwMode("safe");
          return;
        }
      }

      setNsfwMode(nextMode);
    },
    [nsfwMode]
  );

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
      nsfwMode={nsfwMode}
      onToggleTheme={() => setTheme((previous) => (previous === "light" ? "dark" : "light"))}
      onChangeNSFWMode={handleNSFWModeChange}
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
          notice={fallbackNotice}
          aiSummary={aiPlannerSummary}
          viewMode={mediaType === "image" ? "images" : "default"}
          hiddenCount={hiddenResultCount}
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
        />
      ) : null}
    </div>
  );
}

export default App;
