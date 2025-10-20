export interface SampleMetadataEntry {
  metadata: Record<string, unknown>;
  files: Array<{
    name: string;
    format: string;
    size: number;
    mtime: string;
  }>;
}

const createMetadata = (
  identifier: string,
  title: string,
  mediatype: string,
  description: string,
  creator: string | string[],
  date: string,
  collection: string | string[],
  subjects: string[],
  downloads: number,
  files: Array<{
    name: string;
    format: string;
    size: number;
    mtime: string;
  }>
): SampleMetadataEntry => ({
  metadata: {
    identifier,
    title,
    mediatype,
    description,
    creator,
    date,
    collection,
    subject: subjects,
    downloads,
    language: "English",
    licenseurl: "https://creativecommons.org/licenses/by/4.0/",
    publicdate: date,
    addeddate: date,
    uploader: "alexandria-browser",
    runtime: mediatype === "audio" ? "01:02:15" : undefined
  },
  files
});

export const SAMPLE_METADATA: Record<string, SampleMetadataEntry> = {
  waybackmachine: createMetadata(
    "waybackmachine",
    "Internet Archive Wayback Machine",
    "web",
    "An overview of the Internet Archive's Wayback Machine, including highlights from the web archive and preservation projects.",
    "Internet Archive",
    "2024-01-12",
    ["internetarchive", "web"],
    ["web archiving", "digital preservation", "internet archive"],
    125430,
    [
      {
        name: "waybackmachine.html",
        format: "Text",
        size: 17452,
        mtime: "2024-01-12T00:00:00Z"
      },
      {
        name: "waybackmachine.mp4",
        format: "MP4",
        size: 12400345,
        mtime: "2024-01-12T00:00:00Z"
      },
      {
        name: "waybackmachine.png",
        format: "PNG",
        size: 234234,
        mtime: "2024-01-12T00:00:00Z"
      }
    ]
  ),
  gutenberg: createMetadata(
    "gutenberg",
    "Project Gutenberg Collection",
    "texts",
    "A curated set of Project Gutenberg ebooks mirrored for posterity.",
    "Project Gutenberg",
    "2023-08-01",
    ["texts", "gutenberg"],
    ["ebooks", "literature", "public domain"],
    48201,
    [
      {
        name: "aliceinwonderland_64kb_mp3.zip",
        format: "ZIP",
        size: 62394421,
        mtime: "2023-08-01T00:00:00Z"
      },
      {
        name: "moby_dick.pdf",
        format: "PDF",
        size: 14234932,
        mtime: "2023-08-01T00:00:00Z"
      }
    ]
  ),
  "naropa-poetry-audio": createMetadata(
    "naropa-poetry-audio",
    "Naropa University Poetry Lectures",
    "audio",
    "Lectures and readings from Naropa University's celebrated poetics program.",
    ["Naropa University", "Allen Ginsberg Library"],
    "2019-05-15",
    ["naropa", "audio"],
    ["poetry", "spoken word", "naropa"],
    9123,
    [
      {
        name: "naropa-poetry-audio_001.mp3",
        format: "MP3",
        size: 52342345,
        mtime: "2019-05-15T00:00:00Z"
      },
      {
        name: "naropa-poetry-audio_001.txt",
        format: "Text",
        size: 12345,
        mtime: "2019-05-15T00:00:00Z"
      }
    ]
  ),
  "prelinger-archives": createMetadata(
    "prelinger-archives",
    "Prelinger Archives",
    "movies",
    "Historic films, commercials, and home movies digitized by the Prelinger Archives.",
    "Prelinger Archives",
    "2018-11-09",
    ["movies", "prelinger"],
    ["film", "history", "advertising"],
    275401,
    [
      {
        name: "prelinger-archives_001.mpeg",
        format: "MPEG4",
        size: 503423409,
        mtime: "2018-11-09T00:00:00Z"
      },
      {
        name: "prelinger-archives_001.jpg",
        format: "JPEG",
        size: 432423,
        mtime: "2018-11-09T00:00:00Z"
      }
    ]
  ),
  "smithsonian-images": createMetadata(
    "smithsonian-images",
    "Smithsonian Open Access Images",
    "image",
    "High-resolution images released by the Smithsonian Institution covering art, history, science, and culture.",
    "Smithsonian Institution",
    "2020-02-25",
    ["smithsonian", "images"],
    ["photography", "museum", "open access"],
    34782,
    [
      {
        name: "smithsonian-images_0001.tif",
        format: "TIFF",
        size: 84234234,
        mtime: "2020-02-25T00:00:00Z"
      },
      {
        name: "smithsonian-images_0001.jpg",
        format: "JPEG",
        size: 5234234,
        mtime: "2020-02-25T00:00:00Z"
      }
    ]
  ),
  msdos_games_collection: createMetadata(
    "msdos_games_collection",
    "MS-DOS Games Collection",
    "software",
    "Playable software titles from the MS-DOS era preserved and emulated in the browser.",
    "Internet Archive",
    "2017-10-06",
    ["softwarelibrary_msdos_games"],
    ["games", "retro", "ms-dos"],
    905432,
    [
      {
        name: "msdos_games_collection_emu.zip",
        format: "ZIP",
        size: 251234567,
        mtime: "2017-10-06T00:00:00Z"
      },
      {
        name: "msdos_games_collection.js",
        format: "JavaScript",
        size: 745623,
        mtime: "2017-10-06T00:00:00Z"
      }
    ]
  ),
  "climate-data-rescue": createMetadata(
    "climate-data-rescue",
    "Climate Data Rescue",
    "data",
    "Datasets digitizing historical climate observations for research and long-term trend analysis.",
    "International Environmental Data Rescue Organization",
    "2016-04-18",
    ["climate", "data"],
    ["climate", "data", "history"],
    12903,
    [
      {
        name: "climate-data-rescue.csv",
        format: "CSV",
        size: 8342342,
        mtime: "2016-04-18T00:00:00Z"
      },
      {
        name: "climate-data-rescue-readme.txt",
        format: "Text",
        size: 34234,
        mtime: "2016-04-18T00:00:00Z"
      }
    ]
  ),
  "tvnews-2020-elections": createMetadata(
    "tvnews-2020-elections",
    "TV News Archive: 2020 Elections",
    "tvnews",
    "Television news coverage of the 2020 United States elections with searchable transcripts.",
    ["Internet Archive", "TV News Archive"],
    "2020-11-04",
    ["TV", "news"],
    ["television", "news", "politics"],
    450123,
    [
      {
        name: "tvnews-2020-elections.mp4",
        format: "MP4",
        size: 150234234,
        mtime: "2020-11-04T00:00:00Z"
      },
      {
        name: "tvnews-2020-elections.vtt",
        format: "WebVTT",
        size: 65234,
        mtime: "2020-11-04T00:00:00Z"
      }
    ]
  ),
  opensource_audio_mix: createMetadata(
    "opensource_audio_mix",
    "Open Source Audio Mix",
    "audio",
    "Community contributed music, podcasts, and soundscapes shared under Creative Commons licenses.",
    "Various",
    "2021-07-22",
    ["opensource_audio"],
    ["music", "creative commons", "audio"],
    32098,
    [
      {
        name: "opensource_audio_mix_01.ogg",
        format: "OGG",
        size: 62342345,
        mtime: "2021-07-22T00:00:00Z"
      },
      {
        name: "opensource_audio_mix_tracklist.txt",
        format: "Text",
        size: 2345,
        mtime: "2021-07-22T00:00:00Z"
      }
    ]
  ),
  "hackernews-archives": createMetadata(
    "hackernews-archives",
    "Hacker News Daily Mirror",
    "web",
    "Daily snapshots of the Hacker News front page preserved for research into technology news and community discussions.",
    "Internet Archive",
    "2022-06-02",
    ["web", "hackernews"],
    ["technology", "news", "communities"],
    20456,
    [
      {
        name: "hackernews-archives_2022-06-01.html",
        format: "Text",
        size: 234234,
        mtime: "2022-06-02T00:00:00Z"
      }
    ]
  )
};
