import { DEFAULT_KEYMAP, normaliseKeymap, type Keymap } from "./input";

/** Player settings (localStorage "arena.settings"; ?qte= overrides for tests). */
export type QteMode = "on" | "assist" | "off";
export interface ArenaSettings {
  qte: QteMode;
  keymap: Keymap;
  music: boolean;
  sfx: number; // 0..1
  shake: boolean;
  /** which brain bosses start with: jev, or the rules bot (for comparison runs) */
  brain: "jev" | "rules";
}
const KEY = "arena.settings";
const DEFAULTS: ArenaSettings = { qte: "on", keymap: DEFAULT_KEYMAP, music: true, sfx: 0.8, shake: true, brain: "jev" };

export function loadSettings(): ArenaSettings {
  let s: ArenaSettings = { ...DEFAULTS, keymap: { ...DEFAULT_KEYMAP } };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    s = { ...s, ...raw, keymap: normaliseKeymap(raw.keymap) };
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
