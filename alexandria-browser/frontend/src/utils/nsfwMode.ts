import keywordPayload from "../../../src/config/nsfwKeywords.json" assert { type: "json" };

import type { ArchiveSearchDoc, NSFWFilterMode, NSFWUserMode } from "../types";
import { applyNSFWModeToDocs } from "./nsfw";

interface KeywordConfig {
  categories?: {
    explicit?: unknown;
    mild?: unknown;
  };
}

type KeywordSets = {
  explicit: string[];
  mild: string[];
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
  if (!payload.categories || typeof payload.categories !== "object") {
    return { explicit: [], mild: [] };
  }

  const explicit = normalizeKeywordList((payload.categories as Record<string, unknown>).explicit);
  const mild = normalizeKeywordList((payload.categories as Record<string, unknown>).mild);
  const explicitSet = new Set(explicit);
  const filteredMild = mild.filter((keyword) => !explicitSet.has(keyword));

  return { explicit, mild: filteredMild };
}

const KEYWORD_SETS = parseKeywordConfig(keywordPayload as KeywordConfig);

export const NSFW_MODE_KEYWORDS: Readonly<KeywordSets> = {
  explicit: KEYWORD_SETS.explicit,
  mild: KEYWORD_SETS.mild,
};

export function getNSFWMode(mode: NSFWFilterMode): NSFWUserMode {
  switch (mode) {
    case "moderate":
      return "moderate";
    case "off":
      return "unrestricted";
    case "only":
      return "only-nsfw";
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
    case "only-nsfw":
      return "only";
    case "unrestricted":
      return "off";
    default:
      return "safe";
  }
}
