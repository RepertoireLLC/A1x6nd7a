import type { ArchiveSearchDoc, LinkStatus } from "../types";
import { getDescription, getYearOrDate, mediaIcon } from "../utils/format";

interface ResultCardProps {
  doc: ArchiveSearchDoc;
  status: LinkStatus;
  filterNSFW: boolean;
  isBookmarked: boolean;
  onToggleBookmark: (identifier: string, doc: ArchiveSearchDoc) => void;
  onSaveSnapshot: (identifier: string, url: string) => void;
  onOpenDetails: (doc: ArchiveSearchDoc) => void;
  saveLabel: string;
  saveDisabled: boolean;
  saveState: string | null;
  saveTone?: "success" | "error" | "info";
  snapshotUrl?: string;
}

const STATUS_LABELS: Record<LinkStatus, string> = {
  online: "🟢 Online",
  "archived-only": "🟡 Archived only",
  offline: "🔴 Offline",
  checking: "Checking availability…"
};

const STATUS_ARIA_LABELS: Record<LinkStatus, string> = {
  online: "Online",
  "archived-only": "Archived only",
  offline: "Offline",
  checking: "Checking availability"
};

/**
 * ResultCard renders a single archive search hit with metadata and actions.
 */
export function ResultCard({
  doc,
  status,
  filterNSFW,
  isBookmarked,
  onToggleBookmark,
  onSaveSnapshot,
  onOpenDetails,
  saveLabel,
  saveDisabled,
  saveState,
  saveTone,
  snapshotUrl
}: ResultCardProps) {
  const fallbackArchiveUrl = `https://archive.org/details/${encodeURIComponent(doc.identifier)}`;
  const archiveUrl = doc.archive_url ?? doc.links?.archive ?? fallbackArchiveUrl;
  const waybackUrl = doc.wayback_url ?? doc.links?.wayback ?? `https://web.archive.org/web/*/${archiveUrl}`;
  const rawOriginal = doc.original_url ?? doc.links?.original ?? null;
  const originalUrl = rawOriginal && rawOriginal !== archiveUrl ? rawOriginal : null;
  const description = getDescription(doc.description);
  const yearOrDate = getYearOrDate(doc);
  const creator = Array.isArray(doc.creator) ? doc.creator.join(", ") : doc.creator ?? "";
  const isNSFW = doc.nsfw === true;

  const cardClasses = ["result-card"];
  if (isNSFW) {
    cardClasses.push("result-card-nsfw");
  }
  if (filterNSFW && isNSFW) {
    cardClasses.push("result-card-nsfw-filtered");
  }

  return (
    <li className={cardClasses.join(" ")}>
      <div className={`result-body${filterNSFW && isNSFW ? " result-body-blurred" : ""}`}>
        <div className="result-header">
          <div className="result-thumb-wrapper" aria-hidden="true">
            {doc.thumbnail ? (
              <img src={doc.thumbnail} alt="" className="result-thumbnail" loading="lazy" />
            ) : (
              <span className="result-media" aria-hidden="true">{mediaIcon(doc.mediatype)}</span>
            )}
          </div>
          <div>
            <a href={archiveUrl} target="_blank" rel="noreferrer" className="result-title">
              {doc.title || doc.identifier}
            </a>
            <div className="result-meta">
              <span>{yearOrDate}</span>
              {creator ? <span>· {creator}</span> : null}
              {!filterNSFW && isNSFW ? <span className="nsfw-label">(NSFW)</span> : null}
            </div>
          </div>
        </div>
        {description ? <p className="result-description">{description}</p> : null}
        <div className="result-footer">
          <span className={`result-status status-${status}`} aria-label={STATUS_ARIA_LABELS[status]}>
            {STATUS_LABELS[status]}
          </span>
          <div className="result-links">
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
            <button
              type="button"
              className="bookmark-button"
              onClick={() => onToggleBookmark(doc.identifier, doc)}
            >
              {isBookmarked ? "★ Remove bookmark" : "☆ Bookmark"}
            </button>
            <button type="button" className="details-button" onClick={() => onOpenDetails(doc)}>
              Details
            </button>
            <button
              type="button"
              className="save-button"
              onClick={() => onSaveSnapshot(doc.identifier, archiveUrl)}
              disabled={saveDisabled}
            >
              {saveLabel}
            </button>
          </div>
        </div>
        {saveState ? (
          <div className={`save-status save-status-${saveTone ?? "info"}`}>
            {saveState}
            {snapshotUrl ? (
              <span>
                {" "}
                <a href={snapshotUrl} target="_blank" rel="noreferrer">
                  View snapshot
                </a>
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}
