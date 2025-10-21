import type { ReactNode } from "react";
import { useMemo } from "react";
import type { ArchiveSearchDoc, LinkStatus } from "../types";
import { ResultCard } from "./ResultCard";
import { PaginationControls } from "./PaginationControls";

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
  suggestionNode: ReactNode;
  notice?: string | null;
  notices?: string[];
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
  suggestionNode,
  notice,
  notices
}: ResultsListProps) {
  const noticeMessages = useMemo(() => {
    const messages: string[] = [];
    if (notice && typeof notice === "string" && notice.trim()) {
      messages.push(notice.trim());
    }
    if (Array.isArray(notices)) {
      for (const entry of notices) {
        if (entry && entry.trim()) {
          messages.push(entry.trim());
        }
      }
    }
    return messages;
  }, [notice, notices]);

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

  if (results.length === 0) {
    return (
      <>
        {suggestionNode}
        <div className="results-message">No archive results found. Try refining your query.</div>
      </>
    );
  }

  const startIndex = (page - 1) * resultsPerPage + 1;
  const endIndex = (page - 1) * resultsPerPage + results.length;

  return (
    <>
      {suggestionNode}
      {noticeMessages.length > 0 ? (
        <div className="results-notice" role="status">
          {noticeMessages.map((message, index) => (
            <p key={`${message}-${index}`}>{message}</p>
          ))}
        </div>
      ) : null}
      <div className="results-summary">
        Showing {startIndex} – {endIndex} of {totalResults ?? "?"} preserved records
      </div>
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
              saveLabel={meta.label}
              saveDisabled={meta.disabled}
              saveState={meta.message}
              saveTone={meta.tone}
              snapshotUrl={meta.snapshotUrl}
            />
          );
        })}
      </ol>
      <PaginationControls
        currentPage={page}
        totalPages={totalPages}
        isLoading={isLoading}
        onPageChange={onPageChange}
      />
    </>
  );
}
