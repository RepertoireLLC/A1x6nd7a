const ADVANCED_SEARCH_URL = 'https://archive.org/advancedsearch.php';
const WAYBACK_STATUS_URL = 'https://archive.org/wayback/available';

export interface AlexandriaSearchItem {
  identifier: string;
  title?: string;
  description?: string;
  creator?: string | string[];
  date?: string;
  mediaType?: string;
  collection?: string | string[];
  downloads?: number;
}

export interface AlexandriaSearchResponse {
  total: number;
  page: number;
  rows: number;
  items: AlexandriaSearchItem[];
}

export interface WaybackAvailability {
  url: string;
  archivedSnapshots: {
    closest?: {
      url: string;
      status: string;
      timestamp: string;
      available: boolean;
    };
  };
}

function sanitizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ');
}

function buildSearchUrl(query: string, page: number, rows: number): string {
  const params = new URLSearchParams({
    q: query,
    output: 'json',
    page: String(page),
    rows: String(rows),
    fl: ['identifier', 'title', 'description', 'creator', 'date', 'mediatype', 'collection', 'downloads'].join(','),
  });
  return `${ADVANCED_SEARCH_URL}?${params.toString()}`;
}

export async function searchArchive(query: string, page = 1, rows = 20): Promise<AlexandriaSearchResponse> {
  const sanitizedQuery = sanitizeQuery(query);

  if (!sanitizedQuery) {
    return {
      total: 0,
      page,
      rows,
      items: [],
    };
  }

  const url = buildSearchUrl(sanitizedQuery, page, rows);

  try {
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Archive.org returned status ${response.status}`);
    }

    const payload = await response.json();
    const docs = Array.isArray(payload?.response?.docs) ? payload.response.docs : [];

    const items: AlexandriaSearchItem[] = docs.map((doc: Record<string, unknown>) => ({
      identifier: String(doc.identifier ?? ''),
      title: doc.title ? String(doc.title) : undefined,
      description: doc.description ? String(doc.description) : undefined,
      creator: doc.creator as string | string[] | undefined,
      date: doc.date ? String(doc.date) : undefined,
      mediaType: doc.mediatype ? String(doc.mediatype) : undefined,
      collection: doc.collection as string | string[] | undefined,
      downloads: doc.downloads != null ? Number(doc.downloads) : undefined,
    })).filter((item) => Boolean(item.identifier));

    return {
      total: Number(payload?.response?.numFound ?? 0),
      page,
      rows,
      items,
    };
  } catch (error) {
    console.error('[Alexandria] Failed to search archive', error);
    return {
      total: 0,
      page,
      rows,
      items: [],
    };
  }
}

export async function checkWaybackStatus(url: string): Promise<WaybackAvailability | null> {
  const trimmedUrl = url.trim();
  if (!trimmedUrl) {
    return null;
  }

  const params = new URLSearchParams({ url: trimmedUrl });
  const requestUrl = `${WAYBACK_STATUS_URL}?${params.toString()}`;

  try {
    const response = await fetch(requestUrl, {
      headers: {
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Wayback Machine returned status ${response.status}`);
    }

    const payload = await response.json();
    if (!payload?.archived_snapshots) {
      return {
        url: trimmedUrl,
        archivedSnapshots: {},
      };
    }

    const closest = payload.archived_snapshots.closest;
    return {
      url: trimmedUrl,
      archivedSnapshots: closest
        ? {
            closest: {
              url: String(closest.url ?? ''),
              status: String(closest.status ?? ''),
              timestamp: String(closest.timestamp ?? ''),
              available: Boolean(closest.available),
            },
          }
        : {},
    };
  } catch (error) {
    console.error('[Alexandria] Failed to check Wayback status', error);
    return null;
  }
}
