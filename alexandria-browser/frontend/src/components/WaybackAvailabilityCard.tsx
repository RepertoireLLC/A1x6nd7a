import type { WaybackAvailabilityResponse } from "../types";

interface WaybackAvailabilityCardProps {
  url: string;
  payload: WaybackAvailabilityResponse | null;
  error: string | null;
}

function formatTimestamp(timestamp?: string): string | null {
  if (!timestamp) {
    return null;
  }
  if (timestamp.length >= 14) {
    const year = timestamp.slice(0, 4);
    const month = timestamp.slice(4, 6);
    const day = timestamp.slice(6, 8);
    const hour = timestamp.slice(8, 10);
    const minute = timestamp.slice(10, 12);
    const second = timestamp.slice(12, 14);
    return `${year}-${month}-${day} ${hour}:${minute}:${second} UTC`;
  }
  return timestamp;
}

export function WaybackAvailabilityCard({ url, payload, error }: WaybackAvailabilityCardProps) {
  if (!payload && !error) {
    return null;
  }

  const closest = payload?.archived_snapshots?.closest;
  const formattedTimestamp = formatTimestamp(closest?.timestamp);

  return (
    <div className="wayback-card">
      <h3>Wayback Machine Availability</h3>
      {error ? (
        <p className="wayback-error" role="alert">
          Unable to load Wayback data: {error}
        </p>
      ) : null}
      {closest ? (
        <div className="wayback-details">
          <p>
            Closest snapshot for <strong>{url}</strong>
          </p>
          <p>
            Status: {closest.status ?? "Unknown"} · {closest.available ? "Available" : "Unavailable"}
          </p>
          {formattedTimestamp ? <p>Captured: {formattedTimestamp}</p> : null}
          {closest.url ? (
            <a href={closest.url} target="_blank" rel="noreferrer">
              Open snapshot
            </a>
          ) : null}
        </div>
      ) : !error ? (
        <p>No archived snapshots found.</p>
      ) : null}
    </div>
  );
}
