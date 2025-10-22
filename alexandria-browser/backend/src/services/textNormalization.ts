const DIACRITIC_PATTERN = /[\u0300-\u036f]/g;

export function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(DIACRITIC_PATTERN, "");
}
