/** Per-fight records and the Jev-vs-rules comparison (localStorage "arena.stats", newest last, capped). Pure functions plus load/save. */
export type BrainTag = "jev" | "rules" | "mixed";
export interface FightRecord {
  boss: string;
  brain: BrainTag;
  /** the player won */
  won: boolean;
  ms: number;
  hpLost: number;
  thrown: number;
  deflected: number;
  countered: number;
  blocked: number;
  dodged: number;
  hit: number;
  decisions: { jev: number; rules: number; fallback: number };
  /** summed Jev answer latency */
  jevMs: number;
  at: number;
}
const KEY = "arena.stats";
const CAP = 200;

export function loadStats(): FightRecord[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
export function saveStats(list: FightRecord[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(-CAP)));
  } catch {
    /* private mode */
  }
}
export function addRecord(list: FightRecord[], r: FightRecord): FightRecord[] {
  list.push(r);
  return list.slice(-CAP);
}

export interface BrainSummary {
  fights: number;
  /** fights the boss won (the player lost) */
  bossWins: number;
  bossWinRate: number;
  avgSeconds: number;
  avgHpLost: number;
  /** share of the boss's attacks the player deflected or countered */
  parryRate: number;
  /** share of the boss's attacks that landed */
  hitRate: number;
  avgJevMs: number;
}
const blank = (): BrainSummary => ({ fights: 0, bossWins: 0, bossWinRate: 0, avgSeconds: 0, avgHpLost: 0, parryRate: 0, hitRate: 0, avgJevMs: 0 });

/** Aggregate by brain (mixed fights are left out of the comparison). */
export function aggregate(list: FightRecord[]): { jev: BrainSummary; rules: BrainSummary } {
  const out = { jev: blank(), rules: blank() };
  for (const k of ["jev", "rules"] as const) {
    const rs = list.filter((r) => r.brain === k);
    if (!rs.length) continue;
    const sum = (f: (r: FightRecord) => number) => rs.reduce((s, r) => s + f(r), 0);
    const thrown = sum((r) => r.thrown);
    const jevN = sum((r) => r.decisions.jev);
    out[k] = {
      fights: rs.length,
      bossWins: rs.filter((r) => !r.won).length,
      bossWinRate: rs.filter((r) => !r.won).length / rs.length,
      avgSeconds: sum((r) => r.ms) / rs.length / 1000,
      avgHpLost: sum((r) => r.hpLost) / rs.length,
      parryRate: thrown ? sum((r) => r.deflected + r.countered) / thrown : 0,
      hitRate: thrown ? sum((r) => r.hit) / thrown : 0,
      avgJevMs: jevN ? sum((r) => r.jevMs) / jevN : 0,
    };
  }
  return out;
}
