import type { NSFWFilterMode } from "../types";
import type { IAItem } from "./archive";

const ADULT_TERMS = [
  "adult",
  "nsfw",
  "porn",
  "xxx",
  "erotic",
  "erotica",
  "fetish",
  "sex",
  "nude",
  "nudity",
  "hardcore"
];

const EXPLICIT_TERMS = ["xxx", "porn", "hardcore", "fetish", "nsfw", "explicit"];

function containsTerm(value: string | undefined, terms: string[]): boolean {
  if (!value) {
    return false;
  }
  const lowered = value.toLowerCase();
  return terms.some((term) => lowered.includes(term));
}

function arrayContainsTerm(values: string[] | undefined, terms: string[]): boolean {
  if (!values || values.length === 0) {
    return false;
  }
  return values.some((value) => containsTerm(value, terms));
}

/**
 * Filter Internet Archive items client-side based on the user's NSFW preference.
 */
export function applyNSFWFilter(items: IAItem[], mode: NSFWFilterMode): IAItem[] {
  if (mode === "unrestricted") {
    return items;
  }

  if (mode === "nsfw-only") {
    return items.filter((item) => {
      return (
        containsTerm(item.title, ADULT_TERMS) ||
        containsTerm(item.description, ADULT_TERMS) ||
        arrayContainsTerm(item.subject, ADULT_TERMS)
      );
    });
  }

  const blockTerms = mode === "moderate" ? EXPLICIT_TERMS : ADULT_TERMS;

  return items.filter((item) => {
    const titleBlocked = containsTerm(item.title, blockTerms);
    const descriptionBlocked = containsTerm(item.description, blockTerms);
    const subjectBlocked = arrayContainsTerm(item.subject, blockTerms);
    if (titleBlocked || descriptionBlocked || subjectBlocked) {
      return false;
    }
    if (mode === "moderate") {
      // Allow mild historical descriptions but block explicit content.
      return !containsTerm(item.description, ["pornographic", "xxx", "hardcore", "fetish"]);
    }
    return true;
  });
}
