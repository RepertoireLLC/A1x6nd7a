import { useMemo } from 'react';
import type { AlexandriaSearchState } from '../hooks/useAlexandriaSearch';
import type { WaybackAvailability } from '../../backend/internetArchiveService';

export interface AlexandriaResultsProps {
  state: AlexandriaSearchState;
  availabilityMap?: Record<string, WaybackAvailability | null | undefined>;
  onCheckWayback?: (identifier: string) => void;
}

export function AlexandriaResults({ state, availabilityMap = {}, onCheckWayback }: AlexandriaResultsProps) {
  const hasResults = state.items.length > 0;

  const statusText = useMemo(() => {
    if (state.loading) {
      return 'Searching the Internet Archive…';
    }

    if (state.error) {
      return state.error;
    }

    if (!hasResults) {
      return 'Try searching the Internet Archive to explore public collections.';
    }

    return `${state.total} matching item${state.total === 1 ? '' : 's'} found.`;
  }, [state.loading, state.error, hasResults, state.total]);

  return (
    <div className="flex flex-col gap-4 p-4 bg-slate-900/70 border border-slate-700 rounded-xl text-slate-100">
      <p className="text-sm font-medium text-slate-300">{statusText}</p>

      {hasResults && (
        <ul className="flex flex-col gap-3 max-h-80 overflow-y-auto pr-2">
          {state.items.map((item) => {
            const availability = availabilityMap[item.identifier];
            const waybackStatus = availability?.archivedSnapshots?.closest;

            return (
              <li key={item.identifier} className="p-3 bg-slate-800/80 rounded-lg border border-slate-700">
                <div className="flex justify-between items-start gap-4">
                  <div>
                    <h3 className="text-base font-semibold text-slate-100">{item.title ?? item.identifier}</h3>
                    {item.creator && (
                      <p className="text-xs text-slate-400">{Array.isArray(item.creator) ? item.creator.join(', ') : item.creator}</p>
                    )}
                    {item.date && (
                      <p className="text-xs text-slate-500">{item.date}</p>
                    )}
                    {item.description && (
                      <p className="text-xs text-slate-300 mt-2 overflow-hidden text-ellipsis max-h-16">
                        {item.description}
                      </p>
                    )}
                    <p className="text-xs text-slate-500 mt-2">
                      Media Type: {item.mediaType ?? 'Unknown'} · Downloads: {item.downloads ?? 'N/A'}
                    </p>
                    {item.collection && (
                      <p className="text-xs text-slate-500 mt-1">
                        Collection: {Array.isArray(item.collection) ? item.collection.join(', ') : item.collection}
                      </p>
                    )}
                  </div>
                  {onCheckWayback && (
                    <button
                      type="button"
                      onClick={() => onCheckWayback(item.identifier)}
                      className="shrink-0 px-3 py-1 text-xs font-semibold rounded-md bg-indigo-500 hover:bg-indigo-400 text-white"
                    >
                      Check Wayback
                    </button>
                  )}
                </div>

                {onCheckWayback && availability !== undefined && (
                  <div className="mt-2 text-xs text-slate-400">
                    {waybackStatus?.available ? (
                      <a
                        href={waybackStatus.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-emerald-300 hover:text-emerald-200"
                      >
                        Snapshot available from {waybackStatus.timestamp}
                      </a>
                    ) : (
                      <span>No archived snapshot found.</span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
