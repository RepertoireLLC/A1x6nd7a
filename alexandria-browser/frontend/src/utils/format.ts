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

export function formatWaybackTimestamp(timestamp: string): string {
  const digits = timestamp.replace(/[^\d]/g, "");
  if (digits.length >= 14) {
    const year = digits.slice(0, 4);
    const month = digits.slice(4, 6);
    const day = digits.slice(6, 8);
    const hour = digits.slice(8, 10);
    const minute = digits.slice(10, 12);
    const second = digits.slice(12, 14);
    return `${year}-${month}-${day} ${hour}:${minute}:${second} UTC`;
  }

  if (digits.length >= 8) {
    const year = digits.slice(0, 4);
    const month = digits.slice(4, 6);
    const day = digits.slice(6, 8);
    return `${year}-${month}-${day}`;
  }

  return timestamp;
}

export function formatFileSize(bytes?: number | null): string | null {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) {
    return null;
  }

  const absolute = Math.abs(bytes);
  if (absolute < 1024) {
    return `${absolute} B`;
  }

  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = absolute / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const rounded = value >= 10 ? value.toFixed(0) : value.toFixed(1);
  return `${rounded} ${units[unitIndex]}`;
}
