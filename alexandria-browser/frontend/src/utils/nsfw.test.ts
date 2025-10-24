import { describe, expect, it } from "vitest";

import type { ArchiveSearchDoc } from "../types";
import { annotateDocs, applyNSFWModeToDocs, countHiddenByMode, shouldIncludeDoc } from "./nsfw";
import { getNSFWMode } from "./nsfwMode";

const SAMPLE_DOCS: ArchiveSearchDoc[] = [
  {
    identifier: "safe-doc",
    title: "Completely Safe",
  },
  {
    identifier: "mild-doc",
    title: "Suggestive Artwork",
    nsfw: true,
    nsfwLevel: "mild",
  },
  {
    identifier: "explicit-doc",
    title: "Explicit Archive Entry",
    nsfw: true,
    nsfwLevel: "explicit",
  },
];

describe("NSFW filtering helpers", () => {
  it("filters documents according to the selected mode", () => {
    const safeDocs = applyNSFWModeToDocs(SAMPLE_DOCS, "safe");
    const moderateDocs = applyNSFWModeToDocs(SAMPLE_DOCS, "moderate");
    const nsfwOnlyDocs = applyNSFWModeToDocs(SAMPLE_DOCS, "nsfw-only");
    const unrestrictedDocs = applyNSFWModeToDocs(SAMPLE_DOCS, "unrestricted");

    expect(safeDocs.map((doc) => doc.identifier)).toEqual(["safe-doc"]);
    expect(moderateDocs.map((doc) => doc.identifier)).toEqual(["safe-doc", "mild-doc"]);
    expect(nsfwOnlyDocs.map((doc) => doc.identifier)).toEqual(["mild-doc", "explicit-doc"]);
    expect(unrestrictedDocs.map((doc) => doc.identifier)).toEqual(["safe-doc", "mild-doc", "explicit-doc"]);
  });

  it("reports hidden counts for safe and moderate modes only", () => {
    expect(countHiddenByMode(SAMPLE_DOCS, "safe")).toBe(2);
    expect(countHiddenByMode(SAMPLE_DOCS, "moderate")).toBe(1);
    expect(countHiddenByMode(SAMPLE_DOCS, "unrestricted")).toBe(0);
    expect(countHiddenByMode(SAMPLE_DOCS, "nsfw-only")).toBe(0);
  });

  it("evaluates individual documents against the active mode", () => {
    const explicitDoc = SAMPLE_DOCS[2];
    const mildDoc = SAMPLE_DOCS[1];
    const safeDoc = SAMPLE_DOCS[0];

    expect(shouldIncludeDoc(explicitDoc, "safe")).toBe(false);
    expect(shouldIncludeDoc(explicitDoc, "moderate")).toBe(false);
    expect(shouldIncludeDoc(explicitDoc, "unrestricted")).toBe(true);
    expect(shouldIncludeDoc(explicitDoc, "nsfw-only")).toBe(true);

    expect(shouldIncludeDoc(mildDoc, "moderate")).toBe(true);
    expect(shouldIncludeDoc(mildDoc, "nsfw-only")).toBe(true);
    expect(shouldIncludeDoc(safeDoc, "nsfw-only")).toBe(false);
  });

  it("maps stored NSFW filter modes to user-facing labels", () => {
    expect(getNSFWMode("safe")).toBe("safe");
    expect(getNSFWMode("moderate")).toBe("moderate");
    expect(getNSFWMode("unrestricted")).toBe("unrestricted");
    expect(getNSFWMode("nsfw-only")).toBe("nsfw-only");
  });

  it("avoids false positives when annotating safe documents", () => {
    const [doc] = annotateDocs([
      {
        identifier: "apollo11",
        title: "Apollo 11 Mission Reports",
        description:
          "NASA mission reports, technical documents, and debriefings chronicling the Apollo 11 lunar landing.",
      },
    ]);

    expect(doc.nsfw ?? false).toBe(false);
    expect(doc.nsfwMatches ?? []).toEqual([]);
  });

  it("identifies explicit language while keeping scientific terms clear", () => {
    const docs = annotateDocs([
      {
        identifier: "climate-analysis",
        title: "Climate Data Rescue",
        description: "Datasets digitized for long-term climate analysis and reconstruction studies.",
      },
      {
        identifier: "explicit",
        title: "Example",
        description: "Compilation of classic cumshot scenes with explicit commentary.",
      },
    ]);

    expect(docs[0].nsfw ?? false).toBe(false);
    expect(docs[0].nsfwMatches ?? []).toEqual([]);
    expect(docs[1].nsfw).toBe(true);
    expect(docs[1].nsfwMatches ?? []).toContain("cum");
  });
});

