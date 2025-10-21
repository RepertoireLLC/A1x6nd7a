import type { ReactNode } from "react";
import type { ArchiveSearchDoc, LinkStatus } from "../types";
import type { ReportSubmitHandler } from "../reporting";
import { ResultCard } from "./ResultCard";
import { PaginationControls } from "./PaginationControls";
import { ImageResultGrid } from "./ImageResultGrid";
import { LoadingIndicator } from "./LoadingIndicator";
import { StatusBanner } from "./StatusBanner";

interface ResultsListProps {
  results: ArchiveSearchDoc[];
  statuses: Record<string, LinkStatus>;
  filterNSFW: boolean;
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
}

/**
 * ResultsList renders the archive search outcomes including pagination controls.
 */
export function ResultsList({
  results,
  statuses,
  filterNSFW,
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
  viewMode = "default"
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
    return (
      <>
        {suggestionNode}
        <StatusBanner tone="warning" message="No archive results found. Try refining your query." />
      </>
    );
  }

  const startIndex = (page - 1) * resultsPerPage + 1;
  const endIndex = (page - 1) * resultsPerPage + results.length;

  return (
    <>
      {suggestionNode}
      {notice ? <StatusBanner tone="warning" message={notice} /> : null}
      <div className="results-summary">
        Showing {startIndex} – {endIndex} of {totalResults ?? "?"} preserved records
      </div>
      {viewMode === "images" ? (
        <ImageResultGrid
          results={results}
          statuses={statuses}
          filterNSFW={filterNSFW}
          bookmarkedIds={bookmarkedIds}
          onToggleBookmark={onToggleBookmark}
          onOpenDetails={onOpenDetails}
          onSaveSnapshot={onSaveSnapshot}
          saveMeta={saveMeta}
          onReport={onReport}
        />
      ) : (
        <ol className="results-list">
          {results.map((doc) => {
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
                filterNSFW={filterNSFW}
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
      />
    </>
  );
}
