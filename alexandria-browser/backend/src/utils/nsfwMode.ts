import { matchesNsfwMode, normalizeNsfwMode, type NSFWFilterMode as BackendFilterMode } from "../services/filtering";
import { annotateRecord } from "../services/nsfwFilter";
import { createRequire } from "node:module";

import { detectKeywordMatches } from "./nsfwKeywordMatcher";

const require = createRequire(import.meta.url);

export type NSFWUserMode = "safe" | "moderate" | "unrestricted" | "only-nsfw";

interface KeywordConfig {
  categories?: {
    explicit?: unknown;
    mild?: unknown;
  };
}

interface KeywordSets {
  explicit: string[];
  mild: string[];
}

export interface NsfwAnalysisResult {
  hasExplicit: boolean;
  hasMild: boolean;
  matches: string[];
}

const keywordPayload = require("../../../src/config/nsfwKeywords.json") as KeywordConfig;

const KEYWORD_SETS = parseKeywordConfig(keywordPayload);

export const NSFW_KEYWORD_GROUPS: Readonly<KeywordSets> = {
  explicit: KEYWORD_SETS.explicit,
  mild: KEYWORD_SETS.mild,
};

function parseKeywordConfig(payload: KeywordConfig): KeywordSets {
  const explicit: string[] = [];
  const mild: string[] = [];

  if (payload.categories && typeof payload.categories === "object") {
    const record = payload.categories as Record<string, unknown>;

    const parseList = (value: unknown): string[] => {
      if (!Array.isArray(value)) {
        return [];
      }
      return value
        .map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : ""))
        .filter((entry) => entry.length > 0);
    };

    explicit.push(...parseList(record.explicit));
    mild.push(...parseList(record.mild));
  }

  const uniqueExplicit = Array.from(new Set(explicit));
  const explicitSet = new Set(uniqueExplicit);
  const uniqueMild = Array.from(new Set(mild.filter((keyword) => !explicitSet.has(keyword))));

  return { explicit: uniqueExplicit, mild: uniqueMild };
}

export function getNSFWMode(value?: string | null): NSFWUserMode {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "moderate") {
    return "moderate";
  }
  if (normalized === "unrestricted" || normalized === "off" || normalized === "none" || normalized === "disabled") {
    return "unrestricted";
  }
  if (
    normalized === "only" ||
    normalized === "only-nsfw" ||
    normalized === "only_nsfw" ||
    normalized === "nsfw" ||
    normalized === "adults"
  ) {
    return "only-nsfw";
  }
  return "safe";
}

export function mapUserModeToFilterMode(mode: NSFWUserMode): BackendFilterMode {
  switch (mode) {
    case "moderate":
      return "moderate";
    case "only-nsfw":
      return "only";
    case "unrestricted":
      return "off";
    default:
      return "safe";
  }
}

export function filterByNSFWMode<T extends Record<string, unknown>>(
  results: T[],
  mode: NSFWUserMode
): T[] {
  const filterMode = mapUserModeToFilterMode(mode);
  if (filterMode === "off") {
    return results;
  }

  return results.filter((item) => {
    const annotated = annotateRecord(item);
    return matchesNsfwMode(annotated, filterMode);
  });
}

export function analyzeTextForNSFW(text: string): NsfwAnalysisResult {
  if (!text.trim()) {
    return { hasExplicit: false, hasMild: false, matches: [] };
  }

  const explicit = detectKeywordMatches(text, KEYWORD_SETS.explicit);
  const mild = detectKeywordMatches(text, KEYWORD_SETS.mild);
  const matchSet = new Set<string>([...explicit, ...mild]);

  const hasExplicit = explicit.length > 0;
  const hasMild = hasExplicit ? true : mild.length > 0;

  return { hasExplicit, hasMild, matches: Array.from(matchSet) };
}

export function shouldSuppressAIResponse(
  text: string,
  mode: NSFWUserMode
): { suppressed: boolean; message?: string; severity?: "explicit" | "mild" | null } {
  if (!text.trim()) {
    return { suppressed: false };
  }

  const analysis = analyzeTextForNSFW(text);

  if (mode === "safe") {
    if (analysis.hasExplicit || analysis.hasMild) {
      return {
        suppressed: true,
        severity: analysis.hasExplicit ? "explicit" : "mild",
        message: "AI Mode: This content is hidden because Safe Search is enabled.",
      };
    }
    return { suppressed: false };
  }

  if (mode === "moderate") {
    if (analysis.hasExplicit) {
      return {
        suppressed: true,
        severity: "explicit",
        message: "AI Mode: Explicit requests are blocked while Moderate NSFW mode is active.",
      };
    }
    return { suppressed: false };
  }

  if (mode === "only-nsfw") {
    if (!analysis.hasExplicit && !analysis.hasMild) {
      return {
        suppressed: true,
        severity: null,
        message: "AI Mode: Only-NSFW mode requires adult keywords before suggestions can be generated.",
      };
    }
    return { suppressed: false };
  }

  return { suppressed: false };
}

export function buildNSFWPromptInstruction(mode: NSFWUserMode): string {
  const base = `NSFW mode is currently set to: "${mode}".`;
  switch (mode) {
    case "safe":
      return (
        base +
        " Never suggest explicit material. Filter out adult topics entirely and respond with safe, educational alternatives."
      );
    case "moderate":
      return (
        base +
        " You may reference mature themes at a high level, but avoid explicit descriptions or graphic archive materials."
      );
    case "only-nsfw":
      return (
        base +
        " Focus exclusively on NSFW-tagged archive items or well-known adult keywords. Do not suggest safe or general content."
      );
    default:
      return (
        base +
        " Respect all legal requests without filtering, but ensure responses remain factual and relevant to the Internet Archive."
      );
  }
}

export function normalizeUserSuppliedMode(value: string | undefined): NSFWUserMode {
  const userMode = getNSFWMode(value);
  const fallback = normalizeNsfwMode(value);
  if (!fallback) {
    return userMode;
  }
  if (fallback === "off") {
    return "unrestricted";
  }
  if (fallback === "only") {
    return "only-nsfw";
  }
  return fallback;
}
