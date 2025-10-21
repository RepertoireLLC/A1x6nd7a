import type { SiteImageEntry } from "../types";
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
  const hostLabel = normalizeHostLabel(site, query);
  const scopeLabel = displayScope(scope);
  const subtitleParts = [`Showing archived images for ${hostLabel} (${scopeLabel})`];
  if (fallback) {
    subtitleParts.push("offline sample data");
  }

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

      <div className="site-image-gallery__body">
        {items.length > 0 ? (
          <div className="site-image-gallery__grid" role="list">
            {items.map((item) => {
              const key = `${item.timestamp}-${item.original}`;
              const imageUrl = item.image_url || item.archived_url;
              const altText = `Archived image from ${formatWaybackTimestamp(item.timestamp)} (${item.mime || "image"})`;
              const meta = renderImageMeta(item);
              return (
                <a
                  key={key}
                  className="site-image-card"
                  role="listitem"
                  href={imageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <div className="site-image-card__thumb">
                    <img src={item.thumbnail_url || imageUrl} alt={altText} loading="lazy" />
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

        {!isLoading && !error && items.length === 0 ? (
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
        ) : items.length > 0 ? (
          <span className="site-image-gallery__end">End of archived images.</span>
        ) : null}
      </footer>
    </section>
  );
}
