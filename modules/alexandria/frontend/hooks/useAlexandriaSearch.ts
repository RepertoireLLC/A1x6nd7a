import { useCallback, useMemo, useState } from 'react';
import type { AlexandriaSearchResponse, WaybackAvailability } from '../../backend/internetArchiveService';
import { isAlexandriaEnabled, useAlexandriaSettings } from '../state/useAlexandriaSettings';

export interface AlexandriaSearchState extends AlexandriaSearchResponse {
  loading: boolean;
  error?: string;
}

export interface UseAlexandriaSearchResult {
  query: string;
  state: AlexandriaSearchState;
  setQuery: (value: string) => void;
  executeSearch: (nextQuery?: string, page?: number, rows?: number) => Promise<void>;
  checkWayback: (url: string) => Promise<WaybackAvailability | null>;
  enabled: boolean;
}

async function safeFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

const EMPTY_STATE: AlexandriaSearchState = {
  total: 0,
  page: 1,
  rows: 20,
  items: [],
  loading: false,
};

export function useAlexandriaSearch(): UseAlexandriaSearchResult {
  const { enabled } = useAlexandriaSettings();
  const [query, setQuery] = useState('');
  const [state, setState] = useState<AlexandriaSearchState>(EMPTY_STATE);

  const executeSearch = useCallback(async (nextQuery = query, page = 1, rows = 20) => {
    if (!isAlexandriaEnabled()) {
      setState((prev) => ({ ...prev, loading: false, error: 'Alexandria module is disabled.' }));
      return;
    }

    const sanitizedQuery = nextQuery.trim();
    if (!sanitizedQuery) {
      setState({ ...EMPTY_STATE, rows, page });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: undefined }));

    try {
      const params = new URLSearchParams({ query: sanitizedQuery, page: String(page), rows: String(rows) });
      const result = await safeFetch<AlexandriaSearchResponse>(`/api/alexandria/search?${params.toString()}`);
      setState({ ...result, loading: false });
      setQuery(sanitizedQuery);
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false, error: error instanceof Error ? error.message : 'Unknown error' }));
    }
  }, [query]);

  const checkWayback = useCallback(async (url: string) => {
    if (!isAlexandriaEnabled()) {
      return null;
    }

    const sanitizedUrl = url.trim();
    if (!sanitizedUrl) {
      return null;
    }

    try {
      const params = new URLSearchParams({ url: sanitizedUrl });
      return await safeFetch<WaybackAvailability | null>(`/api/alexandria/status?${params.toString()}`);
    } catch (error) {
      console.warn('[Alexandria] Wayback status check failed', error);
      return null;
    }
  }, []);

  const api = useMemo<UseAlexandriaSearchResult>(() => ({
    query,
    state,
    setQuery,
    executeSearch,
    checkWayback,
    enabled,
  }), [query, state, executeSearch, checkWayback, enabled]);

  return api;
}
