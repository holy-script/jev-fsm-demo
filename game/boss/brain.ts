import { BOSSES, type BossDef } from "./defs";

export interface BossSnapshot {
  boss: {
    name: string;
    hpPct: number;
    phase: 1 | 2;
    state: string;
    msInState: number;
    lastActions: string[];
    sameActionStreak: number;
    justStaggered: boolean;
  };
  player: {
    hpPct: number;
    action: "idle" | "running" | "jumping" | "attacking" | "dashing" | "stunned";
    airborne: boolean;
    facingBoss: boolean;
    dashReady: boolean;
    attacksInLast4s: number;
    dashesInLast4s: number;
    jumpsInLast4s: number;
    standingStillMs: number;
  };
  distancePx: number;
  playerIsVerticallyAboveBoss: boolean;
  bossDistanceToWallBehindPx: number;
  inRange: Record<string, boolean>;
  damageDealtToPlayerLast6s: number;
  damageTakenFromPlayerLast6s: number;
}

export interface BossDecision {
  state: string;
  reason: string;
  source: "jev" | "rules" | "fallback";
  latencyMs: number;
  probabilities?: Record<string, number>;
  error?: string;
}

const rangeText = (r: [number, number]) => (r[0] === 0 && r[1] >= 500 ? "any range" : `best at ${r[0]}-${r[1]}px`);

export function buildQuestion(def: BossDef, available: string[]) {
  const instructions =
    `You control ${def.name}, ${def.title}: a boss in a 2D side-view hack-and-slash duel against a human knight. ` +
    `The knight has a short-reach sword, a jump, and a dash with brief invulnerability. ${def.persona} ` +
    `Choose the boss's NEXT action. Weigh distance, which attacks are in range, what the player is doing right now, ` +
    `the player's habits (attack/dash/jump counts, standing still), your health, and your recent actions. ` +
    `Do not repeat the same action over and over if the player is adapting to it. Only the listed actions are currently available.`;
  const criteria: Record<string, string> = {};
  for (const s of available) {
    const st = def.states[s];
    criteria[s] = st.attack ? `${st.desc} (${rangeText(st.attack.range)})` : st.desc;
  }
  return { instructions, criteria };
}

export async function askJev(def: BossDef, snap: BossSnapshot, available: string[]): Promise<BossDecision> {
  const t0 = performance.now();
  const res = await fetch("/api/jev/boss", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: snap, ...buildQuestion(def, available) }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
  return { state: j.state, reason: j.reason, probabilities: j.probabilities, source: "jev", latencyMs: Math.round(performance.now() - t0) };
}

/** The baseline opponent: fixed priorities, no memory, no randomness. Also Jev's fallback. */
export function rulesDecision(def: BossDef, snap: BossSnapshot, available: string[], source: BossDecision["source"] = "rules"): BossDecision {
  const d = snap.distancePx;
  const attacks = available.filter((s) => def.states[s].attack);
  const moves = available.filter((s) => def.states[s].move);
  const find = (mode: string) => moves.find((s) => def.states[s].move!.mode === mode);
  const maxReach = Math.max(...Object.values(def.states).filter((s) => s.attack).map((s) => s.attack!.range[1]));
  const minReach = Math.min(...Object.values(def.states).filter((s) => s.attack).map((s) => s.attack!.range[0]));

  const inRange = attacks.find((s) => d >= def.states[s].attack!.range[0] && d <= def.states[s].attack!.range[1]);
  let state = "IDLE", reason = "waiting";
  if (inRange) [state, reason] = [inRange, "player in range"];
  else if (d > maxReach) [state, reason] = [find("toward") ?? "IDLE", "player too far"];
  else if (d < minReach) [state, reason] = [find("away") ?? "IDLE", "player too close"];
  else [state, reason] = [find("toward") ?? "IDLE", "closing in"];
  return { state, reason, source, latencyMs: 0 };
}

export const BOSS_COUNT = BOSSES.length;
