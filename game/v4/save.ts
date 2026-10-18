/** Run saves: three slots in localStorage ("arena.save.1..3"). A run is the sequence of bosses; learned habits live in memory.ts and persist across runs. */
export interface RunSave {
  slot: number;
  /** index into ENCOUNTERS of the boss to fight next */
  bossIndex: number;
  cleared: string[];
  deaths: number;
  playMs: number;
  finished: boolean;
  /** shrine perks chosen so far (perks.ts ids) */
  perks: string[];
  updated: number;
}
export const SLOTS = [1, 2, 3];
const key = (slot: number) => `arena.save.${slot}`;

export const newRun = (slot: number): RunSave => ({ slot, bossIndex: 0, cleared: [], deaths: 0, playMs: 0, finished: false, perks: [], updated: Date.now() });

export function loadSave(slot: number): RunSave | null {
  try {
    const v = JSON.parse(localStorage.getItem(key(slot)) ?? "null");
    return v && typeof v.bossIndex === "number" ? { ...newRun(slot), ...v, slot } : null;
  } catch {
    return null;
  }
}
export function writeSave(run: RunSave) {
  run.updated = Date.now();
  try {
    localStorage.setItem(key(run.slot), JSON.stringify(run));
  } catch {
    /* private mode */
  }
}
export function deleteSave(slot: number) {
  try {
    localStorage.removeItem(key(slot));
  } catch {
    /* ignore */
  }
}
export const listSaves = () => SLOTS.map((s) => loadSave(s));
