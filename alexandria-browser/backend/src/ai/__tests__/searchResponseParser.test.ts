import { describe, expect, it } from "vitest";

import { parseModelSearchResponse } from "../LocalAI";

describe("parseModelSearchResponse", () => {
  it("parses interpretation, keywords, refined query, and collection hint", () => {
    const raw = `Interpreting \"apollo\" as interest in NASA lunar missions.\n\n- \"apollo program timeline\"\n- Moon landing mission logs\n- NASA archival photographs\n\nLook at the Apollo Mission Reports and Lunar Surface Journal collections.`;

    const result = parseModelSearchResponse(raw);
    expect(result).not.toBeNull();
    expect(result?.summary).toBe(raw.trim());
    expect(result?.interpretation).toBe('Interpreting "apollo" as interest in NASA lunar missions.');
    expect(result?.keywords).toEqual([
      "apollo program timeline",
      "Moon landing mission logs",
      "NASA archival photographs",
    ]);
    expect(result?.refinedQuery).toBe("apollo program timeline");
    expect(result?.collectionHint).toBe(
      "Look at the Apollo Mission Reports and Lunar Surface Journal collections."
    );
  });

  it("handles numbered bullet lists and quoted refined query labels", () => {
    const raw = `Seeking vintage computing history resources.\n\n1. Refined search: \"commodore 64 software library\"\n2. Consider \"retro computing magazines\" for context\n3. Hardware catalogs and manuals\n\nFocus on the Vintage Computer Federation collection for curated material.`;

    const result = parseModelSearchResponse(raw);
    expect(result).not.toBeNull();
    expect(result?.keywords).toEqual([
      "commodore 64 software library",
      "retro computing magazines",
      "Hardware catalogs and manuals",
    ]);
    expect(result?.refinedQuery).toBe("commodore 64 software library");
    expect(result?.collectionHint).toBe(
      "Focus on the Vintage Computer Federation collection for curated material."
    );
  });

  it("splits comma separated keyword suggestions and ignores directives", () => {
    const raw = `Exploring classical mythology scholarship.\n\n- Search for myths, epic poetry, scholarly commentary\n- Focus on archaeological site reports\n- Include translations from the 19th century\n\nCheck the Mythology Texts and Archaeology Reports collections.`;

    const result = parseModelSearchResponse(raw);
    expect(result).not.toBeNull();
    expect(result?.keywords).toEqual([
      "myths",
      "epic poetry",
      "scholarly commentary",
      "archaeological site reports",
      "translations from the 19th century",
    ]);
    expect(result?.refinedQuery).toBeNull();
  });

  it("returns null when the response is empty", () => {
    expect(parseModelSearchResponse("   ")).toBeNull();
  });
});
