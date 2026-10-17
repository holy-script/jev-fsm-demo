import type { BossDef, GateDef, MoveDef } from "./data";

export type Outcome = "deflected" | "blocked" | "dodged" | "hit" | "slipped" | "missed";
export type Reaction = "roll" | "guard" | "attack" | "retreat" | "none";

interface MoveStats {
  thrown: number;
  deflected: number;
  blocked: number;
  dodged: number;
  hit: number;
  slipped: number;
  missed: number;
  react: Record<Reaction, number>;
}
const blankStats = (): MoveStats => ({ thrown: 0, deflected: 0, blocked: 0, dodged: 0, hit: 0, slipped: 0, missed: 0, react: { roll: 0, guard: 0, attack: 0, retreat: 0, none: 0 } });

type EventType = "attack" | "guard" | "deflect" | "roll" | "kick" | "heal" | "hurt";

/** What Jev gets to know about the player: rolling windows of actions plus, per boss move, how the player has answered it. */
export class Telemetry {
  private events: { t: number; type: EventType }[] = [];
  vsMove: Record<string, MoveStats> = {};
  lastOutcome: { move: string; outcome: Outcome } | null = null;
  private window: { move: string; t0: number; dist0: number; first: Reaction | null } | null = null;
  private dists: { t: number; d: number }[] = [];

  reset() {
    this.events = [];
    this.vsMove = {};
    this.lastOutcome = null;
    this.window = null;
    this.dists = [];
  }

  record(type: EventType, now: number) {
    this.events.push({ t: now, type });
    if (this.events.length > 200) this.events.shift();
  }
  sampleDistance(now: number, d: number) {
    const last = this.dists[this.dists.length - 1];
    if (!last || now - last.t >= 100) this.dists.push({ t: now, d });
    while (this.dists.length && now - this.dists[0].t > 1500) this.dists.shift();
  }
  trend(): "closing" | "holding" | "retreating" {
    if (this.dists.length < 4) return "holding";
    const a = this.dists[0].d, b = this.dists[this.dists.length - 1].d;
    return b - a < -14 ? "closing" : b - a > 14 ? "retreating" : "holding";
  }

  attackStart(move: string, now: number, dist: number) {
    (this.vsMove[move] ??= blankStats()).thrown++;
    this.closeWindow();
    this.window = { move, t0: now, dist0: dist, first: null };
  }
  /** The player's first answer to a boss attack, within 700ms of its start. */
  react(kind: Reaction, now: number) {
    const w = this.window;
    if (!w || w.first || now - w.t0 > 700) return;
    w.first = kind;
    this.vsMove[w.move].react[kind]++;
  }
  watchRetreat(now: number, dist: number) {
    const w = this.window;
    if (w && !w.first && now - w.t0 < 700 && dist - w.dist0 > 14) this.react("retreat", now);
  }
  closeWindow() {
    const w = this.window;
    if (w && !w.first) this.vsMove[w.move].react.none++;
    this.window = null;
  }
  outcome(move: string, outcome: Outcome) {
    (this.vsMove[move] ??= blankStats())[outcome]++;
    this.lastOutcome = { move, outcome };
  }

  recent(now: number, ms: number) {
    const e = this.events.filter((x) => now - x.t <= ms);
    const n = (t: EventType) => e.filter((x) => x.type === t).length;
    return { windowSec: ms / 1000, attacks: n("attack"), guardTaps: n("guard"), deflects: n("deflect"), rolls: n("roll"), kicks: n("kick"), heals: n("heal"), hitsTaken: n("hurt") };
  }

  /** Compact per-move record: only moves that have been thrown. */
  summary() {
    const out: Record<string, unknown> = {};
    for (const [m, s] of Object.entries(this.vsMove)) {
      if (!s.thrown) continue;
      out[m] = { thrown: s.thrown, deflected: s.deflected, blocked: s.blocked, dodged: s.dodged, slipped: s.slipped, hit: s.hit, firstReaction: s.react };
    }
    return out;
  }
}

export interface DuelSnapshot {
  boss: { segment: number; ofSegments: number; phase: 1 | 2; hpPct: number; posturePct: number; armored: boolean; mode: string; lastActions: string[]; sameActionStreak: number };
  player: {
    hpPct: number; posturePct: number; healsLeft: number; state: string; distancePx: number; distanceTrend: string; standingStillMs: number;
    guardHeld: boolean;
  };
  recent: ReturnType<Telemetry["recent"]>;
  vsMove: Record<string, unknown>;
  lastOutcome: { move: string; outcome: string } | null;
  reachable: Record<string, boolean>;
  timing: { mode: "beat" | "classic"; beatMs: number };
  gate?: { move: string; step: number };
}

export interface Reads {
  turtling: number;
  rollReliant: number;
  tradeHungry: number;
  panicking: number;
  predictability: number; // 0..3
}

export interface Decision {
  kind: "idle" | "gate";
  label: string;
  choice: string;
  probabilities?: Record<string, number>;
  reads?: Reads;
  latencyMs: number;
  source: "jev" | "rules" | "fallback";
  error?: string;
}

// ---------------------------------------------------------------- prompts
const RULES_TEXT = `Both fighters have HP and a posture bar (full posture = staggered and open to a deathblow).
Rules you must reason with:
- The player DEFLECTS a normal or heavy attack by tapping guard just before impact: no damage to them and YOUR posture rises. Holding guard instead BLOCKS: tiny chip damage, THEIR posture rises. They can only deflect if they tap shortly before the hit, so a delayed swing (a long pause before impact) beats players who tap early.
- Moves marked unblockable (perilous thrust, sweep, grab, laser) cannot be blocked or deflected. Rolling gives the player brief invulnerability: it beats a sweep or a beam, and rolling INTO a thrust makes them SLIP you (+30 posture on you). A grab ignores guard AND roll invulnerability: only distance avoids it.
- A thrown projectile can be blocked, rolled through, or deflected back at you if the player's guard tap is well timed (then YOUR posture rises).
- The player's kick breaks a raised guard unless the move description says otherwise.
- A player who always answers the same way (always rolls, always deflects, always attacks first) can be punished by the move that beats that answer.
- When snapshot.timing.mode is "beat", the fight is choreographed to a musical beat (timing.beatMs per beat): your attacks land ON the beat, and a DELAY lands half a beat OFF it. A player who taps guard on the beat deflects on-beat attacks easily but is beaten by off-beat ones.
Play to win but stay unpredictable: do not repeat the same action over and over, and adapt to the habits shown in the data.`;

const mechanics = (def: BossDef) => `You control ${def.name}, ${def.title}, a boss in a Sekiro-style duel against a human swordsman. ${def.persona}\n${RULES_TEXT}`;

export const ACTION_DESC: Record<string, string> = {
  APPROACH: "Walk toward the player to close the distance.",
  BACKSTEP: "Step back to reset spacing or bait the player into overextending.",
  CIRCLE: "Circle around the player to change the angle and bait a reaction.",
  WAIT: "Stand still, shield slightly up, watching. Reads the player and delays your next attack.",
  GUARD: "Raise your shield for about 1.5s. Their sword hits then only raise your posture a little, but their kick breaks it. Good against a player who spams attacks or trades hits; poor against one who waits.",
};

export function idleQuestions(def: BossDef, available: string[], withReads = true) {
  const criteria: Record<string, string> = {};
  for (const id of available) {
    const mv = def.moves[id];
    criteria[id] = mv ? `${mv.desc} (${mv.reach && mv.reach < 5000 ? `reach ~${mv.reach}px` : "any distance"})` : def.actionDesc?.[id] ?? ACTION_DESC[id] ?? id;
  }
  const questions: Record<string, unknown> = {
    next_action: {
      type: "choice",
      instructions: `${mechanics(def)}\n\nChoose the boss's NEXT action. Consider distance, reachability, the player's state and posture, your own posture, your recent actions, the last outcome, and what the player's habits against each of your moves say about what will work now.`,
      criteria,
    },
  };
  if (withReads) Object.assign(questions, {
    turtling: { type: "noul", instructions: "Is the player playing defensively: mostly guarding, deflecting or retreating, and rarely attacking?" },
    roll_reliant: { type: "noul", instructions: "Does the player rely on rolling as their main way of avoiding the boss's attacks?" },
    trade_hungry: { type: "noul", instructions: "Is the player greedy: attacking into the boss's moves or right after being hit, instead of defending first?" },
    panicking: { type: "noul", instructions: "Is the player in trouble (low health, high posture, or low on heals) and likely to make a rushed or defensive mistake?" },
    predictability: {
      type: "score",
      instructions: "How predictable is the player's behaviour against the boss's attacks so far?",
      criteria: ["erratic, no pattern", "slight tendencies", "a clear pattern", "highly predictable, answers the same way every time"],
    },
  });
  return questions;
}

export function gateQuestions(def: BossDef, move: MoveDef, gate: GateDef, phase: 1 | 2) {
  const criteria: Record<string, string> = {};
  for (const o of gate.options) {
    if (o.phase2 && phase < 2) continue;
    criteria[o.id] = o.desc;
  }
  return {
    gate_choice: {
      type: "choice",
      instructions: `${mechanics(def)}\n\nYou are mid-combo: ${move.label}. The first hit just resolved (see lastOutcome). Decide how the combo continues. React to how the player answered: e.g. if they deflected early, a delayed swing or a feint beats them; if they rolled, a grab or a chained thrust may punish; if they got hit, pressing on is usually right.`,
      criteria,
    },
  };
}

// ---------------------------------------------------------------- client
interface Answers {
  [k: string]: { type: string; choice?: string; probabilities?: Record<string, number>; noul?: number; score?: number };
}

async function ask(state: unknown, questions: Record<string, unknown>): Promise<Answers> {
  const res = await fetch("/api/jev/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state, questions }) });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
  return j.answers;
}

const readsFrom = (a: Answers): Reads | undefined =>
  a.turtling
    ? { turtling: a.turtling.noul ?? 0, rollReliant: a.roll_reliant?.noul ?? 0, tradeHungry: a.trade_hungry?.noul ?? 0, panicking: a.panicking?.noul ?? 0, predictability: a.predictability?.score ?? 0 }
    : undefined;

export async function askIdle(def: BossDef, snap: DuelSnapshot, available: string[], label: string): Promise<Decision> {
  const t0 = performance.now();
  const a = await ask(snap, idleQuestions(def, available) as Record<string, unknown>);
  const r = a.next_action;
  if (!r?.choice || !available.includes(r.choice)) throw new Error(`Jev picked an unavailable action: ${r?.choice}`);
  return { kind: "idle", label, choice: r.choice, probabilities: r.probabilities, reads: readsFrom(a), latencyMs: Math.round(performance.now() - t0), source: "jev" };
}

export async function askGate(def: BossDef, move: MoveDef, gate: GateDef, snap: DuelSnapshot, phase: 1 | 2, label: string): Promise<Decision> {
  const t0 = performance.now();
  const q = gateQuestions(def, move, gate, phase);
  const a = await ask(snap, q as Record<string, unknown>);
  const r = a.gate_choice;
  if (!r?.choice || !(r.choice in q.gate_choice.criteria)) throw new Error(`Jev picked an unavailable branch: ${r?.choice}`);
  return { kind: "gate", label, choice: r.choice, probabilities: r.probabilities, latencyMs: Math.round(performance.now() - t0), source: "jev" };
}

// ---------------------------------------------------------------- rules (baseline + fallback)
function weighted<T>(items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [v, w] of items) if ((r -= w) <= 0) return v;
  return items[items.length - 1][0];
}

export function rulesIdle(def: BossDef, snap: DuelSnapshot, available: string[], source: "rules" | "fallback" = "rules", error?: string): Decision {
  const d = snap.player.distancePx;
  const table = d <= 92 ? def.weights.close : d <= 150 ? def.weights.mid : def.weights.far ?? ([["APPROACH", 1]] as [string, number][]);
  const last = snap.boss.lastActions[snap.boss.lastActions.length - 1];
  let pool = table.filter(([id]) => available.includes(id)).map(([id, w]) => [id, id === last ? w * 0.3 : w] as [string, number]);
  if (!pool.length) pool = [[available.includes("APPROACH") ? "APPROACH" : available[0], 1]];
  return { kind: "idle", label: "rules", choice: weighted(pool), latencyMs: 0, source, error };
}

export function rulesGate(gate: GateDef, phase: 1 | 2, source: "rules" | "fallback" = "rules", error?: string): Decision {
  const opts = gate.options.filter((o) => !o.phase2 || phase >= 2);
  const choice = Math.random() < 0.7 ? gate.default : opts[Math.floor(Math.random() * opts.length)].id;
  return { kind: "gate", label: "rules", choice, latencyMs: 0, source, error };
}
