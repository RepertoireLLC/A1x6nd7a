import { matchesNsfwMode, normalizeNsfwMode, type NSFWFilterMode as BackendFilterMode } from "../services/filtering";
import { annotateRecord } from "../services/nsfwFilter";
import { createRequire } from "node:module";

import { detectKeywordMatches } from "./nsfwKeywordMatcher";

const require = createRequire(import.meta.url);

export type NSFWUserMode = "safe" | "moderate" | "unrestricted" | "nsfw-only";

interface KeywordConfig {
  explicit?: unknown;
  adult?: unknown;
  violent?: unknown;
}

interface KeywordSets {
  explicit: string[];
  adult: string[];
  violent: string[];
}

export interface NsfwAnalysisResult {
  hasExplicit: boolean;
  hasMild: boolean;
  hasViolent: boolean;
  matches: string[];
}

const keywordPayload = require("../../filters/nsfwTerms.json") as KeywordConfig;

const KEYWORD_SETS = parseKeywordConfig(keywordPayload);

export const NSFW_KEYWORD_GROUPS: Readonly<KeywordSets> = {
  explicit: KEYWORD_SETS.explicit,
  adult: KEYWORD_SETS.adult,
  violent: KEYWORD_SETS.violent,
};

function parseKeywordConfig(payload: KeywordConfig): KeywordSets {
  const parseList = (value: unknown): string[] => {
    if (!Array.isArray(value)) {
      return [];
    }
    return Array.from(
      new Set(
        value
          .map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : ""))
          .filter((entry) => entry.length > 0)
      )
    );
  };

  const explicit = parseList(payload.explicit);
  const adult = parseList(payload.adult).filter((keyword) => !explicit.includes(keyword));
  const violent = parseList(payload.violent);

  return { explicit, adult, violent };
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
    normalized === "nsfw-only" ||
    normalized === "only_nsfw" ||
    normalized === "nsfw" ||
    normalized === "adults"
  ) {
    return "nsfw-only";
  }
  return "safe";
}

export function mapUserModeToFilterMode(mode: NSFWUserMode): BackendFilterMode {
  switch (mode) {
    case "moderate":
      return "moderate";
    case "nsfw-only":
      return "nsfw-only";
    case "unrestricted":
      return "unrestricted";
    default:
      return "safe";
  }
}

export function filterByNSFWMode<T extends Record<string, unknown>>(
  results: T[],
  mode: NSFWUserMode
): T[] {
  const filterMode = mapUserModeToFilterMode(mode);
  if (filterMode === "unrestricted") {
    return results;
  }

  return results.filter((item) => {
    const annotated = annotateRecord(item);
    return matchesNsfwMode(annotated, filterMode);
  });
}

export function analyzeTextForNSFW(text: string): NsfwAnalysisResult {
  if (!text.trim()) {
    return { hasExplicit: false, hasMild: false, hasViolent: false, matches: [] };
  }

  const explicit = detectKeywordMatches(text, KEYWORD_SETS.explicit);
  const mild = detectKeywordMatches(text, KEYWORD_SETS.adult);
  const violent = detectKeywordMatches(text, KEYWORD_SETS.violent);
  const matchSet = new Set<string>([...explicit, ...mild, ...violent]);

  const hasExplicit = explicit.length > 0;
  const hasViolent = violent.length > 0;
  const hasMild = hasExplicit || hasViolent ? true : mild.length > 0;

  return { hasExplicit, hasMild, hasViolent, matches: Array.from(matchSet) };
}

export function shouldSuppressAIResponse(
  text: string,
  mode: NSFWUserMode
): { suppressed: boolean; message?: string; severity?: "explicit" | "mild" | "violent" | null } {
  if (!text.trim()) {
    return { suppressed: false };
  }

  const analysis = analyzeTextForNSFW(text);

  if (mode === "safe") {
    if (analysis.hasExplicit || analysis.hasMild || analysis.hasViolent) {
      return {
        suppressed: true,
        severity: analysis.hasExplicit ? "explicit" : analysis.hasViolent ? "violent" : "mild",
        message: "AI Mode: This content is hidden because Safe mode is enabled for universal audiences.",
      };
    }
    return { suppressed: false };
  }

  if (mode === "moderate") {
    if (analysis.hasExplicit || analysis.hasViolent) {
      return {
        suppressed: true,
        severity: analysis.hasExplicit ? "explicit" : "violent",
        message: "AI Mode: Explicit or graphic requests are blocked while Moderate mode is active.",
      };
    }
    return { suppressed: false };
  }

  if (mode === "nsfw-only") {
    if (!analysis.hasExplicit && !analysis.hasMild && !analysis.hasViolent) {
      return {
        suppressed: true,
        severity: null,
        message: "AI Mode: NSFW Only mode requires adult keywords before suggestions can be generated.",
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
    case "nsfw-only":
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
  if (fallback === "nsfw-only") {
    return "nsfw-only";
  }
  return fallback;
}
