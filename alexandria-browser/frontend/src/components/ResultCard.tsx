import type { ArchiveSearchDoc, LinkStatus, NSFWFilterMode } from "../types";
import { getDescription, getYearOrDate, mediaIcon } from "../utils/format";
import { resolveDocLinks, STATUS_ARIA_LABELS, STATUS_LABELS } from "../utils/resultPresentation";
import { ReportAction, type ReportSubmitHandler } from "../reporting";

interface ResultCardProps {
  doc: ArchiveSearchDoc;
  status: LinkStatus;
  nsfwMode: NSFWFilterMode;
  isBookmarked: boolean;
  onToggleBookmark: (identifier: string, doc: ArchiveSearchDoc) => void;
  onSaveSnapshot: (identifier: string, url: string) => void;
  onOpenDetails: (doc: ArchiveSearchDoc) => void;
  onReport: ReportSubmitHandler;
  saveLabel: string;
  saveDisabled: boolean;
  saveState: string | null;
  saveTone?: "success" | "error" | "info";
  snapshotUrl?: string;
}

/**
 * ResultCard renders a single archive search hit with metadata and actions.
 */
export function ResultCard({
  doc,
  status,
  nsfwMode,
  isBookmarked,
  onToggleBookmark,
  onSaveSnapshot,
  onOpenDetails,
  onReport,
  saveLabel,
  saveDisabled,
  saveState,
  saveTone,
  snapshotUrl
}: ResultCardProps) {
  const { archiveUrl, waybackUrl, originalUrl } = resolveDocLinks(doc);
  const description = getDescription(doc.description);
  const yearOrDate = getYearOrDate(doc);
  const creator = Array.isArray(doc.creator) ? doc.creator.join(", ") : doc.creator ?? "";
  const severity = doc.nsfwLevel ?? doc.nsfw_level ?? null;
  const isNSFW = doc.nsfw === true || severity === "mild" || severity === "explicit";
  const scoreValue =
    typeof doc.score === "number" && Number.isFinite(doc.score)
      ? doc.score
      : typeof doc.score === "string"
      ? Number.parseFloat(doc.score)
      : null;
  const scorePercent = scoreValue !== null && Number.isFinite(scoreValue) ? Math.round(scoreValue * 100) : null;
  const trustLabel = (doc.source_trust ?? doc.source_trust_level) || null;
  const languageLabel = Array.isArray(doc.language)
    ? doc.language.find((entry) => typeof entry === "string" && entry.trim()) ?? null
    : typeof doc.language === "string"
    ? doc.language.trim()
    : null;

  const cardClasses = ["result-card"];
  if (isNSFW) {
    cardClasses.push("result-card-nsfw");
  }
  if (nsfwMode === "safe" && isNSFW) {
    cardClasses.push("result-card-nsfw-filtered");
  }

  const shouldBlur = nsfwMode === "safe" && isNSFW;
  const nsfwBadge = isNSFW ? (severity === "explicit" ? "EXPLICIT" : severity === "mild" ? "SENSITIVE" : "NSFW") : undefined;
  const nsfwLabelText = severity === "explicit" ? "(Explicit NSFW)" : "(Sensitive)";

  return (
    <li
      className={cardClasses.join(" ")}
      data-nsfw-label={nsfwBadge}
      data-nsfw-severity={severity ?? undefined}
    >
      <div className={`result-body${shouldBlur ? " result-body-blurred" : ""}`}>
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
              {isNSFW ? <span className="nsfw-label">{nsfwLabelText}</span> : null}
              {scorePercent !== null ? <span>· Relevance {scorePercent}%</span> : null}
              {trustLabel ? <span>· {trustLabel.charAt(0).toUpperCase() + trustLabel.slice(1)} trust</span> : null}
              {languageLabel ? <span>· {languageLabel}</span> : null}
            </div>
          </div>
        </div>
        {description ? <p className="result-description">{description}</p> : null}
        <div className="result-footer">
          <span className={`result-status status-${status}`} aria-label={STATUS_ARIA_LABELS[status]}>
            {STATUS_LABELS[status]}
          </span>
          <div className="result-links">
            <ReportAction
              identifier={doc.identifier}
              archiveUrl={archiveUrl}
              title={doc.title || doc.identifier}
              onSubmit={onReport}
            />
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
