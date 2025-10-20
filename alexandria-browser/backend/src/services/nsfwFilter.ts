export const NSFW_WORDS = [
  "porn",
  "porno",
  "nsfw",
  "sex",
  "bdsm",
  "hentai",
  "nude",
  "naked",
  "camgirl",
  "strip",
  "fetish",
  "milf",
  "escort",
  "xxx",
  "onlyfans",
  "anal",
  "erotic",
  "cum",
  "orgy"
];

export function isNSFWContent(text: string = ""): boolean {
  const lower = text.toLowerCase();
  return NSFW_WORDS.some((word) => lower.includes(word));
}
