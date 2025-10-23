import type { MutableRefObject, ReactNode, RefObject } from "react";
import type { ArchiveSearchDoc, LinkStatus, NSFWFilterMode } from "../types";
import type { ReportSubmitHandler } from "../reporting";
import { ResultCard } from "./ResultCard";
import { PaginationControls } from "./PaginationControls";
import { ImageResultGrid } from "./ImageResultGrid";
import { LoadingIndicator } from "./LoadingIndicator";
import { StatusBanner } from "./StatusBanner";

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
  isLoadingMore = false,
  loadMoreError = null,
  onLoadMore,
  hasMore = false,
  loadedPages,
  loadMoreRef
}: ResultsListProps) {
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
    const emptyMessage =
      hiddenCount > 0
        ? "All results on this page are hidden by the current NSFW mode."
        : "No archive results found. Try refining your query.";
    const emptyTone = hiddenCount > 0 ? "info" : "warning";
    return (
      <>
        {suggestionNode}
        <StatusBanner tone={emptyTone} message={emptyMessage} />
      </>
    );
  }

  const currentCount = results.length;
  const pageStartIndex = Math.max(0, (page - 1) * resultsPerPage);
  const rawStartIndex = currentCount === 0 ? 0 : pageStartIndex + 1;
  const rawEndIndex = currentCount === 0 ? 0 : pageStartIndex + currentCount;
  const boundedStartIndex =
    totalResults !== null
      ? totalResults === 0
        ? 0
        : Math.min(rawStartIndex, totalResults)
      : rawStartIndex;
  const boundedEndIndex =
    totalResults !== null
      ? totalResults === 0
        ? 0
        : Math.min(rawEndIndex, totalResults)
      : rawEndIndex;
  const loadedSummary =
    loadedPages && loadedPages > 0 ? `Loaded ${loadedPages} page${loadedPages === 1 ? "" : "s"}` : null;
  const globalStartIndex = pageStartIndex;

  return (
    <>
      {suggestionNode}
      {notice ? <StatusBanner tone="warning" message={notice} /> : null}
      <div className="results-summary">
        Showing {boundedStartIndex} – {boundedEndIndex} of {totalResults ?? "?"} preserved records
        {loadedSummary ? ` · ${loadedSummary}` : ""}
      </div>
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
                position={globalStartIndex + index}
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
      {loadMoreRef ? <div ref={loadMoreRef} className="load-more-sentinel" aria-hidden="true" /> : null}
    </>
  );
}
