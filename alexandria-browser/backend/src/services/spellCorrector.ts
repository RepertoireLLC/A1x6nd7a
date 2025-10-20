import COMMON_WORDS from "../data/commonWords";

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function normalize(word: string): string | null {
  const cleaned = word.toLowerCase().replace(/[^a-z0-9]/g, "");
  return cleaned.length > 0 ? cleaned : null;
}

type Correction = {
  original: string;
  corrected: string;
};

export interface SpellcheckResult {
  originalQuery: string;
  correctedQuery: string;
  corrections: Correction[];
}

export class SpellCorrector {
  private readonly frequencies = new Map<string, number>();

  constructor(seedWords: Iterable<string> = []) {
    this.learnWords(seedWords);
  }

  learnFromText(text: string): void {
    this.learnWords(tokenize(text));
  }

  learnWords(words: Iterable<string>): void {
    for (const word of words) {
      const normalized = normalize(word);
      if (!normalized) {
        continue;
      }

      const current = this.frequencies.get(normalized) ?? 0;
      this.frequencies.set(normalized, current + 1);
    }
  }

  correct(word: string): string | null {
    const normalized = normalize(word);
    if (!normalized) {
      return null;
    }

    if (this.frequencies.has(normalized)) {
      return normalized;
    }

    const candidates = this.knownEdits(normalized);
    if (candidates.length > 0) {
      return this.highestFrequency(candidates);
    }

    const twoStepCandidates = this.knownEdits2(normalized);
    if (twoStepCandidates.length > 0) {
      return this.highestFrequency(twoStepCandidates);
    }

    return normalized;
  }

  checkQuery(query: string): SpellcheckResult {
    const tokens = query.split(/\s+/).filter(Boolean);
    const correctedTokens: string[] = [];
    const corrections: Correction[] = [];

    for (const token of tokens) {
      const normalized = normalize(token);
      if (!normalized) {
        correctedTokens.push(token);
        continue;
      }

      const corrected = this.correct(token);
      if (corrected && corrected !== normalized) {
        corrections.push({ original: token, corrected });
        correctedTokens.push(corrected);
        this.learnWords([corrected]);
      } else {
        correctedTokens.push(token);
      }
    }

    const correctedQuery = corrections.length > 0 ? correctedTokens.join(" ") : query;

    return {
      originalQuery: query,
      correctedQuery,
      corrections,
    };
  }

  private known(words: Iterable<string>): string[] {
    const found = new Set<string>();
    for (const word of words) {
      if (this.frequencies.has(word)) {
        found.add(word);
      }
    }
    return [...found];
  }

  private knownEdits(word: string): string[] {
    const edits = this.edits1(word);
    return this.known(edits);
  }

  private knownEdits2(word: string): string[] {
    const results = new Set<string>();
    for (const edit of this.edits1(word)) {
      for (const edit2 of this.edits1(edit)) {
        if (this.frequencies.has(edit2)) {
          results.add(edit2);
        }
      }
    }
    return [...results];
  }

  private edits1(word: string): Set<string> {
    const splits: Array<[string, string]> = [];
    for (let i = 0; i <= word.length; i += 1) {
      splits.push([word.slice(0, i), word.slice(i)]);
    }

    const deletes = splits
      .filter(([, r]) => r.length > 0)
      .map(([l, r]) => l + r.slice(1));

    const transposes = splits
      .filter(([, r]) => r.length > 1)
      .map(([l, r]) => l + r[1] + r[0] + r.slice(2));

    const replaces: string[] = [];
    for (const [l, r] of splits.filter(([, r]) => r.length > 0)) {
      for (const c of ALPHABET) {
        replaces.push(l + c + r.slice(1));
      }
    }

    const inserts: string[] = [];
    for (const [l, r] of splits) {
      for (const c of ALPHABET) {
        inserts.push(l + c + r);
      }
    }

    return new Set([...deletes, ...transposes, ...replaces, ...inserts]);
  }

  private highestFrequency(words: Iterable<string>): string {
    let bestWord = "";
    let bestFrequency = -1;

    for (const word of words) {
      const frequency = this.frequencies.get(word) ?? 0;
      if (frequency > bestFrequency || (frequency === bestFrequency && word < bestWord)) {
        bestWord = word;
        bestFrequency = frequency;
      }
    }

    return bestWord;
  }
}

export function createDefaultSpellCorrector(): SpellCorrector {
  return new SpellCorrector(COMMON_WORDS);
}

const defaultCorrector = createDefaultSpellCorrector();

export function getSpellCorrector(): SpellCorrector {
  return defaultCorrector;
}
