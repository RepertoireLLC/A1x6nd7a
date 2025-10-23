import type { ChangeEvent } from "react";

import type { CdxSnapshot } from "../types";

interface SnapshotTimelineProps {
  snapshots: CdxSnapshot[];
  isLoading: boolean;
  error: string | null;
  isFallback: boolean;
  selectedTimestamp?: string | null;
  onSelectSnapshot?: (snapshot: CdxSnapshot) => void;
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

export function SnapshotTimeline({
  snapshots,
  isLoading,
  error,
  isFallback,
  selectedTimestamp,
  onSelectSnapshot,
}: SnapshotTimelineProps) {
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

  const sorted = snapshots.slice().sort((a, b) => (a.timestamp > b.timestamp ? 1 : -1));
  const grouped = groupByYear(sorted);
  const years = Array.from(grouped.keys()).sort((a, b) => Number(b) - Number(a));
  const activeTimestamp = selectedTimestamp ?? sorted[sorted.length - 1]?.timestamp;
  const activeIndex = Math.max(
    0,
    sorted.findIndex((snapshot) => snapshot.timestamp === activeTimestamp)
  );

  const handleSliderChange = (event: ChangeEvent<HTMLInputElement>) => {
    const index = Number(event.target.value);
    const snapshot = sorted[index];
    if (snapshot) {
      onSelectSnapshot?.(snapshot);
    }
  };

  const handleSnapshotClick = (snapshot: CdxSnapshot) => {
    onSelectSnapshot?.(snapshot);
  };

  return (
    <div className="snapshot-timeline">
      {isFallback ? (
        <p className="timeline-fallback">Showing cached snapshot history while offline.</p>
      ) : null}
      <div className="timeline-slider" aria-hidden={sorted.length <= 1}>
        <input
          type="range"
          min={0}
          max={Math.max(sorted.length - 1, 0)}
          value={activeIndex}
          onChange={handleSliderChange}
        />
        <div className="timeline-slider-labels">
          <span>{formatTimestamp(sorted[0]?.timestamp ?? "")}</span>
          <span>{formatTimestamp(sorted[sorted.length - 1]?.timestamp ?? "")}</span>
        </div>
      </div>
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
                    <button
                      type="button"
                      className={
                        snapshot.timestamp === activeTimestamp
                          ? "timeline-entry timeline-entry-active"
                          : "timeline-entry"
                      }
                      onClick={() => handleSnapshotClick(snapshot)}
                    >
                      <span>{formatTimestamp(snapshot.timestamp)}</span>
                      <span className="snapshot-meta">
                        {snapshot.status} · {snapshot.mime}
                      </span>
                    </button>
                  </li>
                ))}
            </ol>
          </li>
        ))}
      </ul>
    </div>
  );
}
