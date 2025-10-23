import type { ArchiveSearchDoc } from "../types";

interface RankedDoc {
  doc: ArchiveSearchDoc;
  raw: number;
}

const NON_WORD_PATTERN = /[\p{P}\p{S}]+/gu;
const MULTISPACE_PATTERN = /\s+/g;

function normalizeText(value: unknown): string {
  if (typeof value === "string") {
    return value.toLowerCase();
  }
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.toLowerCase())
      .join(" ");
  }
  if (value && typeof value === "object") {
    return Object.values(value)
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.toLowerCase())
      .join(" ");
  }
  return "";
}

function parseNumeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number.parseFloat(trimmed.replace(/,/g, ""));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractYearsFromQuery(query: string): number[] {
  const matches = query.match(/\b(\d{4})\b/g);
  if (!matches) {
    return [];
  }
  const unique = new Set<number>();
  for (const match of matches) {
    const parsed = Number.parseInt(match, 10);
    if (Number.isFinite(parsed)) {
      unique.add(parsed);
    }
  }
  return Array.from(unique);
}

function resolveDocumentYear(doc: ArchiveSearchDoc): number | null {
  const candidates: Array<unknown> = [doc.year, doc.date, doc.publicdate];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") {
      continue;
    }
    const match = candidate.match(/\b(\d{4})\b/);
    if (!match) {
      continue;
    }
    const value = Number.parseInt(match[1], 10);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function computeKeywordDensity(text: string, tokens: string[], tokenExpressions: RegExp[]): number {
  if (!text || tokens.length === 0) {
    return 0;
  }
  const words = text.replace(NON_WORD_PATTERN, " ").trim().split(MULTISPACE_PATTERN).filter(Boolean);
  if (words.length === 0) {
    return 0;
  }
  let matches = 0;
  for (const expression of tokenExpressions) {
    const found = text.match(expression);
    if (found) {
      matches += found.length;
    }
  }
  return matches / words.length;
}

function computeRawRelevance(
  doc: ArchiveSearchDoc,
  query: string,
  tokens: string[],
  tokenExpressions: RegExp[],
  queryYears: number[],
): number {
  let score = 0;

  const normalizedTitle = normalizeText(doc.title || doc.identifier);
  const normalizedDescription = normalizeText(doc.description);
  const normalizedCreator = normalizeText(doc.creator);
  const normalizedCollection = normalizeText(doc.collection);
  const normalizedIdentifier = (doc.identifier || "").toLowerCase();
  const combinedText = [normalizedTitle, normalizedDescription, normalizedCreator, normalizedCollection, normalizedIdentifier]
    .filter(Boolean)
    .join(" ");

  const existingScore = parseNumeric(doc.score);
  if (existingScore !== null) {
    const normalizedExisting = existingScore > 1 ? existingScore / 100 : existingScore;
    score += normalizedExisting * 30;
  }

  if (query && combinedText.includes(query)) {
    score += 35;
  }

  for (const token of tokens) {
    if (!token) {
      continue;
    }
    if (normalizedTitle.includes(token)) {
      score += 12;
    }
    if (normalizedDescription.includes(token)) {
      score += 6;
    }
    if (normalizedCreator.includes(token) || normalizedCollection.includes(token)) {
      score += 3;
    }
    if (normalizedIdentifier.includes(token)) {
      score += 2;
    }
  }

  const density = computeKeywordDensity(combinedText, tokens, tokenExpressions);
  if (density > 0) {
    score += Math.min(20, density * 80);
  }

  const downloads = parseNumeric(doc.downloads);
  if (downloads && downloads > 0) {
    score += Math.min(25, Math.log10(downloads + 1) * 10);
  }

  const views = parseNumeric((doc as { views?: unknown }).views);
  if (views && views > 0) {
    score += Math.min(18, Math.log10(views + 1) * 6);
  }

  if (queryYears.length > 0) {
    const docYear = resolveDocumentYear(doc);
    if (docYear !== null) {
      let bestYearBonus = 0;
      for (const queryYear of queryYears) {
        const diff = Math.abs(docYear - queryYear);
        const bonus = diff === 0 ? 15 : diff > 60 ? 0 : Math.max(0, 12 - diff * 0.2);
        if (bonus > bestYearBonus) {
          bestYearBonus = bonus;
        }
      }
      score += bestYearBonus;
    }
  }

  if (doc.source_trust || doc.source_trust_level) {
    score += 4;
  }

  return score;
}

export function mergeRankedResults(
  existingDocs: ArchiveSearchDoc[],
  incomingDocs: ArchiveSearchDoc[],
  query: string,
): ArchiveSearchDoc[] {
  const trimmedQuery = query.trim().toLowerCase();
  const tokenCandidates = trimmedQuery
    ? trimmedQuery
        .split(MULTISPACE_PATTERN)
        .map((token) => token.trim())
        .filter((token) => token.length > 0)
    : [];

  const tokens = tokenCandidates.filter((token, index, array) => {
    if (array.indexOf(token) !== index) {
      return false;
    }
    return token.length > 2 || array.length === 1;
  });

  const tokenExpressions = tokens.map((token) => new RegExp(`\\b${escapeRegExp(token)}\\b`, "gi"));
  const queryYears = extractYearsFromQuery(trimmedQuery);

  const docMap = new Map<string, ArchiveSearchDoc>();
  for (const doc of existingDocs) {
    docMap.set(doc.identifier, doc);
  }
  for (const doc of incomingDocs) {
    const previous = docMap.get(doc.identifier);
    docMap.set(doc.identifier, previous ? { ...previous, ...doc } : doc);
  }

  const ranked: RankedDoc[] = [];
  for (const doc of docMap.values()) {
    const copy: ArchiveSearchDoc = { ...doc };
    const raw = computeRawRelevance(copy, trimmedQuery, tokens, tokenExpressions, queryYears);
    ranked.push({ doc: copy, raw });
  }

  const maxScore = ranked.reduce((maximum, entry) => (entry.raw > maximum ? entry.raw : maximum), 0);
  if (maxScore <= 0) {
    return ranked.map((entry) => ({ ...entry.doc, score: 0 })).sort((a, b) => a.identifier.localeCompare(b.identifier));
  }

  return ranked
    .map((entry) => ({
      ...entry.doc,
      score: Number.parseFloat((entry.raw / maxScore).toFixed(4)),
    }))
    .sort((a, b) => {
      const scoreA = typeof a.score === "number" ? a.score : 0;
      const scoreB = typeof b.score === "number" ? b.score : 0;
      if (scoreA === scoreB) {
        return a.identifier.localeCompare(b.identifier);
      }
      return scoreB - scoreA;
    });
}
