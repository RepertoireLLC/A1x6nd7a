import type { LinkStatus } from "../types";

interface LiveStatusCardProps {
  url: string;
  status: LinkStatus | null;
}

const STATUS_MESSAGES: Record<LinkStatus, string> = {
  online: "The live web reports this URL as reachable.",
  "archived-only": "Only archived snapshots are available.",
  offline: "The live site appears to be offline.",
  checking: "Checking live status…"
};

/**
 * LiveStatusCard presents availability information for direct URL queries.
 */
export function LiveStatusCard({ url, status }: LiveStatusCardProps) {
  if (!status) {
    return null;
  }

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
      </div>
    </div>
  );
}
