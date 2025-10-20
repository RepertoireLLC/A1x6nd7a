import type {
  ArchiveMetadataResponse,
  ArchiveSearchDoc,
  CdxResponse,
  ScrapeItem
} from "../types";
import { getDescription, getYearOrDate, mediaIcon } from "../utils/format";
import { SnapshotTimeline } from "./SnapshotTimeline";

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
  onClose
}: ItemDetailsPanelProps) {
  const archiveUrl = doc.links?.archive ?? `https://archive.org/details/${encodeURIComponent(doc.identifier)}`;
  const waybackUrl = doc.links?.wayback ?? `https://web.archive.org/web/*/${archiveUrl}`;
  const originalUrl = doc.links?.original;
  const description = getDescription(doc.description);
  const yearOrDate = getYearOrDate(doc);

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
              View on Internet Archive
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
        {metadataLoading ? <p>Loading metadata…</p> : null}
        {metadataError ? (
          <p className="item-details-error" role="alert">
            Unable to load metadata: {metadataError}
          </p>
        ) : null}
        {!metadataLoading && !metadataError ? renderMetadataRows(metadata?.metadata) : null}
        {metadata?.files ? (
          <div className="item-details-files">
            <h4>Files</h4>
            {renderFiles(metadata.files)}
          </div>
        ) : null}
        {metadata?.fallback ? (
          <p className="item-details-fallback">Showing cached metadata while offline.</p>
        ) : null}
      </section>

      <section className="item-details-section">
        <h3>Snapshot Timeline</h3>
        <SnapshotTimeline
          snapshots={timeline?.snapshots ?? []}
          isLoading={timelineLoading}
          error={timelineError}
          isFallback={Boolean(timeline?.fallback)}
        />
      </section>

      <section className="item-details-section">
        <h3>Related Highlights</h3>
        {relatedFallback ? <p className="item-details-fallback">Showing cached highlights while offline.</p> : null}
        {relatedError ? (
          <p className="item-details-error" role="alert">
            Unable to load related items: {relatedError}
          </p>
        ) : null}
        {relatedItems.length === 0 ? (
          <p>No related items found.</p>
        ) : (
          <ul className="related-items">
            {relatedItems.map((item) => (
              <li key={item.identifier}>
                <a
                  href={
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
    </aside>
  );
}
