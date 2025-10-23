import type { LinkStatus, WaybackAvailabilityResponse } from "../types";

interface LiveStatusCardProps {
  url: string;
  status: LinkStatus | null;
  wayback?: WaybackAvailabilityResponse | null;
}

const STATUS_MESSAGES: Record<LinkStatus, string> = {
  online: "The live web reports this URL as reachable.",
  "archived-only": "Only archived snapshots are available.",
  offline: "The live site appears to be offline.",
  checking: "Checking live status…"
};

function formatCapture(timestamp?: string): string | null {
  if (!timestamp) {
    return null;
  }
  if (timestamp.length >= 8) {
    const year = timestamp.slice(0, 4);
    const month = timestamp.slice(4, 6);
    const day = timestamp.slice(6, 8);
    return `${year}-${month}-${day}`;
  }
  return timestamp;
}

/**
 * LiveStatusCard presents availability information for direct URL queries.
 */
export function LiveStatusCard({ url, status, wayback }: LiveStatusCardProps) {
  if (!status) {
    return null;
  }

  const isOffline = status === "offline" || status === "archived-only";
  const closestSnapshot = wayback?.archived_snapshots?.closest;
  const archiveFallback = `https://web.archive.org/web/*/${encodeURIComponent(url)}`;
  const archiveUrl = closestSnapshot?.url ?? archiveFallback;
  const captureLabel = formatCapture(closestSnapshot?.timestamp);
  const archiveCta = captureLabel ? `View ${captureLabel} snapshot` : "View archived version";

  return (
    <div className={`live-status-card status-${status}`}>
      <h3>Live Web Availability</h3>
      <p>
        <strong>{url}</strong>
      </p>
      <p>{STATUS_MESSAGES[status]}</p>
      <div className="live-status-actions">
        <a href={url} target="_blank" rel="noreferrer">
          Open live site
        </a>
        <a href={`https://web.archive.org/web/*/${encodeURIComponent(url)}`} target="_blank" rel="noreferrer">
          Wayback snapshots
        </a>
        {isOffline ? (
          <a href={archiveUrl} target="_blank" rel="noreferrer" className="archive-cta">
            {archiveCta}
          </a>
        ) : null}
      </div>
    </div>
  );
}
