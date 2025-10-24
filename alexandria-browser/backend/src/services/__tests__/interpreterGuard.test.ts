import { afterEach, describe, expect, it, vi } from "vitest";

import { safeInterpretSearchQuery, sanitizeQueryFilters } from "../interpreterGuard";
import type { QueryFilters } from "../queryInterpreter";
import * as queryInterpreter from "../queryInterpreter";

const ALLOWED_MEDIA_TYPES = new Set(["texts", "image", "audio"]);
const YEAR_PATTERN = /^\d{4}$/;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sanitizeQueryFilters", () => {
  it("returns sanitized values for known filters", () => {
    const filters: QueryFilters = {
      mediaType: " Image ",
      yearFrom: " 1800 ",
      yearTo: "1899",
      language: "English",
      sourceTrust: "HIGH",
      availability: "Online",
      collection: "Library_of_Congress, invalid value,smithsonian",
      subject: "Maps ;  History",
      uploader: "ArchiveUser42",
    };

    const result = sanitizeQueryFilters(filters, {
      allowedMediaTypes: ALLOWED_MEDIA_TYPES,
      yearPattern: YEAR_PATTERN,
    });

    expect(result).toEqual({
      mediaType: "image",
      yearFrom: "1800",
      yearTo: "1899",
      language: "english",
      sourceTrust: "high",
      availability: "online",
      collection: "library_of_congress,smithsonian",
      subject: "maps,history",
      uploader: "archiveuser42",
    });
  });

  it("drops unrecognized or malformed filters", () => {
    const filters: QueryFilters = {
      mediaType: "unknown",
      yearFrom: "abcd",
      yearTo: "19A0",
      language: "1234",
      sourceTrust: "trusted",
      availability: "sometimes",
      collection: "!!!",
      subject: "",
      uploader: "bad user",
    };

    const result = sanitizeQueryFilters(filters, {
      allowedMediaTypes: ALLOWED_MEDIA_TYPES,
      yearPattern: YEAR_PATTERN,
    });

    expect(result).toEqual({});
  });
});

describe("safeInterpretSearchQuery", () => {
  it("provides trimmed query and sanitized filters", () => {
    vi.spyOn(queryInterpreter, "interpretSearchQuery").mockReturnValue({
      query: "  refined query  ",
      filters: {
        mediaType: "Image",
        yearFrom: "1890",
      },
    });

    const result = safeInterpretSearchQuery("test", {
      allowedMediaTypes: ALLOWED_MEDIA_TYPES,
      yearPattern: YEAR_PATTERN,
    });

    expect(result.error).toBeNull();
    expect(result.interpretation).toEqual({
      query: "refined query",
      filters: {
        mediaType: "image",
        yearFrom: "1890",
      },
    });
    expect(result.filters).toEqual({
      mediaType: "image",
      yearFrom: "1890",
    });
  });

  it("captures interpreter errors and returns empty filters", () => {
    vi.spyOn(queryInterpreter, "interpretSearchQuery").mockImplementation(() => {
      throw new Error("boom");
    });

    const result = safeInterpretSearchQuery("test", {
      allowedMediaTypes: ALLOWED_MEDIA_TYPES,
      yearPattern: YEAR_PATTERN,
    });

    expect(result.interpretation).toBeNull();
    expect(result.filters).toEqual({});
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toBe("boom");
  });
});
