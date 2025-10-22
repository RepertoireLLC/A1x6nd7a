import { useMemo } from "react";

import type { AISummarySource, AISummaryStatus } from "../types";

interface AiAssistantPanelProps {
  enabled: boolean;
  status: AISummaryStatus;
  summary: string | null;
  error: string | null;
  notice?: string | null;
  source?: AISummarySource | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

function renderStatusLabel(status: AISummaryStatus): string {
  switch (status) {
    case "loading":
      return "Loading";
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

function renderSourceLabel(source: AISummarySource | null | undefined): string | null {
  if (source === "heuristic") {
    return "Heuristic";
  }
  if (source === "model") {
    return "Local Model";
  }
  return null;
}

export function AiAssistantPanel({
  enabled,
  status,
  summary,
  error,
  notice,
  source,
  collapsed,
  onToggleCollapse
}: AiAssistantPanelProps) {
  const hasContent = summary && summary.trim().length > 0;
  const assistiveLabel = useMemo(() => renderStatusLabel(status), [status]);
  const sourceLabel = useMemo(() => renderSourceLabel(source), [source]);
  const sourceClassName = source ? `ai-assistant-source-${source}` : "ai-assistant-source-unknown";
  const trimmedNotice = typeof notice === "string" ? notice.trim() : "";
  const showNotice = Boolean(trimmedNotice && status !== "loading");

  if (!enabled) {
    return null;
  }

  return (
    <section className={`ai-assistant-panel harmonia-card${collapsed ? " collapsed" : ""}`} aria-live="polite">
      <header className="ai-assistant-header">
        <h2>AI Assistant Suggestions</h2>
        <div className="ai-assistant-actions">
          <span className={`ai-assistant-status ai-assistant-status-${status}`}>{assistiveLabel}</span>
          {sourceLabel ? (
            <span className={`ai-assistant-source ${sourceClassName}`}>{sourceLabel}</span>
          ) : null}
          <button type="button" onClick={onToggleCollapse} className="ai-assistant-toggle">
            {collapsed ? "Show" : "Hide"}
          </button>
        </div>
      </header>
      {collapsed ? null : (
        <div className="ai-assistant-body">
          {status === "loading" ? (
            <p className="ai-assistant-loading">Loading…</p>
          ) : hasContent ? (
            <p className="ai-assistant-summary">{summary}</p>
          ) : status === "success" ? (
            <p className="ai-assistant-summary">No AI suggestions are available for this query.</p>
          ) : status === "error" ? (
            <p className="ai-assistant-error" role="status">
              {error || "The AI assistant encountered an unexpected error."}
            </p>
          ) : (
            <p className="ai-assistant-muted" role="status">
              {error || "AI suggestions will appear here when a compatible local model is available."}
            </p>
          )}
          {showNotice ? <p className="ai-assistant-notice">{trimmedNotice}</p> : null}
        </div>
      )}
    </section>
  );
}
