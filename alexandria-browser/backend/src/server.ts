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

import express, { type Request, type Response } from "express";
import cors from "cors";

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

const HEAD_TIMEOUT_MS = 7000;

const spellCorrector = getSpellCorrector();

const app = express();
app.use(cors());
app.use(express.json());

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

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

app.get("/api/search", async (req: Request, res: Response) => {
  const query = (req.query.q as string | undefined)?.trim();
  if (!query) {
    res.status(400).json({ error: "Missing required query parameter 'q'." });
    return;
  }

  const pageParam = (req.query.page as string | undefined) ?? "1";
  const rowsParam = (req.query.rows as string | undefined) ?? "20";
  const page = Number.parseInt(pageParam, 10);
  const rows = Number.parseInt(rowsParam, 10);

  const mediaTypeParam = (req.query.mediaType as string | undefined)?.trim().toLowerCase();
  const yearFromParam = (req.query.yearFrom as string | undefined)?.trim();
  const yearToParam = (req.query.yearTo as string | undefined)?.trim();

  if (mediaTypeParam && !ALLOWED_MEDIA_TYPES.has(mediaTypeParam)) {
    res.status(400).json({
      error: "Invalid media type filter.",
      details: "Supported media types include texts, audio, movies, image, software, web, data, collection, etree, and tvnews."
    });
    return;
  }

  if (yearFromParam && !YEAR_PATTERN.test(yearFromParam)) {
    res.status(400).json({
      error: "Invalid start year.",
      details: "Year filters must be four-digit values (e.g., 1999)."
    });
    return;
  }

  if (yearToParam && !YEAR_PATTERN.test(yearToParam)) {
    res.status(400).json({
      error: "Invalid end year.",
      details: "Year filters must be four-digit values (e.g., 2008)."
    });
    return;
  }

  if (yearFromParam && yearToParam && Number(yearFromParam) > Number(yearToParam)) {
    res.status(400).json({
      error: "Invalid year range.",
      details: "The start year cannot be greater than the end year."
    });
    return;
  }

  const url = new URL(ARCHIVE_SEARCH_ENDPOINT);
  const tokens = query.split(/\s+/).filter(Boolean);
  const fuzzyClause = tokens.map((token) => `${token}~`).join(" ");
  const searchExpression = fuzzyClause ? `(${query}) OR (${fuzzyClause})` : query;

  const filterExpressions: string[] = [];
  if (mediaTypeParam && mediaTypeParam.length > 0) {
    filterExpressions.push(`mediatype:(${mediaTypeParam})`);
  }

  if (yearFromParam || yearToParam) {
    const yearFromValue = yearFromParam ?? "*";
    const yearToValue = yearToParam ?? "*";
    filterExpressions.push(`year:[${yearFromValue} TO ${yearToValue}]`);
  }

  const combinedQuery = [searchExpression, ...filterExpressions]
    .filter((part) => part && part.length > 0)
    .map((part) => `(${part})`)
    .join(" AND ");

  url.searchParams.set("q", combinedQuery.length > 0 ? combinedQuery : searchExpression);
  url.searchParams.set("output", "json");
  url.searchParams.set("page", Number.isFinite(page) && page > 0 ? String(page) : "1");
  url.searchParams.set("rows", Number.isFinite(rows) && rows > 0 ? String(rows) : "20");
  url.searchParams.set(
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
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Archive API responded with status ${response.status}`);
    }

    const data = await response.json();
    let spellcheck: SpellcheckResult | null = null;

    if (Array.isArray(data?.response?.docs)) {
      const combinedTexts: string[] = [];
      data.response.docs = data.response.docs.map((doc: unknown) => {
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

    res.json({
      ...data,
      spellcheck,
    });
  } catch (error) {
    console.error("Error fetching Internet Archive search results", error);
    res.status(502).json({
      error: "Failed to retrieve data from the Internet Archive.",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/api/wayback", async (req: Request, res: Response) => {
  const targetUrl = (req.query.url as string | undefined)?.trim();
  if (!targetUrl) {
    res.status(400).json({ error: "Missing required query parameter 'url'." });
    return;
  }

  const url = new URL(WAYBACK_AVAILABILITY_ENDPOINT);
  url.searchParams.set("url", targetUrl);

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Wayback API responded with status ${response.status}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Error fetching Wayback Machine availability", error);
    res.status(502).json({
      error: "Failed to retrieve Wayback Machine availability.",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

app.get("/api/status", async (req: Request, res: Response) => {
  const targetUrl = (req.query.url as string | undefined)?.trim();
  if (!targetUrl) {
    res.status(400).json({ error: "Missing required query parameter 'url'." });
    return;
  }

  try {
    const status = await evaluateLinkStatus(targetUrl);
    res.json({ status });
  } catch (error) {
    console.error("Error evaluating link status", error);
    res.status(500).json({
      error: "Unable to evaluate link status.",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

app.post("/api/save", async (req: Request, res: Response) => {
  const targetUrl = (req.body?.url as string | undefined)?.trim();
  if (!targetUrl) {
    res.status(400).json({ error: "Missing required field 'url' in request body." });
    return;
  }

  if (!/^https?:\/\//i.test(targetUrl)) {
    res.status(400).json({ error: "The provided URL must start with http:// or https://" });
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
      res.status(502).json({
        success: false,
        error: message,
        snapshotUrl
      });
      return;
    }

    res.json({
      success: true,
      snapshotUrl,
      message:
        snapshotUrl
          ? "Snapshot request accepted by Save Page Now."
          : "Snapshot request sent to Save Page Now. Check back shortly for availability."
    });
  } catch (error) {
    console.error("Error requesting Save Page Now snapshot", error);
    res.status(502).json({
      success: false,
      error: "Failed to contact the Save Page Now service.",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

const PORT = process.env.PORT || 4000;

if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`Alexandria Browser backend listening on port ${PORT}`);
  });
}

export default app;
