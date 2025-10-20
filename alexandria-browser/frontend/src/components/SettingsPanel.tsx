interface SettingsPanelProps {
  theme: "light" | "dark";
  filterNSFW: boolean;
  onToggleTheme: () => void;
  onToggleNSFW: (next: boolean) => void;
  onClearHistory: () => void;
  onClearBookmarks: () => void;
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
  onClearBookmarks
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
    </div>
  );
}
