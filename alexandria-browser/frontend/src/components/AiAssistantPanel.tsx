import { useMemo } from "react";

import type { AISummarySource, AISummaryStatus } from "../types";

type AppliedFilterRecord = Record<string, string> | null | undefined;

interface AiAssistantPanelProps {
  enabled: boolean;
  status: AISummaryStatus;
  summary: string | null;
  error: string | null;
  notice?: string | null;
  source?: AISummarySource | null;
  collapsed: boolean;
  originalQuery?: string | null;
  refinedQuery?: string | null;
  appliedFilters?: AppliedFilterRecord;
  onToggleCollapse: () => void;
}

const FILTER_LABELS: Record<string, string> = {
  mediaType: "Media type",
  yearFrom: "Earliest year",
  yearTo: "Latest year",
  language: "Language",
  sourceTrust: "Source trust",
  availability: "Availability",
  collection: "Collection",
  uploader: "Uploader",
  subject: "Subject",
};

const MEDIA_TYPE_LABELS: Record<string, string> = {
  texts: "Texts",
  audio: "Audio",
  movies: "Video",
  image: "Images",
  software: "Software",
  web: "Web",
  data: "Data",
};

const SOURCE_TRUST_LABELS: Record<string, string> = {
  high: "High trust",
  medium: "Standard",
  low: "Community",
};

const AVAILABILITY_LABELS: Record<string, string> = {
  online: "Online",
  "archived-only": "Archived only",
};

function humanizeKey(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function humanizeValue(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatMultiValue(value: string): string {
  return value
    .split(/[,;]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => humanizeValue(part))
    .join(", ");
}

function formatFilterValue(key: string, raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return trimmed;
  }

  const normalized = trimmed.toLowerCase();

  switch (key) {
    case "mediaType":
      return MEDIA_TYPE_LABELS[normalized] ?? humanizeValue(trimmed);
    case "language":
      return humanizeValue(trimmed);
    case "sourceTrust":
      return SOURCE_TRUST_LABELS[normalized] ?? humanizeValue(trimmed);
    case "availability":
      return AVAILABILITY_LABELS[normalized] ?? humanizeValue(trimmed);
    case "collection":
    case "subject":
      return formatMultiValue(trimmed);
    case "yearFrom":
    case "yearTo":
      return trimmed;
    default:
      if (trimmed.includes(",")) {
        return formatMultiValue(trimmed);
      }
      return trimmed;
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
  originalQuery,
  refinedQuery,
  appliedFilters,
  onToggleCollapse
}: AiAssistantPanelProps) {
  const trimmedSummary = typeof summary === "string" ? summary.trim() : "";
  const summaryText = trimmedSummary.length > 0 ? trimmedSummary : null;
  const filterEntries = useMemo(() => {
    if (!appliedFilters || typeof appliedFilters !== "object") {
      return [] as Array<{ key: string; label: string; value: string }>;
    }
    const entries: Array<{ key: string; label: string; value: string }> = [];
    for (const [key, rawValue] of Object.entries(appliedFilters)) {
      if (typeof rawValue !== "string") {
        continue;
      }
      const trimmed = rawValue.trim();
      if (!trimmed) {
        continue;
      }
      const label = FILTER_LABELS[key] ?? humanizeKey(key);
      const formatted = formatFilterValue(key, trimmed);
      entries.push({ key, label, value: formatted });
    }
    return entries;
  }, [appliedFilters]);

  const hasFilters = filterEntries.length > 0;
  const normalizedOriginal = typeof originalQuery === "string" ? originalQuery.trim() : "";
  const normalizedRefined = typeof refinedQuery === "string" ? refinedQuery.trim() : "";
  const refinedDiffers = Boolean(
    normalizedRefined &&
      (!normalizedOriginal || normalizedRefined.toLowerCase() !== normalizedOriginal.toLowerCase()),
  );
  const hasInterpretation = Boolean(summaryText || refinedDiffers || hasFilters);
  const assistiveLabel = useMemo(() => {
    if (!enabled) {
      return "Disabled";
    }
    if (status === "loading") {
      return "Interpreting";
    }
    if (status === "error") {
      return "Error";
    }
    if (hasInterpretation) {
      return "Interpreted";
    }
    return "Ready";
  }, [enabled, status, hasInterpretation]);
  const sourceLabel = useMemo(() => renderSourceLabel(source), [source]);
  const sourceClassName = source ? `ai-assistant-source-${source}` : "ai-assistant-source-unknown";
  const trimmedNotice = typeof notice === "string" ? notice.trim() : "";
  const showNotice = Boolean(trimmedNotice && status !== "loading");
  const statusTone = hasInterpretation || status === "success" ? "success" : status;
  const badgeClassName = `ai-assistant-status ai-assistant-status-${statusTone}`;

  const refinedMessage = refinedDiffers
    ? (
        <p className="ai-assistant-summary">
          Alexandria is searching for <strong>{`“${normalizedRefined}”`}</strong>
          {normalizedOriginal && normalizedOriginal.length > 0 ? (
            <>
              {" "}(interpreted from {`“${normalizedOriginal}”`})
            </>
          ) : null}
          .
        </p>
      )
    : null;

  if (!enabled) {
    return null;
  }

  return (
    <section className={`ai-assistant-panel harmonia-card${collapsed ? " collapsed" : ""}`} aria-live="polite">
      <header className="ai-assistant-header">
        <h2>AI Search Interpretation</h2>
        <div className="ai-assistant-actions">
          <span className={badgeClassName}>{assistiveLabel}</span>
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
          ) : status === "error" ? (
            <p className="ai-assistant-error" role="status">
              {error || "AI search interpretation encountered an unexpected error."}
            </p>
          ) : hasInterpretation ? (
            <>
              {summaryText ? <p className="ai-assistant-summary">{summaryText}</p> : null}
              {refinedMessage}
              {hasFilters ? (
                <div className="ai-assistant-interpretation">
                  <h3 className="ai-assistant-subheading">AI-applied filters</h3>
                  <dl className="ai-assistant-filters">
                    {filterEntries.map((entry) => (
                      <div key={entry.key} className="ai-assistant-filter">
                        <dt>{entry.label}</dt>
                        <dd>{entry.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}
            </>
          ) : status === "unavailable" ? (
            <p className="ai-assistant-muted" role="status">
              {error || "Alexandria used your exact search terms. Try adding more details or adjusting filters."}
            </p>
          ) : (
            <p className="ai-assistant-muted" role="status">
              {error || "Enable AI-assisted search to have Alexandria interpret natural-language queries before searching."}
            </p>
          )}
          {showNotice ? <p className="ai-assistant-notice">{trimmedNotice}</p> : null}
        </div>
      )}
    </section>
  );
}
