import { FormEvent, useCallback, useState } from 'react';
import { AlexandriaResults } from './AlexandriaResults';
import { useAlexandriaSearch } from '../hooks/useAlexandriaSearch';
import type { WaybackAvailability } from '../../backend/internetArchiveService';

export function AlexandriaSearchBar() {
  const { query, setQuery, executeSearch, state, checkWayback, enabled } = useAlexandriaSearch();
  const [availabilityMap, setAvailabilityMap] = useState<Record<string, WaybackAvailability | null>>({});

  const handleSubmit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!enabled) {
      return;
    }

    await executeSearch();
  }, [executeSearch, enabled]);

  const handleCheckWayback = useCallback(async (identifier: string) => {
    if (!enabled) {
      return;
    }

    const url = `https://archive.org/details/${identifier}`;
    const result = await checkWayback(url);
    setAvailabilityMap((prev) => ({ ...prev, [identifier]: result }));
  }, [checkWayback, enabled]);

  if (!enabled) {
    return (
      <div className="p-4 rounded-xl border border-slate-800 bg-slate-900/60 text-slate-400 text-sm">
        Enable Alexandria Browser in Settings → Plugins to access the Internet Archive integration.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSubmit} className="flex flex-col md:flex-row gap-3 items-stretch md:items-end">
        <label className="flex-1 text-sm text-slate-200">
          <span className="block mb-1 font-semibold text-slate-300">Search the Internet Archive</span>
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search books, audio, software, and more"
            className="w-full px-3 py-2 rounded-md bg-slate-900 border border-slate-700 text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </label>
        <button
          type="submit"
          className="px-4 py-2 rounded-md bg-indigo-500 hover:bg-indigo-400 text-white font-semibold"
          disabled={state.loading}
        >
          {state.loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      <AlexandriaResults state={state} availabilityMap={availabilityMap} onCheckWayback={handleCheckWayback} />
    </div>
  );
}
