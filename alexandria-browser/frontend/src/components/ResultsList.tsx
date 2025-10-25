import type { ReactNode } from "react";
import type { AiSearchPlan, ArchiveSearchDoc, LinkStatus, NSFWFilterMode } from "../types";
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
  aiSummary?: AiSearchPlan | null;
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
  aiSummary = null
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
        {aiSummary ? (
          <StatusBanner
            tone="info"
            title="AI-optimized search"
            message={`Refined query: ${aiSummary.optimizedQuery}`}
          >
            <div className="ai-plan-details">
              {aiSummary.keywords.length > 0 ? (
                <div className="ai-plan-keywords" role="list">
                  {aiSummary.keywords.map((keyword, index) => (
                    <span key={`${keyword}-${index}`} className="ai-plan-keyword" role="listitem">
                      {keyword}
                    </span>
                  ))}
                </div>
              ) : null}
              {aiSummary.rationale ? (
                <p className="ai-plan-rationale">{aiSummary.rationale}</p>
              ) : null}
              <p className="ai-plan-footnote">
                Model: {aiSummary.model ?? "gpt-5"}
                {typeof aiSummary.confidence === "number"
                  ? ` · Confidence ${(aiSummary.confidence * 100).toFixed(0)}%`
                  : null}
              </p>
            </div>
          </StatusBanner>
        ) : null}
        <StatusBanner tone="warning" message="No archive results found. Try refining your query." />
      </>
    );
  }

  const startIndex = (page - 1) * resultsPerPage + 1;
  const endIndex = (page - 1) * resultsPerPage + results.length;

  return (
    <>
      {suggestionNode}
      {aiSummary ? (
        <StatusBanner
          tone="info"
          title="AI-optimized search"
          message={`Refined query: ${aiSummary.optimizedQuery}`}
        >
          <div className="ai-plan-details">
            {aiSummary.keywords.length > 0 ? (
              <div className="ai-plan-keywords" role="list">
                {aiSummary.keywords.map((keyword, index) => (
                  <span key={`${keyword}-${index}`} className="ai-plan-keyword" role="listitem">
                    {keyword}
                  </span>
                ))}
              </div>
            ) : null}
            {aiSummary.rationale ? (
              <p className="ai-plan-rationale">{aiSummary.rationale}</p>
            ) : null}
            <p className="ai-plan-footnote">
              Model: {aiSummary.model ?? "gpt-5"}
              {typeof aiSummary.confidence === "number"
                ? ` · Confidence ${(aiSummary.confidence * 100).toFixed(0)}%`
                : null}
            </p>
          </div>
        </StatusBanner>
      ) : null}
      {notice ? <StatusBanner tone="warning" message={notice} /> : null}
      <div className="results-summary">
        Showing {startIndex} – {endIndex} of {totalResults ?? "?"} preserved records
      </div>
      {hiddenCount > 0 ? (
        <div className="results-filter-note">
          {hiddenCount === 1
            ? "1 result hidden by the current NSFW mode."
            : `${hiddenCount} results hidden by the current NSFW mode.`}
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
