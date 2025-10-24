import { useEffect, useMemo, useState } from "react";

import type {
  ArchiveMetadataResponse,
  ArchiveSearchDoc,
  CdxResponse,
  CdxSnapshot,
  ScrapeItem,
  AIDocumentHelperStatus
} from "../types";
import { getDescription, getYearOrDate, mediaIcon } from "../utils/format";
import { SnapshotTimeline } from "./SnapshotTimeline";
import { LoadingIndicator } from "./LoadingIndicator";
import { StatusBanner } from "./StatusBanner";
import { WaybackPreview } from "./WaybackPreview";

interface ItemDetailsPanelProps {
  doc: ArchiveSearchDoc;
  metadata: ArchiveMetadataResponse | null;
  metadataLoading: boolean;
  metadataError: string | null;
  timeline: CdxResponse | null;
  timelineLoading: boolean;
  timelineError: string | null;
  relatedItems: ScrapeItem[];
  relatedFallback: boolean;
  relatedError: string | null;
  onClose: () => void;
  aiEnabled?: boolean;
  aiHelperStatus?: AIDocumentHelperStatus;
  aiHelperMessage?: string | null;
  aiHelperError?: string | null;
  onRequestAiHelper?: () => void;
}

function renderMetadataRows(metadata: Record<string, unknown> | undefined) {
  if (!metadata) {
    return null;
  }

  const entries = Object.entries(metadata)
    .filter(([key, value]) =>
      !["files", "created", "updated", "addeddate"].includes(key) &&
      value !== null &&
      value !== undefined &&
      value !== ""
    )
    .slice(0, 12);

  return (
    <dl>
      {entries.map(([key, value]) => (
        <div key={key} className="metadata-row">
          <dt>{key}</dt>
          <dd>
            {Array.isArray(value)
              ? value.join(", ")
              : typeof value === "object"
              ? JSON.stringify(value)
              : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function renderFiles(files: ArchiveMetadataResponse["files"]) {
  if (!files || files.length === 0) {
    return <p>No file manifest available.</p>;
  }

  return (
    <ul className="metadata-files">
      {files.slice(0, 8).map((file) => (
        <li key={file.name}>
          <span className="file-name">{file.name}</span>
          <span className="file-meta">
            {file.format ? `${file.format} · ` : ""}
            {typeof file.size === "number" ? `${Math.round(file.size / 1024)} KB` : "Unknown size"}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ItemDetailsPanel({
  doc,
  metadata,
  metadataLoading,
  metadataError,
  timeline,
  timelineLoading,
  timelineError,
  relatedItems,
  relatedFallback,
  relatedError,
  onClose,
  aiEnabled = false,
  aiHelperStatus = "idle",
  aiHelperMessage,
  aiHelperError,
  onRequestAiHelper
}: ItemDetailsPanelProps) {
  const fallbackArchiveUrl = `https://archive.org/details/${encodeURIComponent(doc.identifier)}`;
  const archiveUrl = doc.archive_url ?? doc.links?.archive ?? fallbackArchiveUrl;
  const waybackUrl = doc.wayback_url ?? doc.links?.wayback ?? `https://web.archive.org/web/*/${archiveUrl}`;
  const rawOriginal = doc.original_url ?? doc.links?.original ?? null;
  const originalUrl = rawOriginal && rawOriginal !== archiveUrl ? rawOriginal : null;
  const description = getDescription(doc.description);
  const yearOrDate = getYearOrDate(doc);
  const snapshots = useMemo(() => timeline?.snapshots ?? [], [timeline]);
  const sortedSnapshots = useMemo(
    () => snapshots.slice().sort((a, b) => (a.timestamp > b.timestamp ? 1 : -1)),
    [snapshots]
  );
  const [activeSnapshot, setActiveSnapshot] = useState<CdxSnapshot | null>(null);

  useEffect(() => {
    if (sortedSnapshots.length === 0) {
      setActiveSnapshot(null);
      return;
    }
    setActiveSnapshot((previous) => {
      if (previous && sortedSnapshots.some((snapshot) => snapshot.timestamp === previous.timestamp)) {
        return previous;
      }
      return sortedSnapshots[sortedSnapshots.length - 1];
    });
  }, [sortedSnapshots]);

  return (
    <aside className="item-details" aria-live="polite">
      <button type="button" className="item-details-close" onClick={onClose} aria-label="Close details">
        Close
      </button>
      <div className="item-details-header">
        <span className="item-details-icon">{mediaIcon(doc.mediatype)}</span>
        <div>
          <h2>{doc.title || doc.identifier}</h2>
          <p className="item-details-subtitle">
            {yearOrDate ? `${yearOrDate} · ` : ""}
            {Array.isArray(doc.creator) ? doc.creator.join(", ") : doc.creator ?? "Unknown creator"}
          </p>
          <div className="item-details-links">
            {originalUrl ? (
              <a href={originalUrl} target="_blank" rel="noreferrer">
                Visit original source
              </a>
            ) : null}
            <a href={archiveUrl} target="_blank" rel="noreferrer">
              View on archive.org
            </a>
            <a href={waybackUrl} target="_blank" rel="noreferrer">
              Wayback snapshots
            </a>
          </div>
        </div>
      </div>

      {description ? <p className="item-details-description">{description}</p> : null}

      <section className="item-details-section">
        <h3>Metadata</h3>
        {metadataLoading ? <LoadingIndicator label="Loading metadata…" inline /> : null}
        {metadataError ? (
          <StatusBanner tone="error" message={`Unable to load metadata: ${metadataError}`} />
        ) : null}
        {!metadataLoading && !metadataError ? renderMetadataRows(metadata?.metadata) : null}
        {metadata?.files ? (
          <div className="item-details-files">
            <h4>Files</h4>
            {renderFiles(metadata.files)}
          </div>
        ) : null}
        {metadata?.fallback ? (
          <StatusBanner tone="warning" message="Showing cached metadata while offline." />
        ) : null}
      </section>

      <section className="item-details-section">
        <h3>Snapshot Timeline</h3>
        <SnapshotTimeline
          snapshots={snapshots}
          isLoading={timelineLoading}
          error={timelineError}
          isFallback={Boolean(timeline?.fallback)}
          selectedTimestamp={activeSnapshot?.timestamp ?? null}
          onSelectSnapshot={(snapshot) => setActiveSnapshot(snapshot)}
        />
      </section>

      <section className="item-details-section">
        <h3>Archived Preview</h3>
        <WaybackPreview
          snapshot={activeSnapshot}
          loading={timelineLoading}
          fallbackUrl={waybackUrl}
        />
      </section>

      <section className="item-details-section">
        <h3>Related Highlights</h3>
        {relatedFallback ? (
          <StatusBanner tone="info" message="Showing cached highlights while offline." />
        ) : null}
        {relatedError ? (
          <StatusBanner tone="error" message={`Unable to load related items: ${relatedError}`} />
        ) : null}
        {relatedItems.length === 0 ? (
          <p>No related items found.</p>
        ) : (
          <ul className="related-items">
            {relatedItems.map((item) => (
              <li key={item.identifier}>
                <a
                  href={
                    item.archive_url ??
                    item.links?.archive ??
                    `https://archive.org/details/${encodeURIComponent(item.identifier)}`
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  <strong>{item.title ?? item.identifier}</strong>
                  <span className="related-item-meta">
                    {item.mediatype ?? "Unknown media"}
                    {item.publicdate ? ` · ${item.publicdate}` : ""}
                    {typeof item.downloads === "number" ? ` · ${item.downloads.toLocaleString()} downloads` : ""}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {aiEnabled ? (
        <section className="item-details-section ai-item-helper" aria-live="polite">
          <h3>AI Quick Helper</h3>
          {aiHelperStatus === "idle" ? (
            <button type="button" onClick={onRequestAiHelper}>
              Ask Alexandria about this item
            </button>
          ) : null}
          {aiHelperStatus === "loading" ? <p>Generating a summary…</p> : null}
          {aiHelperStatus === "success" && aiHelperMessage ? (
            <p className="ai-item-helper-message">{aiHelperMessage}</p>
          ) : null}
          {aiHelperStatus === "error" && aiHelperError ? (
            <p className="ai-item-helper-error" role="status">{aiHelperError}</p>
          ) : null}
          {aiHelperStatus === "unavailable" ? (
            <p className="ai-item-helper-muted" role="status">
              {aiHelperError || "AI assistant unavailable. Install the transformer models locally to enable quick help."}
            </p>
          ) : null}
          {aiHelperStatus === "disabled" ? (
            <p className="ai-item-helper-muted" role="status">
              AI helper disabled by configuration.
            </p>
          ) : null}
          {aiHelperStatus === "idle" && !onRequestAiHelper ? (
            <p className="ai-item-helper-muted">AI helper is not available for this item.</p>
          ) : null}
        </section>
      ) : null}
    </aside>
  );
}
