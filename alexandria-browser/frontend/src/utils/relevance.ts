import type { ArchiveSearchDoc } from "../types";

const SCORING_PUNCTUATION_PATTERN = /[^\p{L}\p{N}]+/gu;

export function collectStringValues(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return [String(value)];
  }

  if (Array.isArray(value)) {
    const results: string[] = [];
    for (const entry of value) {
      if (typeof entry === "string") {
        const trimmed = entry.trim();
        if (trimmed) {
          results.push(trimmed);
        }
      } else if (typeof entry === "number" && Number.isFinite(entry)) {
        results.push(String(entry));
      }
    }
    return results;
  }

  return [];
}

export function normalizeMatchText(value: string): string {
  return value.normalize("NFKC").toLowerCase();
}

export function gatherNormalizedStrings(value: unknown): string[] {
  return collectStringValues(value)
    .map((entry) => normalizeMatchText(entry))
    .filter((entry) => entry.length > 0);
}

export function joinNormalizedStrings(value: unknown): string {
  return gatherNormalizedStrings(value).join(" ");
}

export function buildRelevanceContext(query: string): { normalizedQuery: string; tokens: string[] } {
  const normalizedQuery = normalizeMatchText(query).trim();
  const base = normalizedQuery.replace(SCORING_PUNCTUATION_PATTERN, " ");
  const tokens = base
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  const uniqueTokens = Array.from(new Set(tokens));
  return { normalizedQuery, tokens: uniqueTokens };
}

export function parseNumericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number.parseFloat(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

export function parseDateValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1000 && value < 10000) {
      return Date.UTC(Math.trunc(value), 0, 1);
    }
    return value;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }

    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }

    const yearMatch = trimmed.match(/(\d{4})/);
    if (yearMatch) {
      const year = Number.parseInt(yearMatch[1], 10);
      if (Number.isFinite(year)) {
        return Date.UTC(year, 0, 1);
      }
    }
  }

  return null;
}

export function getDocScore(doc: ArchiveSearchDoc): number {
  const score = parseNumericValue(doc.score ?? null);
  return score ?? Number.NEGATIVE_INFINITY;
}

export function getDocDownloads(doc: ArchiveSearchDoc): number {
  const downloads = parseNumericValue(doc.downloads ?? null);
  return downloads ?? Number.NEGATIVE_INFINITY;
}

export function getDocDateValue(doc: ArchiveSearchDoc): number {
  const candidates: Array<unknown> = [doc.publicdate, doc.date, doc.year];
  for (const candidate of candidates) {
    const parsed = parseDateValue(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }
  return Number.NEGATIVE_INFINITY;
}

export function computeDocTextSignals(
  doc: ArchiveSearchDoc,
  context: { normalizedQuery: string; tokens: string[] }
): {
  matchScore: number;
  coverage: number;
  exactTitle: boolean;
  exactIdentifier: boolean;
  titleStartsWith: boolean;
  identifierStartsWith: boolean;
} {
  const record = doc as Record<string, unknown>;
  const titleText = joinNormalizedStrings(record["title"]);
  const identifierText = joinNormalizedStrings(record["identifier"]);
  const descriptionText = joinNormalizedStrings(record["description"]);
  const creatorText = joinNormalizedStrings(record["creator"]);
  const collectionText = joinNormalizedStrings(record["collection"]);
  const subjectText = joinNormalizedStrings(record["subject"]);
  const tagsText = joinNormalizedStrings(record["tags"]);
  const topicText = joinNormalizedStrings(record["topic"]);
  const keywordsText = joinNormalizedStrings(record["keywords"]);

  const combinedText = [
    titleText,
    descriptionText,
    creatorText,
    collectionText,
    subjectText,
    tagsText,
    topicText,
    keywordsText
  ]
    .filter((value) => value.length > 0)
    .join(" ");

  const normalizedQuery = context.normalizedQuery;
  let matchScore = 0;
  const matchedTokens = new Set<string>();

  const hasNormalizedQuery = normalizedQuery.length > 0;
  const exactTitle = hasNormalizedQuery && titleText === normalizedQuery;
  const exactIdentifier = hasNormalizedQuery && identifierText === normalizedQuery;
  const titleStartsWith = hasNormalizedQuery && titleText.startsWith(normalizedQuery);
  const identifierStartsWith = hasNormalizedQuery && identifierText.startsWith(normalizedQuery);

  if (exactTitle) {
    matchScore += 200;
  } else if (titleStartsWith) {
    matchScore += 90;
  } else if (hasNormalizedQuery && titleText.includes(normalizedQuery)) {
    matchScore += 60;
  }

  if (exactIdentifier) {
    matchScore += 160;
  } else if (identifierStartsWith) {
    matchScore += 70;
  } else if (hasNormalizedQuery && identifierText.includes(normalizedQuery)) {
    matchScore += 45;
  }

  if (hasNormalizedQuery && descriptionText.includes(normalizedQuery)) {
    matchScore += 35;
  }

  if (hasNormalizedQuery && creatorText.includes(normalizedQuery)) {
    matchScore += 25;
  }

  const evaluateToken = (token: string): void => {
    if (!token) {
      return;
    }

    if (titleText.includes(token)) {
      matchScore += 16;
      matchedTokens.add(token);
      return;
    }

    if (identifierText.includes(token)) {
      matchScore += 14;
      matchedTokens.add(token);
      return;
    }

    if (creatorText.includes(token)) {
      matchScore += 12;
      matchedTokens.add(token);
      return;
    }

    if (collectionText.includes(token)) {
      matchScore += 10;
      matchedTokens.add(token);
      return;
    }

    if (combinedText.includes(token)) {
      matchScore += 6;
      matchedTokens.add(token);
    }
  };

  for (const token of context.tokens) {
    evaluateToken(token);
  }

  const coverage = matchedTokens.size;
  if (coverage > 0) {
    matchScore += coverage * 4;
  }
  if (coverage === context.tokens.length && coverage > 0) {
    matchScore += 8;
  }

  return {
    matchScore,
    coverage,
    exactTitle,
    exactIdentifier,
    titleStartsWith,
    identifierStartsWith
  };
}

export function sortDocsByRelevance(docs: ArchiveSearchDoc[], query: string): ArchiveSearchDoc[] {
  const context = buildRelevanceContext(query);

  return docs
    .map((doc, index) => {
      const textSignals = computeDocTextSignals(doc, context);
      return {
        doc,
        index,
        score: getDocScore(doc),
        downloads: getDocDownloads(doc),
        date: getDocDateValue(doc),
        matchScore: textSignals.matchScore,
        coverage: textSignals.coverage,
        exactTitle: textSignals.exactTitle,
        exactIdentifier: textSignals.exactIdentifier,
        titleStartsWith: textSignals.titleStartsWith,
        identifierStartsWith: textSignals.identifierStartsWith
      };
    })
    .sort((a, b) => {
      if (a.exactTitle !== b.exactTitle) {
        return Number(b.exactTitle) - Number(a.exactTitle);
      }
      if (a.exactIdentifier !== b.exactIdentifier) {
        return Number(b.exactIdentifier) - Number(a.exactIdentifier);
      }
      if (a.titleStartsWith !== b.titleStartsWith) {
        return Number(b.titleStartsWith) - Number(a.titleStartsWith);
      }
      if (a.identifierStartsWith !== b.identifierStartsWith) {
        return Number(b.identifierStartsWith) - Number(a.identifierStartsWith);
      }
      if (a.matchScore !== b.matchScore) {
        return b.matchScore - a.matchScore;
      }
      if (a.coverage !== b.coverage) {
        return b.coverage - a.coverage;
      }
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      if (a.downloads !== b.downloads) {
        return b.downloads - a.downloads;
      }
      if (a.date !== b.date) {
        return b.date - a.date;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.doc);
}

export function gatherSearchableText(doc: ArchiveSearchDoc): string {
  const values: string[] = [];

  const append = (input: unknown) => {
    if (typeof input === "string") {
      values.push(input);
    } else if (Array.isArray(input)) {
      for (const entry of input) {
        if (typeof entry === "string") {
          values.push(entry);
        }
      }
    }
  };

  append(doc.title);
  append(doc.description);
  append(doc.identifier);
  append(doc.creator);
  append(doc.collection);

  const extended = doc as Record<string, unknown>;
  append(extended.subject);
  append(extended.tags);
  append(extended.topic);
  append(extended.keywords);

  return values.join(" ").toLowerCase();
}
