export const NSFW_WORDS = [
  "adult",
  "afterdark",
  "porn",
  "porno",
  "nsfw",
  "sex",
  "bdsm",
  "hentai",
  "nude",
  "naked",
  "camgirl",
  "camgirls",
  "strip",
  "stripper",
  "fetish",
  "milf",
  "escort",
  "xxx",
  "onlyfans",
  "anal",
  "erotic",
  "cum",
  "orgy",
  "explicit",
  "hardcore",
  "incest",
  "lust",
  "nudity",
  "pegging",
  "sensual",
  "swinger"
];

export function isNSFWContent(text: string = ""): boolean {
  const lower = text.toLowerCase();
  return NSFW_WORDS.some((word) => lower.includes(word));
}
