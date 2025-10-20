interface SettingsPanelProps {
  theme: "light" | "dark";
  filterNSFW: boolean;
  onToggleTheme: () => void;
  onToggleNSFW: (next: boolean) => void;
  onClearHistory: () => void;
  onClearBookmarks: () => void;
  onResetPreferences: () => void; // ADD: Handler to restore default preference values.
}

/**
 * SettingsPanel shows toggles for NSFW filtering, theme, and data cleanup actions.
 */
export function SettingsPanel({
  theme,
  filterNSFW,
  onToggleTheme,
  onToggleNSFW,
  onClearHistory,
  onClearBookmarks,
  onResetPreferences
}: SettingsPanelProps) {
  return (
    <div className="settings-panel">
      <div className="setting-row">
        <span>Theme</span>
        <button type="button" onClick={onToggleTheme}>
          {theme === "light" ? "Switch to dark" : "Switch to light"}
        </button>
      </div>
      <label className="setting-row">
        <span>Filter NSFW content</span>
        <input
          type="checkbox"
          checked={filterNSFW}
          onChange={(event) => onToggleNSFW(event.target.checked)}
        />
      </label>
      <button type="button" className="danger" onClick={onClearHistory}>
        Clear history
      </button>
      <button type="button" className="danger" onClick={onClearBookmarks}>
        Clear bookmarks
      </button>
      <button
        type="button"
        onClick={onResetPreferences} // ADD: Reset control clears cached preferences without touching saved library data.
      >
        Reset saved preferences
      </button>
    </div>
  );
}
