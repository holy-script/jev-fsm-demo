// Tunable numbers and move definitions for the posture duel. Distances are world pixels (ground plane), times in ms.

export const ZOOM = 2;
export const VIEW_W = 960;
export const VIEW_H = 540;
export const TILE = 16;

export type AtkType = "normal" | "heavy" | "thrust" | "sweep" | "grab";
export type Shape = { kind: "cone"; range: number; half: number } | { kind: "circle"; range: number };

export interface HitDef {
  frames: [number, number]; // animation frames in which the hit can connect (resolved once)
  type: AtkType;
  damage: number;
  posture: number; // posture the target gains if it blocks, or when the hit lands
  deflectPosture: number; // posture the attacker gains when deflected
  shape: Shape;
}

export interface GateOption {
  id: string; // CONTINUE | DELAY | FEINT | END, or the id of a move to chain into
  desc: string;
  phase2?: boolean;
}
/** A branch point inside a combo. Jev is asked once the hit at index `after` has resolved, and the answer is applied at frame `at`. */
export interface GateDef {
  after: number;
  at: number | "end";
  options: GateOption[];
  default: string;
}

export interface MoveDef {
  id: string;
  label: string;
  desc?: string; // what Jev is told this move is for
  reach?: number; // rough distance at which it can connect (incl. lunge)
  cooldown?: number; // ms before the boss can use it again (default 1500)
  gates?: GateDef[];
  anim: string; // sheet suffix, e.g. "atkA"
  fps: number;
  hits: HitDef[];
  holds?: { frame: number; ms: number }[]; // freeze on a frame: the telegraph / delayed swing
  lunge?: { frames: [number, number]; speed: number }[];
  endFrame?: number; // stop early at this frame (reusing part of an animation)
}

export const GAME = {
  deflectMs: 160, // guard pressed this recently before impact = deflect
  deflectSpamMs: 260, // re-pressing guard sooner than this after the last press gives no window
  hitstopLight: 70,
  hitstopHeavy: 130,
  hitstopDeflect: 110,
};

export const HERO = {
  maxHp: 100,
  maxPosture: 100,
  speed: 95,
  guardSpeed: 42,
  rollSpeed: 170,
  rollMs: 420,
  rollIframes: [40, 340] as [number, number],
  rollCooldownMs: 160,
  heals: 3,
  healAmount: 45,
  healMs: 1000,
  postureRegenPerSec: 22,
  postureRegenDelayMs: 1100,
  brokenMs: 1700,
  radius: 6,
  chipFraction: 0.12, // share of damage that gets through a block
};

const cone = (range: number, half: number): Shape => ({ kind: "cone", range, half });

export const HERO_MOVES: Record<string, MoveDef> = {
  A: { id: "A", label: "Light 1", anim: "atkA", fps: 18, hits: [{ frames: [4, 5], type: "normal", damage: 12, posture: 9, deflectPosture: 0, shape: cone(52, 58) }], lunge: [{ frames: [2, 4], speed: 70 }] },
  C: { id: "C", label: "Light 2", anim: "atkC", fps: 18, hits: [{ frames: [4, 5], type: "normal", damage: 12, posture: 9, deflectPosture: 0, shape: cone(52, 58) }], lunge: [{ frames: [2, 4], speed: 70 }] },
  B: { id: "B", label: "Thrust", anim: "atkB", fps: 15, hits: [{ frames: [2, 3], type: "normal", damage: 15, posture: 12, deflectPosture: 0, shape: cone(66, 26) }], lunge: [{ frames: [1, 3], speed: 120 }] },
  D: { id: "D", label: "Heavy", anim: "atkD", fps: 13, hits: [{ frames: [5, 6], type: "heavy", damage: 26, posture: 24, deflectPosture: 0, shape: cone(56, 72) }], lunge: [{ frames: [3, 5], speed: 60 }] },
  KICK: { id: "KICK", label: "Kick", anim: "kick", fps: 16, hits: [{ frames: [1, 2], type: "normal", damage: 4, posture: 8, deflectPosture: 0, shape: cone(40, 55) }] },
};
export const LIGHT_CHAIN = ["A", "C", "B"];

export interface BossDef {
  id: string;
  name: string;
  title: string;
  prefix: string; // manifest sheet prefix
  scale: number;
  segments: number;
  segmentHp: number;
  maxPosture: number;
  speed: number;
  radius: number;
  moves: Record<string, MoveDef>;
  // rough preferred spacing used by the placeholder brain (Jev replaces it)
  weights: { close: [string, number][]; mid: [string, number][] };
}

const GATE = {
  CONTINUE: { id: "CONTINUE", desc: "Follow through with the second slash at its normal timing." },
  DELAY: { id: "DELAY", desc: "Hold the second slash a beat longer before it lands. Beats a player who taps guard early to deflect." },
  FEINT: { id: "FEINT", desc: "Cancel the second slash and raise your guard instead. Baits a roll or a greedy attack." },
  END: { id: "END", desc: "Stop here and recover. Safe, but gives the player a turn." },
};

export const CAPTAIN: BossDef = {
  id: "captain",
  name: "SKELETON CAPTAIN",
  title: "Shield of the Fallen",
  prefix: "cap",
  scale: 1.25,
  segments: 2,
  segmentHp: 150,
  maxPosture: 100,
  speed: 62,
  radius: 9,
  moves: {
    SLASH2: {
      id: "SLASH2", cooldown: 1200, label: "Double slash", reach: 82,
      desc: "Two quick slashes (blockable and deflectable). A flexible opener with branch points: you can delay, feint, or chain into another attack mid-combo.",
      anim: "atkA", fps: 14,
      hits: [
        { frames: [2, 4], type: "normal", damage: 16, posture: 18, deflectPosture: 11, shape: cone(58, 62) },
        { frames: [8, 10], type: "normal", damage: 16, posture: 18, deflectPosture: 11, shape: cone(58, 62) },
      ],
      holds: [{ frame: 1, ms: 330 }, { frame: 7, ms: 230 }], lunge: [{ frames: [1, 3], speed: 70 }, { frames: [7, 9], speed: 70 }],
      gates: [
        { after: 0, at: 7, default: "CONTINUE", options: [GATE.CONTINUE, GATE.DELAY, GATE.FEINT, GATE.END, { id: "GRAB", desc: "Drop the second slash and go straight into a grab. Ignores guard and roll; punishes a player who just rolled or stayed close." }] },
        { after: 1, at: "end", default: "END", options: [
          GATE.END,
          { id: "THRUST", desc: "Chain straight into a red perilous thrust. Unblockable, but a well-timed roll slips you." },
          { id: "OVERHEAD", desc: "Chain a delayed heavy overhead: big posture damage if blocked." },
          { id: "GRAB", desc: "Chain a grab. Ignores guard and roll." },
          { id: "SWEEP", desc: "Chain a yellow sweep around you. Unblockable; punishes a player who stays close to guard.", phase2: true },
        ] },
      ],
    },
    OVERHEAD: {
      id: "OVERHEAD", cooldown: 2500, label: "Overhead", reach: 88,
      desc: "A delayed heavy overhead: big damage if it lands and big posture damage if blocked. Slow wind-up, easy to deflect if the player is patient.",
      anim: "atkB", fps: 10,
      hits: [{ frames: [3, 5], type: "heavy", damage: 28, posture: 34, deflectPosture: 20, shape: cone(60, 48) }],
      holds: [{ frame: 2, ms: 300 }], lunge: [{ frames: [2, 4], speed: 80 }],
      gates: [{ after: 0, at: "end", default: "END", options: [
        GATE.END,
        { id: "SWEEP", desc: "Chain a yellow sweep to punish a roll or a player who steps in." },
        { id: "GRAB", desc: "Chain a grab. Ignores guard and roll." },
        { id: "THRUST", desc: "Chain a red perilous thrust.", phase2: true },
      ] }],
    },
    THRUST: {
      id: "THRUST", cooldown: 3500, label: "Perilous thrust", reach: 135,
      desc: "A red perilous thrust that lunges forward. Cannot be blocked or deflected. If the player rolls into it at the right time they slip you (+30 posture on you). Strong against standing, guarding players; risky against rollers.",
      anim: "atkA", fps: 14, endFrame: 5,
      hits: [{ frames: [3, 5], type: "thrust", damage: 32, posture: 30, deflectPosture: 0, shape: cone(96, 14) }],
      holds: [{ frame: 1, ms: 480 }], lunge: [{ frames: [2, 5], speed: 170 }],
    },
    SWEEP: {
      id: "SWEEP", cooldown: 3500, label: "Sweep", reach: 78,
      desc: "A yellow sweep in a circle around you. Cannot be blocked; the player avoids it by rolling or backing away. Punishes players who stand still and guard up close.",
      anim: "atkB", fps: 10,
      hits: [{ frames: [3, 5], type: "sweep", damage: 26, posture: 30, deflectPosture: 0, shape: { kind: "circle", range: 66 } }],
      holds: [{ frame: 2, ms: 420 }],
      gates: [{ after: 0, at: "end", default: "END", options: [
        GATE.END,
        { id: "OVERHEAD", desc: "Chain a heavy overhead right after the sweep." },
        { id: "GRAB", desc: "Chain a grab; punishes a player who rolled out of the sweep toward you." },
      ] }],
    },
    GRAB: {
      id: "GRAB", cooldown: 5000, label: "Grab", reach: 86,
      desc: "A purple grab. Cannot be blocked and ignores roll invulnerability; only distance avoids it. Punishes roll-reliant players who are close.",
      anim: "atkB", fps: 10,
      hits: [{ frames: [3, 4], type: "grab", damage: 38, posture: 20, deflectPosture: 0, shape: cone(44, 75) }],
      holds: [{ frame: 1, ms: 560 }], lunge: [{ frames: [2, 4], speed: 120 }],
    },
  },
  weights: {
    close: [["SLASH2", 30], ["OVERHEAD", 22], ["THRUST", 12], ["SWEEP", 12], ["GRAB", 10], ["GUARD", 10], ["BACKSTEP", 4]],
    mid: [["THRUST", 45], ["OVERHEAD", 15], ["APPROACH", 40], ["CIRCLE", 6]],
  },
};

export const GLYPH: Record<AtkType, { color: number; label: string } | null> = {
  normal: null,
  heavy: null,
  thrust: { color: 0xff3b3b, label: "!" },
  sweep: { color: 0xffc83b, label: "!" },
  grab: { color: 0xb04bff, label: "!" },
};
