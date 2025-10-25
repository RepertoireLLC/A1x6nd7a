import keywordPayload from "../../../shared/nsfwKeywords.json" assert { type: "json" };

import type { ArchiveSearchDoc, NSFWFilterMode, NSFWUserMode } from "../types";
import { applyNSFWModeToDocs } from "./nsfw";

interface KeywordConfig {
  explicit?: unknown;
  adult?: unknown;
  violent?: unknown;
}

type KeywordSets = {
  explicit: string[];
  adult: string[];
  violent: string[];
};

function normalizeKeywordList(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return Array.from(
    new Set(
      input
        .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
        .filter((value) => value.length > 0)
    )
  );
}

function parseKeywordConfig(payload: KeywordConfig): KeywordSets {
  const explicit = normalizeKeywordList(payload.explicit);
  const adult = normalizeKeywordList(payload.adult).filter((keyword) => !explicit.includes(keyword));
  const violent = normalizeKeywordList(payload.violent);

  return { explicit, adult, violent };
}

const KEYWORD_SETS = parseKeywordConfig(keywordPayload as KeywordConfig);

export const NSFW_MODE_KEYWORDS: Readonly<KeywordSets> = {
  explicit: KEYWORD_SETS.explicit,
  adult: KEYWORD_SETS.adult,
  violent: KEYWORD_SETS.violent,
};

export function getNSFWMode(mode: NSFWFilterMode): NSFWUserMode {
  switch (mode) {
    case "moderate":
      return "moderate";
    case "unrestricted":
      return "unrestricted";
    case "nsfw-only":
      return "nsfw-only";
    default:
      return "safe";
  }
}

export function filterByNSFWMode(results: ArchiveSearchDoc[], mode: NSFWFilterMode): ArchiveSearchDoc[] {
  return applyNSFWModeToDocs(results, mode);
}

export function mapUserModeToFilterMode(mode: NSFWUserMode): NSFWFilterMode {
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
