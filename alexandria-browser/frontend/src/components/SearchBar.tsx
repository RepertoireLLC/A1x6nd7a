import { useMemo } from "react";

interface SearchBarProps {
  value: string;
  suggestions: string[];
  onChange: (next: string) => void;
  onSubmit: () => void;
  onSelectSuggestion: (suggestion: string) => void;
}

/**
 * SearchBar renders the combined address/search bar with autocomplete.
 */
export function SearchBar({
  value,
  suggestions,
  onChange,
  onSubmit,
  onSelectSuggestion
}: SearchBarProps) {
  const suggestionSet = useMemo(() => Array.from(new Set(suggestions)), [suggestions]);

  return (
    <div className="search-bar" role="search">
      <input
        list="alexandria-search-suggestions"
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onSubmit();
          }
        }}
        placeholder="Search the archives or paste a URL..."
        aria-label="Search the web and archives"
      />
      <datalist id="alexandria-search-suggestions">
        {suggestionSet.map((item) => (
          <option key={item} value={item} />
        ))}
      </datalist>
      <button type="button" className="search-button" onClick={onSubmit} aria-label="Search">
        Search
      </button>
      <div className="suggestions-list" aria-live="polite">
        {suggestionSet.slice(0, 5).map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="suggestion-chip"
            onClick={() => onSelectSuggestion(suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}
