# Alexandria Browser

## Manifesto

The internet forgets. Links die. Knowledge is buried by algorithms and corporations. The **Alexandria Browser** exists to preserve collective memory. It searches, restores, and archives knowledge using the Internet Archive. It serves no ads, no agendas—only truth, utility, and preservation.

Core values:

* Preserve Everything
* No Gatekeepers
* Serve the Seeker
* Build Open and Forkable

## Project Overview

This repository contains the Alexandria Browser project, featuring a TypeScript-based backend and frontend. Follow the build steps sequentially to construct the application.

### Structure

```
alexandria-browser/
 ├─ backend/           # Node.js + Express (TypeScript)
 └─ frontend/          # React + Vite (TypeScript)
```

### Getting Started

#### Prerequisites

* Node.js 18+
* npm 9+

#### Install dependencies

```bash
npm install --workspaces
```

If the sandbox blocks package downloads for `@types/*`, run the backend with `npm run dev --workspace alexandria-browser/backend` using a local checkout that has already installed dependencies.

#### Launch the development servers

```bash
# Terminal 1
npm run dev --workspace alexandria-browser/backend

# Terminal 2
npm run dev --workspace alexandria-browser/frontend
```

The frontend expects the backend at `http://localhost:4000` by default. Override this via `VITE_API_BASE_URL` in a `.env` file placed beside `frontend/.env` if you host the API elsewhere.

By default the backend requires live access to archive.org services. If you're developing offline, export `ARCHIVE_ENABLE_OFFLINE_DATA=true` before launching the backend and `VITE_ENABLE_OFFLINE_DATA=true` before building or serving the frontend to opt into the bundled sample datasets.

#### Production build

```bash
npm run build --workspace alexandria-browser/backend
npm run build --workspace alexandria-browser/frontend
```

### Features

* **Clean search UI** — centered Google-like query bar, responsive theming, and accessible layout.
* **Built-in browser controls** — back, forward, refresh, and home buttons mimic a lightweight browser session over saved searches.
* **Internet Archive search** — proxied through `/api/search` using the [Advanced Search API](https://archive.org/developers/internetarchive/advancedsearch.html) with fuzzy term expansion.
* **Wayback availability** — `/api/wayback` surfaces data from the [Wayback Availability API](https://archive.org/help/wayback_api.php) and `/api/status` augments it with live HEAD/GET probing.
* **Live web checks** — direct URL searches run availability probes and surface links to open the live site or archived snapshots.
* **Result presentation** — cards display title, snippet, media glyph, provenance metadata, Wayback link, and status badge inside a scrollable container.
* **Pagination & scroll reset** — previous/next controls update query parameters, report `Page X of Y`, and focus the new batch automatically.
* **Advanced filtering** — limit results by media type or year range to mirror Internet Archive advanced search capabilities.
* **NSFW safeguarding** — backend keyword filter flags sensitive records; the UI blurs them by default with a user-controlled reveal toggle inside Settings.
* **Spell correction** — a Norvig-inspired service suggests corrections and emits fuzzy Solr clauses, powering “Did you mean…” flows.
* **Save Page Now integration** — `/api/save` relays preservation requests to `https://web.archive.org/save/` and reports snapshot links.
* **Bookmarks & history** — sidebar keeps a persistent library of saved archive items and your recent searches with quick re-run controls.
* **Persistent preferences** — localStorage stores theme, NSFW toggle, last query, results-per-page, and saved sidebar state.

### Backend API

| Endpoint | Method | Description |
| --- | --- | --- |
| `/health` | GET | Lightweight health probe for orchestration. |
| `/api/search` | GET | Proxies the Internet Archive Advanced Search API with fuzzy fallback, NSFW annotations, and optional filters. Parameters: `q`, `page`, `rows`, `mediaType`, `yearFrom`, `yearTo`. |
| `/api/wayback` | GET | Wraps the Wayback Machine availability endpoint. Parameter: `url`. |
| `/api/status` | GET | Performs a guarded HEAD/GET probe and falls back to Wayback availability to classify a URL as online, archived-only, or offline. Parameter: `url`. |
| `/api/save` | POST | Relays Save Page Now requests to archive a specific `url`. Returns snapshot link metadata when provided by the service. |

### Frontend UX Notes

* Theme toggle (light/dark) updates instantly and persists across sessions.
* NSFW toggle hides sensitive results with blur; switching off reveals the content and labels entries as “NSFW”.
* Advanced filters expose media type selection and year range inputs; the Apply button re-runs the current search with the new constraints.
* “Did you mean…” banner appears when the backend’s spell corrector suggests a stronger query. Clicking it re-runs the search and records the correction.
* Save-to-Archive buttons track per-result status (“Ready”, “Saving…”, “Saved”, error states) and display returned Wayback snapshot URLs.
* Results-per-page selector updates pagination math and is restored on refresh from stored preferences.

### Harmonia Integration Hooks

The project maintains a modular structure so Harmonia can attach without disruptive rewrites:

1. **Backend composition** — expose Express `app` (default export of `backend/src/server.ts`) for embedding inside a Harmonia service container or gateway middleware.
2. **API surface** — maintain route prefixes under `/api/` so Harmonia can proxy or namespace them without breaking the frontend. Add new Harmonia modules by registering additional routers before the `app.listen` guard.
3. **Frontend modularity** — lift shared state into dedicated hooks or context providers if Harmonia introduces cross-application shells. The current single-page layout keeps state localized for straightforward embedding.
4. **Environment bridging** — configure `VITE_API_BASE_URL` to point at Harmonia’s API gateway; the backend already respects `PORT` via `.env` to align with orchestrated deployments.

### Step-by-Step Progress Recap

1. **Step 1 – Project Setup**: Established workspaces, environment scaffold, manifesto, and scripts.
2. **Step 2 – Base UI**: Delivered the themed search shell with centered query bar and results placeholder.
3. **Step 3 – Internet Archive API Integration**: Added proxied search and Wayback endpoints with validation.
4. **Step 4 – Display Search Results**: Rendered result cards with metadata, icons, and Wayback links.
5. **Step 5 – Online / Offline / Archived-Only Status**: Implemented availability probing and badges.
6. **Step 6 – Pagination + Scroll**: Added previous/next controls, range reporting, and scroll resets.
7. **Step 7 – NSFW Censor Keyword Filter**: Flagged sensitive material and added the UI toggle.
8. **Step 8 – Spell Correction + Fuzzy Search**: Introduced the spell corrector and “Did you mean…” flows.
9. **Step 9 – Save Page to Archive**: Wired Save Page Now actions with snapshot feedback.
10. **Step 10 – Save User Settings Locally**: Persisted theme, NSFW, query, and paging settings.
11. **Step 11 – Finalize & Notify**: Documented the end-to-end system, clarified build/run workflows, and outlined Harmonia integration guidance.

### Next Steps

* Harden error telemetry (e.g., structured logging or tracing) for production Harmonia deployments.
* Expand NSFW heuristics with configurable lists or machine learning classifiers when privacy constraints permit.
* Introduce authenticated sessions if Harmonia requires personalized archive collections or collaboration features.
