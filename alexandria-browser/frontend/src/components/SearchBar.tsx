import { useMemo } from "react";

interface SearchBarProps {
  value: string;
  suggestions: string[];
  onChange: (next: string) => void;
  onSubmit: (sanitizedValue: string) => void;
  onSelectSuggestion: (suggestion: string) => void;
}

function sanitizeInputValue(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * SearchBar renders the combined address/search bar with autocomplete styled for Harmonia.
 */
export function SearchBar({
  value,
  suggestions,
  onChange,
  onSubmit,
  onSelectSuggestion
}: SearchBarProps) {
  const suggestionSet = useMemo(() => Array.from(new Set(suggestions)), [suggestions]);

  const handleSubmit = () => {
    const sanitizedValue = sanitizeInputValue(value);
    if (sanitizedValue !== value) {
      onChange(sanitizedValue);
    }
    onSubmit(sanitizedValue);
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
        <button type="button" className="search-button harmonia-glow-button" onClick={handleSubmit}>
          Initiate Search
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
