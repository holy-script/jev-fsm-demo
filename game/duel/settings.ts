// Player settings and save data, persisted in localStorage (every access is guarded: it can be unavailable).
export interface Settings {
  beat: "beat" | "classic"; // choreographed (beat grid) or classic timing
  difficulty: "assist" | "duelist" | "shadow";
  music: boolean;
  sfx: number; // 0..1
}

export const DIFFICULTY = {
  assist: { label: "Assist", dealt: 1.3, received: 0.65, deflectMs: 220, blurb: "Wider deflect window, you deal more and take less." },
  duelist: { label: "Duelist", dealt: 1, received: 1, deflectMs: 160, blurb: "The intended balance." },
  shadow: { label: "Shadow", dealt: 0.9, received: 1.3, deflectMs: 130, blurb: "A tight deflect window and punishing hits." },
} as const;

const DEFAULTS: Settings = { beat: "beat", difficulty: "duelist", music: true, sfx: 0.8 };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode etc: settings just won't persist */
  }
}

export const settings: Settings = read("duel.settings", DEFAULTS);
export const saveSettings = () => write("duel.settings", settings);

export interface SaveData {
  cleared: string[]; // boss ids defeated
  deaths: number;
  skills: string[]; // unlocked skill ids
  points: number; // unspent skill points
}
const FRESH: SaveData = { cleared: [], deaths: 0, skills: [], points: 2 };
export const save: SaveData = read("duel.save", { ...FRESH });
export const saveGame = () => write("duel.save", save);
export const resetSave = () => {
  Object.assign(save, { ...FRESH, cleared: [], skills: [] });
  saveGame();
};
