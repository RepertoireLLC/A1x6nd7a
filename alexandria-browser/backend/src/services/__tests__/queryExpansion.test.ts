import { describe, expect, it } from "vitest";

import {
  buildHybridSearchExpression,
  suggestAlternativeQueries
} from "../queryExpansion";

describe("queryExpansion", () => {
  it("suggests unique alternate queries using synonyms and wildcards", () => {
    const suggestions = suggestAlternativeQueries("book history");

    expect(suggestions.length).toBeLessThanOrEqual(5);
    expect(suggestions.length).toBeGreaterThanOrEqual(2);
    expect(new Set(suggestions).size).toBe(suggestions.length);
    expect(suggestions).toContain("books history");
    expect(suggestions.some((entry) => entry.includes("historical"))).toBe(true);
  });

  it("builds hybrid expressions that include fuzzy, wildcard, and synonym clauses", () => {
    const expression = buildHybridSearchExpression("climate data", true);

    expect(expression).toContain("(climate data)");
    expect(expression).toContain("climate~");
    expect(expression).toContain("data*");
    expect(expression).toContain("\"weather\"");
  });
});
