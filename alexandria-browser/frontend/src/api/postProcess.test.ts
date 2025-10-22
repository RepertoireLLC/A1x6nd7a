import { describe, expect, it } from "vitest";

import type { ArchiveSearchDoc, ArchiveSearchResponse, SearchFilters } from "../types";
import { postProcessDirectSearchPayload } from "./postProcess";

describe("postProcessDirectSearchPayload", () => {
  const baseFilters: SearchFilters = {
    mediaType: "all",
    yearFrom: "",
    yearTo: "",
    language: "english",
    sourceTrust: "high",
    availability: "online",
    nsfwMode: "safe",
  };

  it("annotates documents with scores and filters them according to the UI selections", () => {
    const matchingDoc: ArchiveSearchDoc = {
      identifier: "climate-report",
      title: "Climate Change Research",
      description: "Detailed analysis of climate change research findings.",
      creator: "National Climate Agency",
      downloads: 25000,
      original_url: "https://example.com/report",
      collection: ["smithsonian"],
      language: ["English"],
    };

    const filteredDoc: ArchiveSearchDoc = {
      identifier: "nsfw-entry",
      title: "Archived material",
      language: ["English"],
      nsfw: true,
    };

    const payload: ArchiveSearchResponse = {
      response: {
        docs: [matchingDoc, filteredDoc],
        numFound: 2,
      },
    };

    const result = postProcessDirectSearchPayload(payload, "climate change research", baseFilters);

    expect(result.response?.docs).toHaveLength(1);
    const doc = result.response?.docs?.[0];
    expect(doc?.identifier).toBe("climate-report");
    expect(doc?.score).toBeGreaterThan(0.8);
    expect(doc?.score_breakdown?.combinedScore).toBeGreaterThan(0.8);
    expect(doc?.availability).toBe("online");
    expect(doc?.source_trust).toBe("high");
    expect(typeof doc?.language).toBe("string");

    expect(result.original_numFound).toBe(2);
    expect(result.filtered_count).toBe(1);
  });

  it("retains documents when filters are relaxed", () => {
    const doc: ArchiveSearchDoc = {
      identifier: "archived-item",
      title: "Historic archive",
      downloads: 5,
      language: ["Spanish"],
      links: { archive: "https://archive.org/details/archived-item", wayback: "https://web.archive.org" },
    };

    const payload: ArchiveSearchResponse = {
      response: {
        docs: [doc],
        numFound: 1,
      },
    };

    const relaxedFilters: SearchFilters = {
      ...baseFilters,
      language: "",
      sourceTrust: "any",
      availability: "archived-only",
      nsfwMode: "off",
    };

    const result = postProcessDirectSearchPayload(payload, "historic archive", relaxedFilters);

    expect(result.response?.docs).toHaveLength(1);
    expect(result.response?.docs?.[0]?.availability).toBe("archived-only");
  });
});
