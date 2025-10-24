import type { JSX } from "react";

interface ResultsSkeletonListProps {
  count?: number;
  variant?: "initial" | "inline";
}

const DEFAULT_COUNT = 6;

/**
 * ResultsSkeletonList renders shimmering placeholders while search results load.
 */
export function ResultsSkeletonList({ count = DEFAULT_COUNT, variant = "initial" }: ResultsSkeletonListProps): JSX.Element {
  const entries = Array.from({ length: Math.max(1, count) });
  return (
    <div className={`results-skeleton results-skeleton-${variant}`} aria-hidden="true">
      {entries.map((_, index) => (
        <div key={index} className="result-card result-card-skeleton">
          <div className="result-header">
            <div className="result-thumb-wrapper skeleton-thumb" />
            <div className="result-skeleton-body">
              <span className="skeleton-line skeleton-title" />
              <span className="skeleton-line skeleton-meta" />
            </div>
          </div>
          <span className="skeleton-line skeleton-description" />
          <div className="skeleton-pill-row">
            <span className="skeleton-pill" />
            <span className="skeleton-pill" />
            <span className="skeleton-pill skeleton-pill-short" />
          </div>
        </div>
      ))}
    </div>
  );
}
