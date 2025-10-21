import { useState } from "react";

import type { ArchiveSearchDoc, LinkStatus } from "../types";
import { getYearOrDate, mediaIcon } from "../utils/format";
import {
  formatDisplayUrl,
  getImagePreviewUrl,
  resolveDocLinks,
  STATUS_ARIA_LABELS,
  STATUS_LABELS
} from "../utils/resultPresentation";

type SaveTone = "success" | "error" | "info" | undefined;

interface SaveMetaEntry {
  label: string;
  disabled: boolean;
  message: string | null;
  tone?: SaveTone;
  snapshotUrl?: string;
}

interface ImageResultGridProps {
  results: ArchiveSearchDoc[];
  statuses: Record<string, LinkStatus>;
  filterNSFW: boolean;
  bookmarkedIds: Set<string>;
  onToggleBookmark: (identifier: string, doc: ArchiveSearchDoc) => void;
  onOpenDetails: (doc: ArchiveSearchDoc) => void;
  onSaveSnapshot: (identifier: string, url: string) => void;
  saveMeta: Record<string, SaveMetaEntry>;
}

const DEFAULT_SAVE_META: SaveMetaEntry = {
  label: "Save to Archive",
  disabled: false,
  message: null,
  tone: "info"
};

function buildPreviewFallback(doc: ArchiveSearchDoc) {
  if (doc.thumbnail && doc.thumbnail.trim().length > 0) {
    return doc.thumbnail;
  }
  if (doc.mediatype?.toLowerCase() === "image" || doc.mediatype?.toLowerCase() === "images") {
    return getImagePreviewUrl(doc);
  }
  return undefined;
}

function getPreviewSource(doc: ArchiveSearchDoc) {
  return buildPreviewFallback(doc) ?? getImagePreviewUrl(doc);
}

function getCreatorLabel(doc: ArchiveSearchDoc) {
  if (!doc.creator) {
    return "";
  }
  return Array.isArray(doc.creator) ? doc.creator.join(", ") : doc.creator;
}

export function ImageResultGrid({
  results,
  statuses,
  filterNSFW,
  bookmarkedIds,
  onToggleBookmark,
  onOpenDetails,
  onSaveSnapshot,
  saveMeta
}: ImageResultGridProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <ol className="image-results-grid">
      {results.map((doc) => {
        const status = statuses[doc.identifier] ?? "checking";
        const meta = saveMeta[doc.identifier] ?? DEFAULT_SAVE_META;
        const { archiveUrl, waybackUrl, originalUrl } = resolveDocLinks(doc);
        const previewSrc = getPreviewSource(doc);
        const isExpanded = expandedId === doc.identifier;
        const isNSFW = doc.nsfw === true;
        const shouldBlur = filterNSFW && isNSFW;
        const yearOrDate = getYearOrDate(doc);
        const creator = getCreatorLabel(doc);
        const displayUrl = formatDisplayUrl(originalUrl ?? archiveUrl);
        const saveTone: SaveTone = meta.tone ?? "info";

        const handleToggle = () => {
          setExpandedId((current) => (current === doc.identifier ? null : doc.identifier));
        };

        const handleClose = () => {
          setExpandedId(null);
        };

        return (
          <li
            key={doc.identifier}
            className={`image-result-card${isNSFW ? " image-result-nsfw" : ""}${shouldBlur ? " image-result-blurred" : ""}`}
          >
            <button
              type="button"
              className="image-result-preview"
              onClick={handleToggle}
              aria-expanded={isExpanded}
              aria-label={isExpanded ? "Hide image details" : "Show image details"}
            >
              {previewSrc ? (
                <img src={previewSrc} alt={doc.title || doc.identifier} loading="lazy" />
              ) : (
                <span className="image-result-placeholder" aria-hidden="true">
                  {mediaIcon(doc.mediatype)}
                </span>
              )}
            </button>
            {isExpanded ? (
              <div className="image-result-details" role="group" aria-label="Image result details">
                <button type="button" className="image-result-close" onClick={handleClose} aria-label="Close details">
                  ×
                </button>
                <div className="image-result-details-body">
                  <span className={`result-status status-${status}`} aria-label={STATUS_ARIA_LABELS[status]}>
                    {STATUS_LABELS[status]}
                  </span>
                  <h3 className="image-result-title">{doc.title || doc.identifier}</h3>
                  <div className="image-result-meta">
                    <span>{yearOrDate}</span>
                    {creator ? <span>· {creator}</span> : null}
                    {!filterNSFW && isNSFW ? <span className="nsfw-label">(NSFW)</span> : null}
                  </div>
                  <a
                    href={originalUrl ?? archiveUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="image-result-url"
                    title={originalUrl ?? archiveUrl}
                  >
                    {displayUrl}
                  </a>
                  <div className="result-links image-result-links">
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
                  <div className="result-links image-result-actions">
                    <button
                      type="button"
                      className="bookmark-button"
                      onClick={() => onToggleBookmark(doc.identifier, doc)}
                    >
                      {bookmarkedIds.has(doc.identifier) ? "★ Remove bookmark" : "☆ Bookmark"}
                    </button>
                    <button type="button" className="details-button" onClick={() => onOpenDetails(doc)}>
                      Details
                    </button>
                    <button
                      type="button"
                      className="save-button"
                      onClick={() => onSaveSnapshot(doc.identifier, archiveUrl)}
                      disabled={meta.disabled}
                    >
                      {meta.label}
                    </button>
                  </div>
                  {meta.message ? (
                    <div className={`save-status save-status-${saveTone}`}>
                      {meta.message}
                      {meta.snapshotUrl ? (
                        <span>
                          {" "}
                          <a href={meta.snapshotUrl} target="_blank" rel="noreferrer">
                            View snapshot
                          </a>
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
