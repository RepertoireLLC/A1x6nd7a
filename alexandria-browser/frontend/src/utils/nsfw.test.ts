import { describe, expect, it } from "vitest";

import type { ArchiveSearchDoc } from "../types";
import { applyNSFWModeToDocs, countHiddenByMode, shouldIncludeDoc } from "./nsfw";

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
    const onlyDocs = applyNSFWModeToDocs(SAMPLE_DOCS, "only");
    const offDocs = applyNSFWModeToDocs(SAMPLE_DOCS, "off");

    expect(safeDocs.map((doc) => doc.identifier)).toEqual(["safe-doc"]);
    expect(moderateDocs.map((doc) => doc.identifier)).toEqual(["safe-doc", "mild-doc"]);
    expect(onlyDocs.map((doc) => doc.identifier)).toEqual(["mild-doc", "explicit-doc"]);
    expect(offDocs.map((doc) => doc.identifier)).toEqual(["safe-doc", "mild-doc", "explicit-doc"]);
  });

  it("reports hidden counts for safe and moderate modes only", () => {
    expect(countHiddenByMode(SAMPLE_DOCS, "safe")).toBe(2);
    expect(countHiddenByMode(SAMPLE_DOCS, "moderate")).toBe(1);
    expect(countHiddenByMode(SAMPLE_DOCS, "off")).toBe(0);
    expect(countHiddenByMode(SAMPLE_DOCS, "only")).toBe(0);
  });

  it("evaluates individual documents against the active mode", () => {
    const explicitDoc = SAMPLE_DOCS[2];
    const mildDoc = SAMPLE_DOCS[1];
    const safeDoc = SAMPLE_DOCS[0];

    expect(shouldIncludeDoc(explicitDoc, "safe")).toBe(false);
    expect(shouldIncludeDoc(explicitDoc, "moderate")).toBe(false);
    expect(shouldIncludeDoc(explicitDoc, "off")).toBe(true);
    expect(shouldIncludeDoc(explicitDoc, "only")).toBe(true);

    expect(shouldIncludeDoc(mildDoc, "moderate")).toBe(true);
    expect(shouldIncludeDoc(mildDoc, "only")).toBe(true);
    expect(shouldIncludeDoc(safeDoc, "only")).toBe(false);
  });
});

