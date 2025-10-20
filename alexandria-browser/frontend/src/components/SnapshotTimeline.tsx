import type { CdxSnapshot } from "../types";

interface SnapshotTimelineProps {
  snapshots: CdxSnapshot[];
  isLoading: boolean;
  error: string | null;
  isFallback: boolean;
}

function formatTimestamp(timestamp: string): string {
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

function groupByYear(snapshots: CdxSnapshot[]): Map<string, CdxSnapshot[]> {
  const map = new Map<string, CdxSnapshot[]>();
  for (const snapshot of snapshots) {
    const year = snapshot.timestamp.slice(0, 4);
    const list = map.get(year);
    if (list) {
      list.push(snapshot);
    } else {
      map.set(year, [snapshot]);
    }
  }
  return map;
}

export function SnapshotTimeline({ snapshots, isLoading, error, isFallback }: SnapshotTimelineProps) {
  if (isLoading) {
    return <div className="timeline-message">Loading snapshot history…</div>;
  }

  if (error) {
    return (
      <div className="timeline-error" role="alert">
        Unable to load snapshot history: {error}
      </div>
    );
  }

  if (snapshots.length === 0) {
    return <div className="timeline-message">No Wayback Machine captures found for this record.</div>;
  }

  const grouped = groupByYear(snapshots);
  const years = Array.from(grouped.keys()).sort((a, b) => Number(b) - Number(a));

  return (
    <div className="snapshot-timeline">
      {isFallback ? (
        <p className="timeline-fallback">Showing cached snapshot history while offline.</p>
      ) : null}
      <ul>
        {years.map((year) => (
          <li key={year}>
            <h4>{year}</h4>
            <ol>
              {grouped
                .get(year)!
                .slice()
                .sort((a, b) => (a.timestamp > b.timestamp ? -1 : 1))
                .map((snapshot) => (
                  <li key={snapshot.timestamp}>
                    <span>{formatTimestamp(snapshot.timestamp)}</span>
                    <span className="snapshot-meta">
                      {snapshot.status} · {snapshot.mime}
                    </span>
                  </li>
                ))}
            </ol>
          </li>
        ))}
      </ul>
    </div>
  );
}
