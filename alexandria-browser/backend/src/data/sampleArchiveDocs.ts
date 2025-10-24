export interface SampleArchiveDoc {
  identifier: string;
  title: string;
  description?: string;
  mediatype?: string;
  year?: string;
  date?: string;
  publicdate?: string;
  creator?: string | string[];
  collection?: string | string[];
  subject?: string | string[];
  uploader?: string | string[];
  links?: {
    archive: string;
    original?: string | null;
    wayback?: string | null;
  };
  thumbnail?: string;
}

export const SAMPLE_ARCHIVE_DOCS: SampleArchiveDoc[] = [
  {
    identifier: "waybackmachine",
    title: "Internet Archive Wayback Machine",
    description: "Explore archived versions of websites captured by the Internet Archive's Wayback Machine. Includes billions of web pages dating back to 1996.",
    mediatype: "web",
    year: "2024",
    date: "2024-01-12",
    publicdate: "2024-01-12T00:00:00Z",
    creator: "Internet Archive",
    collection: ["web", "internetarchive"]
  },
  {
    identifier: "gutenberg",
    title: "Project Gutenberg Collection",
    description: "A curated set of public domain ebooks hosted on the Internet Archive, covering literature, reference works, and historical texts.",
    mediatype: "texts",
    year: "2023",
    date: "2023-08-01",
    publicdate: "2023-08-01T00:00:00Z",
    creator: "Project Gutenberg",
    collection: ["texts", "gutenberg"]
  },
  {
    identifier: "naropa-poetry-audio",
    title: "Naropa University Poetry Lectures",
    description: "Audio recordings from the Naropa University audio archive featuring lectures, readings, and discussions with prominent poets.",
    mediatype: "audio",
    year: "2019",
    date: "2019-05-14",
    publicdate: "2019-05-15T00:00:00Z",
    creator: ["Naropa University", "Allen Ginsberg Library"],
    collection: ["naropa", "audio"]
  },
  {
    identifier: "prelinger-archives",
    title: "Prelinger Archives",
    description: "Historic films, commercials, and home movies digitized by the Prelinger Archives with a focus on ephemeral cultural artifacts.",
    mediatype: "movies",
    year: "2018",
    date: "2018-11-09",
    publicdate: "2018-11-09T00:00:00Z",
    creator: "Prelinger Archives",
    collection: ["movies", "prelinger"]
  },
  {
    identifier: "smithsonian-images",
    title: "Smithsonian Open Access Images",
    description: "High-resolution images released by the Smithsonian Institution covering art, history, science, and culture for open reuse.",
    mediatype: "image",
    year: "2020",
    date: "2020-02-25",
    publicdate: "2020-02-25T00:00:00Z",
    creator: "Smithsonian Institution",
    collection: ["smithsonian", "images"]
  },
  {
    identifier: "msdos_games_collection",
    title: "MS-DOS Games Collection",
    description: "Playable software titles from the MS-DOS era preserved and emulated in the browser, including classic adventure and action games.",
    mediatype: "software",
    year: "2017",
    date: "2017-10-06",
    publicdate: "2017-10-06T00:00:00Z",
    creator: "Internet Archive",
    collection: ["softwarelibrary_msdos_games"]
  },
  {
    identifier: "climate-data-rescue",
    title: "Climate Data Rescue",
    description: "Datasets collected by volunteers digitizing historical climate observations for research and long-term trend analysis.",
    mediatype: "data",
    year: "2016",
    date: "2016-04-18",
    publicdate: "2016-04-18T00:00:00Z",
    creator: "International Environmental Data Rescue Organization",
    collection: ["climate", "data"]
  },
  {
    identifier: "tvnews-2020-elections",
    title: "TV News Archive: 2020 Elections",
    description: "Clips from major television networks covering the 2020 United States elections, searchable by transcript and broadcast date.",
    mediatype: "tvnews",
    year: "2020",
    date: "2020-11-03",
    publicdate: "2020-11-04T00:00:00Z",
    creator: ["Internet Archive", "TV News Archive"],
    collection: ["TV", "news"]
  },
  {
    identifier: "opensource_audio_mix",
    title: "Open Source Audio Mix",
    description: "Community contributed music, podcasts, and soundscapes shared under Creative Commons licenses across the world.",
    mediatype: "audio",
    year: "2021",
    date: "2021-07-22",
    publicdate: "2021-07-22T00:00:00Z",
    creator: "Various",
    collection: ["opensource_audio"]
  },
  {
    identifier: "hackernews-archives",
    title: "Hacker News Daily Mirror",
    description: "Daily snapshots of the Hacker News front page preserved for research into technology news and community discussions.",
    mediatype: "web",
    year: "2022",
    date: "2022-06-01",
    publicdate: "2022-06-02T00:00:00Z",
    creator: "Archive Team",
    collection: ["archiveteam", "web"]
  },
  {
    identifier: "encyclopedia-britannica-1911",
    title: "Encyclopedia Britannica 1911 Edition",
    description: "Digitized volumes of the 1911 Encyclopedia Britannica featuring detailed entries across arts, sciences, and world history.",
    mediatype: "texts",
    year: "1911",
    date: "1911-01-01",
    publicdate: "2006-03-15T00:00:00Z",
    creator: "Encyclopedia Britannica",
    collection: ["americana"]
  },
  {
    identifier: "apollo11-mission-reports",
    title: "Apollo 11 Mission Reports",
    description: "NASA mission reports, technical documents, and debriefings chronicling the Apollo 11 lunar landing.",
    mediatype: "texts",
    year: "1969",
    date: "1969-07-24",
    publicdate: "2012-07-20T00:00:00Z",
    creator: "NASA",
    collection: ["nasa"]
  },
  {
    identifier: "george-washington-letters",
    title: "George Washington Papers",
    description: "Correspondence and personal papers of George Washington digitized from the Library of Congress collection.",
    mediatype: "texts",
    year: "1776",
    date: "1776-12-25",
    publicdate: "2002-07-04T00:00:00Z",
    creator: "George Washington",
    collection: ["library_of_congress"]
  }
];
