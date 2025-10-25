import { describe, expect, it } from "vitest";

import { annotateRecord } from "../nsfwFilter";

describe("NSFW keyword detection", () => {
  it("does not flag safe words containing substrings like 'cum' or 'anal'", () => {
    const safeRecord = annotateRecord({
      title: "Apollo 11 Mission Reports",
      description: "NASA mission reports, technical documents, and debriefings chronicling the Apollo 11 lunar landing.",
    });

    expect(safeRecord.nsfw).toBe(false);
    expect(safeRecord.nsfwLevel).toBeUndefined();
    expect(safeRecord.nsfwMatches ?? []).toEqual([]);
  });

  it("keeps scientific terms with 'analysis' unflagged", () => {
    const scientificRecord = annotateRecord({
      title: "Climate Data Rescue",
      description: "Datasets digitized for long-term climate analysis and reconstruction studies.",
    });

    expect(scientificRecord.nsfw).toBe(false);
    expect(scientificRecord.nsfwMatches ?? []).toEqual([]);
  });

  it("flags explicit keywords such as 'cumshot'", () => {
    const explicitRecord = annotateRecord({
      title: "Example",
      description: "Compilation of classic cumshot scenes.",
    });

    expect(explicitRecord.nsfw).toBe(true);
    expect(explicitRecord.nsfwLevel).toBe("explicit");
    expect(explicitRecord.nsfwMatches).toContain("cum");
  });

  it("flags explicit phrases like 'anal sex'", () => {
    const explicitRecord = annotateRecord({
      title: "Guide",
      description: "Educational material about safe anal sex practices.",
    });

    expect(explicitRecord.nsfw).toBe(true);
    expect(explicitRecord.nsfwMatches).toContain("anal");
  });
});
