/** What the game remembers about the player across fights (localStorage "arena.memory"). Fed into Jev's snapshot: each boss opens with what
 *  beat the player last time, and Echo reads the player's profile aggregated over every boss. */
export interface Habits {
  rollDirections?: { toward: number; away: number; sideways: number };
  guardTapLeadMs?: number;
  attacksIntoRecovery: number;
  attacksIntoWindup: number;
}
export interface BossMemory {
  attempts: number;
  wins: number;
  /** how many times each move of this boss hit the player */
  landed: Record<string, number>;
  habits?: Habits;
}
export type MemoryStore = Record<string, BossMemory>;
const KEY = "arena.memory";

export function loadMemory(): MemoryStore {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}
export function saveMemory(m: MemoryStore) {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* private mode: the run just does not remember */
  }
}

export function remember(store: MemoryStore, boss: string, won: boolean, landed: Record<string, number>, habits: Habits): MemoryStore {
  const m = (store[boss] ??= { attempts: 0, wins: 0, landed: {} });
  m.attempts++;
  if (won) m.wins++;
  for (const [k, n] of Object.entries(landed)) m.landed[k] = (m.landed[k] ?? 0) + n;
  m.habits = habits;
  return store;
}

const usualOf = (r: { toward: number; away: number; sideways: number }) => (r.toward >= r.away && r.toward >= r.sideways ? "toward" : r.away >= r.sideways ? "away" : "sideways");

/** The short form Jev reads for one boss. */
export function memoryFor(store: MemoryStore, boss: string) {
  const m = store[boss];
  if (!m) return undefined;
  const top = Object.entries(m.landed).sort((a, b) => b[1] - a[1]).slice(0, 3).filter(([, n]) => n > 0).map(([k]) => k);
  const r = m.habits?.rollDirections;
  return { attempts: m.attempts, wins: m.wins, movesThatLandedMost: top, usualRoll: r ? usualOf(r) : undefined, usualGuardTapLeadMs: m.habits?.guardTapLeadMs };
}

/** Echo's view: habits merged across every boss fought so far. */
export function profile(store: MemoryStore, exclude = "echo") {
  const roll = { toward: 0, away: 0, sideways: 0 };
  let leadSum = 0, leadN = 0, greedy = 0, punish = 0, fights = 0;
  for (const [id, m] of Object.entries(store)) {
    if (id === exclude || !m.habits) continue;
    fights += m.attempts;
    const r = m.habits.rollDirections;
    if (r) { roll.toward += r.toward; roll.away += r.away; roll.sideways += r.sideways; }
    if (m.habits.guardTapLeadMs != null) { leadSum += m.habits.guardTapLeadMs; leadN++; }
    greedy += m.habits.attacksIntoWindup;
    punish += m.habits.attacksIntoRecovery;
  }
  if (!fights) return undefined;
  const rt = roll.toward + roll.away + roll.sideways;
  return { fightsSoFar: fights, usualRoll: rt ? usualOf(roll) : undefined, averageGuardTapLeadMs: leadN ? Math.round(leadSum / leadN) : undefined, greedySwings: greedy, punishingSwings: punish };
}
