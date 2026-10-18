import type { BossDef } from "./bosses";
import { GENERIC_ACTIONS } from "./bosses";
import type { EnemyAttack, GateDef } from "./data";
import type { Habits } from "./memory";

/** The boss's decision-making: Jev (through /api/jev/ask) with a hand-written rules bot as fallback and as the comparison opponent.
 *  Jev only chooses among options the engine says are legal right now; the engine validates and executes. See docs/02. */

export type Outcome = "deflected" | "blocked" | "dodged" | "hit" | "countered" | "missed" | "leapt";
export type Reaction = "roll" | "guard" | "attack" | "none";

interface MoveStats {
  thrown: number;
  deflected: number;
  blocked: number;
  dodged: number;
  hit: number;
  countered: number;
  leapt: number;
  react: Record<Reaction, number>;
}
const blank = (): MoveStats => ({ thrown: 0, deflected: 0, blocked: 0, dodged: 0, hit: 0, countered: 0, leapt: 0, react: { roll: 0, guard: 0, attack: 0, none: 0 } });
type EventType = "attack" | "guard" | "deflect" | "roll" | "hurt" | "skill" | "counter" | "jump" | "dash";

/** What Jev gets to know about the player: rolling windows of actions plus how the player has answered each move. */
export class Telemetry {
  private events: { t: number; type: EventType }[] = [];
  vsMove: Record<string, MoveStats> = {};
  lastOutcome: { move: string; outcome: Outcome } | null = null;
  private window: { move: string; t0: number; first: Reaction | null } | null = null;
  rolls = { toward: 0, away: 0, side: 0 };
  private leadSum = 0;
  private leadN = 0;
  swings = { punish: 0, greedy: 0 };
  landed: Record<string, number> = {};

  reset() {
    this.events = [];
    this.vsMove = {};
    this.lastOutcome = null;
    this.window = null;
    this.rolls = { toward: 0, away: 0, side: 0 };
    this.leadSum = this.leadN = 0;
    this.swings = { punish: 0, greedy: 0 };
    this.landed = {};
  }
  record(type: EventType, now: number) {
    this.events.push({ t: now, type });
    if (this.events.length > 200) this.events.shift();
  }
  rollDir(rel: number) {
    this.rolls[rel > 0.5 ? "toward" : rel < -0.5 ? "away" : "side"]++;
  }
  deflectLead(ms: number) {
    this.leadSum += ms;
    this.leadN++;
  }
  attackStart(move: string, now: number) {
    (this.vsMove[move] ??= blank()).thrown++;
    this.closeWindow();
    this.window = { move, t0: now, first: null };
  }
  react(kind: Reaction, now: number) {
    const w = this.window;
    if (!w || w.first || now - w.t0 > 900) return;
    w.first = kind;
    this.vsMove[w.move].react[kind]++;
  }
  closeWindow() {
    const w = this.window;
    if (w && !w.first) this.vsMove[w.move].react.none++;
    this.window = null;
  }
  outcome(move: string, outcome: Outcome) {
    if (outcome === "missed") return;
    (this.vsMove[move] ??= blank())[outcome]++;
    this.lastOutcome = { move, outcome };
    if (outcome === "hit") this.landed[move] = (this.landed[move] ?? 0) + 1;
  }
  habits(): Habits {
    const r = this.rolls, rt = r.toward + r.away + r.side;
    return {
      rollDirections: rt ? { toward: r.toward, away: r.away, sideways: r.side } : undefined,
      guardTapLeadMs: this.leadN ? Math.round(this.leadSum / this.leadN) : undefined,
      attacksIntoRecovery: this.swings.punish,
      attacksIntoWindup: this.swings.greedy,
    };
  }
  recent(now: number, ms: number) {
    const e = this.events.filter((x) => now - x.t <= ms);
    const n = (t: EventType) => e.filter((x) => x.type === t).length;
    return { windowSec: ms / 1000, attacks: n("attack"), guardTaps: n("guard"), deflects: n("deflect"), counters: n("counter"), rolls: n("roll"), jumps: n("jump"), dashes: n("dash"), hitsTaken: n("hurt"), skills: n("skill") };
  }
  summary() {
    const out: Record<string, unknown> = {};
    for (const [m, s] of Object.entries(this.vsMove)) if (s.thrown) out[m] = { thrown: s.thrown, deflected: s.deflected, blocked: s.blocked, dodged: s.dodged, countered: s.countered, leapt: s.leapt, hit: s.hit, firstReaction: s.react };
    return out;
  }
}

export interface Snapshot {
  boss: { name: string; phase: 1 | 2; hpPct: number; posturePct: number; mode: string; lastActions: string[]; sameActionStreak: number };
  player: { hpPct: number; posturePct: number; spirit: number; state: string; airborne: boolean; distancePx: number; guardHeld: boolean; riposteReady: boolean; standingStillMs: number };
  recent: ReturnType<Telemetry["recent"]>;
  vsMove: Record<string, unknown>;
  lastOutcome: { move: string; outcome: string } | null;
  habits: Habits;
  memory?: unknown;
  profile?: unknown;
  reachable: Record<string, boolean>;
  fairness: { perilousStreak: number; perilousCapped: boolean };
  gate?: { move: string; afterHit: number };
}

export interface Decision {
  kind: "idle" | "gate";
  /** short human label: the chosen action plus its probability */
  label: string;
  choice: string;
  probabilities?: Record<string, number>;
  reads?: { turtling: number; rollReliant: number; tradeHungry: number; panicking: number };
  taunt?: string;
  latencyMs: number;
  source: "jev" | "rules" | "fallback";
  error?: string;
}

const RULES_TEXT = `Both fighters have HP and a posture bar. When a fighter's posture is full they are staggered and open to a deathblow.
Rules you must reason with:
- The player DEFLECTS a normal or heavy attack by tapping guard just before impact (about 0.16 s): no damage to them, YOUR posture rises, and your swing is thrown back. Holding guard instead BLOCKS: chip damage, THEIR posture rises. Only a tap shortly before the hit deflects, so a delayed swing (a pause before impact) beats players who tap early.
- PERILOUS moves (marked in their description) cannot be blocked or deflected: guard does nothing. The player counters one by pressing ATTACK in the last 0.2 s before it lands (your posture jumps) or slips it with a roll (your posture rises). Players who only guard are punished by perilous moves; players who roll or counter well should see them rarely.
- A roll gives brief invulnerability: it beats a single fast hit if timed, and rolling through a perilous move slips it. It does not beat a wide around-you whirlwind that lands late.
- A SWEEP (marked in a move's description) is a low, unblockable strike along the ground. Rolling does NOT protect against it and neither does guard: only a JUMP clears it. A player who leaps it can answer with an air attack (a jump counter) that rewinds your swing and takes a lot of posture. Players who never jump are punished by sweeps; players who jump on cue should see them less often and be baited with other moves.
- The player can also DASH (a short burst with a brief invulnerable start, good for spacing) and attack from the air. Nothing they do in the air protects them from a normal strike, so a ground attack aimed at a jumping player still hits.
- Moves with a branch point (gate) let you choose how the combo continues after the first hit. DELAY beats early guard taps. FEINT rewinds your swing and baits a reaction. CONTINUE is the default.
- If two of your attacks clash with the player's swing in the same instant, a mash decides who is thrown back.
- snapshot.habits says how this player rolls (toward/away/sideways), how early they tap guard (guardTapLeadMs: large means they tap early, so delayed hits beat them) and whether they swing into your recovery or into your wind-up. snapshot.memory and snapshot.profile, when present, are what you learned in earlier fights: use it from your very first move.
- snapshot.fairness: you may not throw a third perilous move in a row; when perilousCapped is true they are simply not on offer.
Play to win but stay unpredictable: do not repeat the same action over and over, and adapt to the habits shown in the data.`;

const mechanics = (b: BossDef) => `You control ${b.name}, ${b.title}, a boss in a duel against a human swordsman. ${b.persona}\n${RULES_TEXT}`;

export function idleQuestions(b: BossDef, available: string[], withReads = true) {
  const criteria: Record<string, string> = {};
  for (const id of available) {
    const a = b.attacks[id];
    criteria[id] = a ? `${a.desc} (reach about ${a.range[1]} px)` : GENERIC_ACTIONS[id] ?? id;
  }
  const questions: Record<string, unknown> = {
    next_action: {
      type: "choice",
      instructions: `${mechanics(b)}\n\nChoose the boss's NEXT action. Consider the distance, the player's state, posture and habits, your own posture, your recent actions, the last outcome, and what each of your moves has done against this player so far (snapshot.vsMove).`,
      criteria,
    },
  };
  if (withReads) {
    Object.assign(questions, {
      turtling: { type: "noul", instructions: "Is the player playing defensively: mostly guarding or retreating and rarely attacking?" },
      roll_reliant: { type: "noul", instructions: "Does the player rely on rolling as their main way of avoiding attacks?" },
      trade_hungry: { type: "noul", instructions: "Is the player greedy: attacking into the boss's moves or right after being hit, instead of defending first?" },
      panicking: { type: "noul", instructions: "Is the player in trouble (low health or high posture) and likely to make a rushed or defensive mistake?" },
    });
  }
  if (b.taunts?.length) {
    const tc: Record<string, string> = { NONE: "Say nothing. Silence is the default; most of the time this is right." };
    for (const t of b.taunts) tc[t.id] = `Say: "${t.text}". Use when: ${t.when}`;
    questions.taunt = {
      type: "choice",
      instructions: `You may also have ${b.name} speak one short line now. Choose silence unless a line fits the moment very well; speaking too often ruins it.`,
      criteria: tc,
    };
  }
  return questions;
}

export function gateQuestions(b: BossDef, a: EnemyAttack, g: GateDef, phase: 1 | 2) {
  const criteria: Record<string, string> = {};
  for (const o of g.options) if (!o.phase2 || phase >= 2) criteria[o.id] = o.desc;
  return {
    gate_choice: {
      type: "choice",
      instructions: `${mechanics(b)}\n\nYou are mid-combo: ${a.id}. The first hit just resolved (see lastOutcome). Decide how the combo continues. React to how the player answered: if they deflected early, DELAY or FEINT beats them; if they rolled, pressing on may punish; if they were hit, CONTINUE is usually right.`,
      criteria,
    },
  };
}

// ---------------------------------------------------------------- client
interface Answers {
  [k: string]: { type: string; choice?: string; probabilities?: Record<string, number>; noul?: number };
}
async function ask(state: unknown, questions: Record<string, unknown>): Promise<Answers> {
  const res = await fetch("/api/jev/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state, questions }) });
  const j = await res.json();
  if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
  return j.answers;
}
const pct = (p?: Record<string, number>, c?: string) => (p && c && p[c] != null ? ` ${Math.round(p[c] * 100)}%` : "");

export async function askIdle(b: BossDef, snap: Snapshot, available: string[]): Promise<Decision> {
  const t0 = performance.now();
  const a = await ask(snap, idleQuestions(b, available));
  const r = a.next_action;
  if (!r?.choice || !available.includes(r.choice)) throw new Error(`Jev picked an unavailable action: ${r?.choice}`);
  return {
    kind: "idle", label: r.choice + pct(r.probabilities, r.choice), choice: r.choice, probabilities: r.probabilities, taunt: a.taunt?.choice,
    reads: a.turtling ? { turtling: a.turtling.noul ?? 0, rollReliant: a.roll_reliant?.noul ?? 0, tradeHungry: a.trade_hungry?.noul ?? 0, panicking: a.panicking?.noul ?? 0 } : undefined,
    latencyMs: Math.round(performance.now() - t0), source: "jev",
  };
}

export async function askGate(b: BossDef, a: EnemyAttack, g: GateDef, snap: Snapshot, phase: 1 | 2): Promise<Decision> {
  const t0 = performance.now();
  const q = gateQuestions(b, a, g, phase);
  const ans = await ask(snap, q);
  const r = ans.gate_choice;
  if (!r?.choice || !(r.choice in q.gate_choice.criteria)) throw new Error(`Jev picked an unavailable branch: ${r?.choice}`);
  return { kind: "gate", label: `${a.id}: ${r.choice}${pct(r.probabilities, r.choice)}`, choice: r.choice, probabilities: r.probabilities, latencyMs: Math.round(performance.now() - t0), source: "jev" };
}

// ---------------------------------------------------------------- rules bot (baseline and fallback)
function weighted<T>(items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [v, w] of items) if ((r -= w) <= 0) return v;
  return items[items.length - 1][0];
}

export function rulesIdle(b: BossDef, snap: Snapshot, available: string[], source: "rules" | "fallback" = "rules", error?: string): Decision {
  const d = snap.player.distancePx;
  const table = d <= 100 ? b.weights.close : d <= 170 ? b.weights.mid : b.weights.far;
  const last = snap.boss.lastActions[snap.boss.lastActions.length - 1];
  let pool = table.filter(([id]) => available.includes(id)).map(([id, w]) => [id, id === last ? w * 0.3 : w] as [string, number]);
  if (!pool.length) pool = [[available.includes("APPROACH") ? "APPROACH" : available[0], 1]];
  const choice = weighted(pool);
  return { kind: "idle", label: choice, choice, latencyMs: 0, source, error };
}

export function rulesGate(g: GateDef, phase: 1 | 2, a: EnemyAttack, source: "rules" | "fallback" = "rules", error?: string): Decision {
  const opts = g.options.filter((o) => !o.phase2 || phase >= 2);
  const choice = Math.random() < 0.7 ? g.default : opts[Math.floor(Math.random() * opts.length)].id;
  return { kind: "gate", label: `${a.id}: ${choice}`, choice, latencyMs: 0, source, error };
}

// ---------------------------------------------------------------- controller
export const ASK_TIMEOUT = 1500; // wall-clock ms an idle boss waits on Jev before the rules bot decides
export const STALE_MS = 3500;

export interface BrainHooks {
  onDecision?: (d: Decision) => void;
}

/** Owns the Jev/rules switch, the in-flight request and the per-brain stats. The scene calls `request` when the boss starts recovering and
 *  `take` when it becomes idle, so the answer is usually already waiting. A late answer from an older request is ignored (askId). */
export class BossBrain {
  mode: "jev" | "rules" = "jev";
  private askId = 0;
  private ready: (Decision & { at: number }) | null = null;
  private reqAt = 0;
  private inflight = false;
  stats = { jev: { n: 0, ms: 0, errors: 0 }, rules: { n: 0 }, fallback: { n: 0 } };
  last: Decision | null = null;
  constructor(private hooks: BrainHooks = {}) {}

  get waiting() {
    return this.inflight;
  }
  /** true when nothing is asked yet and Jev is the active brain: the scene should build a snapshot and request */
  get needsRequest() {
    return this.mode === "jev" && !this.inflight && !this.ready;
  }
  toggle() {
    this.mode = this.mode === "jev" ? "rules" : "jev";
    this.askId++; // an answer still in flight belongs to the old brain
    this.ready = null;
    this.inflight = false;
    return this.mode;
  }
  reset() {
    this.askId++;
    this.ready = null;
    this.inflight = false;
    this.last = null;
  }

  request(b: BossDef, snap: Snapshot, available: string[]) {
    if (this.mode === "rules" || this.inflight || this.ready) return;
    const id = ++this.askId;
    this.inflight = true;
    this.reqAt = performance.now();
    askIdle(b, snap, available)
      .then((d) => {
        if (id !== this.askId) return;
        this.ready = { ...d, at: performance.now() };
        this.inflight = false;
      })
      .catch((e) => {
        if (id !== this.askId) return;
        this.inflight = false;
        this.stats.jev.errors++;
        this.ready = { ...rulesIdle(b, snap, available, "fallback", String(e.message ?? e)), at: performance.now() };
      });
  }

  /** The decision if one is ready (or the rules bot's, when Jev is off or too slow); null = keep waiting or request again. */
  take(b: BossDef, snap: Snapshot, available: string[]): Decision | null {
    if (this.mode === "rules") return this.finish(rulesIdle(b, snap, available));
    const r = this.ready;
    if (r) {
      this.ready = null;
      if (performance.now() - r.at > STALE_MS) return null;
      if (!available.includes(r.choice)) return this.finish(rulesIdle(b, snap, available, "fallback", `stale pick ${r.choice}`));
      return this.finish(r);
    }
    if (!this.inflight) return null;
    if (performance.now() - this.reqAt >= ASK_TIMEOUT) {
      this.askId++;
      this.inflight = false;
      this.stats.jev.errors++;
      return this.finish(rulesIdle(b, snap, available, "fallback", "timeout"));
    }
    return null;
  }

  /** Gate decisions are one-shot promises (the scene holds the combo for GATE_WAIT ms). */
  gate(b: BossDef, a: EnemyAttack, g: GateDef, snap: Snapshot, phase: 1 | 2): Promise<Decision> {
    if (this.mode === "rules") return Promise.resolve(this.finish(rulesGate(g, phase, a)));
    return askGate(b, a, g, snap, phase)
      .then((d) => this.finish(d))
      .catch((e) => {
        this.stats.jev.errors++;
        return this.finish(rulesGate(g, phase, a, "fallback", String(e.message ?? e)));
      });
  }

  private finish(d: Decision): Decision {
    if (d.source === "jev") {
      this.stats.jev.n++;
      this.stats.jev.ms += d.latencyMs;
    } else if (d.source === "fallback") this.stats.fallback.n++;
    else this.stats.rules.n++;
    this.last = d;
    this.hooks.onDecision?.(d);
    return d;
  }
}
