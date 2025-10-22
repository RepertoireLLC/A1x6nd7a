import { describe, expect, it } from "vitest";

import {
  matchesAdvancedFilters,
  normalizeAvailability,
  normalizeNsfwMode,
  normalizeSourceTrust,
  type ArchiveSearchFiltersInput
} from "../filtering";

describe("filtering", () => {
  const baseRecord: Record<string, unknown> = {
    language: ["English"],
    source_trust: "high",
    availability: "online",
    nsfw: false,
  };

  it("normalizes filter values consistently", () => {
    expect(normalizeAvailability("Online")).toBe("online");
    expect(normalizeAvailability("archive")).toBe("archived-only");
    expect(normalizeSourceTrust("Curated")).toBe("high");
    expect(normalizeSourceTrust("default")).toBe("medium");
    expect(normalizeNsfwMode("only-nsfw")).toBe("only");
    expect(normalizeNsfwMode("unrestricted")).toBe("off");
  });

  it("matches language, trust, availability, and nsfw filters", () => {
    const filters: ArchiveSearchFiltersInput = {
      language: "english",
      sourceTrust: "high",
      availability: "online",
      nsfwMode: "safe",
    };

    expect(matchesAdvancedFilters(baseRecord, filters)).toBe(true);

    expect(
      matchesAdvancedFilters(
        { ...baseRecord, language: ["spanish"] },
        filters
      )
    ).toBe(false);

    expect(
      matchesAdvancedFilters(
        { ...baseRecord, source_trust: "medium" },
        filters
      )
    ).toBe(false);

    expect(
      matchesAdvancedFilters(
        { ...baseRecord, availability: "archived-only" },
        filters
      )
    ).toBe(false);

    expect(
      matchesAdvancedFilters(
        { ...baseRecord, nsfw: true },
        filters
      )
    ).toBe(false);
  });
});
