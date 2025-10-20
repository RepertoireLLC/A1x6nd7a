export interface SampleScrapeItem {
  identifier: string;
  title: string;
  mediatype: string;
  description: string;
  publicdate: string;
  downloads: number;
}

export interface SampleScrapeResponse {
  items: SampleScrapeItem[];
  total: number;
}

const createItem = (
  identifier: string,
  title: string,
  mediatype: string,
  description: string,
  publicdate: string,
  downloads: number
): SampleScrapeItem => ({ identifier, title, mediatype, description, publicdate, downloads });

export const SAMPLE_SCRAPE_RESULTS: Record<string, SampleScrapeResponse> = {
  "collection:opensource_audio": {
    items: [
      createItem(
        "opensource_audio_mix",
        "Open Source Audio Mix",
        "audio",
        "Community remixes and Creative Commons music.",
        "2021-07-22",
        32098
      ),
      createItem(
        "ambient_soundscapes_2020",
        "Ambient Soundscapes 2020",
        "audio",
        "Field recordings and ambient compositions.",
        "2020-05-19",
        21043
      ),
      createItem(
        "community_podcasts_weekly",
        "Community Podcasts Weekly",
        "audio",
        "Independent podcasts covering technology and culture.",
        "2024-02-08",
        18901
      )
    ],
    total: 3
  },
  "mediatype:(texts)": {
    items: [
      createItem(
        "gutenberg",
        "Project Gutenberg Collection",
        "texts",
        "A curated set of Project Gutenberg ebooks mirrored for posterity.",
        "2023-08-01",
        48201
      ),
      createItem(
        "scientific-american-archive",
        "Scientific American Archive",
        "texts",
        "Digitized issues of Scientific American magazine.",
        "2019-03-14",
        27430
      ),
      createItem(
        "zine-collection-90s",
        "DIY Zine Collection (1990s)",
        "texts",
        "Independent zines capturing DIY culture from the 1990s.",
        "2022-11-05",
        15320
      )
    ],
    total: 3
  },
  "(web)": {
    items: [
      createItem(
        "hackernews-archives",
        "Hacker News Daily Mirror",
        "web",
        "Daily snapshots of the Hacker News front page preserved for research into technology news and community discussions.",
        "2022-06-02",
        20456
      ),
      createItem(
        "open-government-web-crawl",
        "Open Government Web Crawl",
        "web",
        "Preserved pages from open government portals.",
        "2021-01-12",
        15430
      ),
      createItem(
        "covid19-web-snapshots",
        "COVID-19 Web Snapshots",
        "web",
        "Web captures documenting the early response to the COVID-19 pandemic.",
        "2020-04-01",
        28520
      )
    ],
    total: 3
  }
};

export const DEFAULT_SCRAPE_RESPONSE: SampleScrapeResponse = {
  items: [
    createItem(
      "waybackmachine",
      "Internet Archive Wayback Machine",
      "web",
      "Highlights from the Wayback Machine web archive.",
      "2024-01-12",
      125430
    ),
    createItem(
      "gutenberg",
      "Project Gutenberg Collection",
      "texts",
      "A curated set of Project Gutenberg ebooks mirrored for posterity.",
      "2023-08-01",
      48201
    ),
    createItem(
      "prelinger-archives",
      "Prelinger Archives",
      "movies",
      "Historic films, commercials, and home movies digitized by the Prelinger Archives.",
      "2018-11-09",
      275401
    )
  ],
  total: 3
};
