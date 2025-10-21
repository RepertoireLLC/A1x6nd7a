import { useMemo } from "react";

import type { SiteImageEntry } from "../types";
import { useSettings } from "../context/SettingsContext";
import { formatFileSize, formatWaybackTimestamp } from "../utils/format";

interface SiteImageGalleryProps {
  items: SiteImageEntry[];
  query: string;
  site: string;
  scope: "host" | "path";
  page: number;
  total?: number;
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  fallback: boolean;
  onLoadMore: () => void;
  onRefresh: () => void;
}

const IMAGE_EXTENSION_PATTERN = /\.(avif|jpe?g|png|gif|bmp|webp|svg|tiff?)$/i;

function isImageAsset(item: SiteImageEntry): boolean {
  const mime = (item.mime ?? "").toLowerCase();
  if (mime.startsWith("image/")) {
    return true;
  }

  const candidate = item.image_url || item.original || "";
  if (!candidate) {
    return false;
  }

  return IMAGE_EXTENSION_PATTERN.test(candidate);
}

function includesKeyword(value: string, keywords: string[]): boolean {
  const normalized = value.toLowerCase();
  if (keywords.some((keyword) => normalized.includes(keyword))) {
    return true;
  }

  try {
    const decoded = decodeURIComponent(value).toLowerCase();
    if (decoded !== normalized) {
      return keywords.some((keyword) => decoded.includes(keyword));
    }
  } catch {
    // Ignore URI decoding failures and fall back to the raw string comparison above.
  }

  return false;
}

function isExplicitImage(item: SiteImageEntry, keywords: string[]): boolean {
  if (item.nsfw) {
    return true;
  }

  const sources = [item.original, item.image_url, item.archived_url];
  for (const source of sources) {
    if (typeof source !== "string" || !source) {
      continue;
    }
    if (includesKeyword(source, keywords)) {
      return true;
    }
  }

  return false;
}

function displayScope(scope: "host" | "path"): string {
  return scope === "path" ? "this page and its captures" : "the entire site";
}

function normalizeHostLabel(site: string, query: string): string {
  if (site && site.trim()) {
    return site.trim();
  }

  try {
    const parsed = new URL(query);
    return parsed.hostname;
  } catch {
    return query;
  }
}

function renderImageMeta(item: SiteImageEntry): string {
  const timestamp = formatWaybackTimestamp(item.timestamp);
  const size = formatFileSize(item.length ?? null);
  const mime = item.mime || "image";
  return size ? `${timestamp} · ${mime} · ${size}` : `${timestamp} · ${mime}`;
}

export function SiteImageGallery({
  items,
  query,
  site,
  scope,
  page,
  total,
  isLoading,
  error,
  hasMore,
  fallback,
  onLoadMore,
  onRefresh
}: SiteImageGalleryProps) {
  const { filterNSFW, nsfwKeywords } = useSettings();

  const { displayItems, flaggedCount, filteredOutCount } = useMemo(
    () => {
      if (!items || items.length === 0) {
        return { displayItems: [] as SiteImageEntry[], flaggedCount: 0, filteredOutCount: 0 };
      }

      const imageItems = items.filter((item) => isImageAsset(item));
      const removedCount = items.length - imageItems.length;
      let flagged = 0;

      const enriched = imageItems.map((item) => {
        const explicit = isExplicitImage(item, nsfwKeywords);
        if (explicit) {
          flagged += 1;
          if (item.nsfw !== true) {
            return { ...item, nsfw: true };
          }
        }
        return item;
      });

      return { displayItems: enriched, flaggedCount: flagged, filteredOutCount: removedCount };
    },
    [items, nsfwKeywords]
  );

  const hostLabel = normalizeHostLabel(site, query);
  const scopeLabel = displayScope(scope);
  const subtitleParts = [`Showing archived images for ${hostLabel} (${scopeLabel})`];
  if (fallback) {
    subtitleParts.push("offline sample data");
  }
  if (filteredOutCount > 0) {
    subtitleParts.push(
      filteredOutCount === 1
        ? "1 non-image capture hidden"
        : `${filteredOutCount} non-image captures hidden`
    );
  }

  const nsfwNotice =
    flaggedCount > 0
      ? filterNSFW
        ? "NSFW images are blurred. Disable the NSFW filter in settings to view them clearly."
        : "NSFW filter is off. Explicit archived images are visible."
      : null;

  return (
    <section className="site-image-gallery harmonia-card" aria-live="polite">
      <header className="site-image-gallery__header">
        <div>
          <h2>Archived images</h2>
          <p className="site-image-gallery__subtitle">{subtitleParts.join(" — ")}</p>
          <p className="site-image-gallery__query" title={query}>
            Query: <code>{query}</code>
          </p>
          {typeof total === "number" ? (
            <p className="site-image-gallery__count">Total cached images: {total}</p>
          ) : null}
        </div>
        <div className="site-image-gallery__actions">
          <button type="button" onClick={onRefresh} disabled={isLoading}>
            {isLoading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {error ? (
        <div className="site-image-gallery__error" role="alert">
          Unable to load archived images: {error}
        </div>
      ) : null}

      {nsfwNotice ? (
        <p className="site-image-gallery__notice" role="note">
          {nsfwNotice}
        </p>
      ) : null}

      <div className="site-image-gallery__body">
        {displayItems.length > 0 ? (
          <div className="site-image-gallery__grid" role="list">
            {displayItems.map((item) => {
              const key = `${item.timestamp}-${item.original}`;
              const imageUrl = item.image_url || item.archived_url;
              const altText = `Archived image from ${formatWaybackTimestamp(item.timestamp)} (${item.mime || "image"})`;
              const meta = renderImageMeta(item);
              const isFlagged = item.nsfw === true;
              const blurred = isFlagged && filterNSFW;
              const cardClassNames = [
                "site-image-card",
                isFlagged ? "site-image-card--nsfw" : "",
                blurred ? "site-image-card--blurred" : ""
              ]
                .filter(Boolean)
                .join(" ");
              const thumbClassNames = [
                "site-image-card__thumb",
                isFlagged ? "site-image-card__thumb--flagged" : "",
                blurred ? "site-image-card__thumb--blurred" : ""
              ]
                .filter(Boolean)
                .join(" ");
              const accessibleLabel = isFlagged
                ? `${altText} — NSFW${blurred ? " (blurred)" : ""}`
                : altText;
              return (
                <a
                  key={key}
                  className={cardClassNames}
                  role="listitem"
                  href={imageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={accessibleLabel}
                  title={accessibleLabel}
                >
                  <div className={thumbClassNames}>
                    <img src={item.thumbnail_url || imageUrl} alt={altText} loading="lazy" />
                    {isFlagged ? (
                      <span className="site-image-card__badge" aria-hidden="true">
                        {filterNSFW ? "NSFW · Blurred" : "NSFW"}
                      </span>
                    ) : null}
                  </div>
                  <div className="site-image-card__meta">
                    <span className="site-image-card__timestamp">{formatWaybackTimestamp(item.timestamp)}</span>
                    <span className="site-image-card__details">{meta}</span>
                  </div>
                </a>
              );
            })}
          </div>
        ) : null}

        {!isLoading && !error && displayItems.length === 0 ? (
          <p className="site-image-gallery__empty">No archived images found for this site.</p>
        ) : null}

        {isLoading ? (
          <div className="site-image-gallery__loading">Loading archived images…</div>
        ) : null}
      </div>

      <footer className="site-image-gallery__footer">
        <span className="site-image-gallery__page">Page {page}</span>
        {hasMore ? (
          <button type="button" onClick={onLoadMore} disabled={isLoading}>
            {isLoading ? "Loading…" : "Load more images"}
          </button>
        ) : displayItems.length > 0 ? (
          <span className="site-image-gallery__end">End of archived images.</span>
        ) : null}
      </footer>
    </section>
  );
}
