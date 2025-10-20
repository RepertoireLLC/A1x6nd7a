const DEFAULT_DATASET = [
  'history',
  'science',
  'technology',
  'literature',
  'photography',
  'music',
  'architecture',
  'manuscripts',
  'newspapers',
  'magazines',
  'biography',
  'world war',
  'map',
  'painting',
  'astronomy',
  'education',
  'mathematics',
  'poetry'
];

function levenshtein(a, b) {
  const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + 1
        );
      }
    }
  }

  return matrix[a.length][b.length];
}

/**
 * Returns a fuzzy suggestion for a query given a dataset.
 * @param {string} query
 * @param {string[]} [dataset]
 * @returns {string|null}
 */
export function getFuzzySuggestion(query, dataset = []) {
  const source = [...new Set([...dataset.filter(Boolean), ...DEFAULT_DATASET])];
  if (!query || source.length === 0) return null;

  const normalizedQuery = query.trim().toLowerCase();
  let bestSuggestion = null;
  let smallestDistance = Infinity;

  for (const term of source) {
    const normalizedTerm = term.toLowerCase();
    const distance = levenshtein(normalizedQuery, normalizedTerm);
    const closeness = distance / Math.max(normalizedTerm.length, normalizedQuery.length);

    if (closeness <= 0.5 && distance < smallestDistance) {
      smallestDistance = distance;
      bestSuggestion = term;
    }
  }

  return bestSuggestion;
}
