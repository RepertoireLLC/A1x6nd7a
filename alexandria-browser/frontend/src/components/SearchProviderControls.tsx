import { useMemo } from "react";

import type { SearchProviderKey, SearchProviderPreferences } from "../types";

interface SearchProviderControlsProps {
  query: string;
  providers: SearchProviderPreferences;
  onToggle: (provider: SearchProviderKey, enabled: boolean) => void;
}

type ProviderMetadata = {
  label: string;
  description: string;
  buildUrl: (query: string) => string;
};

const PROVIDER_KEYS: SearchProviderKey[] = ["google", "images", "youtube"];

const PROVIDER_METADATA: Record<SearchProviderKey, ProviderMetadata> = {
  google: {
    label: "Google Search",
    description: "Toggle to expose a quick jump into Google’s main search index.",
    buildUrl: (query: string) => `https://www.google.com/search?q=${encodeURIComponent(query)}`
  },
  images: {
    label: "Google Images",
    description: "Toggle to surface a visual pivot via Google Images.",
    buildUrl: (query: string) => `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(query)}`
  },
  youtube: {
    label: "YouTube",
    description: "Toggle to reach long-form and documentary sources on YouTube.",
    buildUrl: (query: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`
  }
};

/**
 * SearchProviderControls presents toggle buttons that light up external pivots
 * (Google, Google Images, YouTube) without leaving Alexandria’s flow.
 */
export function SearchProviderControls({ query, providers, onToggle }: SearchProviderControlsProps) {
  const trimmedQuery = query.trim();

  const activeProviders = useMemo(() => {
    // Memoizing avoids recalculating the enabled list on every keystroke.
    return PROVIDER_KEYS.filter((key) => providers[key]);
  }, [providers]);

  return (
    <div className="search-provider-controls" aria-label="External search toggles">
      <div className="search-provider-toggle-row" role="group" aria-label="Toggle quick search destinations">
        {PROVIDER_KEYS.map((key) => {
          const enabled = providers[key];
          const metadata = PROVIDER_METADATA[key];
          return (
            <button
              key={key}
              type="button"
              className={`search-provider-toggle${enabled ? " is-active" : ""}`}
              aria-pressed={enabled}
              title={metadata.description}
              onClick={() => onToggle(key, !enabled)}
            >
              <span className="search-provider-toggle-label">{metadata.label}</span>
            </button>
          );
        })}
      </div>
      {trimmedQuery && activeProviders.length > 0 ? (
        <div className="search-provider-action-row" aria-label="Launch quick searches">
          {activeProviders.map((key) => {
            const metadata = PROVIDER_METADATA[key];
            const href = metadata.buildUrl(trimmedQuery);
            return (
              <a
                key={key}
                className="search-provider-action"
                href={href}
                target="_blank"
                rel="noreferrer"
              >
                {metadata.label}
              </a>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
