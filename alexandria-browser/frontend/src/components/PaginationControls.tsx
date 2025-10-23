interface PaginationControlsProps {
  currentPage: number;
  totalPages: number | null;
  isLoading: boolean;
  onPageChange: (direction: "previous" | "next") => void;
  onLoadMore?: () => void;
  isLoadingMore?: boolean;
  hasMore?: boolean;
  loadedPages?: number;
}

/**
 * PaginationControls renders next/previous buttons with summary text.
 */
export function PaginationControls({
  currentPage,
  totalPages,
  isLoading,
  onPageChange,
  onLoadMore,
  isLoadingMore = false,
  hasMore = false,
  loadedPages
}: PaginationControlsProps) {
  const canGoPrevious = currentPage > 1 && !isLoading;
  const canGoNext =
    !isLoading && (totalPages === null ? true : currentPage < totalPages);

  const label = totalPages ? `Page ${currentPage} of ${totalPages}` : `Page ${currentPage}`;
  const loadMoreEnabled = Boolean(hasMore && onLoadMore && !isLoading && !isLoadingMore);
  const loadedSummary = loadedPages && loadedPages > 0 ? `Loaded ${loadedPages} page${loadedPages === 1 ? "" : "s"}` : null;

  return (
    <div className="pagination-controls" role="navigation" aria-label="Search pagination">
      <button
        type="button"
        onClick={() => onPageChange("previous")}
        disabled={!canGoPrevious}
        aria-label="Previous page"
      >
        Previous
      </button>
      <span className="pagination-label">{label}</span>
      <button
        type="button"
        onClick={() => onPageChange("next")}
        disabled={!canGoNext}
        aria-label="Next page"
      >
        Next
      </button>
      {onLoadMore ? (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={!loadMoreEnabled}
          aria-label="Load more results"
          className="load-more-button"
        >
          {isLoadingMore ? "Loading…" : "Load more"}
        </button>
      ) : null}
      {loadedSummary ? <span className="pagination-loaded-summary">{loadedSummary}</span> : null}
    </div>
  );
}
