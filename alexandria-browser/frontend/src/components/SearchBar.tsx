import { useMemo } from "react";

import type { SearchMode } from "../types/search";

interface SearchBarProps {
  value: string;
  suggestions: string[];
  onChange: (next: string) => void;
  onSubmit: () => void;
  onSelectSuggestion: (suggestion: string) => void;
  isLoading?: boolean;
  searchMode?: SearchMode;
  onSearchModeChange?: (mode: SearchMode) => void;
}

/**
 * SearchBar renders the combined address/search bar with autocomplete styled for Harmonia.
 */
export function SearchBar({
  value,
  suggestions,
  onChange,
  onSubmit,
  onSelectSuggestion,
  isLoading = false,
  searchMode,
  onSearchModeChange
}: SearchBarProps) {
  const suggestionSet = useMemo(() => Array.from(new Set(suggestions)), [suggestions]);

  const handleSubmit = () => {
    onSubmit();
  };

  return (
    <div className="search-bar" role="search">
      <div className="search-bar-input">
        <span className="search-icon harmonia-node" aria-hidden="true">
          <span className="harmonia-pulse-ring" aria-hidden="true" />
          ⟁
        </span>
        <input
          list="alexandria-search-suggestions"
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="Seek the Alexandria archives or paste a URL"
          aria-label="Search the web and archives"
        />
        {searchMode && onSearchModeChange ? (
          <label className="search-mode-select">
            <span className="sr-only">Search Mode</span>
            <select
              value={searchMode}
              onChange={(event) => onSearchModeChange(event.target.value as SearchMode)}
              aria-label="Search Mode"
            >
              <option value="legacy">Legacy Search</option>
              <option value="ai">AI Assisted</option>
            </select>
          </label>
        ) : null}
        <button
          type="button"
          className="search-button harmonia-glow-button"
          onClick={handleSubmit}
          disabled={isLoading}
        >
          {isLoading ? (
            <span className="search-button-loading" aria-live="polite">
              <span className="button-spinner" aria-hidden="true" /> Searching…
            </span>
          ) : (
            "Initiate Search"
          )}
        </button>
      </div>

      <datalist id="alexandria-search-suggestions">
        {suggestionSet.map((item) => (
          <option key={item} value={item} />
        ))}
      </datalist>

      {suggestionSet.length > 0 ? (
        <div className="suggestions-list" aria-live="polite">
          {suggestionSet.slice(0, 5).map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="suggestion-chip harmonia-chip"
              onClick={() => onSelectSuggestion(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
