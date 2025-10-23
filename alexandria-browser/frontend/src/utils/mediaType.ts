const MEDIA_TYPE_ALIASES: Record<string, string> = {
  texts: "texts",
  text: "texts",
  book: "texts",
  books: "texts",
  literature: "texts",
  audio: "audio",
  sound: "audio",
  music: "audio",
  spokenword: "audio",
  movies: "movies",
  movie: "movies",
  video: "movies",
  videos: "movies",
  film: "movies",
  films: "movies",
  image: "image",
  images: "image",
  photo: "image",
  photos: "image",
  picture: "image",
  pictures: "image",
  software: "software",
  program: "software",
  programs: "software",
  app: "software",
  apps: "software",
  web: "web",
  website: "web",
  websites: "web",
  html: "web",
  data: "data",
  dataset: "data",
  datasets: "data",
  statistics: "data",
  stats: "data",
  collection: "collection",
  collections: "collection",
  etree: "etree",
  tvnews: "tvnews",
};

const MEDIA_TYPE_KEYS = ["mediatype", "mediaType", "media_type", "type"] as const;

type MediaTypeKey = (typeof MEDIA_TYPE_KEYS)[number];

export function normalizeMediaTypeValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    return MEDIA_TYPE_ALIASES[normalized] ?? normalized;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const normalized = normalizeMediaTypeValue(entry);
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}

export function normalizeMediaTypeFilter(value: string): string | null {
  const normalized = normalizeMediaTypeValue(value);
  if (!normalized || normalized === "all") {
    return null;
  }
  return normalized;
}

export function extractMediaType(record: Record<string, unknown> | null | undefined): string | null {
  if (!record) {
    return null;
  }

  for (const key of MEDIA_TYPE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      const value = (record as Record<MediaTypeKey, unknown>)[key];
      const normalized = normalizeMediaTypeValue(value);
      if (normalized) {
        return normalized;
      }
    }
  }

  return null;
}
