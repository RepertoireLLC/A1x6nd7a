/**
 * Alexandria Browser Backend
 *
 * Manifesto:
 * The internet forgets. Links die. Knowledge is buried by algorithms and corporations.
 * The Alexandria Browser exists to preserve collective memory. It searches, restores,
 * and archives knowledge using the Internet Archive. It serves no ads, no agendas—only truth,
 * utility, and preservation.
 *
 * Core values:
 * - Preserve Everything
 * - No Gatekeepers
 * - Serve the Seeker
 * - Build Open and Forkable
 */

import { createServer, type IncomingMessage, type ServerResponse } from "http";

import { isNSFWContent } from "./services/nsfwFilter";
import { getSpellCorrector, type SpellcheckResult } from "./services/spellCorrector";

const ARCHIVE_SEARCH_ENDPOINT = "https://archive.org/advancedsearch.php";
const WAYBACK_AVAILABILITY_ENDPOINT = "https://archive.org/wayback/available";
const SAVE_PAGE_NOW_ENDPOINT = "https://web.archive.org/save/";

const ALLOWED_MEDIA_TYPES = new Set([
  "texts",
  "audio",
  "movies",
  "image",
  "software",
  "web",
  "data",
  "collection",
  "etree",
  "tvnews"
]);

const YEAR_PATTERN = /^\d{4}$/;

type LinkStatus = "online" | "archived-only" | "offline";

type HandlerContext = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
};

type RouteHandler = (context: HandlerContext) => Promise<void> | void;

const HEAD_TIMEOUT_MS = 7000;

const spellCorrector = getSpellCorrector();

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function parseRequestUrl(req: IncomingMessage): URL {
  const hostHeader = req.headers?.host ?? "localhost";
  const requestUrl = req.url ?? "/";
  return new URL(requestUrl, `http://${hostHeader}`);
}

function getEnv(name: string): string | undefined {
  const globalProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return globalProcess?.env?.[name];
}

async function readRequestBody(req: IncomingMessage): Promise<string> {
  const decoder = new TextDecoder();
  let body = "";

  return await new Promise<string>((resolve, reject) => {
    req.on("data", (chunk) => {
      if (typeof chunk === "string") {
        body += chunk;
      } else {
        body += decoder.decode(chunk as ArrayBufferView, { stream: true });
      }
    });

    req.on("end", () => {
      body += decoder.decode();
      resolve(body);
    });

    req.on("error", (error) => {
      reject(error);
    });
  });
}

class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const raw = await readRequestBody(req);
  if (!raw.trim()) {
    return {};
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch (error) {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

async function evaluateLinkStatus(targetUrl: string): Promise<LinkStatus> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEAD_TIMEOUT_MS);

  try {
    const headResponse = await fetch(targetUrl, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal
    });

    if (headResponse.ok || (headResponse.status >= 200 && headResponse.status < 400)) {
      return "online";
    }

    if (headResponse.status === 405 || headResponse.status === 501) {
      const getResponse = await fetch(targetUrl, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal
      });

      if (getResponse.ok || (getResponse.status >= 200 && getResponse.status < 400)) {
        return "online";
      }
    }
  } catch (error) {
    if ((error as Error).name !== "AbortError") {
      console.warn("HEAD request failed for", targetUrl, error);
    }
  } finally {
    clearTimeout(timeout);
  }

  try {
    const waybackUrl = new URL(WAYBACK_AVAILABILITY_ENDPOINT);
    waybackUrl.searchParams.set("url", targetUrl);

    const waybackResponse = await fetch(waybackUrl);
    if (waybackResponse.ok) {
      const waybackData = (await waybackResponse.json()) as {
        archived_snapshots?: { closest?: unknown };
      };

      if (waybackData.archived_snapshots?.closest) {
        return "archived-only";
      }
    }
  } catch (error) {
    console.warn("Wayback availability check failed for", targetUrl, error);
  }

  return "offline";
}

const routes: Record<string, Record<string, RouteHandler>> = {
  GET: {
    "/health": ({ res }) => {
      sendJson(res, 200, { status: "ok" });
    },
    "/api/search": handleSearch,
    "/api/wayback": handleWayback,
    "/api/status": handleStatus
  },
  POST: {
    "/api/save": handleSave
  }
};

const server = createServer(async (req, res) => {
  setCorsHeaders(res);

  if (!req.method) {
    sendJson(res, 400, { error: "Missing HTTP method." });
    return;
  }

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (!req.url) {
    sendJson(res, 404, { error: "Not found." });
    return;
  }

  const url = parseRequestUrl(req);
  const methodRoutes = routes[req.method];

  if (!methodRoutes) {
    res.setHeader("Allow", Object.keys(routes).join(","));
    sendJson(res, 405, { error: "Method not allowed." });
    return;
  }

  const handler = methodRoutes[url.pathname];
  if (!handler) {
    sendJson(res, 404, { error: "Not found." });
    return;
  }

  try {
    await handler({ req, res, url });
  } catch (error) {
    console.error("Unhandled error while processing request", error);
    sendJson(res, 500, {
      error: "Internal server error.",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

async function handleSearch({ res, url }: HandlerContext): Promise<void> {
  const query = url.searchParams.get("q")?.trim();
  if (!query) {
    sendJson(res, 400, { error: "Missing required query parameter 'q'." });
    return;
  }

  const pageParam = url.searchParams.get("page") ?? "1";
  const rowsParam = url.searchParams.get("rows") ?? "20";
  const page = Number.parseInt(pageParam, 10);
  const rows = Number.parseInt(rowsParam, 10);

  const mediaTypeParam = url.searchParams.get("mediaType")?.trim().toLowerCase() ?? "";
  const yearFromParam = url.searchParams.get("yearFrom")?.trim() ?? "";
  const yearToParam = url.searchParams.get("yearTo")?.trim() ?? "";

  if (mediaTypeParam && !ALLOWED_MEDIA_TYPES.has(mediaTypeParam)) {
    sendJson(res, 400, {
      error: "Invalid media type filter.",
      details:
        "Supported media types include texts, audio, movies, image, software, web, data, collection, etree, and tvnews."
    });
    return;
  }

  if (yearFromParam && !YEAR_PATTERN.test(yearFromParam)) {
    sendJson(res, 400, {
      error: "Invalid start year.",
      details: "Year filters must be four-digit values (e.g., 1999)."
    });
    return;
  }

  if (yearToParam && !YEAR_PATTERN.test(yearToParam)) {
    sendJson(res, 400, {
      error: "Invalid end year.",
      details: "Year filters must be four-digit values (e.g., 2008)."
    });
    return;
  }

  if (yearFromParam && yearToParam && Number(yearFromParam) > Number(yearToParam)) {
    sendJson(res, 400, {
      error: "Invalid year range.",
      details: "The start year cannot be greater than the end year."
    });
    return;
  }

  const requestUrl = new URL(ARCHIVE_SEARCH_ENDPOINT);
  const tokens = query.split(/\s+/).filter(Boolean);
  const fuzzyClause = tokens.map((token) => `${token}~`).join(" ");
  const searchExpression = fuzzyClause ? `(${query}) OR (${fuzzyClause})` : query;

  const filterExpressions: string[] = [];
  if (mediaTypeParam) {
    filterExpressions.push(`mediatype:(${mediaTypeParam})`);
  }

  if (yearFromParam || yearToParam) {
    const yearFromValue = yearFromParam || "*";
    const yearToValue = yearToParam || "*";
    filterExpressions.push(`year:[${yearFromValue} TO ${yearToValue}]`);
  }

  const combinedQuery = [searchExpression, ...filterExpressions]
    .filter((part) => part && part.length > 0)
    .map((part) => `(${part})`)
    .join(" AND ");

  requestUrl.searchParams.set("q", combinedQuery.length > 0 ? combinedQuery : searchExpression);
  requestUrl.searchParams.set("output", "json");
  requestUrl.searchParams.set("page", Number.isFinite(page) && page > 0 ? String(page) : "1");
  requestUrl.searchParams.set("rows", Number.isFinite(rows) && rows > 0 ? String(rows) : "20");
  requestUrl.searchParams.set(
    "fl",
    [
      "identifier",
      "title",
      "description",
      "creator",
      "collection",
      "mediatype",
      "year",
      "date",
      "publicdate"
    ].join(",")
  );

  try {
    const response = await fetch(requestUrl);
    if (!response.ok) {
      throw new Error(`Archive API responded with status ${response.status}`);
    }

    const data = (await response.json()) as Record<string, unknown> & {
      response?: { docs?: Array<Record<string, unknown>> };
    };
    let spellcheck: SpellcheckResult | null = null;

    if (Array.isArray(data?.response?.docs)) {
      const combinedTexts: string[] = [];
      data.response.docs = data.response.docs.map((doc) => {
        if (doc && typeof doc === "object") {
          const record = doc as Record<string, unknown>;
          const textualFields: string[] = [];

          const possibleFields: Array<unknown> = [
            record.title,
            record.description,
            record.identifier,
            record.creator
          ];

          for (const field of possibleFields) {
            if (typeof field === "string") {
              textualFields.push(field);
            } else if (Array.isArray(field)) {
              for (const entry of field) {
                if (typeof entry === "string") {
                  textualFields.push(entry);
                }
              }
            }
          }

          const combinedText = textualFields.join(" ");
          if (combinedText) {
            combinedTexts.push(combinedText);
          }
          return { ...record, nsfw: isNSFWContent(combinedText) };
        }

        return doc;
      });

      if (combinedTexts.length > 0) {
        spellCorrector.learnFromText(combinedTexts.join(" "));
      }
    }

    if (query.length > 0) {
      const result = spellCorrector.checkQuery(query);
      const trimmedCorrected = result.correctedQuery.trim();
      const trimmedOriginal = result.originalQuery.trim();
      if (
        trimmedCorrected.length > 0 &&
        trimmedOriginal.length > 0 &&
        trimmedCorrected.toLowerCase() !== trimmedOriginal.toLowerCase()
      ) {
        spellcheck = result;
      }
    }

    sendJson(res, 200, {
      ...data,
      spellcheck
    });
  } catch (error) {
    console.error("Error fetching Internet Archive search results", error);
    sendJson(res, 502, {
      error: "Failed to retrieve data from the Internet Archive.",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

async function handleWayback({ res, url }: HandlerContext): Promise<void> {
  const targetUrl = url.searchParams.get("url")?.trim();
  if (!targetUrl) {
    sendJson(res, 400, { error: "Missing required query parameter 'url'." });
    return;
  }

  const requestUrl = new URL(WAYBACK_AVAILABILITY_ENDPOINT);
  requestUrl.searchParams.set("url", targetUrl);

  try {
    const response = await fetch(requestUrl);
    if (!response.ok) {
      throw new Error(`Wayback API responded with status ${response.status}`);
    }

    const data = await response.json();
    sendJson(res, 200, data);
  } catch (error) {
    console.error("Error fetching Wayback Machine availability", error);
    sendJson(res, 502, {
      error: "Failed to retrieve Wayback Machine availability.",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

async function handleStatus({ res, url }: HandlerContext): Promise<void> {
  const targetUrl = url.searchParams.get("url")?.trim();
  if (!targetUrl) {
    sendJson(res, 400, { error: "Missing required query parameter 'url'." });
    return;
  }

  try {
    const status = await evaluateLinkStatus(targetUrl);
    sendJson(res, 200, { status });
  } catch (error) {
    console.error("Error evaluating link status", error);
    sendJson(res, 500, {
      error: "Unable to evaluate link status.",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

async function handleSave({ req, res }: HandlerContext): Promise<void> {
  let payload: unknown;
  try {
    payload = await readJsonBody(req);
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(res, error.statusCode, { error: error.message });
      return;
    }

    console.error("Error reading request body", error);
    sendJson(res, 400, { error: "Unable to read request body." });
    return;
  }

  const urlValue =
    typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>).url : undefined;
  const targetUrl = typeof urlValue === "string" ? urlValue.trim() : "";

  if (!targetUrl) {
    sendJson(res, 400, { error: "Missing required field 'url' in request body." });
    return;
  }

  if (!/^https?:\/\//i.test(targetUrl)) {
    sendJson(res, 400, { error: "The provided URL must start with http:// or https://" });
    return;
  }

  const saveUrl = `${SAVE_PAGE_NOW_ENDPOINT}${encodeURI(targetUrl)}`;

  try {
    const response = await fetch(saveUrl, {
      method: "GET",
      redirect: "manual"
    });

    const contentLocation = response.headers.get("content-location");
    const locationHeader = response.headers.get("location");
    const snapshotPath = contentLocation ?? locationHeader ?? undefined;
    const snapshotUrl = snapshotPath
      ? snapshotPath.startsWith("http")
        ? snapshotPath
        : `https://web.archive.org${snapshotPath}`
      : undefined;

    const success = response.status >= 200 && response.status < 400;

    if (!success) {
      const message = `Save Page Now responded with status ${response.status}`;
      sendJson(res, 502, {
        success: false,
        error: message,
        snapshotUrl
      });
      return;
    }

    sendJson(res, 200, {
      success: true,
      snapshotUrl,
      message: snapshotUrl
        ? "Snapshot request accepted by Save Page Now."
        : "Snapshot request sent to Save Page Now. Check back shortly for availability."
    });
  } catch (error) {
    console.error("Error requesting Save Page Now snapshot", error);
    sendJson(res, 502, {
      success: false,
      error: "Failed to contact the Save Page Now service.",
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

const port = Number.parseInt(getEnv("PORT") ?? "4000", 10);
const nodeEnv = getEnv("NODE_ENV") ?? "development";

if (nodeEnv !== "test") {
  server.listen(port, () => {
    console.log(`Alexandria Browser backend listening on port ${port}`);
  });
}

export default server;
