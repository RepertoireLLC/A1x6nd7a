interface PaginationControlsProps {
  currentPage: number;
  totalPages: number | null;
  isLoading: boolean;
  onPageChange: (direction: "previous" | "next") => void;
}

/**
 * PaginationControls renders next/previous buttons with summary text.
 */
export function PaginationControls({
  currentPage,
  totalPages,
  isLoading,
  onPageChange
}: PaginationControlsProps) {
  const canGoPrevious = currentPage > 1 && !isLoading;
  const canGoNext =
    !isLoading && (totalPages === null ? true : currentPage < totalPages);

  const label = totalPages ? `Page ${currentPage} of ${totalPages}` : `Page ${currentPage}`;

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
    </div>
  );
}
