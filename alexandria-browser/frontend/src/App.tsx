/**
 * Alexandria Browser Frontend
 *
 * Manifesto:
 * The internet forgets. Links die. Knowledge is buried by algorithms and corporations.
 * The Alexandria Browser exists to preserve collective memory. It searches, restores,
 * and archives knowledge using the Internet Archive. It serves no ads, no agendas—only truth,
 * utility, and preservation.
 *
 * Core values:
 * - Preserve Everything
 * - No Gatekeepers
 * - Serve the Seeker
 * - Build Open and Forkable
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent
} from "react";

interface ArchiveSearchDoc {
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

interface SpellcheckCorrection {
  original: string;
  corrected: string;
}

interface SpellcheckPayload {
  originalQuery: string;
  correctedQuery: string;
  corrections: SpellcheckCorrection[];
}

interface ArchiveSearchResponse {
  response?: {
    docs?: ArchiveSearchDoc[];
    numFound?: number;
    start?: number;
  };
  spellcheck?: SpellcheckPayload | null;
}

interface SavePageResponse {
  success?: boolean;
  snapshotUrl?: string;
  message?: string;
  error?: string;
  details?: string;
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

const SETTINGS_KEY = "alexandria-browser-settings";
const DEFAULT_RESULTS_PER_PAGE = 20;
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
const YEAR_PATTERN = /^\d{4}$/;

type Theme = "light" | "dark";
type MediaTypeOption = (typeof MEDIA_TYPE_OPTIONS)[number]["value"];

interface StoredSettings {
  theme: Theme;
  filterNSFW: boolean;
  lastQuery: string;
  resultsPerPage: number;
  mediaType: MediaTypeOption;
  yearFrom: string;
  yearTo: string;
}

const DEFAULT_SETTINGS: StoredSettings = {
  theme: "light",
  filterNSFW: true,
  lastQuery: "",
  resultsPerPage: DEFAULT_RESULTS_PER_PAGE,
  mediaType: "all",
  yearFrom: "",
  yearTo: ""
};

const sanitizeTheme = (value: unknown): Theme => (value === "dark" ? "dark" : "light");

const sanitizeBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const sanitizeResultsPerPage = (value: unknown): number => {
  const numericValue = typeof value === "number" ? value : Number(value);
  return RESULTS_PER_PAGE_OPTIONS.includes(numericValue)
    ? numericValue
    : DEFAULT_RESULTS_PER_PAGE;
};

const sanitizeMediaType = (value: unknown): MediaTypeOption => {
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (MEDIA_TYPE_OPTIONS.some((option) => option.value === normalized)) {
      return normalized as MediaTypeOption;
    }
  }
  return "all";
};

const sanitizeYearField = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  return YEAR_PATTERN.test(trimmed) ? trimmed : "";
};

const isYearInputInvalid = (value: string): boolean => {
  const trimmed = value.trim();
  return trimmed.length > 0 && !YEAR_PATTERN.test(trimmed);
};

const loadStoredSettings = (): StoredSettings => {
  if (typeof window === "undefined") {
    return DEFAULT_SETTINGS;
  }

  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) {
      return DEFAULT_SETTINGS;
    }

    const parsed = JSON.parse(raw) as Partial<StoredSettings>;

    return {
      theme: sanitizeTheme(parsed.theme),
      filterNSFW: sanitizeBoolean(parsed.filterNSFW, DEFAULT_SETTINGS.filterNSFW),
      lastQuery:
        typeof parsed.lastQuery === "string" ? parsed.lastQuery : DEFAULT_SETTINGS.lastQuery,
      resultsPerPage: sanitizeResultsPerPage(parsed.resultsPerPage),
      mediaType: sanitizeMediaType(parsed.mediaType),
      yearFrom: sanitizeYearField(parsed.yearFrom),
      yearTo: sanitizeYearField(parsed.yearTo)
    } satisfies StoredSettings;
  } catch (parseError) {
    console.warn("Unable to read stored Alexandria Browser settings", parseError);
    return DEFAULT_SETTINGS;
  }
};

type LinkStatus = "online" | "archived-only" | "offline" | "checking";

type SaveStateStatus = "idle" | "saving" | "success" | "error";

interface SaveState {
  status: SaveStateStatus;
  message?: string;
  snapshotUrl?: string;
}

const STATUS_LABELS: Record<LinkStatus, string> = {
  online: "🟢 Online",
  "archived-only": "🟡 Archived only",
  offline: "🔴 Offline",
  checking: "Checking availability…"
};

const STATUS_ARIA_LABELS: Record<LinkStatus, string> = {
  online: "Online",
  "archived-only": "Archived only",
  offline: "Offline",
  checking: "Checking availability"
};

function App() {
  const storedSettingsRef = useRef<StoredSettings | null>(null);
  if (storedSettingsRef.current === null) {
    storedSettingsRef.current = loadStoredSettings();
  }

  const initialSettings = storedSettingsRef.current ?? DEFAULT_SETTINGS;

  const [theme, setTheme] = useState<Theme>(() => initialSettings.theme);
  const [query, setQuery] = useState(() => initialSettings.lastQuery);
  const [activeQuery, setActiveQuery] = useState<string | null>(() =>
    initialSettings.lastQuery ? initialSettings.lastQuery : null
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ArchiveSearchDoc[]>([]);
  const [totalResults, setTotalResults] = useState<number | null>(null);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [hasSearched, setHasSearched] = useState(() => Boolean(initialSettings.lastQuery));
  const [statusMap, setStatusMap] = useState<Record<string, LinkStatus>>({});
  const [saveStatusMap, setSaveStatusMap] = useState<Record<string, SaveState>>({});
  const [filterNSFW, setFilterNSFW] = useState(() => initialSettings.filterNSFW);
  const [suggestedQuery, setSuggestedQuery] = useState<string | null>(null);
  const [suggestionCorrections, setSuggestionCorrections] = useState<SpellcheckCorrection[]>([]);
  const [resultsPerPage, setResultsPerPage] = useState(() => initialSettings.resultsPerPage);
  const [mediaType, setMediaType] = useState<MediaTypeOption>(() => initialSettings.mediaType);
  const [yearFrom, setYearFrom] = useState(() => initialSettings.yearFrom);
  const [yearTo, setYearTo] = useState(() => initialSettings.yearTo);
  const resultsContainerRef = useRef<HTMLDivElement | null>(null);
  const hasBootstrappedSearch = useRef(false);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const payload: StoredSettings = {
      theme,
      filterNSFW,
      lastQuery: activeQuery ?? "",
      resultsPerPage,
      mediaType,
      yearFrom: YEAR_PATTERN.test(yearFrom.trim()) ? yearFrom.trim() : "",
      yearTo: YEAR_PATTERN.test(yearTo.trim()) ? yearTo.trim() : ""
    };

    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
  }, [theme, filterNSFW, activeQuery, resultsPerPage, mediaType, yearFrom, yearTo]);

  const themeLabel = useMemo(() => (theme === "light" ? "🌞 Light" : "🌜 Dark"), [theme]);

  const performSearch = useCallback(
    async (searchQuery: string, pageNumber: number, overrideRows?: number) => {
      hasBootstrappedSearch.current = true;
      setIsLoading(true);
      setError(null);

      try {
        if (isYearInputInvalid(yearFrom)) {
          setIsLoading(false);
          setError("Please enter a 4-digit start year (e.g., 1999).");
          return;
        }

        if (isYearInputInvalid(yearTo)) {
          setIsLoading(false);
          setError("Please enter a 4-digit end year (e.g., 2015).");
          return;
        }

        const normalizedYearFrom = YEAR_PATTERN.test(yearFrom.trim()) ? yearFrom.trim() : "";
        const normalizedYearTo = YEAR_PATTERN.test(yearTo.trim()) ? yearTo.trim() : "";

        if (
          normalizedYearFrom &&
          normalizedYearTo &&
          Number(normalizedYearFrom) > Number(normalizedYearTo)
        ) {
          setIsLoading(false);
          setError("The start year cannot be later than the end year.");
          return;
        }

        const url = new URL(`${API_BASE_URL}/api/search`);
        url.searchParams.set("q", searchQuery);
        url.searchParams.set("page", String(pageNumber));
        const rows = overrideRows ?? resultsPerPage;
        url.searchParams.set("rows", String(rows));
        if (mediaType !== "all") {
          url.searchParams.set("mediaType", mediaType);
        }
        if (normalizedYearFrom) {
          url.searchParams.set("yearFrom", normalizedYearFrom);
        }
        if (normalizedYearTo) {
          url.searchParams.set("yearTo", normalizedYearTo);
        }

        const response = await fetch(url.toString());
        if (!response.ok) {
          throw new Error(`Search failed with status ${response.status}`);
        }

        const payload = (await response.json()) as ArchiveSearchResponse;
        const docs = payload.response?.docs ?? [];
        const numFound = payload.response?.numFound ?? null;

        setResults(docs);
        setTotalResults(numFound);
        setTotalPages(numFound !== null ? Math.max(1, Math.ceil(numFound / rows)) : null);
        setStatusMap(() => {
          const initialStatuses: Record<string, LinkStatus> = {};
          for (const doc of docs) {
            initialStatuses[doc.identifier] = "checking";
          }
          return initialStatuses;
        });
        setSaveStatusMap(() => {
          const initialSaves: Record<string, SaveState> = {};
          for (const doc of docs) {
            initialSaves[doc.identifier] = { status: "idle" };
          }
          return initialSaves;
        });

      const suggestion = payload.spellcheck;
      if (
        suggestion &&
        suggestion.correctedQuery &&
        suggestion.originalQuery &&
        suggestion.correctedQuery.trim().toLowerCase() !==
          suggestion.originalQuery.trim().toLowerCase()
      ) {
        setSuggestedQuery(suggestion.correctedQuery.trim());
        setSuggestionCorrections(suggestion.corrections ?? []);
      } else {
        setSuggestedQuery(null);
        setSuggestionCorrections([]);
      }

      if (resultsContainerRef.current) {
        resultsContainerRef.current.scrollTo({ top: 0, behavior: "smooth" });
      }
    } catch (fetchError) {
      console.error(fetchError);
      setError(
        fetchError instanceof Error
          ? fetchError.message
          : "An unexpected error occurred while searching the archives."
      );
      setResults([]);
      setTotalResults(null);
      setTotalPages(null);
      setStatusMap({});
      setSaveStatusMap({});
      setSuggestedQuery(null);
      setSuggestionCorrections([]);
      } finally {
        setIsLoading(false);
      }
    },
    [resultsPerPage, mediaType, yearFrom, yearTo]
  );

  useEffect(() => {
    const initialLastQuery = initialSettings.lastQuery;
    if (!initialLastQuery || hasBootstrappedSearch.current) {
      return;
    }

    setPage(1);
    setHasSearched(true);
    setActiveQuery(initialLastQuery);
    setQuery(initialLastQuery);
    void performSearch(initialLastQuery, 1, initialSettings.resultsPerPage);
  }, [initialSettings.lastQuery, initialSettings.resultsPerPage, performSearch]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      return;
    }

    setQuery(trimmedQuery);
    setActiveQuery(trimmedQuery);
    setPage(1);
    setHasSearched(true);
    await performSearch(trimmedQuery, 1);
  };

  const handlePageChange = async (direction: "previous" | "next") => {
    if (!activeQuery) {
      return;
    }

    const nextPage = direction === "next" ? page + 1 : page - 1;
    if (nextPage < 1) {
      return;
    }

    if (totalPages !== null && (nextPage > totalPages || nextPage < 1)) {
      return;
    }

    setPage(nextPage);
    await performSearch(activeQuery, nextPage);
  };

  const toggleTheme = () => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  const handleSuggestionClick = async (nextQuery: string) => {
    const trimmed = nextQuery.trim();
    if (!trimmed) {
      return;
    }

    setQuery(trimmed);
    setActiveQuery(trimmed);
    setPage(1);
    setHasSearched(true);
    await performSearch(trimmed, 1);
  };

  const handleResultsPerPageChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const value = Number(event.target.value);
    if (Number.isNaN(value) || !RESULTS_PER_PAGE_OPTIONS.includes(value)) {
      return;
    }

    setResultsPerPage(value);

    if (!activeQuery) {
      return;
    }

    setPage(1);
    setHasSearched(true);
    void performSearch(activeQuery, 1, value);
  };

  const handleMediaTypeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextValue = event.target.value as MediaTypeOption;
    if (!MEDIA_TYPE_OPTIONS.some((option) => option.value === nextValue)) {
      return;
    }

    setMediaType(nextValue);
  };

  const handleYearFromChange = (event: ChangeEvent<HTMLInputElement>) => {
    setYearFrom(event.target.value);
  };

  const handleYearToChange = (event: ChangeEvent<HTMLInputElement>) => {
    setYearTo(event.target.value);
  };

  const applyFilterChanges = useCallback(() => {
    if (!activeQuery) {
      return;
    }

    setPage(1);
    setHasSearched(true);
    void performSearch(activeQuery, 1);
  }, [activeQuery, performSearch]);

  const handleSaveToArchive = async (identifier: string, targetUrl: string) => {
    setSaveStatusMap((previous) => ({
      ...previous,
      [identifier]: {
        status: "saving",
        message: "Requesting snapshot from the Wayback Machine…"
      }
    }));

    try {
      const response = await fetch(`${API_BASE_URL}/api/save`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ url: targetUrl })
      });

      const payload = (await response.json()) as SavePageResponse;

      if (!response.ok || payload.success === false) {
        const errorMessage =
          payload.error || payload.details || "Save Page Now rejected the snapshot request.";
        setSaveStatusMap((previous) => ({
          ...previous,
          [identifier]: {
            status: "error",
            message: errorMessage,
            snapshotUrl: payload.snapshotUrl
          }
        }));
        return;
      }

      setSaveStatusMap((previous) => ({
        ...previous,
        [identifier]: {
          status: "success",
          message:
            payload.message ??
            "Snapshot request sent to Save Page Now. Check Wayback Machine for updates.",
          snapshotUrl: payload.snapshotUrl
        }
      }));
    } catch (saveError) {
      const message =
        saveError instanceof Error
          ? saveError.message
          : "An unexpected error occurred while requesting Save Page Now.";
      setSaveStatusMap((previous) => ({
        ...previous,
        [identifier]: {
          status: "error",
          message,
          snapshotUrl: undefined
        }
      }));
    }
  };

  useEffect(() => {
    if (results.length === 0) {
      setStatusMap({});
      return;
    }

    setStatusMap((previous) => {
      const next: Record<string, LinkStatus> = {};
      for (const doc of results) {
        next[doc.identifier] = previous[doc.identifier] ?? "checking";
      }
      return next;
    });
    setSaveStatusMap((previous) => {
      const next: Record<string, SaveState> = {};
      for (const doc of results) {
        next[doc.identifier] = previous[doc.identifier] ?? { status: "idle" };
      }
      return next;
    });

    let isCancelled = false;

    const fetchStatuses = async () => {
      const statusEntries: Array<[string, LinkStatus]> = await Promise.all(
        results.map(async (doc) => {
          const archiveUrl = `https://archive.org/details/${encodeURIComponent(doc.identifier)}`;
          try {
            const url = new URL(`${API_BASE_URL}/api/status`);
            url.searchParams.set("url", archiveUrl);

            const response = await fetch(url.toString());
            if (!response.ok) {
              throw new Error(`Status check failed with ${response.status}`);
            }

            const payload = (await response.json()) as { status?: LinkStatus };
            const status = payload.status ?? "offline";
            return [doc.identifier, status] satisfies [string, LinkStatus];
          } catch (statusError) {
            console.warn("Failed to determine status for", doc.identifier, statusError);
            return [doc.identifier, "offline"] satisfies [string, LinkStatus];
          }
        })
      );

      if (!isCancelled) {
        setStatusMap((previous) => {
          const next = { ...previous };
          for (const [identifier, status] of statusEntries) {
            next[identifier] = status;
          }
          return next;
        });
      }
    };

    void fetchStatuses();

    return () => {
      isCancelled = true;
    };
  }, [results]);

  const mediaIcon = (mediatype?: string) => {
    if (!mediatype) return "🗂️";
    const normalized = mediatype.toLowerCase();
    switch (normalized) {
      case "texts":
        return "📚";
      case "audio":
      case "etree":
        return "🎧";
      case "movies":
      case "video":
        return "🎬";
      case "software":
        return "💾";
      case "image":
      case "images":
        return "🖼️";
      case "data":
        return "📊";
      default:
        return "🗂️";
    }
  };

  const getDescription = (description?: string | string[]) => {
    if (!description) return "";
    return Array.isArray(description) ? description.join(" ") : description;
  };

  const getYearOrDate = (doc: ArchiveSearchDoc) => {
    if (doc.year) return doc.year;
    if (doc.date) return doc.date;
    if (doc.publicdate) return doc.publicdate.split("T")[0];
    return "Unknown";
  };

  const renderResults = () => {
    if (isLoading) {
      return <div className="results-message">Searching the archives…</div>;
    }

    if (error) {
      return (
        <div className="results-error" role="alert">
          Unable to reach the archives: {error}
        </div>
      );
    }

    if (!hasSearched) {
      return <div className="results-message">Results will appear here once you begin searching.</div>;
    }

    const correctionSummary =
      suggestionCorrections.length > 0
        ? suggestionCorrections.map((item) => `${item.original} → ${item.corrected}`).join(", ")
        : null;

    const suggestionNode = suggestedQuery ? (
      <div className="spellcheck-suggestion" role="note">
        Did you mean
        {" "}
        <button
          type="button"
          className="spellcheck-button"
          onClick={() => void handleSuggestionClick(suggestedQuery)}
        >
          {suggestedQuery}
        </button>
        {correctionSummary ? <span className="spellcheck-details">({correctionSummary})</span> : null}
      </div>
    ) : null;

    if (results.length === 0) {
      return (
        <>
          {suggestionNode}
          <div className="results-message">No records found. Try refining your query.</div>
        </>
      );
    }

    const startIndex = (page - 1) * resultsPerPage + 1;
    const endIndex = (page - 1) * resultsPerPage + results.length;
    const pageLabel = totalPages ? `Page ${page} of ${totalPages}` : `Page ${page}`;
    const canGoPrevious = page > 1 && !isLoading;
    const canGoNext =
      !isLoading &&
      (totalPages === null ? results.length === resultsPerPage : page < totalPages);

    return (
      <>
        {suggestionNode}
        <div className="results-summary">
          Showing {startIndex}
          {" "}
          –
          {" "}
          {endIndex} of {totalResults ?? "?"} preserved records · {pageLabel}
        </div>
        <ol className="results-list">
          {results.map((doc) => {
            const archiveUrl = `https://archive.org/details/${encodeURIComponent(doc.identifier)}`;
            const waybackUrl = `https://web.archive.org/web/*/${archiveUrl}`;
            const description = getDescription(doc.description);
            const yearOrDate = getYearOrDate(doc);
            const creator = Array.isArray(doc.creator)
              ? doc.creator.join(", ")
              : doc.creator ?? undefined;
            const status = statusMap[doc.identifier] ?? "checking";
            const statusClassName = `result-status status-${status}`;
            const isNSFW = doc.nsfw === true;
            const saveState = saveStatusMap[doc.identifier] ?? { status: "idle" };
            const isSaving = saveState.status === "saving";
            const cardClassNames = ["result-card"];
            if (isNSFW) {
              cardClassNames.push("result-card-nsfw");
            }
            if (filterNSFW && isNSFW) {
              cardClassNames.push("result-card-nsfw-filtered");
            }

            return (
              <li key={doc.identifier} className={cardClassNames.join(" ")}> 
                <div className={`result-body${filterNSFW && isNSFW ? " result-body-blurred" : ""}`}>
                  <div className="result-header">
                    <span className="result-media" aria-hidden="true">
                      {mediaIcon(doc.mediatype)}
                    </span>
                    <div>
                      <a href={archiveUrl} target="_blank" rel="noreferrer" className="result-title">
                        {doc.title || doc.identifier}
                      </a>
                      <div className="result-meta">
                        <span>{yearOrDate}</span>
                        {creator ? <span>· {creator}</span> : null}
                        {!filterNSFW && isNSFW ? <span className="nsfw-label">(NSFW)</span> : null}
                      </div>
                    </div>
                  </div>
                  {description ? <p className="result-description">{description}</p> : null}
                  <div className="result-footer">
                    <span className={statusClassName} aria-live="polite" aria-label={STATUS_ARIA_LABELS[status]}>
                      {STATUS_LABELS[status]}
                    </span>
                    <div className="result-links">
                      <a href={archiveUrl} target="_blank" rel="noreferrer">
                        View on Internet Archive
                      </a>
                      <a href={waybackUrl} target="_blank" rel="noreferrer">
                        Wayback snapshots
                      </a>
                      <button
                        type="button"
                        className="save-button"
                        onClick={() =>
                          void handleSaveToArchive(doc.identifier, archiveUrl)
                        }
                        disabled={isSaving}
                      >
                        {isSaving ? "Saving…" : "Save to Archive"}
                      </button>
                    </div>
                  </div>
                  {saveState.status !== "idle" ? (
                    <div
                      className={`save-status save-status-${saveState.status}`}
                      aria-live="polite"
                    >
                      {saveState.status === "success" ? "✅" : saveState.status === "error" ? "⚠️" : "⏳"} {saveState.message}
                      {saveState.snapshotUrl ? (
                        <>
                          {" "}
                          <a
                            href={saveState.snapshotUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View snapshot
                          </a>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {filterNSFW && isNSFW ? (
                  <div className="nsfw-warning" role="note">
                    NSFW content hidden. Disable the filter to reveal this preserved record.
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
        <div className="pagination-controls" role="navigation" aria-label="Search pagination">
          <button
            type="button"
            className="pagination-button"
            onClick={() => void handlePageChange("previous")}
            disabled={!canGoPrevious}
          >
            Previous Page
          </button>
          <span className="pagination-info">{pageLabel}</span>
          <button
            type="button"
            className="pagination-button"
            onClick={() => void handlePageChange("next")}
            disabled={!canGoNext}
          >
            Next Page
          </button>
        </div>
      </>
    );
  };

  const yearFromInvalid = isYearInputInvalid(yearFrom);
  const yearToInvalid = isYearInputInvalid(yearTo);
  const canApplyFilters = Boolean(activeQuery) && !yearFromInvalid && !yearToInvalid;

  return (
    <div className="app-shell">
      <header className="hero">
        <h1>Alexandria Browser</h1>
        <p className="tagline">Preserve Everything · No Gatekeepers · Serve the Seeker · Build Open and Forkable</p>
      </header>

      <section className="search-panel">
        <div className="settings-panel" role="group" aria-label="Display settings">
          <button type="button" className="theme-toggle" onClick={toggleTheme} aria-label="Toggle theme">
            {themeLabel}
          </button>
          <label className="nsfw-toggle">
            <input
              type="checkbox"
              checked={filterNSFW}
              onChange={(event) => setFilterNSFW(event.target.checked)}
            />
            <span className="nsfw-toggle-indicator" aria-hidden="true" />
            <span className="nsfw-toggle-label">Filter NSFW content</span>
          </label>
          <label className="results-count-select">
            <span className="results-count-label">Results per page</span>
            <select value={resultsPerPage} onChange={handleResultsPerPageChange} aria-label="Results per page">
              {RESULTS_PER_PAGE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
        </div>
        <form className="search-form" onSubmit={handleSubmit} role="search" aria-label="Alexandria search">
          <div className="search-row">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search the archives..."
              className="search-input"
              aria-label="Search query"
            />
            <button type="submit" className="search-button">
              Search
            </button>
          </div>
          <div className="advanced-controls" role="group" aria-label="Advanced filters">
            <label className="media-type-select">
              <span className="media-type-label">Media type</span>
              <select value={mediaType} onChange={handleMediaTypeChange} aria-label="Filter by media type">
                {MEDIA_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="year-filters">
              <label className="year-field">
                <span className="year-label">From year</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\\d{4}"
                  maxLength={4}
                  placeholder="YYYY"
                  value={yearFrom}
                  onChange={handleYearFromChange}
                  aria-invalid={yearFromInvalid}
                />
              </label>
              <label className="year-field">
                <span className="year-label">To year</span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="\\d{4}"
                  maxLength={4}
                  placeholder="YYYY"
                  value={yearTo}
                  onChange={handleYearToChange}
                  aria-invalid={yearToInvalid}
                />
              </label>
              <button
                type="button"
                className="apply-filters-button"
                onClick={applyFilterChanges}
                disabled={!canApplyFilters}
              >
                Apply filters
              </button>
            </div>
          </div>
          <p className="filter-hint">
            Refine by media type or publication year using Internet Archive advanced search parameters. Leave years blank for
            open-ended ranges.
          </p>
          {yearFromInvalid || yearToInvalid ? (
            <p className="field-error" role="alert">
              Year filters must be four-digit values (e.g., 1999). Clear the field to search all dates.
            </p>
          ) : null}
        </form>
      </section>

      <section className="results-container" aria-live="polite" ref={resultsContainerRef}>
        {renderResults()}
      </section>
    </div>
  );
}

export default App;
