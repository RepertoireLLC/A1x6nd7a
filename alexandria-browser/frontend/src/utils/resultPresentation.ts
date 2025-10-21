import type { ArchiveSearchDoc, LinkStatus } from "../types";

export const STATUS_LABELS: Record<LinkStatus, string> = {
  online: "🟢 Online",
  "archived-only": "🟡 Archived only",
  offline: "🔴 Offline",
  checking: "Checking availability…"
};

export const STATUS_ARIA_LABELS: Record<LinkStatus, string> = {
  online: "Online",
  "archived-only": "Archived only",
  offline: "Offline",
  checking: "Checking availability"
};

export function resolveDocLinks(doc: ArchiveSearchDoc) {
  const fallbackArchiveUrl = `https://archive.org/details/${encodeURIComponent(doc.identifier)}`;
  const archiveUrl = doc.archive_url ?? doc.links?.archive ?? fallbackArchiveUrl;
  const waybackUrl = doc.wayback_url ?? doc.links?.wayback ?? `https://web.archive.org/web/*/${archiveUrl}`;
  const rawOriginal = doc.original_url ?? doc.links?.original ?? null;
  const originalUrl = rawOriginal && rawOriginal !== archiveUrl ? rawOriginal : null;

  return { archiveUrl, waybackUrl, originalUrl };
}

export function getImagePreviewUrl(doc: ArchiveSearchDoc) {
  if (doc.thumbnail && doc.thumbnail.trim().length > 0) {
    return doc.thumbnail;
  }
  return `https://archive.org/services/img/${encodeURIComponent(doc.identifier)}`;
}

export function formatDisplayUrl(url: string) {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/\/$/, "");
    return pathname ? `${parsed.host}${pathname}` : parsed.host;
  } catch (error) {
    return url;
  }
}
