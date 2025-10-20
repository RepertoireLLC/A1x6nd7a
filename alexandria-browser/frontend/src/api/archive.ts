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

const offlineFallbackPreference = import.meta.env.VITE_ENABLE_OFFLINE_FALLBACK;
const OFFLINE_FALLBACK_ENABLED = offlineFallbackPreference === "true";

function resolveApiBaseUrl(): string {
  const configuredUrl = import.meta.env.VITE_API_BASE_URL?.trim();
  if (configuredUrl) {
    return configuredUrl.replace(/\/$/, "");
  }

  if (typeof window !== "undefined") {
    const { hostname, protocol, port } = window.location;
    const isLocalhost =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]";

    if (isLocalhost) {
      return "http://localhost:4000";
    }

    if (protocol === "http:" || protocol === "https:") {
      const originPort = port ? `:${port}` : "";
      return `${protocol}//${hostname}${originPort}`;
    }

    return "http://localhost:4000";
  }

  return "http://localhost:4000";
}

const API_BASE_URL = resolveApiBaseUrl();

function buildApiUrl(path: string): URL {
  return new URL(path, `${API_BASE_URL}/`);
}

/**
 * Execute an archive search request with the provided parameters.
 */
export async function searchArchive(
  query: string,
  page: number,
  rows: number,
  filters: SearchFilters
): Promise<ArchiveSearchResponse> {
  const url = buildApiUrl("/api/searchArchive");
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

  let lastError: unknown;

  try {
    const response = await fetch(url.toString());
    if (!response.ok) {
      throw await buildResponseError(
        response,
        `Search request failed with status ${response.status}.`
      );
    }

    return (await response.json()) as ArchiveSearchResponse;
  } catch (error) {
    lastError = error;
  }

  if (OFFLINE_FALLBACK_ENABLED) {
    console.warn("Search request failed, using local fallback dataset.", lastError);
    return performFallbackArchiveSearch(query, page, rows, filters);
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Search request failed. Please try again later.");
}

/**
 * Request link availability for the provided URL.
 */
export async function checkLinkStatus(url: string): Promise<LinkStatus> {
  const request = buildApiUrl("/api/status");
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
  const request = buildApiUrl("/api/wayback");
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
  const response = await fetch(buildApiUrl("/api/save").toString(), {
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
  const request = buildApiUrl("/api/metadata");
  request.searchParams.set("identifier", identifier);

  const response = await fetch(request.toString());
  if (!response.ok) {
    throw new Error(`Metadata request failed with status ${response.status}`);
  }

  return (await response.json()) as ArchiveMetadataResponse;
}

export async function fetchCdxSnapshots(targetUrl: string, limit = 25): Promise<CdxResponse> {
  const request = buildApiUrl("/api/cdx");
  request.searchParams.set("url", targetUrl);
  request.searchParams.set("limit", String(limit));

  const response = await fetch(request.toString());
  if (!response.ok) {
    throw new Error(`CDX timeline request failed with status ${response.status}`);
  }

  return (await response.json()) as CdxResponse;
}

export async function scrapeArchive(query: string, count = 5): Promise<ScrapeResponse> {
  const request = buildApiUrl("/api/scrape");
  request.searchParams.set("query", query);
  request.searchParams.set("count", String(count));

  const response = await fetch(request.toString());
  if (!response.ok) {
    throw new Error(`Scrape request failed with status ${response.status}`);
  }

  return (await response.json()) as ScrapeResponse;
}

async function buildResponseError(response: Response, fallbackMessage: string): Promise<Error> {
  const contentType = response.headers.get("content-type") ?? "";
  const responseClone = response.clone();

  if (contentType.includes("application/json")) {
    try {
      const payload = (await responseClone.json()) as { error?: unknown; details?: unknown } | null;
      const parts: string[] = [];
      if (payload && typeof payload === "object") {
        const errorText = payload.error;
        const detailText = payload.details;
        if (typeof errorText === "string" && errorText.trim()) {
          parts.push(errorText.trim());
        }
        if (typeof detailText === "string" && detailText.trim()) {
          parts.push(detailText.trim());
        }
      }

      if (parts.length > 0) {
        return new Error(`${fallbackMessage} ${parts.join(" ")}`.trim());
      }
    } catch (error) {
      console.warn("Failed to parse error response payload", error);
    }
  }

  try {
    const text = (await response.text()).trim();
    if (text) {
      return new Error(`${fallbackMessage} ${text}`.trim());
    }
  } catch (error) {
    console.warn("Failed to read error response body", error);
  }

  return new Error(fallbackMessage);
}
