const MEDIA_TYPE_KEYWORDS: Array<{ type: string; keywords: string[] }> = [
  {
    type: "texts",
    keywords: [
      "book",
      "books",
      "text",
      "texts",
      "manuscript",
      "manuscripts",
      "document",
      "documents",
      "paper",
      "papers",
      "treatise",
      "journal",
      "journals",
      "diary",
      "diaries",
      "magazine",
      "magazines",
      "newspaper",
      "newspapers",
      "transcript",
      "transcripts",
      "letter",
      "letters",
    ],
  },
  {
    type: "image",
    keywords: [
      "photo",
      "photos",
      "photograph",
      "photographs",
      "image",
      "images",
      "picture",
      "pictures",
      "illustration",
      "illustrations",
      "engraving",
      "engravings",
      "map",
      "maps",
      "atlas",
      "atlases",
      "chart",
      "charts",
    ],
  },
  {
    type: "movies",
    keywords: [
      "film",
      "films",
      "movie",
      "movies",
      "video",
      "videos",
      "newsreel",
      "newsreels",
      "footage",
      "documentary",
      "documentaries",
      "tv",
      "television",
    ],
  },
  {
    type: "audio",
    keywords: [
      "audio",
      "recording",
      "recordings",
      "sound",
      "sounds",
      "audiobook",
      "audiobooks",
      "spoken word",
      "oral history",
      "oral histories",
      "interview",
      "interviews",
      "radio",
      "podcast",
      "podcasts",
    ],
  },
  {
    type: "software",
    keywords: [
      "software",
      "program",
      "programs",
      "application",
      "applications",
      "app",
      "apps",
      "game",
      "games",
      "rom",
      "roms",
    ],
  },
  {
    type: "data",
    keywords: ["dataset", "datasets", "data", "statistics", "statistical", "census", "tables", "table"],
  },
  {
    type: "web",
    keywords: [
      "website",
      "websites",
      "web page",
      "web pages",
      "webpage",
      "webpages",
      "blog",
      "blogs",
      "site",
      "sites",
      "snapshot",
      "snapshots",
    ],
  },
];

const LANGUAGE_KEYWORDS = [
  "english",
  "french",
  "spanish",
  "german",
  "italian",
  "latin",
  "greek",
  "russian",
  "chinese",
  "japanese",
  "arabic",
  "hebrew",
  "portuguese",
  "dutch",
  "polish",
  "swedish",
  "norwegian",
  "danish",
  "finnish",
  "icelandic",
  "czech",
  "hungarian",
  "turkish",
];

const TRUST_HIGH_KEYWORDS = [
  "primary source",
  "primary sources",
  "official record",
  "official records",
  "government record",
  "government records",
  "authenticated",
  "verified",
  "scholarly",
  "peer reviewed",
  "peer-reviewed",
  "academic",
  "historical accuracy",
  "authoritative",
];

const TRUST_LOW_KEYWORDS = ["fan made", "fan-made", "community upload", "community uploads"];

const COLLECTION_KEYWORDS: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /library of congress/i, value: "library_of_congress" },
  { pattern: /smithsonian/i, value: "smithsonian" },
  { pattern: /prelinger/i, value: "prelinger" },
  { pattern: /gutenberg/i, value: "gutenberg" },
  { pattern: /naropa/i, value: "naropa" },
  { pattern: /wellcome library/i, value: "wellcomelibrary" },
  { pattern: /national archives/i, value: "usnationalarchives" },
  { pattern: /american libraries/i, value: "americanlibraries" },
];

const SUBJECT_KEYWORDS: Array<{ pattern: RegExp; value: string }> = [
  { pattern: /\bmaps?\b/i, value: "maps" },
  { pattern: /\batlases\b/i, value: "maps" },
  { pattern: /\bcartography\b/i, value: "maps" },
  { pattern: /\bphotograph/i, value: "photographs" },
  { pattern: /\bnewspaper/i, value: "newspapers" },
];

const LEADING_PHRASES = [
  /^(?:please\s+)?(?:show|find|search|locate|pull up)\s+(?:me\s+)?/i,
  /^(?:can|could|would)\s+you\s+(?:please\s+)?(?:show|find|locate|search\s+for)\s+/i,
  /^i\s+(?:am\s+)?(?:looking|searching)\s+for\s+/i,
  /^i\s+(?:need|want|would\s+like)\s+/i,
];

const FILLER_PATTERNS = [/\bplease\b/gi, /\bthank you\b/gi];

export interface QueryFilters {
  mediaType?: string;
  yearFrom?: string;
  yearTo?: string;
  language?: string;
  sourceTrust?: string;
  availability?: string;
  collection?: string;
  uploader?: string;
  subject?: string;
}

export interface QueryInterpretation {
  query: string;
  filters: QueryFilters;
}

function clampYear(value: number): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 9999) {
    return 9999;
  }
  return Math.trunc(value);
}

function stripPattern(
  text: string,
  pattern: RegExp,
  onMatch: (match: RegExpExecArray) => void,
): string {
  let working = text;
  let match: RegExpExecArray | null;
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const globalPattern = new RegExp(pattern.source, flags);

  while ((match = globalPattern.exec(working)) !== null) {
    onMatch(match);
    working = `${working.slice(0, match.index)} ${working.slice(match.index + match[0].length)}`;
    globalPattern.lastIndex = 0;
  }

  return working;
}

function detectMediaType(text: string): string | null {
  const lower = text.toLowerCase();
  const scores = new Map<string, number>();

  for (const entry of MEDIA_TYPE_KEYWORDS) {
    for (const keyword of entry.keywords) {
      if (lower.includes(keyword)) {
        scores.set(entry.type, (scores.get(entry.type) ?? 0) + 1);
      }
    }
  }

  let selected: string | null = null;
  let highest = 0;

  for (const [type, score] of scores.entries()) {
    if (score > highest) {
      highest = score;
      selected = type;
    }
  }

  return selected;
}

function detectLanguage(text: string): string | null {
  const lower = text.toLowerCase();
  for (const keyword of LANGUAGE_KEYWORDS) {
    const pattern = new RegExp(`\\b${keyword}\\b`, "i");
    if (pattern.test(lower)) {
      return keyword;
    }
  }
  return null;
}

function detectSourceTrust(text: string): string | null {
  const lower = text.toLowerCase();
  for (const keyword of TRUST_HIGH_KEYWORDS) {
    if (lower.includes(keyword)) {
      return "high";
    }
  }
  for (const keyword of TRUST_LOW_KEYWORDS) {
    if (lower.includes(keyword)) {
      return "low";
    }
  }
  return null;
}

export function interpretSearchQuery(input: string): QueryInterpretation {
  if (typeof input !== "string") {
    return { query: "", filters: {} };
  }

  const original = input.trim();
  if (!original) {
    return { query: "", filters: {} };
  }

  let working = original;
  let yearFrom: number | null = null;
  let yearTo: number | null = null;

  const applyYearFrom = (value: number) => {
    const safe = clampYear(value);
    if (safe === null) {
      return;
    }
    yearFrom = yearFrom === null ? safe : Math.max(yearFrom, safe);
  };

  const applyYearTo = (value: number) => {
    const safe = clampYear(value);
    if (safe === null) {
      return;
    }
    yearTo = yearTo === null ? safe : Math.min(yearTo, safe);
  };

  working = stripPattern(working, /(?:between|from)\s+(\d{3,4})\s+(?:and|to)\s+(\d{3,4})/i, (match) => {
    const first = Number.parseInt(match[1], 10);
    const second = Number.parseInt(match[2], 10);
    if (Number.isFinite(first) && Number.isFinite(second)) {
      const min = Math.min(first, second);
      const max = Math.max(first, second);
      applyYearFrom(min);
      applyYearTo(max);
    }
  });

  working = stripPattern(working, /(?:before|earlier than|prior to)\s+(?:the\s+year\s+)?(\d{3,4})/i, (match) => {
    const value = Number.parseInt(match[1], 10);
    if (Number.isFinite(value)) {
      applyYearTo(value - 1);
    }
  });

  working = stripPattern(working, /(?:after|later than)\s+(?:the\s+year\s+)?(\d{3,4})/i, (match) => {
    const value = Number.parseInt(match[1], 10);
    if (Number.isFinite(value)) {
      applyYearFrom(value + 1);
    }
  });

  working = stripPattern(working, /since\s+(?:the\s+year\s+)?(\d{3,4})/i, (match) => {
    const value = Number.parseInt(match[1], 10);
    if (Number.isFinite(value)) {
      applyYearFrom(value);
    }
  });

  working = stripPattern(working, /(\d{4})s\b/i, (match) => {
    const base = Number.parseInt(match[1], 10);
    if (Number.isFinite(base)) {
      const raw = match[0].toLowerCase();
      const isCentury = raw.endsWith("00s");
      const end = isCentury ? base + 99 : base + 9;
      applyYearFrom(base);
      applyYearTo(end);
    }
  });

  working = stripPattern(working, /(\d{1,2})(?:st|nd|rd|th)\s+century/i, (match) => {
    const value = Number.parseInt(match[1], 10);
    if (Number.isFinite(value) && value > 0) {
      const start = (value - 1) * 100;
      applyYearFrom(start);
      applyYearTo(start + 99);
    }
  });

  working = stripPattern(working, /(?:circa|c\.?|around|approximately)\s+(\d{3,4})/i, (match) => {
    const value = Number.parseInt(match[1], 10);
    if (Number.isFinite(value)) {
      applyYearFrom(value - 5);
      applyYearTo(value + 5);
    }
  });

  const mediaType = detectMediaType(original);
  const language = detectLanguage(original);
  const sourceTrust = detectSourceTrust(original);

  const collections = new Set<string>();
  for (const entry of COLLECTION_KEYWORDS) {
    if (entry.pattern.test(original)) {
      collections.add(entry.value);
    }
  }

  const subjects = new Set<string>();
  for (const entry of SUBJECT_KEYWORDS) {
    if (entry.pattern.test(original)) {
      subjects.add(entry.value);
    }
  }

  for (const pattern of LEADING_PHRASES) {
    working = working.replace(pattern, "");
  }

  for (const pattern of FILLER_PATTERNS) {
    working = working.replace(pattern, " ");
  }

  working = working.replace(/\s+/g, " ").trim();

  if (!working) {
    working = original;
  }

  const filters: QueryFilters = {};

  if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) {
    const swap = yearFrom;
    yearFrom = yearTo;
    yearTo = swap;
  }

  if (yearFrom !== null) {
    filters.yearFrom = String(yearFrom);
  }
  if (yearTo !== null) {
    filters.yearTo = String(yearTo);
  }
  if (mediaType) {
    filters.mediaType = mediaType;
  }
  if (language) {
    filters.language = language;
  }
  if (sourceTrust) {
    filters.sourceTrust = sourceTrust;
  }
  if (collections.size > 0) {
    filters.collection = Array.from(collections).join(",");
  }
  if (subjects.size > 0) {
    filters.subject = Array.from(subjects).join(",");
  }

  return { query: working, filters };
}

export default interpretSearchQuery;
