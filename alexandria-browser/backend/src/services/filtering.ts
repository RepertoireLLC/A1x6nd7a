export type LinkStatus = "online" | "archived-only" | "offline";

export type NSFWFilterMode = "safe" | "moderate" | "off" | "only";

export type SourceTrustLevel = "high" | "medium" | "low";

export interface ArchiveSearchFiltersInput {
  mediaType?: string;
  yearFrom?: string;
  yearTo?: string;
  language?: string;
  sourceTrust?: string;
  nsfwMode?: string;
  availability?: string;
}

const COMMUNITY_LABELS = new Set(["community", "experimental", "low"]);

export function normalizeSourceTrust(value: string | undefined): SourceTrustLevel | "any" | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "any" || normalized === "all") {
    return "any";
  }
  if (normalized === "high" || normalized === "trusted" || normalized === "curated") {
    return "high";
  }
  if (normalized === "medium" || normalized === "standard" || normalized === "default") {
    return "medium";
  }
  if (COMMUNITY_LABELS.has(normalized)) {
    return "low";
  }
  return null;
}

export function normalizeAvailability(value: string | undefined): LinkStatus | "any" | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "any" || normalized === "all") {
    return "any";
  }
  if (normalized === "online" || normalized === "live") {
    return "online";
  }
  if (normalized === "archived-only" || normalized === "archived" || normalized === "archive") {
    return "archived-only";
  }
  if (normalized === "offline") {
    return "offline";
  }
  return null;
}

export function normalizeNsfwMode(value: string | undefined): NSFWFilterMode | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "safe") {
    return "safe";
  }
  if (normalized === "moderate") {
    return "moderate";
  }
  if (normalized === "only" || normalized === "only_nsfw" || normalized === "only-nsfw" || normalized === "nsfw") {
    return "only";
  }
  if (normalized === "unrestricted" || normalized === "off" || normalized === "none" || normalized === "disabled") {
    return "off";
  }
  return null;
}

export function extractLanguageList(record: Record<string, unknown>): string[] {
  const values: string[] = [];
  const candidate = record.language ?? record.languages ?? record.lang;

  if (typeof candidate === "string" && candidate.trim()) {
    values.push(candidate.trim().toLowerCase());
  } else if (Array.isArray(candidate)) {
    for (const entry of candidate) {
      if (typeof entry === "string" && entry.trim()) {
        values.push(entry.trim().toLowerCase());
      }
    }
  }

  return values;
}

export function matchesNsfwMode(record: Record<string, unknown>, mode: NSFWFilterMode): boolean {
  if (mode === "off") {
    return true;
  }

  const isFlagged = record.nsfw === true;
  const severityRaw = record.nsfwLevel ?? record.nsfw_level;
  const severity = typeof severityRaw === "string" ? severityRaw.toLowerCase() : null;

  if (mode === "only") {
    return isFlagged;
  }

  if (mode === "safe") {
    return !isFlagged;
  }

  if (mode === "moderate") {
    return severity !== "explicit";
  }

  return true;
}

export function matchesAdvancedFilters(
  record: Record<string, unknown>,
  filters: ArchiveSearchFiltersInput
): boolean {
  const languageFilter = filters.language?.trim().toLowerCase() ?? "";
  if (languageFilter) {
    const languages = extractLanguageList(record);
    if (languages.length === 0) {
      return false;
    }
    if (!languages.some((entry) => entry.includes(languageFilter) || entry.startsWith(languageFilter))) {
      return false;
    }
  }

  const trustFilter = normalizeSourceTrust(filters.sourceTrust);
  if (trustFilter && trustFilter !== "any") {
    const trustValueRaw = record.source_trust ?? record.source_trust_level ?? record.trust_level;
    const trustValue = typeof trustValueRaw === "string" ? trustValueRaw.trim().toLowerCase() : "";
    if (!trustValue || trustValue !== trustFilter) {
      return false;
    }
  }

  const availabilityFilter = normalizeAvailability(filters.availability);
  if (availabilityFilter && availabilityFilter !== "any") {
    const availabilityValueRaw = record.availability;
    const availabilityValue =
      typeof availabilityValueRaw === "string" ? availabilityValueRaw.trim().toLowerCase() : "";
    if (!availabilityValue || availabilityValue !== availabilityFilter) {
      return false;
    }
  }

  const nsfwMode = normalizeNsfwMode(filters.nsfwMode);
  if (nsfwMode && !matchesNsfwMode(record, nsfwMode)) {
    return false;
  }

  return true;
}
