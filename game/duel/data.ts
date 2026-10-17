// Tunable numbers and move definitions for the posture duel. Distances are world pixels (ground plane), times in ms.

export const ZOOM = 2;
export const VIEW_W = 1280;
export const VIEW_H = 720;
export const TILE = 16;

export type AtkType = "normal" | "heavy" | "thrust" | "sweep" | "grab" | "beam";
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

export interface SpawnDef {
  frame: number;
  speed: number;
  damage: number;
  posture: number;
  deflectPosture: number; // posture the boss takes when the player deflects the projectile back
}
export interface BeamDef {
  frame: number;
  ms: number;
  length: number;
  halfWidth: number;
  damage: number;
  posture: number;
  lockMs: number; // the aim stops tracking this long before the beam fires
}

export interface MoveDef {
  kind?: "melee" | "projectile" | "beam" | "buff"; // default melee
  spawns?: SpawnDef[]; // projectile moves
  spawnsP2?: SpawnDef[]; // replaces spawns in phase 2
  beam?: BeamDef;
  buff?: { frame: number; ms: number }; // armor-up
  id: string;
  label: string;
  desc?: string; // what Jev is told this move is for
  reach?: number; // rough distance at which it can connect (incl. lunge)
  cooldown?: number; // ms before the boss can use it again (default 1500)
  gates?: GateDef[];
  anim: string; // sheet suffix, e.g. "atkA"
  fps: number;
  hits: HitDef[];
  holds?: { frame: number; ms: number; telegraph?: boolean }[]; // freeze on a frame: the telegraph / delayed swing. telegraph:false = a fixed pause (not beat-aligned)
  leadBeats?: number; // choreographed mode: beats from the start of the move to its first impact
  gapBeats?: number[]; // beats between impact i and impact i+1
  grid?: number; // impacts snap to multiples of this many beats (1 = on the beat, 0.5 = syncopated)
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
  // Skill-gated and spirit moves (see skills.ts)
  RIPOSTE: { id: "RIPOSTE", label: "Riposte", anim: "atkB", fps: 22, hits: [{ frames: [2, 3], type: "normal", damage: 20, posture: 28, deflectPosture: 0, shape: cone(84, 30) }], lunge: [{ frames: [0, 3], speed: 150 }] },
  ROLLCUT: { id: "ROLLCUT", label: "Roll cut", anim: "atkA", fps: 22, hits: [{ frames: [3, 4], type: "normal", damage: 14, posture: 12, deflectPosture: 0, shape: cone(62, 70) }], lunge: [{ frames: [0, 4], speed: 120 }] },
  WHIRL: { id: "WHIRL", label: "Whirl cut", anim: "atkC", fps: 15, hits: [{ frames: [4, 5], type: "normal", damage: 14, posture: 18, deflectPosture: 0, shape: { kind: "circle", range: 66 } }] },
  THROW: { id: "THROW", label: "Throw", anim: "atkA", fps: 30, endFrame: 3, hits: [] },
};
export const LIGHT_CHAIN = ["A", "C", "B"];
export const SPIRIT = { base: 3, wellBonus: 2, whirlCost: 2, bladeCost: 1, riposteMs: 800, slipRiposteMs: 1100 };

export interface BossDef {
  id: string;
  name: string;
  title: string;
  prefix: string; // manifest sheet prefix
  scale: number;
  headY: number; // height of the head above the feet, for glyphs and popups
  segments: number;
  segmentHp: number;
  maxPosture: number;
  speed: number;
  radius: number;
  moves: Record<string, MoveDef>;
  anims: { idle: string; walk: string; hit: string; block: string; dead: string }; // sheet suffixes
  guardLoop?: boolean; // false: the guard animation plays once and holds its last frame
  stoneGuard?: boolean; // guard is immune to light attacks and kicks; only a heavy breaks it
  noFlinch?: boolean; // hits never interrupt it (it only flashes)
  music: string; // key in manifest.music
  persona: string; // told to Jev
  actionDesc?: Record<string, string>; // overrides for the generic actions (e.g. GUARD)
  dummyKeys: string[]; // move ids bound to Z X C V B in the training-dummy mode
  weights: { close: [string, number][]; mid: [string, number][]; far?: [string, number][] };
}

const GATE = {
  CONTINUE: { id: "CONTINUE", desc: "Follow through with the second slash at its normal timing." },
  DELAY: { id: "DELAY", desc: "Hold the second slash half a beat longer, so it lands OFF the beat. Beats a player who taps guard early or on the beat to deflect." },
  FEINT: { id: "FEINT", desc: "Cancel the second slash and raise your guard instead. Baits a roll or a greedy attack." },
  END: { id: "END", desc: "Stop here and recover. Safe, but gives the player a turn." },
};

export const CAPTAIN: BossDef = {
  id: "captain",
  name: "SKELETON CAPTAIN",
  title: "Shield of the Fallen",
  prefix: "cap",
  scale: 1.25,
  headY: 78,
  segments: 2,
  segmentHp: 150,
  maxPosture: 100,
  speed: 62,
  radius: 9,
  anims: { idle: "idle", walk: "walk", hit: "hit", block: "block", dead: "dead" },
  music: "captain",
  persona: "A disciplined skeleton duelist with a shield and a heavy cleaver. Its strength is mixing blockable chains with unblockable surprises.",
  dummyKeys: ["SLASH2", "OVERHEAD", "THRUST", "SWEEP", "GRAB"],
  moves: {
    SLASH2: {
      id: "SLASH2", cooldown: 1200, label: "Double slash", reach: 82,
      desc: "Two quick slashes (blockable and deflectable). A flexible opener with branch points: you can delay, feint, or chain into another attack mid-combo.",
      anim: "atkA", fps: 14,
      hits: [
        { frames: [2, 4], type: "normal", damage: 16, posture: 18, deflectPosture: 11, shape: cone(58, 62) },
        { frames: [8, 10], type: "normal", damage: 16, posture: 18, deflectPosture: 11, shape: cone(58, 62) },
      ],
      holds: [{ frame: 1, ms: 330 }, { frame: 7, ms: 230 }], leadBeats: 1.5, gapBeats: [1], grid: 1, lunge: [{ frames: [1, 3], speed: 70 }, { frames: [7, 9], speed: 70 }],
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
      holds: [{ frame: 2, ms: 300 }], leadBeats: 2, grid: 0.5, lunge: [{ frames: [2, 4], speed: 80 }],
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
      holds: [{ frame: 1, ms: 480 }], leadBeats: 2, grid: 1, lunge: [{ frames: [2, 5], speed: 170 }],
    },
    SWEEP: {
      id: "SWEEP", cooldown: 3500, label: "Sweep", reach: 78,
      desc: "A yellow sweep in a circle around you. Cannot be blocked; the player avoids it by rolling or backing away. Punishes players who stand still and guard up close.",
      anim: "atkB", fps: 10,
      hits: [{ frames: [3, 5], type: "sweep", damage: 26, posture: 30, deflectPosture: 0, shape: { kind: "circle", range: 66 } }],
      holds: [{ frame: 2, ms: 420 }], leadBeats: 2, grid: 1,
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
      holds: [{ frame: 1, ms: 560 }], leadBeats: 2.5, grid: 0.5, lunge: [{ frames: [2, 4], speed: 120 }],
    },
  },
  weights: {
    close: [["SLASH2", 30], ["OVERHEAD", 22], ["THRUST", 12], ["SWEEP", 12], ["GRAB", 10], ["GUARD", 10], ["BACKSTEP", 4]],
    mid: [["THRUST", 45], ["OVERHEAD", 15], ["APPROACH", 40], ["CIRCLE", 6]],
  },
};

export const GOLEM: BossDef = {
  id: "golem",
  name: "MECHA-STONE GOLEM",
  title: "Heart of the Ruin",
  prefix: "golem",
  scale: 2.2,
  headY: 104,
  segments: 2,
  segmentHp: 190,
  maxPosture: 100,
  speed: 36,
  radius: 15,
  anims: { idle: "idle", walk: "idle", hit: "hit", block: "block", dead: "dead" },
  guardLoop: false,
  stoneGuard: true,
  noFlinch: true,
  music: "crypt",
  persona:
    "A huge, slow stone construct. It cannot be flinched by normal hits and is dangerous at every range: a crushing fist up close, a deflectable thrown fist at mid range, and a long unblockable laser. Its weakness is posture: deflecting its fist back, or breaking its stone guard with a heavy attack. It wins by controlling space and punishing impatience.",
  actionDesc: {
    APPROACH: "Stomp toward the player to close the distance.",
    BACKSTEP: "Lumber backward to reopen the distance for ranged attacks.",
    CIRCLE: "Slowly circle the player to change the firing angle.",
    WAIT: "Stand still and let the player act; reads their behaviour. Cheap and safe.",
    GUARD: "Curl into a stone ball for about 2 seconds. Light attacks and kicks do NOTHING to it (the player only gains a little posture), and only a heavy attack breaks it. An excellent answer to a player who is spamming light attacks, rushing in, or trading hits; useless against a player who simply waits or keeps away.",
  },
  dummyKeys: ["STONE_FIST", "ARM_SHOT", "LASER", "ARMOR_UP"],
  moves: {
    STONE_FIST: {
      id: "STONE_FIST", cooldown: 2600, label: "Stone fist", reach: 96,
      desc: "A slow crushing overhand swing with a very long wind-up. Big damage if it lands and big posture damage if blocked, but easy to deflect or dodge for a patient player. Strong against players who stay close.",
      anim: "melee", fps: 12,
      hits: [{ frames: [4, 5], type: "heavy", damage: 30, posture: 36, deflectPosture: 22, shape: cone(70, 58) }],
      holds: [{ frame: 2, ms: 440 }], leadBeats: 2, grid: 1, lunge: [{ frames: [3, 5], speed: 50 }],
      gates: [{ after: 0, at: "end", default: "END", options: [
        { id: "END", desc: "Stop and recover. Safe, but gives the player a turn." },
        { id: "ARM_SHOT", desc: "Fire the arm point-blank right after the swing; punishes a player who stepped in to punish." },
        { id: "STONE_GUARD", desc: "Curl up into stone guard to bait a greedy punish." },
        { id: "LASER", desc: "Chain straight into the laser charge.", phase2: true },
      ] }],
    },
    ARM_SHOT: {
      id: "ARM_SHOT", cooldown: 2800, label: "Arm shot", reach: 340, kind: "projectile",
      desc: "Launch a stone fist in a straight line. The player can block it, roll through it, or deflect it back at you for big posture damage on you if their tap is well timed. Good at mid-to-long range to force a reaction. In phase 2 it fires two in a row.",
      anim: "arm", fps: 12, hits: [],
      holds: [{ frame: 2, ms: 380 }], leadBeats: 2, grid: 1,
      spawns: [{ frame: 3, speed: 240, damage: 18, posture: 22, deflectPosture: 16 }],
      spawnsP2: [{ frame: 3, speed: 240, damage: 18, posture: 22, deflectPosture: 16 }, { frame: 6, speed: 280, damage: 18, posture: 22, deflectPosture: 16 }],
    },
    LASER: {
      id: "LASER", cooldown: 7000, label: "Laser", reach: 300, kind: "beam",
      desc: "Charge for about a second, then fire a straight beam. Cannot be blocked or deflected. The aim tracks the player during the charge and locks about 0.3s before firing: the player must step or roll off the line in that window, or roll through it. Punishes players who stand still, turtle at range, or strafe in a straight line.",
      anim: "laser", fps: 10, hits: [],
      holds: [{ frame: 4, ms: 780 }, { frame: 6, ms: 480, telegraph: false }], leadBeats: 3, grid: 1,
      beam: { frame: 5, ms: 460, length: 300, halfWidth: 13, damage: 34, posture: 28, lockMs: 300 },
    },
    ARMOR_UP: {
      id: "ARMOR_UP", cooldown: 16000, label: "Armor up", reach: 9999, kind: "buff",
      desc: "Harden for 7 seconds: you take half damage, ignore posture buildup partially, cannot be flinched, and your hits land 25% harder. Takes a moment to cast, so use it when the player is far or recovering. The player's answers are to keep their distance, deflect, or use heavy attacks to break posture instead of damaging HP.",
      anim: "armor", fps: 10, hits: [], buff: { frame: 5, ms: 7000 },
    },
  },
  weights: {
    close: [["STONE_FIST", 40], ["GUARD", 18], ["BACKSTEP", 12], ["ARM_SHOT", 15], ["ARMOR_UP", 10], ["CIRCLE", 5]],
    mid: [["ARM_SHOT", 35], ["LASER", 20], ["APPROACH", 35], ["STONE_FIST", 10]],
    far: [["LASER", 35], ["ARM_SHOT", 35], ["APPROACH", 30]],
  },
};

export const BOSSES: BossDef[] = [CAPTAIN, GOLEM];

export const GLYPH: Record<AtkType, { color: number; label: string } | null> = {
  beam: { color: 0xff8a2b, label: "!" },
  normal: null,
  heavy: null,
  thrust: { color: 0xff3b3b, label: "!" },
  sweep: { color: 0xffc83b, label: "!" },
  grab: { color: 0xb04bff, label: "!" },
};
