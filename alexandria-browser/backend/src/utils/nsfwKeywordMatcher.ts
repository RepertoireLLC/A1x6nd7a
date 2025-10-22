const ANAL_SAFE_SUFFIXES = [
  "ysis",
  "yses",
  "yse",
  "yzed",
  "yzes",
  "yzing",
  "yzer",
  "yzers",
  "ytic",
  "ytics",
  "ytical",
  "ytically",
  "yst",
  "ysts",
  "ogue",
  "ogues",
  "ogy",
  "ogies",
  "ogic",
  "ogical",
  "ogist",
  "ogists",
  "ogous",
  "ogy",
  "emma",
  "emmas",
  "ects",
  "ecta",
  "ectic",
  "gesic",
  "gesics",
  "gesia",
  "gesias",
  "gesis",
  "geses",
  "ges",
  "getic",
  "getics",
  "glyph",
  "glyphs"
];

const ANAL_EXPLICIT_SUFFIXES = [
  "sex",
  "sexual",
  "sexed",
  "sexes",
  "sexing",
  "play",
  "plays",
  "player",
  "players",
  "plug",
  "plugs",
  "porn",
  "porno",
  "porns",
  "pornography",
  "fuck",
  "fucks",
  "fucking",
  "fucked",
  "cream",
  "creampie",
  "creampies",
  "gape",
  "gapes",
  "gaping",
  "toy",
  "toys",
  "vid",
  "video",
  "videos",
  "xxx",
  "queen",
  "queens",
  "whore",
  "whores",
  "slut",
  "sluts",
  "mania",
  "maniac",
  "maniacs",
  "bead",
  "beads",
  "beaded",
  "beading",
  "fist",
  "fists",
  "fisting",
  "train",
  "trainer",
  "trainers",
  "training",
  "penetration",
  "penetrations",
  "penetrate",
  "penetrated",
  "penetrating",
  "penetrative",
  "lick",
  "licks",
  "licking",
  "job",
  "jobs"
];

const ANAL_EXPLICIT_NEXT = new Set(
  [
    "sex",
    "sexual",
    "sexually",
    "porn",
    "porno",
    "pornography",
    "video",
    "videos",
    "vid",
    "vids",
    "xxx",
    "content",
    "scene",
    "scenes",
    "clip",
    "clips",
    "toy",
    "toys",
    "plug",
    "plugs",
    "play",
    "player",
    "players",
    "fetish",
    "material",
    "photo",
    "photos",
    "picture",
    "pictures",
    "image",
    "images",
    "job",
    "jobs",
    "creampie",
    "creampies",
    "gape",
    "gaping",
    "dp",
    "penetration",
    "penetrations",
    "penetrate",
    "penetrating",
    "penetrative",
    "fist",
    "fisting",
    "stories",
    "story",
    "act",
    "acts",
    "action",
    "actions",
    "collection",
    "collections"
  ]
);

const CUM_SAFE_PREFIXES = ["cumul"];

const CUM_SAFE_TOKENS = new Set([
  "cumin",
  "cummings",
  "cummer",
  "cummerbund",
  "cummerbunds"
]);

const CUM_SAFE_SUFFIXES = [
  "ulate",
  "ulated",
  "ulates",
  "ulating",
  "ulation",
  "ulations",
  "ulative",
  "ulatively",
  "ulator",
  "ulators",
  "ulatory",
  "ulus",
  "ulous",
  "ulum",
  "ulums",
  "ulonimbus",
  "ulus",
  "ulent",
  "ulence",
  "ulene",
  "ulic",
  "ules",
  "ulus",
  "ulite",
  "ulousness",
  "ulousnesses",
  "ber",
  "bers",
  "bersome",
  "berland",
  "berlands",
  "berbatch"
];

const CUM_EXPLICIT_SUFFIXES = [
  "shot",
  "shots",
  "slut",
  "sluts",
  "dump",
  "dumps",
  "dumped",
  "dumping",
  "dumpster",
  "tribute",
  "tributes",
  "drip",
  "drips",
  "dripping",
  "dripped",
  "soak",
  "soaks",
  "soaked",
  "soaking",
  "load",
  "loads",
  "loading",
  "loader",
  "loaders",
  "play",
  "plays",
  "playing",
  "stain",
  "stains",
  "stained",
  "bath",
  "baths",
  "bucket",
  "buckets",
  "blast",
  "blasts",
  "stream",
  "streams",
  "streaming",
  "swap",
  "swaps",
  "swapping",
  "face",
  "facial",
  "guzzle",
  "guzzler",
  "guzzlers",
  "guzzling",
  "cover",
  "covered",
  "covering",
  "coat",
  "coating",
  "paint",
  "painted",
  "painting",
  "spray",
  "sprays",
  "spraying",
  "bucket",
  "buckets",
  "dumpster"
];

const CUM_SAFE_NEXT = new Set(["laude"]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function matchAnalToken(token: string, nextToken: string | undefined): boolean {
  if (token === "anal") {
    if (nextToken && ANAL_EXPLICIT_NEXT.has(nextToken)) {
      return true;
    }
    return !nextToken;
  }

  if (!token.startsWith("anal")) {
    return false;
  }

  const remainder = token.slice(4);
  if (remainder.length === 0) {
    return true;
  }

  if (ANAL_EXPLICIT_SUFFIXES.some((suffix) => remainder.startsWith(suffix))) {
    return true;
  }

  if (ANAL_SAFE_SUFFIXES.some((suffix) => remainder.startsWith(suffix))) {
    return false;
  }

  if (/^\d/.test(remainder)) {
    return true;
  }

  return remainder.length <= 2;
}

function matchCumToken(token: string, nextToken: string | undefined): boolean {
  if (token === "cum") {
    if (nextToken && CUM_SAFE_NEXT.has(nextToken)) {
      return false;
    }
    return true;
  }

  if (!token.startsWith("cum")) {
    return false;
  }

  if (CUM_SAFE_PREFIXES.some((prefix) => token.startsWith(prefix))) {
    return false;
  }

  if (CUM_SAFE_TOKENS.has(token)) {
    return false;
  }

  const remainder = token.slice(3);
  if (remainder.length === 0) {
    return true;
  }

  if (CUM_EXPLICIT_SUFFIXES.some((suffix) => remainder.startsWith(suffix))) {
    return true;
  }

  if (CUM_SAFE_SUFFIXES.some((suffix) => remainder.startsWith(suffix))) {
    return false;
  }

  if (/^ming/.test(remainder)) {
    return token !== "cummings";
  }

  if (/^\d/.test(remainder)) {
    return true;
  }

  return remainder.length <= 2;
}

export function keywordMatches(text: string, keyword: string): boolean {
  if (!text.trim()) {
    return false;
  }

  const normalized = text.toLowerCase();
  const tokens = tokenize(normalized);
  const target = keyword.toLowerCase();

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const nextToken = tokens[index + 1];

    if (target === "anal") {
      if (matchAnalToken(token, nextToken)) {
        return true;
      }
      continue;
    }

    if (target === "cum") {
      if (matchCumToken(token, nextToken)) {
        return true;
      }
      continue;
    }

    if (token === target) {
      return true;
    }

    if (token.startsWith(target)) {
      return true;
    }
  }

  if (target === "anal" || target === "cum") {
    return false;
  }

  return normalized.includes(target);
}

export function detectKeywordMatches(text: string, keywords: readonly string[]): string[] {
  if (!keywords.length || !text.trim()) {
    return [];
  }

  const matches: string[] = [];
  for (const keyword of keywords) {
    if (keywordMatches(text, keyword)) {
      matches.push(keyword);
    }
  }
  return matches;
}
