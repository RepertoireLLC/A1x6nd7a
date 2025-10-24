export type LinkStatus = "online" | "archived-only" | "offline";

export type NSFWFilterMode = "safe" | "moderate" | "unrestricted" | "nsfw-only";

export type SourceTrustLevel = "high" | "medium" | "low";

export interface ArchiveSearchFiltersInput {
  mediaType?: string;
  yearFrom?: string;
  yearTo?: string;
  language?: string;
  sourceTrust?: string;
  nsfwMode?: string;
  availability?: string;
  collection?: string;
  uploader?: string;
  subject?: string;
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
  if (
    normalized === "nsfw-only" ||
    normalized === "only" ||
    normalized === "only_nsfw" ||
    normalized === "only-nsfw" ||
    normalized === "nsfw"
  ) {
    return "nsfw-only";
  }
  if (normalized === "unrestricted" || normalized === "off" || normalized === "none" || normalized === "disabled") {
    return "unrestricted";
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
  if (mode === "unrestricted") {
    return true;
  }

  const isFlagged = record.nsfw === true;
  const severityRaw = record.nsfwLevel ?? record.nsfw_level;
  const severity = typeof severityRaw === "string" ? severityRaw.toLowerCase() : null;

  if (mode === "nsfw-only") {
    return isFlagged;
  }

  if (mode === "safe") {
    return !isFlagged;
  }

  if (mode === "moderate") {
    if (!isFlagged) {
      return true;
    }
    return severity === "mild";
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

  const buildTokenList = (raw: string | undefined): string[] =>
    raw
      ?.split(/[,\n]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0) ?? [];

  const collectionFilterValues = buildTokenList(filters.collection);
  if (collectionFilterValues.length > 0) {
    const collectionCandidate = record.collection;
    const collectionValues = Array.isArray(collectionCandidate)
      ? collectionCandidate
      : typeof collectionCandidate === "string"
      ? [collectionCandidate]
      : [];
    const normalizedCollections = collectionValues
      .map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : ""))
      .filter((entry) => entry.length > 0);
    if (!collectionFilterValues.some((value) => normalizedCollections.includes(value))) {
      return false;
    }
  }

  const subjectFilterValues = buildTokenList(filters.subject);
  if (subjectFilterValues.length > 0) {
    const subjectCandidate =
      (record as Record<string, unknown>).subject ?? (record as Record<string, unknown>).subjects;
    const subjectValues = Array.isArray(subjectCandidate)
      ? subjectCandidate
      : typeof subjectCandidate === "string"
      ? subjectCandidate.split(/[,;]+/)
      : [];
    const normalizedSubjects = subjectValues
      .map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : ""))
      .filter((entry) => entry.length > 0);
    if (!subjectFilterValues.some((value) => normalizedSubjects.includes(value))) {
      return false;
    }
  }

  const uploaderFilter = filters.uploader?.trim().toLowerCase();
  if (uploaderFilter) {
    const uploaderCandidate =
      (record as Record<string, unknown>).uploader ??
      (record as Record<string, unknown>).submitter ??
      record.creator;
    const uploaderValues = Array.isArray(uploaderCandidate)
      ? uploaderCandidate
      : uploaderCandidate
      ? [uploaderCandidate]
      : [];
    const normalizedUploaders = uploaderValues
      .map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : ""))
      .filter((entry) => entry.length > 0);
    if (!normalizedUploaders.some((value) => value.includes(uploaderFilter))) {
      return false;
    }
  }

  return true;
}
