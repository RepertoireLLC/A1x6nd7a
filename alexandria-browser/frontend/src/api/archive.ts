import type {
  ArchiveSearchResponse,
  LinkStatus,
  ArchiveMetadataResponse,
  CdxResponse,
  ScrapeResponse,
  WaybackAvailabilityResponse,
  SavePageResponse,
  SearchFilters
} from "../types";
import { performFallbackArchiveSearch } from "../utils/fallbackSearch";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000";

/**
 * Execute an archive search request with the provided parameters.
 */
export async function searchArchive(
  query: string,
  page: number,
  rows: number,
  filters: SearchFilters
): Promise<ArchiveSearchResponse> {
  const url = new URL(`${API_BASE_URL}/api/search`);
  url.searchParams.set("q", query);
  url.searchParams.set("page", String(page));
  url.searchParams.set("rows", String(rows));

  if (filters.mediaType !== "all") {
    url.searchParams.set("mediaType", filters.mediaType);
  }
  if (filters.yearFrom.trim()) {
    url.searchParams.set("yearFrom", filters.yearFrom.trim());
  }
  if (filters.yearTo.trim()) {
    url.searchParams.set("yearTo", filters.yearTo.trim());
  }

  try {
    const response = await fetch(url.toString());
    if (!response.ok) {
      console.warn(`Search request failed with status ${response.status}; using local fallback dataset.`);
      return performFallbackArchiveSearch(query, page, rows, filters);
    }

    return (await response.json()) as ArchiveSearchResponse;
  } catch (error) {
    console.warn("Search request failed, using local fallback dataset.", error);
    return performFallbackArchiveSearch(query, page, rows, filters);
  }
}

/**
 * Request link availability for the provided URL.
 */
export async function checkLinkStatus(url: string): Promise<LinkStatus> {
  const request = new URL(`${API_BASE_URL}/api/status`);
  request.searchParams.set("url", url);

  const response = await fetch(request.toString());
  if (!response.ok) {
    throw new Error(`Status check failed with status ${response.status}`);
  }

  const payload = (await response.json()) as { status?: LinkStatus };
  return payload.status ?? "offline";
}

/**
 * Query the Wayback Machine availability endpoint.
 */
export async function getWaybackAvailability(url: string) {
  const request = new URL(`${API_BASE_URL}/api/wayback`);
  request.searchParams.set("url", url);

  const response = await fetch(request.toString());
  if (!response.ok) {
    throw new Error(`Wayback availability failed with status ${response.status}`);
  }

  return response.json() as Promise<WaybackAvailabilityResponse>;
}

/**
 * Ask the backend to request a Save Page Now snapshot for the URL.
 */
export async function requestSaveSnapshot(url: string): Promise<SavePageResponse> {
  const response = await fetch(`${API_BASE_URL}/api/save`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ url })
  });

  if (!response.ok) {
    throw new Error(`Save Page Now request failed with status ${response.status}`);
  }

  return (await response.json()) as SavePageResponse;
}

export async function fetchArchiveMetadata(identifier: string): Promise<ArchiveMetadataResponse> {
  const request = new URL(`${API_BASE_URL}/api/metadata`);
  request.searchParams.set("identifier", identifier);

  const response = await fetch(request.toString());
  if (!response.ok) {
    throw new Error(`Metadata request failed with status ${response.status}`);
  }

  return (await response.json()) as ArchiveMetadataResponse;
}

export async function fetchCdxSnapshots(targetUrl: string, limit = 25): Promise<CdxResponse> {
  const request = new URL(`${API_BASE_URL}/api/cdx`);
  request.searchParams.set("url", targetUrl);
  request.searchParams.set("limit", String(limit));

  const response = await fetch(request.toString());
  if (!response.ok) {
    throw new Error(`CDX timeline request failed with status ${response.status}`);
  }

  return (await response.json()) as CdxResponse;
}

export async function scrapeArchive(query: string, count = 5): Promise<ScrapeResponse> {
  const request = new URL(`${API_BASE_URL}/api/scrape`);
  request.searchParams.set("query", query);
  request.searchParams.set("count", String(count));

  const response = await fetch(request.toString());
  if (!response.ok) {
    throw new Error(`Scrape request failed with status ${response.status}`);
  }

  return (await response.json()) as ScrapeResponse;
}
