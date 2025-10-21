import type { ReactNode } from "react";
import type { BookmarkEntry, SearchHistoryEntry } from "../types";

interface SidebarProps {
  isOpen: boolean;
  activeTab: "bookmarks" | "history" | "settings";
  onClose: () => void;
  onSelectTab: (tab: "bookmarks" | "history" | "settings") => void;
  bookmarks: BookmarkEntry[];
  history: SearchHistoryEntry[];
  onSelectHistoryItem: (query: string) => void;
  onDeleteHistoryItem: (entry: SearchHistoryEntry) => void;
  onRemoveBookmark: (identifier: string) => void;
  settingsPanel: ReactNode;
}

/**
 * Sidebar renders bookmarks, history, and the settings panel in a collapsible layout.
 */
export function Sidebar({
  isOpen,
  activeTab,
  onClose,
  onSelectTab,
  bookmarks,
  history,
  onSelectHistoryItem,
  onDeleteHistoryItem,
  onRemoveBookmark,
  settingsPanel
}: SidebarProps) {
  return (
    <aside className={`sidebar${isOpen ? " sidebar-open" : ""}`} aria-hidden={!isOpen}>
      <div className="sidebar-header">
        <h2>Library</h2>
        <button type="button" onClick={onClose} aria-label="Close sidebar">
          ✖️
        </button>
      </div>
      <nav className="sidebar-tabs" aria-label="Sidebar tabs">
        <button
          type="button"
          className={activeTab === "bookmarks" ? "active" : ""}
          onClick={() => onSelectTab("bookmarks")}
        >
          Bookmarks
        </button>
        <button
          type="button"
          className={activeTab === "history" ? "active" : ""}
          onClick={() => onSelectTab("history")}
        >
          History
        </button>
        <button
          type="button"
          className={activeTab === "settings" ? "active" : ""}
          onClick={() => onSelectTab("settings")}
        >
          Settings
        </button>
      </nav>
      <div className="sidebar-content">
        {activeTab === "bookmarks" ? (
          <ul className="sidebar-list">
            {bookmarks.length === 0 ? <li>No bookmarks yet.</li> : null}
            {bookmarks.map((bookmark) => (
              <li key={bookmark.identifier}>
                <div className="sidebar-list-item">
                  <a
                    href={
                      bookmark.archiveUrl ??
                      `https://archive.org/details/${encodeURIComponent(bookmark.identifier)}`
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    <strong>{bookmark.title || bookmark.identifier}</strong>
                    <div className="sidebar-item-meta">{bookmark.mediatype ?? "Unknown media"}</div>
                  </a>
                  <button type="button" onClick={() => onRemoveBookmark(bookmark.identifier)}>
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {activeTab === "history" ? (
          <ul className="sidebar-list">
            {history.length === 0 ? <li>No searches yet.</li> : null}
            {history.map((entry) => (
              <li key={`${entry.query}-${entry.timestamp}`}>
                <div className="sidebar-list-item history-list-item">
                  <div className="history-entry">
                    <button
                      type="button"
                      className="history-button"
                      onClick={() => onSelectHistoryItem(entry.query)}
                    >
                      {entry.query}
                    </button>
                    <div className="sidebar-item-meta">
                      {new Date(entry.timestamp).toLocaleString()}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="history-remove-button"
                    onClick={() => onDeleteHistoryItem(entry)}
                    aria-label={`Remove ${entry.query} from search history`}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {activeTab === "settings" ? settingsPanel : null}
      </div>
    </aside>
  );
}
