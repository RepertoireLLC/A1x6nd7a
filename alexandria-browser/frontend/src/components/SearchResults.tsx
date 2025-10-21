import { useMemo } from "react";
import type { ReactNode } from "react";
import type { ArchiveSearchDoc, LinkStatus } from "../types";
import { useSettings } from "../context/SettingsContext";
import { ResultsList } from "./ResultsList";

interface SearchResultsProps {
  results: ArchiveSearchDoc[];
  statuses: Record<string, LinkStatus>;
  isLoading: boolean;
  error: string | null;
  hasSearched: boolean;
  page: number;
  totalPages: number | null;
  totalResults: number | null;
  resultsPerPage: number;
  onPageChange: (direction: "previous" | "next") => void;
  onToggleBookmark: (identifier: string, doc: ArchiveSearchDoc) => void;
  onOpenDetails: (doc: ArchiveSearchDoc) => void;
  bookmarkedIds: Set<string>;
  onSaveSnapshot: (identifier: string, url: string) => void;
  saveMeta: Record<string, { label: string; disabled: boolean; message: string | null; snapshotUrl?: string; tone?: "success" | "error" | "info" }>;
  suggestionNode: ReactNode;
  fallbackNotice?: string | null;
  searchNotice?: string | null;
}

function extractText(content: unknown): string[] {
  if (!content) {
    return [];
  }
  if (typeof content === "string") {
    return [content];
  }
  if (Array.isArray(content)) {
    const entries: string[] = [];
    for (const item of content) {
      if (typeof item === "string") {
        entries.push(item);
      }
    }
    return entries;
  }
  return [];
}

function buildSearchableText(doc: ArchiveSearchDoc): string {
  const values: string[] = [];
  values.push(...extractText(doc.title));
  values.push(...extractText(doc.description));
  values.push(doc.identifier);
  values.push(...extractText(doc.creator));
  values.push(...extractText(doc.collection));

  const extended = doc as Record<string, unknown>;
  values.push(...extractText(extended.subject));
  values.push(...extractText(extended.tags));
  values.push(...extractText(extended.topic));
  values.push(...extractText(extended.keywords));

  return values
    .map((entry) => entry.toString())
    .join(" ")
    .toLowerCase();
}

function markExplicit(doc: ArchiveSearchDoc, keywords: string[]): boolean {
  if (doc.nsfw) {
    return true;
  }

  const haystack = buildSearchableText(doc);
  return keywords.some((keyword) => haystack.includes(keyword));
}

export function SearchResults({
  results,
  statuses,
  isLoading,
  error,
  hasSearched,
  page,
  totalPages,
  totalResults,
  resultsPerPage,
  onPageChange,
  onToggleBookmark,
  onOpenDetails,
  bookmarkedIds,
  onSaveSnapshot,
  saveMeta,
  suggestionNode,
  fallbackNotice,
  searchNotice
}: SearchResultsProps) {
  const { filterNSFW, nsfwKeywords } = useSettings();

  const { displayResults, filteredCount } = useMemo(() => {
    let hidden = 0;
    const flaggedResults = results.map((doc) => {
      const flagged = markExplicit(doc, nsfwKeywords);
      if (flagged && doc.nsfw !== true) {
        return { ...doc, nsfw: true };
      }
      return doc;
    });

    const visible = filterNSFW
      ? flaggedResults.filter((doc) => {
          if (doc.nsfw) {
            hidden += 1;
            return false;
          }
          return true;
        })
      : flaggedResults;

    return { displayResults: visible, filteredCount: hidden };
  }, [results, filterNSFW, nsfwKeywords]);

  const noticeMessages = useMemo(() => {
    const messages: string[] = [];
    if (searchNotice && searchNotice.trim()) {
      messages.push(searchNotice.trim());
    }
    if (fallbackNotice && fallbackNotice.trim()) {
      messages.push(fallbackNotice.trim());
    }
    if (filterNSFW && filteredCount > 0) {
      messages.push(`${filteredCount} result${filteredCount === 1 ? "" : "s"} hidden by NSFW filter.`);
    }
    return messages;
  }, [searchNotice, fallbackNotice, filterNSFW, filteredCount]);

  return (
    <ResultsList
      results={displayResults}
      statuses={statuses}
      filterNSFW={filterNSFW}
      isLoading={isLoading}
      error={error}
      hasSearched={hasSearched}
      page={page}
      totalPages={totalPages}
      totalResults={totalResults}
      resultsPerPage={resultsPerPage}
      onPageChange={onPageChange}
      onToggleBookmark={onToggleBookmark}
      onOpenDetails={onOpenDetails}
      bookmarkedIds={bookmarkedIds}
      onSaveSnapshot={onSaveSnapshot}
      saveMeta={saveMeta}
      suggestionNode={suggestionNode}
      notices={noticeMessages}
    />
  );
}
