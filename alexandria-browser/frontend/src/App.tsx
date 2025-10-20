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
import {
  searchArchive,
  checkLinkStatus,
  requestSaveSnapshot
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
import { isLikelyUrl, isYearValid, normalizeYear } from "./utils/validators";
import type {
  ArchiveSearchDoc,
  BookmarkEntry,
  LinkStatus,
  SearchHistoryEntry,
  SpellcheckCorrection,
  StoredSettings
} from "./types";

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

  const resultsContainerRef = useRef<HTMLDivElement | null>(null);
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

  const suggestionList = useMemo(() => {
    const historyQueries = history.map((entry) => entry.query);
    const bookmarkTitles = bookmarks.map((bookmark) => bookmark.title || bookmark.identifier);
    return [...historyQueries, ...bookmarkTitles];
  }, [history, bookmarks]);

  const performSearch = useCallback(
    async (searchQuery: string, pageNumber: number, options?: { recordHistory?: boolean; rowsOverride?: number }) => {
      const rows = options?.rowsOverride ?? resultsPerPage;
      setIsLoading(true);
      setError(null);
      setFallbackNotice(null);

      const normalizedYearFrom = normalizeYear(yearFrom);
      const normalizedYearTo = normalizeYear(yearTo);

      try {
        if (!isYearValid(yearFrom) || !isYearValid(yearTo)) {
          throw new Error("Year filters must be four-digit values (e.g., 1999).");
        }
        if (normalizedYearFrom && normalizedYearTo && Number(normalizedYearFrom) > Number(normalizedYearTo)) {
          throw new Error("The start year cannot be later than the end year.");
        }

        const payload = await searchArchive(searchQuery, pageNumber, rows, {
          mediaType,
          yearFrom: normalizedYearFrom,
          yearTo: normalizedYearTo
        });

        if (payload.fallback) {
          setFallbackNotice(
            "Working offline — showing a limited built-in dataset while the Alexandria backend is unreachable."
          );
        }

        const docs = payload.response?.docs ?? [];
        const numFound = payload.response?.numFound ?? null;

        setResults(docs);
        setTotalResults(numFound);
        setTotalPages(numFound !== null ? Math.max(1, Math.ceil(numFound / rows)) : null);
        setPage(pageNumber);
        setHasSearched(true);
        setStatuses(() => {
          const next: Record<string, LinkStatus> = {};
          const defaultStatus: LinkStatus = payload.fallback ? "offline" : "checking";
          for (const doc of docs) {
            next[doc.identifier] = defaultStatus;
          }
          return next;
        });
        setSaveMeta(() => {
          const next: Record<string, SaveMeta> = {};
          for (const doc of docs) {
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
            const entry: SearchHistoryEntry = { query: searchQuery, timestamp: Date.now() };
            return [entry, ...previous.filter((item) => item.query !== searchQuery)].slice(0, 50);
          });
          setHistoryIndex(0);
        }

        if (resultsContainerRef.current) {
          resultsContainerRef.current.scrollTo({ top: 0, behavior: "smooth" });
        }

        if (payload.fallback) {
          setLiveStatus(null);
        } else if (isLikelyUrl(searchQuery)) {
          setLiveStatus("checking");
          try {
            const status = await checkLinkStatus(searchQuery);
            setLiveStatus(status);
          } catch (statusError) {
            console.warn("Failed to check live status", statusError);
            setLiveStatus("offline");
          }
        } else {
          setLiveStatus(null);
        }
      } catch (fetchError) {
        console.error(fetchError);
        setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
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
    [resultsPerPage, mediaType, yearFrom, yearTo]
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
    if (results.length === 0 || fallbackNotice) {
      return;
    }
    let cancelled = false;

    const loadStatuses = async () => {
      const pairs = await Promise.all(
        results.map(async (doc) => {
          const targetUrl = `https://archive.org/details/${encodeURIComponent(doc.identifier)}`;
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
  }, [results, fallbackNotice]);

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
        addedAt: Date.now()
      };
      return [entry, ...previous];
    });
  };

  const removeBookmark = (identifier: string) => {
    setBookmarks((previous) => previous.filter((bookmark) => bookmark.identifier !== identifier));
  };

  const handleSaveSnapshot = async (identifier: string, archiveUrl: string) => {
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
    setQuery(nextQuery);
    setActiveQuery(nextQuery);
    void performSearch(nextQuery, 1);
  };

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
    const trimmedQuery = defaults.lastQuery.trim();
    setQuery(trimmedQuery);
    setActiveQuery(null);
    setHasSearched(false);
    setHistoryIndex(-1);
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

      <section className="results-container" aria-live="polite" ref={resultsContainerRef}>
        <ResultsList
          results={results}
          statuses={statuses}
          filterNSFW={filterNSFW}
          isLoading={isLoading}
          error={error}
          hasSearched={hasSearched}
          page={page}
          totalPages={totalPages}
          totalResults={totalResults}
          resultsPerPage={resultsPerPage}
          onPageChange={handlePageChange}
          onToggleBookmark={toggleBookmark}
          bookmarkedIds={bookmarkedIdentifiers}
          onSaveSnapshot={handleSaveSnapshot}
          saveMeta={saveMeta}
          suggestionNode={suggestionNode}
          notice={fallbackNotice}
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
        onRemoveBookmark={removeBookmark}
        settingsPanel={settingsPanel}
      />
    </div>
  );
}

export default App;
