import { useMemo } from "react";

import type { AISummaryStatus } from "../types";

interface AiSearchAssistPanelProps {
  enabled: boolean;
  status: AISummaryStatus;
  error: string | null;
  interpretation: string | null;
  refinedQuery: string | null;
  keywords: string[];
  collectionHint: string | null;
  onApplyRefinedQuery: (query: string) => void;
  onAppendKeyword: (keyword: string) => void;
}

function renderStatusLabel(status: AISummaryStatus): string {
  switch (status) {
    case "loading":
      return "Analyzing";
    case "success":
      return "Ready";
    case "error":
      return "Error";
    case "unavailable":
      return "Unavailable";
    default:
      return "Disabled";
  }
}

function normalizeKeywords(keywords: string[]): string[] {
  return Array.from(
    new Set(keywords.map((keyword) => keyword.trim()).filter((keyword) => keyword.length > 0))
  ).slice(0, 6);
}

export function AiSearchAssistPanel({
  enabled,
  status,
  error,
  interpretation,
  refinedQuery,
  keywords,
  collectionHint,
  onApplyRefinedQuery,
  onAppendKeyword
}: AiSearchAssistPanelProps) {
  const isEnabled = enabled && status !== "disabled";
  const statusLabel = useMemo(() => renderStatusLabel(status), [status]);
  const keywordList = useMemo(() => normalizeKeywords(keywords), [keywords]);

  const hasContent = Boolean(
    interpretation?.trim().length || refinedQuery?.trim().length || keywordList.length || collectionHint?.trim().length
  );

  if (!enabled) {
    return null;
  }

  const trimmedInterpretation = interpretation?.trim() ?? "";
  const trimmedCollection = collectionHint?.trim() ?? "";
  const trimmedRefinedQuery = refinedQuery?.trim() ?? "";

  return (
    <section className="ai-search-assist harmonia-card" aria-live="polite">
      <header className="ai-search-assist-header">
        <h2>AI Search Assistant</h2>
        <span className={`ai-assistant-status ai-assistant-status-${status}`}>{statusLabel}</span>
      </header>
      <div className="ai-search-assist-body">
        {status === "loading" ? (
          <p className="ai-assistant-loading">Analyzing your search…</p>
        ) : status === "error" ? (
          <p className="ai-assistant-error" role="status">{error || "AI assistance encountered an unexpected error."}</p>
        ) : status === "unavailable" ? (
          <p className="ai-assistant-muted" role="status">
            {error || "AI suggestions are unavailable for this query."}
          </p>
        ) : !hasContent ? (
          <p className="ai-search-assist-muted" role="status">
            AI assistant did not identify additional tips for this search.
          </p>
        ) : (
          <>
            {trimmedInterpretation ? (
              <p className="ai-search-assist-interpretation">{trimmedInterpretation}</p>
            ) : null}
            {trimmedRefinedQuery ? (
              <div className="ai-search-assist-refine">
                <span className="ai-search-assist-label">Refined query:</span>
                <button
                  type="button"
                  className="ai-search-assist-refine-button"
                  onClick={() => onApplyRefinedQuery(trimmedRefinedQuery)}
                  disabled={!isEnabled}
                >
                  Search “{trimmedRefinedQuery}”
                </button>
              </div>
            ) : null}
            {keywordList.length > 0 ? (
              <div className="ai-search-assist-keywords">
                <span className="ai-search-assist-label">Try adding:</span>
                <div className="ai-search-assist-keyword-list">
                  {keywordList.map((keyword) => (
                    <button
                      key={keyword}
                      type="button"
                      className="ai-search-assist-keyword"
                      onClick={() => onAppendKeyword(keyword)}
                      disabled={!isEnabled}
                    >
                      + {keyword}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {trimmedCollection ? (
              <p className="ai-search-assist-collection">{trimmedCollection}</p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
