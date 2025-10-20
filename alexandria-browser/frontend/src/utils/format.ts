import type { ArchiveSearchDoc } from "../types";

/**
 * Collapse a description field that may be a string or string array.
 */
export function getDescription(description?: string | string[]) {
  if (!description) {
    return "";
  }
  return Array.isArray(description) ? description.join(" ") : description;
}

/**
 * Determine a human readable date or year for a document.
 */
export function getYearOrDate(doc: ArchiveSearchDoc) {
  if (doc.year) {
    return doc.year;
  }
  if (doc.date) {
    return doc.date;
  }
  if (doc.publicdate) {
    return doc.publicdate.split("T")[0];
  }
  return "Unknown";
}

/**
 * Provide an emoji icon for the media type.
 */
export function mediaIcon(mediatype?: string) {
  if (!mediatype) return "🗂️";
  const normalized = mediatype.toLowerCase();
  switch (normalized) {
    case "texts":
      return "📚";
    case "audio":
    case "etree":
      return "🎧";
    case "movies":
    case "video":
      return "🎬";
    case "software":
      return "💾";
    case "image":
    case "images":
      return "🖼️";
    case "data":
      return "📊";
    default:
      return "🗂️";
  }
}
