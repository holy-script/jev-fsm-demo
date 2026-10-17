/** Player settings (localStorage "arena.settings"; the ?qte= query parameter overrides for tests). */
export type QteMode = "on" | "assist" | "off";
export interface ArenaSettings {
  qte: QteMode;
}
const KEY = "arena.settings";
const DEFAULTS: ArenaSettings = { qte: "on" };

export function loadSettings(): ArenaSettings {
  let s = { ...DEFAULTS };
  try {
    s = { ...s, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    /* private mode or bad JSON: defaults */
  }
  const q = new URLSearchParams(window.location.search).get("qte");
  if (q === "on" || q === "assist" || q === "off") s.qte = q;
  return s;
}
export function saveSettings(s: ArenaSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}
