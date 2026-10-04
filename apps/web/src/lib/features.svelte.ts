/**
 * Device preferences (⚙ Settings → This device), kept in this device's app
 * storage: theme, view mode when opening a note, text size, and the checks
 * for vaults shared with other people or apps (watching the folder for
 * changes made elsewhere, checking a note was not changed on disk before
 * saving it, listing OneDrive conflict copies; off by default).
 */
export type Theme = "auto" | "light" | "dark";
export type StartMode = "auto" | "edit" | "split" | "view";

export interface Prefs {
  theme: Theme;
  startMode: StartMode;
  /** Note text size in px (editor and preview). */
  textSize: number;
  multiUser: boolean;
  /** Sidebar width (px) and editor share of the Split view (0–1), set by dragging. */
  sidebarWidth: number;
  split: number;
}

const KEY = "zeolite.prefs";
const DEFAULTS: Prefs = { theme: "auto", startMode: "auto", textSize: 15, multiUser: false, sidebarWidth: 290, split: 0.5 };
export const DEFAULT_LAYOUT = { sidebarWidth: DEFAULTS.sidebarWidth, split: DEFAULTS.split };

function load(): Prefs {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Prefs>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export const prefs = $state<Prefs>(load());

export function savePrefs(next: Prefs) {
  Object.assign(prefs, next);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Not kept: defaults next time.
  }
  applyPrefs();
}

/** Theme and text size on the page. */
export function applyPrefs() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (prefs.theme === "auto") delete root.dataset.theme;
  else root.dataset.theme = prefs.theme;
  root.style.setProperty("--note-size", `${prefs.textSize}px`);
}

/** Whether the shared-folder checks are on (read where they run, so a change applies at once). */
export const multiUserChecks = () => prefs.multiUser;
