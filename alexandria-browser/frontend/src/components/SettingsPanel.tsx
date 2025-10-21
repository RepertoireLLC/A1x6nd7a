import type { NSFWFilterMode } from "../types";

interface SettingsPanelProps {
  theme: "light" | "dark";
  nsfwFilterMode: NSFWFilterMode;
  onToggleTheme: () => void;
  onChangeNSFWMode: (next: NSFWFilterMode) => void;
  onClearHistory: () => void;
  onClearBookmarks: () => void;
  onResetPreferences: () => void; // ADD: Handler to restore default preference values.
}

/**
 * SettingsPanel shows toggles for NSFW filtering, theme, and data cleanup actions.
 */
export function SettingsPanel({
  theme,
  nsfwFilterMode,
  onToggleTheme,
  onChangeNSFWMode,
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
        <span>Safe search</span>
        <select
          value={nsfwFilterMode}
          onChange={(event) => onChangeNSFWMode(event.target.value as NSFWFilterMode)}
        >
          <option value="safe">Safe search (hide NSFW)</option>
          <option value="moderate">Moderate (blur NSFW)</option>
          <option value="off">No restriction</option>
          <option value="only">Only NSFW</option>
        </select>
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
