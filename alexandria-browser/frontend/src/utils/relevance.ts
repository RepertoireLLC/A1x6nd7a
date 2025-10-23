import type { ArchiveSearchDoc } from "../types";
import {
  createTruthScoringContext,
  scoreArchiveDocTruth,
} from "./truthRanking";

export function mergeRankedResults(
  existingDocs: ArchiveSearchDoc[],
  incomingDocs: ArchiveSearchDoc[],
  query: string,
): ArchiveSearchDoc[] {
  const context = createTruthScoringContext(query);

  const docMap = new Map<string, ArchiveSearchDoc>();
  for (const doc of existingDocs) {
    if (doc.identifier) {
      docMap.set(doc.identifier, doc);
    }
  }

  for (const doc of incomingDocs) {
    if (!doc.identifier) {
      continue;
    }
    const previous = docMap.get(doc.identifier);
    docMap.set(doc.identifier, previous ? { ...previous, ...doc } : doc);
  }

  const scoredDocs: ArchiveSearchDoc[] = [];
  let highestScore = 0;

  for (const doc of docMap.values()) {
    const { score, breakdown } = scoreArchiveDocTruth(doc, context);
    const safeScore = Number.isFinite(score) ? Math.max(0, score) : 0;
    if (safeScore > highestScore) {
      highestScore = safeScore;
    }

    const enriched: ArchiveSearchDoc = {
      ...doc,
      score: Number.parseFloat(safeScore.toFixed(4)),
      score_breakdown: breakdown,
      source_trust: breakdown.trustLevel,
    };
    scoredDocs.push(enriched);
  }

  if (highestScore <= 0) {
    return scoredDocs.sort((a, b) => a.identifier.localeCompare(b.identifier));
  }

  return scoredDocs.sort((a, b) => {
    const scoreA = typeof a.score === "number" ? a.score : 0;
    const scoreB = typeof b.score === "number" ? b.score : 0;
    if (scoreA === scoreB) {
      return a.identifier.localeCompare(b.identifier);
    }
    return scoreB - scoreA;
  });
}
