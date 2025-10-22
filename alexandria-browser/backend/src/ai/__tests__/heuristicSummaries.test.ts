import { describe, expect, it } from "vitest";

import { buildHeuristicAISummary, type HeuristicDocSummary } from "../heuristicSummaries";

const SAMPLE_DOCS: HeuristicDocSummary[] = [
  {
    identifier: "apollo11-mission-reports",
    title: "Apollo 11 Mission Reports",
    description: "NASA mission reports, technical documents, and debriefings chronicling the Apollo 11 lunar landing.",
    mediatype: "texts",
    year: "1969",
    creator: "NASA",
    language: "english",
  },
  {
    identifier: "apollo11-video",
    title: "Apollo 11 Video Footage",
    description: "Film documenting the Apollo 11 launch and moon landing with mission commentary.",
    mediatype: "movies",
    year: "1969",
    creator: "NASA",
  },
  {
    identifier: "apollo11-audio",
    title: "Apollo 11 Audio Archive",
    description: "Mission control recordings and astronaut communications from the first moon landing.",
    mediatype: "audio",
    year: "1969",
    creator: "NASA",
  },
];

describe("buildHeuristicAISummary", () => {
  it("returns a multi-paragraph summary with keyword suggestions", () => {
    const result = buildHeuristicAISummary("Apollo 11", SAMPLE_DOCS, "safe");

    expect(result).not.toBeNull();
    expect(result?.summary.split("\n\n")).toHaveLength(3);
    expect(result?.summary).toContain("Alexandria heuristics reviewed");
    expect(result?.summary).toContain("Keyword suggestions:");
    expect(result?.notice).toContain("No offline AI response");
  });

  it("honors safe mode by avoiding mild NSFW terms", () => {
    const docs: HeuristicDocSummary[] = [
      {
        identifier: "safe-doc",
        title: "Neutral Entry",
        description: "A guide to classic literature and community history.",
        mediatype: "texts",
      },
    ];

    const result = buildHeuristicAISummary("Classic", docs, "safe");
    expect(result).not.toBeNull();
    expect(result?.summary).not.toMatch(/adult|explicit/i);
  });

  it("focuses on nsfw language when only-nsfw mode is active", () => {
    const docs: HeuristicDocSummary[] = [
      {
        identifier: "nsfw-doc",
        title: "Vintage Cinema Collection",
        description: "A curated catalog of classic adult cinema.",
        mediatype: "movies",
      },
    ];

    const result = buildHeuristicAISummary("classic cinema", docs, "only-nsfw");
    expect(result).not.toBeNull();
    expect(result?.notice).toContain("NSFW");
  });
});
