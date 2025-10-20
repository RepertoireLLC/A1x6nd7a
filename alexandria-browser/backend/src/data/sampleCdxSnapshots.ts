export interface SampleCdxEntry {
  timestamp: string;
  original: string;
  status: string;
  mime: string;
  digest: string;
  length: number;
}

const createEntry = (
  timestamp: string,
  original: string,
  status: string,
  mime: string,
  digest: string,
  length: number
): SampleCdxEntry => ({ timestamp, original, status, mime, digest, length });

export const SAMPLE_CDX_SNAPSHOTS: Record<string, SampleCdxEntry[]> = {
  "https://archive.org/details/waybackmachine": [
    createEntry("20200101120000", "https://archive.org/details/waybackmachine", "200", "text/html", "ABCDEFG1", 20480),
    createEntry("20210101120000", "https://archive.org/details/waybackmachine", "200", "text/html", "ABCDEFG2", 22140),
    createEntry("20220101120000", "https://archive.org/details/waybackmachine", "200", "text/html", "ABCDEFG3", 22500),
    createEntry("20230101120000", "https://archive.org/details/waybackmachine", "200", "text/html", "ABCDEFG4", 23110)
  ],
  "https://archive.org/details/gutenberg": [
    createEntry("20180512091500", "https://archive.org/details/gutenberg", "200", "text/html", "GUTENBERG1", 54230),
    createEntry("20200512091500", "https://archive.org/details/gutenberg", "200", "text/html", "GUTENBERG2", 54890),
    createEntry("20220512091500", "https://archive.org/details/gutenberg", "200", "text/html", "GUTENBERG3", 56012)
  ],
  "https://archive.org/details/naropa-poetry-audio": [
    createEntry("20170601081200", "https://archive.org/details/naropa-poetry-audio", "200", "text/html", "NAROPA1", 42341),
    createEntry("20190601081200", "https://archive.org/details/naropa-poetry-audio", "200", "text/html", "NAROPA2", 46310),
    createEntry("20220601081200", "https://archive.org/details/naropa-poetry-audio", "200", "text/html", "NAROPA3", 47110)
  ],
  "https://archive.org/details/prelinger-archives": [
    createEntry("20150303100000", "https://archive.org/details/prelinger-archives", "200", "text/html", "PRELINGER1", 70123),
    createEntry("20170303100000", "https://archive.org/details/prelinger-archives", "200", "text/html", "PRELINGER2", 73210),
    createEntry("20210303100000", "https://archive.org/details/prelinger-archives", "200", "text/html", "PRELINGER3", 80124)
  ],
  "https://archive.org/details/smithsonian-images": [
    createEntry("20190323074510", "https://archive.org/details/smithsonian-images", "200", "text/html", "SMITHSONIAN1", 45210),
    createEntry("20210323074510", "https://archive.org/details/smithsonian-images", "200", "text/html", "SMITHSONIAN2", 49910),
    createEntry("20230323074510", "https://archive.org/details/smithsonian-images", "200", "text/html", "SMITHSONIAN3", 51230)
  ],
  "https://archive.org/details/msdos_games_collection": [
    createEntry("20161225010101", "https://archive.org/details/msdos_games_collection", "200", "text/html", "MSDOS1", 90452),
    createEntry("20181225010101", "https://archive.org/details/msdos_games_collection", "200", "text/html", "MSDOS2", 95234),
    createEntry("20221225010101", "https://archive.org/details/msdos_games_collection", "200", "text/html", "MSDOS3", 101234)
  ],
  "https://archive.org/details/climate-data-rescue": [
    createEntry("20140418103030", "https://archive.org/details/climate-data-rescue", "200", "text/html", "CLIMATE1", 33123),
    createEntry("20160418103030", "https://archive.org/details/climate-data-rescue", "200", "text/html", "CLIMATE2", 35110),
    createEntry("20200418103030", "https://archive.org/details/climate-data-rescue", "200", "text/html", "CLIMATE3", 38111)
  ],
  "https://archive.org/details/tvnews-2020-elections": [
    createEntry("20201015225040", "https://archive.org/details/tvnews-2020-elections", "200", "text/html", "TVNEWS1", 78110),
    createEntry("20201215225040", "https://archive.org/details/tvnews-2020-elections", "200", "text/html", "TVNEWS2", 82110),
    createEntry("20220315225040", "https://archive.org/details/tvnews-2020-elections", "200", "text/html", "TVNEWS3", 86234)
  ],
  "https://archive.org/details/opensource_audio_mix": [
    createEntry("20210522063200", "https://archive.org/details/opensource_audio_mix", "200", "text/html", "OSA1", 42111),
    createEntry("20220522063200", "https://archive.org/details/opensource_audio_mix", "200", "text/html", "OSA2", 46340),
    createEntry("20230522063200", "https://archive.org/details/opensource_audio_mix", "200", "text/html", "OSA3", 50110)
  ],
  "https://archive.org/details/hackernews-archives": [
    createEntry("20200102050505", "https://archive.org/details/hackernews-archives", "200", "text/html", "HACKERNEWS1", 31230),
    createEntry("20210102050505", "https://archive.org/details/hackernews-archives", "200", "text/html", "HACKERNEWS2", 33450),
    createEntry("20230102050505", "https://archive.org/details/hackernews-archives", "200", "text/html", "HACKERNEWS3", 34890)
  ],
  "https://example.com": [
    createEntry("20180501121212", "https://example.com", "200", "text/html", "EXAMPLE1", 20120),
    createEntry("20190501121212", "https://example.com", "200", "text/html", "EXAMPLE2", 22120),
    createEntry("20220501121212", "https://example.com", "200", "text/html", "EXAMPLE3", 25120)
  ]
};
