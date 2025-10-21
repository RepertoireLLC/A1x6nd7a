export interface SampleSiteImageEntry {
  timestamp: string;
  original: string;
  mime: string;
  status: string;
  length?: number;
}

const createEntry = (
  timestamp: string,
  original: string,
  mime: string,
  length?: number,
  status = "200"
): SampleSiteImageEntry => ({
  timestamp,
  original,
  mime,
  status,
  ...(typeof length === "number" ? { length } : {})
});

export const SAMPLE_SITE_IMAGES: Record<string, SampleSiteImageEntry[]> = {
  "wikipedia.org": [
    createEntry(
      "20230115000512",
      "https://upload.wikimedia.org/wikipedia/commons/thumb/8/80/Wikipedia-logo-v2.svg/512px-Wikipedia-logo-v2.svg.png",
      "image/png",
      186123
    ),
    createEntry(
      "20220704091003",
      "https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/Wikipedia-logo.png/320px-Wikipedia-logo.png",
      "image/png",
      104512
    ),
    createEntry(
      "20211225021544",
      "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7f/Wikipedia-logo-en-big.png/256px-Wikipedia-logo-en-big.png",
      "image/png",
      82194
    )
  ],
  "en.wikipedia.org": [
    createEntry(
      "20220518030330",
      "https://upload.wikimedia.org/wikipedia/en/thumb/8/80/Wikipedia-logo-v2.svg/320px-Wikipedia-logo-v2.svg.png",
      "image/png",
      118934
    ),
    createEntry(
      "20201012174218",
      "https://upload.wikimedia.org/wikipedia/commons/thumb/4/4a/Wiktionary-blue-logo.svg/256px-Wiktionary-blue-logo.svg.png",
      "image/png",
      96543
    )
  ],
  "google.com": [
    createEntry(
      "20211201010101",
      "https://www.google.com/images/branding/googlelogo/2x/googlelogo_color_272x92dp.png",
      "image/png",
      135210
    ),
    createEntry(
      "20191225083022",
      "https://www.google.com/logos/doodles/2019/new-years-eve-2019-6753651837108228.2-law.gif",
      "image/gif",
      245812
    ),
    createEntry(
      "20171105095910",
      "https://www.google.com/images/icons/product/photos-64.png",
      "image/png",
      64321
    )
  ],
  "oldgoogle.com": [
    createEntry(
      "20051002120533",
      "http://www.oldgoogle.com/img/googlelogo.gif",
      "image/gif",
      47321
    )
  ],
  "example.com": [
    createEntry("20200601000000", "https://example.com/logo.png", "image/png", 32123),
    createEntry("20180405121515", "https://example.com/hero.jpg", "image/jpeg", 512341)
  ]
};

export function getSampleSiteImages(hostname: string): SampleSiteImageEntry[] | null {
  const normalized = hostname.toLowerCase();
  if (normalized in SAMPLE_SITE_IMAGES) {
    return SAMPLE_SITE_IMAGES[normalized] ?? null;
  }

  if (normalized.startsWith("www.")) {
    const withoutWww = normalized.slice(4);
    if (withoutWww in SAMPLE_SITE_IMAGES) {
      return SAMPLE_SITE_IMAGES[withoutWww] ?? null;
    }
  }

  return null;
}
