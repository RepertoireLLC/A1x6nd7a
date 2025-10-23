import type { CdxSnapshot } from "../types";

interface WaybackPreviewProps {
  snapshot: CdxSnapshot | null;
  loading?: boolean;
  fallbackUrl?: string | null;
}

function buildSnapshotUrl(snapshot: CdxSnapshot): string {
  return `https://web.archive.org/web/${snapshot.timestamp}/${snapshot.original}`;
}

function formatSnapshotLabel(snapshot: CdxSnapshot): string {
  const { timestamp, status, mime } = snapshot;
  if (timestamp.length >= 14) {
    const year = timestamp.slice(0, 4);
    const month = timestamp.slice(4, 6);
    const day = timestamp.slice(6, 8);
    const hour = timestamp.slice(8, 10);
    const minute = timestamp.slice(10, 12);
    return `${year}-${month}-${day} ${hour}:${minute} UTC`;
  }
  return `${timestamp}${status ? ` · ${status}` : ""}${mime ? ` · ${mime}` : ""}`.trim();
}

/**
 * WaybackPreview renders an inline iframe preview of the selected snapshot.
 */
export function WaybackPreview({ snapshot, loading = false, fallbackUrl }: WaybackPreviewProps) {
  if (loading) {
    return <div className="wayback-preview wayback-preview-loading">Loading archived preview…</div>;
  }

  if (!snapshot) {
    return (
      <div className="wayback-preview wayback-preview-empty">
        <p>Select a capture from the timeline to preview it here.</p>
        {fallbackUrl ? (
          <p>
            <a href={fallbackUrl} target="_blank" rel="noreferrer">
              Browse all snapshots on web.archive.org
            </a>
          </p>
        ) : null}
      </div>
    );
  }

  const snapshotUrl = buildSnapshotUrl(snapshot);
  const label = formatSnapshotLabel(snapshot);

  return (
    <div className="wayback-preview">
      <div className="wayback-preview-header">
        <strong>{label}</strong>
        <a href={snapshotUrl} target="_blank" rel="noreferrer">
          Open full snapshot
        </a>
      </div>
      <iframe
        title={`Wayback snapshot ${label}`}
        src={snapshotUrl}
        className="wayback-preview-frame"
        loading="lazy"
        sandbox="allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox"
      />
    </div>
  );
}

