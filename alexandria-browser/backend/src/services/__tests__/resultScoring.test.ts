import { describe, expect, it } from "vitest";

import { scoreArchiveRecord } from "../resultScoring";

describe("resultScoring", () => {
  it("computes a perfect score for fully matching high-quality documents", () => {
    const record: Record<string, unknown> = {
      title: "Climate Change Research Archive",
      description: "Comprehensive report on climate change findings.",
      identifier: "climate_change_report",
      creator: "National Climate Agency",
      collection: ["smithsonian"],
      year: "2010",
      thumbnail: "https://example.com/thumb.jpg",
      original_url: "https://example.com/report",
      downloads: 1000000,
    };

    const analysis = scoreArchiveRecord(record, "climate change research");

    expect(analysis.breakdown.authenticity).toBeGreaterThan(0.6);
    expect(analysis.breakdown.relevance).toBeGreaterThan(0.7);
    expect(analysis.breakdown.combinedScore).toBeGreaterThan(0.65);
    expect(analysis.availability).toBe("online");
    expect(analysis.trustLevel).toBe("high");
  });

  it("assigns lower scores when only partial matches are present", () => {
    const record: Record<string, unknown> = {
      title: "Weather observations in the arctic",
      description: "Historic log of arctic weather stations.",
      identifier: "arctic_weather_log",
      downloads: 25,
    };

    const analysis = scoreArchiveRecord(record, "climate change research");

    expect(analysis.breakdown.relevance).toBeLessThan(0.6);
    expect(analysis.breakdown.combinedScore).toBeLessThan(0.6);
    expect(analysis.trustLevel).toBe("low");
  });
});
