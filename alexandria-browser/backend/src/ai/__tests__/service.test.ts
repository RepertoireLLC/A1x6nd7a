import { describe, expect, it } from "vitest";

import { buildHeuristicRefinement } from "../service";

describe("buildHeuristicRefinement", () => {
  it("returns null when there is no meaningful expansion", () => {
    expect(buildHeuristicRefinement("hi")).toBeNull();
  });

  it("adds fuzzy and wildcard clauses for multi-term queries", () => {
    const refined = buildHeuristicRefinement("apollo moon landing footage");
    expect(refined).toBeTruthy();
    expect(refined).toContain("apollo~");
    expect(refined).toContain("apollo*");
  });

  it("includes synonym-based alternatives when available", () => {
    const refined = buildHeuristicRefinement("historic video");
    expect(refined).toBeTruthy();
    expect(refined).toContain('"film"');
    expect(refined).toContain('"movies"');
  });
});
