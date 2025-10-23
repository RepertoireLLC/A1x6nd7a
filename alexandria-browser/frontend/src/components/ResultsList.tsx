import { useEffect, useState, type MutableRefObject, type ReactNode, type RefObject } from "react";
import type { ArchiveSearchDoc, LinkStatus, NSFWFilterMode } from "../types";
import type { ReportSubmitHandler } from "../reporting";
import { ResultCard } from "./ResultCard";
import { PaginationControls } from "./PaginationControls";
import { ImageResultGrid } from "./ImageResultGrid";
import { LoadingIndicator } from "./LoadingIndicator";
import { StatusBanner } from "./StatusBanner";
import { resolveDocLinks } from "../utils/resultPresentation";

interface ResultsListProps {
  results: ArchiveSearchDoc[];
  statuses: Record<string, LinkStatus>;
  nsfwMode: NSFWFilterMode;
  isLoading: boolean;
  error: string | null;
  hasSearched: boolean;
  page: number;
  totalPages: number | null;
  totalResults: number | null;
  resultsPerPage: number;
  onPageChange: (direction: "previous" | "next") => void;
  onToggleBookmark: (identifier: string, doc: ArchiveSearchDoc) => void;
  onOpenDetails: (doc: ArchiveSearchDoc) => void;
  bookmarkedIds: Set<string>;
  onSaveSnapshot: (identifier: string, url: string) => void;
  saveMeta: Record<string, { label: string; disabled: boolean; message: string | null; snapshotUrl?: string; tone?: "success" | "error" | "info" }>;
  onReport: ReportSubmitHandler;
  suggestionNode: ReactNode;
  notice?: string | null;
  viewMode?: "default" | "images";
  hiddenCount?: number;
  hiddenDocs?: ArchiveSearchDoc[];
  isLoadingMore?: boolean;
  loadMoreError?: string | null;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadedPages?: number;
  loadMoreRef?: RefObject<HTMLDivElement> | MutableRefObject<HTMLDivElement | null>;
}

/**
 * ResultsList renders the archive search outcomes including pagination controls.
 */
export function ResultsList({
  results,
  statuses,
  nsfwMode,
  isLoading,
  error,
  hasSearched,
  page,
  totalPages,
  totalResults,
  resultsPerPage,
  onPageChange,
  onToggleBookmark,
  onOpenDetails,
  bookmarkedIds,
  onSaveSnapshot,
  saveMeta,
  onReport,
  suggestionNode,
  notice,
  viewMode = "default",
  hiddenCount = 0,
  hiddenDocs = [],
  isLoadingMore = false,
  loadMoreError = null,
  onLoadMore,
  hasMore = false,
  loadedPages,
  loadMoreRef
}: ResultsListProps) {
  const [showHiddenResults, setShowHiddenResults] = useState(false);

  useEffect(() => {
    if (hiddenDocs.length === 0) {
      setShowHiddenResults(false);
    }
  }, [hiddenDocs]);

  if (isLoading) {
    return <LoadingIndicator label="Searching the archives…" />;
  }

  if (error) {
    return <StatusBanner tone="error" message={`Unable to reach the archives. ${error}`} />;
  }

  if (!hasSearched) {
    return <StatusBanner tone="info" message="Results will appear here once you begin searching." />;
  }

  if (results.length === 0) {
    return (
      <>
        {suggestionNode}
        <StatusBanner tone="warning" message="No archive results found. Try refining your query." />
      </>
    );
  }

  const startIndex = results.length === 0 ? 0 : 1;
  const endIndex = results.length;
  const loadedSummary = loadedPages && loadedPages > 0 ? `Loaded ${loadedPages} page${loadedPages === 1 ? "" : "s"}` : null;

  return (
    <>
      {suggestionNode}
      {notice ? <StatusBanner tone="warning" message={notice} /> : null}
      <div className="results-summary">
        Showing {startIndex} – {endIndex} of {totalResults ?? "?"} preserved records
        {loadedSummary ? ` · ${loadedSummary}` : ""}
      </div>
      {hiddenCount > 0 ? (
        <div className="results-filter-note">
          <span>
            {hiddenCount === 1
              ? "1 result hidden by the current NSFW mode."
              : `${hiddenCount} results hidden by the current NSFW mode.`}
          </span>
          {hiddenDocs.length > 0 ? (
            <button
              type="button"
              className="hidden-results-toggle"
              onClick={() => setShowHiddenResults((previous) => !previous)}
              aria-expanded={showHiddenResults}
            >
              {showHiddenResults ? "Hide list" : "View hidden results"}
            </button>
          ) : null}
        </div>
      ) : null}
      {showHiddenResults && hiddenDocs.length > 0 ? (
        <div className="hidden-results-panel">
          <p className="hidden-results-intro">
            These entries are filtered out by the current NSFW setting. They remain in your search history so you can review
            them later if you adjust the filter.
          </p>
          <ul className="hidden-results-list">
            {hiddenDocs.map((doc) => {
              const { archiveUrl } = resolveDocLinks(doc);
              const severity = doc.nsfwLevel ?? doc.nsfw_level ?? null;
              const isFlagged = doc.nsfw === true || severity === "mild" || severity === "explicit";
              const modeReason = nsfwMode === "only"
                ? "Hidden because NSFW-only mode is enabled."
                : severity === "explicit"
                ? "Hidden because it is classified as explicit."
                : severity === "mild"
                ? "Hidden because it is marked as sensitive."
                : isFlagged
                ? "Hidden because it is flagged as NSFW."
                : "Hidden because it is not flagged as NSFW.";
              const matches = Array.isArray(doc.nsfwMatches)
                ? doc.nsfwMatches
                : Array.isArray((doc as Record<string, unknown>).nsfw_matches)
                ? ((doc as Record<string, unknown>).nsfw_matches as string[])
                : [];
              return (
                <li key={doc.identifier}>
                  <a href={archiveUrl} target="_blank" rel="noreferrer" className="hidden-result-title">
                    {doc.title || doc.identifier}
                  </a>
                  <span className="hidden-result-reason">{modeReason}</span>
                  {matches.length > 0 ? (
                    <span className="hidden-result-keywords">Keywords: {matches.join(", ")}</span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {viewMode === "images" ? (
        <ImageResultGrid
          results={results}
          statuses={statuses}
          nsfwMode={nsfwMode}
          bookmarkedIds={bookmarkedIds}
          onToggleBookmark={onToggleBookmark}
          onOpenDetails={onOpenDetails}
          onSaveSnapshot={onSaveSnapshot}
          saveMeta={saveMeta}
          onReport={onReport}
        />
      ) : (
        <ol className="results-list">
          {results.map((doc, index) => {
            const status = statuses[doc.identifier] ?? "checking";
            const meta = saveMeta[doc.identifier] ?? {
              label: "Save to Archive",
              disabled: false,
              message: null,
              tone: "info" as const
            };
            return (
              <ResultCard
                key={doc.identifier}
                doc={doc}
                status={status}
                nsfwMode={nsfwMode}
                isBookmarked={bookmarkedIds.has(doc.identifier)}
                onToggleBookmark={onToggleBookmark}
                onSaveSnapshot={onSaveSnapshot}
                onOpenDetails={onOpenDetails}
                onReport={onReport}
                saveLabel={meta.label}
                saveDisabled={meta.disabled}
                saveState={meta.message}
                saveTone={meta.tone}
                snapshotUrl={meta.snapshotUrl}
                position={index}
              />
            );
          })}
        </ol>
      )}
      <PaginationControls
        currentPage={page}
        totalPages={totalPages}
        isLoading={isLoading}
        onPageChange={onPageChange}
        onLoadMore={onLoadMore}
        isLoadingMore={isLoadingMore}
        hasMore={hasMore}
        loadedPages={loadedPages}
      />
      {isLoadingMore ? (
        <div className="load-more-status" role="status" aria-live="polite">
          Loading additional archive results…
        </div>
      ) : null}
      {loadMoreError ? <StatusBanner tone="error" message={loadMoreError} /> : null}
      {loadMoreRef && hasMore ? (
        <div ref={loadMoreRef} className="load-more-sentinel" aria-hidden="true" />
      ) : null}
    </>
  );
}
