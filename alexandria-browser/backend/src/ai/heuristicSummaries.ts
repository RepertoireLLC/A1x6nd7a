import { analyzeTextForNSFW, NSFW_KEYWORD_GROUPS, type NSFWUserMode } from "../utils/nsfwMode";

export interface HeuristicDocSummary {
  identifier: string;
  title: string;
  description?: string | null;
  mediatype?: string | null;
  year?: string | null;
  creator?: string | null;
  language?: string | null;
  downloads?: number | null;
}

export interface HeuristicSummaryResult {
  summary: string;
  notice: string;
}

interface KeywordScore {
  word: string;
  count: number;
}

const STOPWORDS = new Set(
  [
    "the",
    "and",
    "for",
    "that",
    "with",
    "from",
    "this",
    "have",
    "will",
    "your",
    "into",
    "about",
    "there",
    "which",
    "their",
    "after",
    "would",
    "could",
    "those",
    "these",
    "where",
    "when",
    "what",
    "been",
    "over",
    "some",
    "more",
    "only",
    "also",
    "other",
    "through",
    "archive",
    "internet",
    "collection",
    "collections",
    "digital",
    "archive",
    "archives",
    "library",
    "files",
    "items",
    "media",
    "available",
    "using",
    "including",
    "document",
    "documents",
    "record",
    "records",
    "search",
    "results",
    "https",
    "www",
    "http",
    "org",
    "com",
    "institution",
    "edition",
    "report",
    "reports",
    "dataset",
    "datasets",
    "open",
    "access",
    "historic",
    "history",
    "public",
  ]
);

const NSFW_EXPLICIT_SET = new Set(NSFW_KEYWORD_GROUPS.explicit);
const NSFW_ADULT_SET = new Set(NSFW_KEYWORD_GROUPS.adult);
const NSFW_VIOLENT_SET = new Set(NSFW_KEYWORD_GROUPS.violent);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token));
}

function rankKeywords(tokens: string[]): KeywordScore[] {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
}

function filterKeywordsByMode(keywords: string[], mode: NSFWUserMode): string[] {
  if (keywords.length === 0) {
    return keywords;
  }

  if (mode === "safe") {
    return keywords.filter(
      (word) => !NSFW_EXPLICIT_SET.has(word) && !NSFW_ADULT_SET.has(word) && !NSFW_VIOLENT_SET.has(word)
    );
  }

  if (mode === "moderate") {
    return keywords.filter((word) => !NSFW_EXPLICIT_SET.has(word) && !NSFW_VIOLENT_SET.has(word));
  }

  if (mode === "nsfw-only") {
    const focused = keywords.filter(
      (word) => NSFW_EXPLICIT_SET.has(word) || NSFW_ADULT_SET.has(word) || NSFW_VIOLENT_SET.has(word)
    );
    return focused.length > 0 ? focused : keywords.slice(0, 6);
  }

  return keywords;
}

function buildHighlight(doc: HeuristicDocSummary, mode: NSFWUserMode): string {
  const parts: string[] = [];
  const metadata: string[] = [];

  if (doc.year) {
    metadata.push(doc.year);
  }

  if (doc.mediatype) {
    metadata.push(formatMediaType(doc.mediatype));
  }

  if (doc.creator) {
    metadata.push(doc.creator);
  }

  const summaryPieces: string[] = [];
  if (metadata.length > 0) {
    summaryPieces.push(`${doc.title} (${metadata.join(" · ")})`);
  } else {
    summaryPieces.push(doc.title);
  }

  const description = doc.description ? normalizeSentence(doc.description) : null;
  if (description) {
    const analysis = analyzeTextForNSFW(description);
    const allowDescription =
      mode === "nsfw-only" ||
      mode === "unrestricted" ||
      (mode === "moderate" && !analysis.hasExplicit) ||
      (mode === "safe" && !analysis.hasExplicit && !analysis.hasMild);

    if (allowDescription) {
      summaryPieces.push(`— ${truncate(description, 140)}`);
    }
  }

  parts.push(summaryPieces.join(" "));
  return parts.join(" ");
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function normalizeSentence(text: string): string | null {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) {
    return null;
  }
  const sentenceMatch = cleaned.match(/^(.*?[.!?])\s/);
  if (sentenceMatch && sentenceMatch[1]) {
    return sentenceMatch[1].trim();
  }
  return cleaned;
}

function formatMediaType(value: string): string {
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case "texts":
      return "Texts";
    case "audio":
      return "Audio";
    case "movies":
      return "Video";
    case "image":
      return "Images";
    case "software":
      return "Software";
    case "web":
      return "Web";
    case "data":
      return "Data";
    case "collection":
      return "Collection";
    case "tvnews":
      return "TV News";
    default:
      return value;
  }
}

function formatMediaSuggestions(docs: HeuristicDocSummary[]): string | null {
  const counts = new Map<string, number>();
  for (const doc of docs) {
    if (!doc.mediatype) {
      continue;
    }
    const label = formatMediaType(doc.mediatype);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  if (counts.size === 0) {
    return null;
  }

  const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const top = ranked.slice(0, 3).map(([label, count]) => `${label} (${count})`);
  return top.join(", ");
}

function deriveKeywordSuggestions(docs: HeuristicDocSummary[], mode: NSFWUserMode): string[] {
  const tokens: string[] = [];
  for (const doc of docs) {
    const textSegments: string[] = [doc.title];
    if (doc.description) {
      textSegments.push(doc.description);
    }
    tokens.push(...tokenize(textSegments.join(" ")));
  }

  const ranked = rankKeywords(tokens);
  const keywords = ranked.map((entry) => entry.word);
  const filtered = filterKeywordsByMode(keywords, mode);
  return filtered.slice(0, 5);
}

function buildSuggestionParagraph(keywords: string[]): string {
  if (keywords.length === 0) {
    return "Keyword suggestions:\n- refine with collection names or creators featured in the results";
  }
  return `Keyword suggestions:\n${keywords.map((word) => `- ${word}`).join("\n")}`;
}

function buildMediaParagraph(mediaSummary: string | null, mode: NSFWUserMode): string {
  if (mode === "nsfw-only") {
    return (
      "NSFW Only mode is active. Focus on adult-tagged collections or creators and consider adding specific site names or years."
    );
  }

  if (!mediaSummary) {
    return "Use filters such as media type, year, or language to tighten the results.";
  }

  return `Notable media types: ${mediaSummary}. Apply the matching filter to surface the strongest material.`;
}

export function buildHeuristicAISummary(
  query: string,
  docs: HeuristicDocSummary[],
  mode: NSFWUserMode,
  unavailableReason?: string | null
): HeuristicSummaryResult | null {
  const sanitizedQuery = query.trim();
  if (!sanitizedQuery && docs.length === 0) {
    return null;
  }

  const meaningfulDocs = docs.slice(0, 5);

  const highlights = meaningfulDocs.slice(0, 3).map((doc) => buildHighlight(doc, mode));
  const keywordSuggestions = deriveKeywordSuggestions(meaningfulDocs, mode);
  const mediaSummary = formatMediaSuggestions(meaningfulDocs);

  const leadSentence = meaningfulDocs.length
    ? `Alexandria heuristics reviewed ${meaningfulDocs.length} result${meaningfulDocs.length === 1 ? "" : "s"} for "${
        sanitizedQuery || "your query"
      }". Notable matches include ${highlights.join("; ")}.`
    : `No archive items matched "${sanitizedQuery || "your query"}" under the current filters.`;

  const keywordParagraph = buildSuggestionParagraph(keywordSuggestions);
  const mediaParagraph = buildMediaParagraph(mediaSummary, mode);

  const summary = [leadSentence, keywordParagraph, mediaParagraph].join("\n\n");

  const baseNotice = unavailableReason && unavailableReason.trim().length > 0
    ? unavailableReason.trim()
    : "No offline AI response was available.";

  const noticeTail =
    mode === "nsfw-only"
      ? " Suggestions are generated directly from NSFW-filtered results."
      : " Suggestions are synthesized from the current search results.";

  return {
    summary,
    notice: `${baseNotice} ${noticeTail}`.trim(),
  };
}
