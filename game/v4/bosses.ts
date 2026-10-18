import type { Clip, EnemyAttack, GateDef } from "./data";

/** Everything the engine and Jev need to know about one boss. Add a boss = add a table here (docs/09 section 12 has the recipe). */
export interface BossDef {
  id: string;
  /** key into AREAS (areas.ts) */
  area: string;
  name: string;
  title: string;
  /** sheet prefix in the manifest (fk_, mb_, cm_, wh_) */
  prefix: string;
  nativeDir: 1 | -1;
  tint?: number;
  /** hue rotation in degrees (WebGL colour matrix): recolours a shared sprite so a boss does not look like the player */
  hue?: number;
  hp: number;
  /** tuning levers (default 1): damage dealt to the player, posture the player's hits add to the boss, and how short its pauses between actions are */
  dmgMul?: number;
  postureMul?: number;
  pace?: number;
  speed: number;
  radius: number;
  clips: { idle: Clip; run: Clip; hit: Clip; broken: Clip; death: Clip };
  attacks: Record<string, EnemyAttack>;
  /** rules-bot weights by distance band (close <= 100 px, mid <= 170, far beyond). Ids may be attack ids or APPROACH / BACKSTEP / WAIT. */
  weights: { close: [string, number][]; mid: [string, number][]; far: [string, number][] };
  /** the temperament paragraph Jev is told */
  persona: string;
  taunts?: { id: string; text: string; when: string }[];
  intro: string;
  outro: string;
  /** the ebb and flow: how it paces pressure and distance (defaults in DEFAULT_SPACING) */
  spacing?: Partial<Spacing>;
  /** below hpPct of max HP the boss gets faster and shorter-winded */
  phase2: { hpPct: number; speed: number; cooldown: number; hold: number };
}

/** A boss alternates two stances: it ENGAGES (stays near, throws a few attacks) and DISENGAGES (backs away, circles, waits) so a fight has a rhythm
 *  instead of a boss glued to the player. Distances are px between the fighters. */
export interface Spacing {
  engage: number;
  disengage: number;
  /** a boss that is not attacking will not stay closer than this */
  personal: number;
  engageMs: [number, number];
  disengageMs: [number, number];
  attacksPerEngage: [number, number];
}
export const DEFAULT_SPACING: Spacing = { engage: 100, disengage: 240, personal: 84, engageMs: [4500, 7500], disengageMs: [1400, 2600], attacksPerEngage: [2, 4] };

export const GENERIC_ACTIONS: Record<string, string> = {
  RETREAT: "Back away from the player to about 240 px, still facing them. Breaks their momentum, resets spacing and baits an approach you can punish. Use after a combo or when the player is crowding you.",
  CIRCLE: "Strafe around the player at medium range to change the angle and bait a reaction. Good for watching what the player does before you commit.",
  APPROACH: "Walk toward the player to close the distance.",
  BACKSTEP: "Step back to reset spacing or bait the player into overextending.",
  WAIT: "Stand still for a moment, watching. Use RARELY: only to bait a player who is rushing in or to break a rhythm. A boss that keeps waiting is passive and boring; when an attack is on offer and fits, prefer the attack.",
};

const gate = (afterHit: number, extra: GateDef["options"] = []): GateDef => ({
  afterHit,
  default: "CONTINUE",
  options: [
    { id: "CONTINUE", desc: "Carry on with the rest of the combo as it is written." },
    { id: "DELAY", desc: "Hold the pose for a heartbeat (about 0.35 s) before the next hit. Beats players who tap guard early for the following hit." },
    { id: "FEINT", desc: "Abort the combo and rewind your own swing. You give up the later hits, but a player who committed to a defensive reaction is left exposed and baited." },
    { id: "END", desc: "Stop after this hit and reset the spacing." },
    ...extra,
  ],
});

// ------------------------------------------------------------------ Metal Bladekeeper (boss 1)
const MB: BossDef = {
  id: "mb", area: "forest", name: "Metal Bladekeeper", title: "The Duelist of Edges", prefix: "mb", nativeDir: 1, hp: 600, postureMul: 0.4, speed: 105, radius: 20,
  clips: {
    idle: { sheet: "mb_idle", from: 0, to: 7, fps: 8 }, run: { sheet: "mb_run", from: 0, to: 7, fps: 14 },
    hit: { sheet: "mb_take_hit", from: 0, to: 5, fps: 16 }, broken: { sheet: "mb_take_hit", from: 5, to: 5 }, death: { sheet: "mb_death", from: 0, to: 11, fps: 10 },
  },
  attacks: {
    SLASH: {
      id: "SLASH", desc: "A single fast dagger slash with a short, readable wind-up. Can be deflected or blocked. Weak on its own, but cheap and low-risk; good for testing a player who guards early.",
      clip: { sheet: "mb_1_atk", from: 0, to: 5, fps: 18, holds: { 0: 520 } }, hits: [{ a: 1, b: 3, dmg: 14, posture: 18, reach: 125 }],
      range: [0, 120], cooldownMs: 1400, lunge: 40, clashable: true,
    },
    TWIN: {
      id: "TWIN", desc: "Two quick dagger cuts in a row. After the first cut you can continue, delay the second (beats early guard taps), feint, or stop. Reaches slightly farther than SLASH.",
      clip: { sheet: "mb_2_atk", from: 0, to: 7, fps: 18, holds: { 0: 560, 3: 150 } },
      hits: [{ a: 1, b: 2, dmg: 10, posture: 14, reach: 125 }, { a: 4, b: 5, dmg: 12, posture: 16, reach: 135 }],
      range: [40, 170], cooldownMs: 2000, lunge: 50, clashable: true, gate: gate(0),
    },
    FLURRY: {
      id: "FLURRY", desc: "A long three-part flurry (two cuts you can deflect) that ends in a big low SWEEP along the ground: unblockable, and rolling does not help, only a JUMP clears it (a player who leaps it can counter from the air). Strong against a player who stands, blocks or rolls. Gives a branch point after the first cut.",
      clip: { sheet: "mb_3_atk", from: 0, to: 17, fps: 18, holds: { 0: 520, 3: 140, 10: 220 } },
      hits: [{ a: 1, b: 3, dmg: 9, posture: 12, reach: 125 }, { a: 4, b: 5, dmg: 9, posture: 12, reach: 135 }, { a: 11, b: 16, dmg: 16, posture: 22, reach: 170, kind: "sweep" }],
      range: [20, 180], cooldownMs: 3200, lunge: 40, gate: gate(0), perilous: true,
    },
    BLOOM: {
      id: "BLOOM", desc: "PERILOUS: blades erupt from the ground on both sides of you. Unblockable: guarding does nothing. The player beats it by pressing attack just before it lands (a counter) or by rolling through it. Punishes players who turtle behind guard. Use sparingly: it has a long cooldown.",
      clip: { sheet: "mb_sp_atk", from: 0, to: 10, fps: 16, holds: { 2: 800 } },
      hits: [{ a: 3, b: 8, dmg: 24, posture: 20, reach: 200, band: 80, kind: "perilous", around: true }],
      range: [0, 210], cooldownMs: 6500, lunge: 0, perilous: true,
    },
  },
  weights: {
    close: [["SLASH", 3], ["TWIN", 2], ["FLURRY", 1], ["BLOOM", 1], ["BACKSTEP", 1]],
    mid: [["TWIN", 3], ["SLASH", 1], ["FLURRY", 1], ["APPROACH", 2], ["BLOOM", 1]],
    far: [["APPROACH", 1]],
  },
  persona: "You are a precise, patient duellist. You prefer to bait and punish: quick cuts, then long pauses. You respect a good guard but you love to find the moment a defender gets comfortable.",
  taunts: [
    { id: "SLOW", text: "Too slow.", when: "the player just got hit or rolled late." },
    { id: "CAREFUL", text: "Guard all you like.", when: "the player has been turtling behind guard." },
  ],
  intro: "A blade is only as good as the patience behind it.", outro: "Edges dull. Patience... does not.",
  phase2: { hpPct: 0.5, speed: 1.15, cooldown: 0.8, hold: 0.8 },
};

// ------------------------------------------------------------------ Crystal Mauler (boss 2)
const CM: BossDef = {
  id: "cm", area: "river", name: "Crystal Mauler", title: "Hammer of the Deep Vein", prefix: "cm", nativeDir: 1, hp: 800, dmgMul: 0.62, postureMul: 0.3, pace: 0.8, speed: 70, radius: 26,
  clips: {
    idle: { sheet: "cm_idle", from: 0, to: 7, fps: 8 }, run: { sheet: "cm_run", from: 0, to: 7, fps: 11 },
    hit: { sheet: "cm_take_hit", from: 0, to: 5, fps: 16 }, broken: { sheet: "cm_take_hit", from: 5, to: 5 }, death: { sheet: "cm_death", from: 0, to: 14, fps: 10 },
  },
  attacks: {
    SWING: {
      id: "SWING", desc: "A slow, heavy overhead hammer swing with a long visible wind-up and a big hit. Easy to deflect if you read the wind-up, brutal if you are greedy. Deflecting it costs the Mauler a lot of posture.",
      clip: { sheet: "cm_1_atk", from: 0, to: 6, fps: 14, holds: { 2: 520 } }, hits: [{ a: 3, b: 4, dmg: 20, posture: 24, reach: 120, kind: "heavy" }],
      range: [0, 125], cooldownMs: 1500, lunge: 20,
    },
    BACKHAND: {
      id: "BACKHAND", desc: "A sideways hammer sweep that comes a little quicker than SWING. Same weight. Good to vary against a player who has learned the timing of SWING.",
      clip: { sheet: "cm_2_atk", from: 0, to: 6, fps: 14, holds: { 2: 430 } }, hits: [{ a: 3, b: 4, dmg: 18, posture: 22, reach: 125, kind: "heavy" }],
      range: [0, 130], cooldownMs: 1400, lunge: 20,
    },
    SLAM: {
      id: "SLAM", desc: "A very long wind-up into a ground slam, then CRYSTALS ERUPT forward in a long line (perilous: unblockable, roll through it or counter it). Branch point after the slam: continue into the crystals, delay them, or stop. Strongest against a player standing in front of you at mid distance.",
      clip: { sheet: "cm_3_atk", from: 0, to: 16, fps: 14, holds: { 6: 480, 9: 120 } },
      hits: [{ a: 7, b: 8, dmg: 24, posture: 26, reach: 125, kind: "heavy" }, { a: 10, b: 12, dmg: 14, posture: 12, reach: 280, band: 55, kind: "perilous" }],
      range: [0, 200], cooldownMs: 3600, lunge: 0, perilous: true,
      gate: { afterHit: 0, default: "CONTINUE", options: [
        { id: "CONTINUE", desc: "Let the crystals erupt right after the slam." },
        { id: "DELAY", desc: "Pause before the crystals erupt (about 0.35 s). Beats players who roll immediately after the slam." },
        { id: "END", desc: "Stop after the slam. No crystals." },
      ] },
    },
    SHATTER: {
      id: "SHATTER", desc: "SWEEP: throws the hammer into the ground and a huge wall of crystal shards erupts forward along the floor across most of the arena. Unblockable and rolling does not help: the player must JUMP over it (and can counter from the air). Use it when the player is far away, turtling or rolling a lot.",
      clip: { sheet: "cm_sp_atk", from: 0, to: 14, fps: 14, holds: { 6: 600 } },
      hits: [{ a: 8, b: 11, dmg: 28, posture: 24, reach: 320, band: 70, kind: "sweep" }],
      range: [60, 330], cooldownMs: 7000, lunge: 0, perilous: true,
    },
  },
  weights: {
    close: [["SWING", 3], ["BACKHAND", 3], ["SLAM", 2], ["BACKSTEP", 1]],
    mid: [["SLAM", 3], ["SHATTER", 2], ["APPROACH", 2], ["SWING", 1]],
    far: [["SHATTER", 2], ["APPROACH", 2]],
  },
  persona: "You are a slow, enormous miner who hits like a landslide. You are not clever but you are relentless; every blow is heavy and you never rush. You punish a player who gets greedy between your swings and you love to bury a defender in crystals.",
  taunts: [
    { id: "BREAK", text: "Everything breaks.", when: "the player has been deflecting well and you have just lost a lot of posture." },
    { id: "MINE", text: "Dig deeper.", when: "the player is at low health." },
  ],
  intro: "The vein runs deep, and so do I.", outro: "The mountain... remembers you.",
  phase2: { hpPct: 0.5, speed: 1.25, cooldown: 0.75, hold: 0.8 },
};

// ------------------------------------------------------------------ Wind Hashashin (boss 3)
const WH: BossDef = {
  id: "wh", area: "ruins", name: "Wind Hashashin", title: "The Gale That Cuts", prefix: "wh", nativeDir: 1, hp: 520, dmgMul: 1.4, postureMul: 0.45, pace: 0.5, speed: 150, radius: 20,
  clips: {
    idle: { sheet: "wh_idle", from: 0, to: 7, fps: 9 }, run: { sheet: "wh_run", from: 0, to: 7, fps: 16 },
    hit: { sheet: "wh_take_hit", from: 0, to: 5, fps: 16 }, broken: { sheet: "wh_take_hit", from: 5, to: 5 }, death: { sheet: "wh_death", from: 0, to: 18, fps: 11 },
  },
  attacks: {
    FLICK: {
      id: "FLICK", desc: "A lightning-fast single slash with almost no wind-up. Low damage, very hard to deflect on reaction. Best used to interrupt a player who is healing, swinging or about to guard late.",
      clip: { sheet: "wh_1_atk", from: 0, to: 7, fps: 20, holds: { 1: 220 } }, hits: [{ a: 2, b: 3, dmg: 9, posture: 12, reach: 125 }],
      range: [0, 125], cooldownMs: 900, lunge: 40, clashable: true,
    },
    WHIRL: {
      id: "WHIRL", desc: "A quick slash followed by a spinning whirlwind that hits all around. After the first slash you can continue, delay the whirlwind (beats early guard taps), feint, or stop. The whirlwind hits on both sides, so side-stepping does not help; deflect it or roll.",
      clip: { sheet: "wh_2_atk", from: 0, to: 17, fps: 20, holds: { 1: 220, 6: 140 } },
      hits: [{ a: 2, b: 3, dmg: 8, posture: 10, reach: 125 }, { a: 7, b: 11, dmg: 12, posture: 16, reach: 135, around: true }],
      range: [0, 150], cooldownMs: 1800, lunge: 30, clashable: true, gate: gate(0),
    },
    CYCLONE: {
      id: "CYCLONE", desc: "A three-part combo: slash, whirlwind, then a leaping cyclone finisher that hits all around and is a heavy blow. Branch point after the first slash. Punishes players who relax after deflecting the first two hits; the finisher lands late.",
      clip: { sheet: "wh_3_atk", from: 0, to: 25, fps: 20, holds: { 1: 220, 6: 160, 15: 150 } },
      hits: [{ a: 2, b: 3, dmg: 8, posture: 10, reach: 125 }, { a: 7, b: 10, dmg: 10, posture: 14, reach: 135, around: true }, { a: 17, b: 20, dmg: 14, posture: 24, reach: 150, around: true, kind: "heavy" }],
      range: [0, 160], cooldownMs: 3000, lunge: 30, gate: gate(0),
    },
  },
  weights: {
    close: [["FLICK", 3], ["WHIRL", 3], ["CYCLONE", 1], ["BACKSTEP", 2]],
    mid: [["WHIRL", 2], ["FLICK", 2], ["APPROACH", 3]],
    far: [["APPROACH", 3]],
  },
  persona: "You are a fast, evasive assassin. You live in the player's blind spot: short bursts, quick resets, never standing still. You are fragile, so you avoid trades and look for a mistake. You change the rhythm constantly.",
  taunts: [
    { id: "CATCH", text: "Catch the wind.", when: "the player just missed a swing or whiffed an attack." },
    { id: "STILL", text: "Standing still?", when: "the player has been standing still for a while." },
  ],
  intro: "You will not see the one that kills you.", outro: "The wind... forgets me.",
  phase2: { hpPct: 0.5, speed: 1.2, cooldown: 0.7, hold: 0.75 },
};

// ------------------------------------------------------------------ Echo (final boss): the player's own style, thrown back
const ECHO: BossDef = {
  id: "echo", area: "gate", name: "Echo", title: "Your Own Shadow", prefix: "fk", nativeDir: 1, hue: 235, tint: 0xb9a8ff, hp: 700, dmgMul: 1.2, postureMul: 0.35, pace: 0.6, speed: 125, radius: 18,
  clips: {
    idle: { sheet: "fk_idle", from: 0, to: 7, fps: 8 }, run: { sheet: "fk_run", from: 0, to: 7, fps: 14 },
    hit: { sheet: "fk_take_hit", from: 0, to: 5, fps: 16 }, broken: { sheet: "fk_take_hit", from: 5, to: 5 }, death: { sheet: "fk_death", from: 0, to: 12, fps: 10 },
  },
  attacks: {
    CUT: {
      id: "CUT", desc: "The player's own light cut, thrown back at them. Fast and clean with a short tell. Deflect it or step out of reach.",
      clip: { sheet: "fk_1_atk", from: 0, to: 10, fps: 20, holds: { 3: 300 } }, hits: [{ a: 4, b: 6, dmg: 12, posture: 16, reach: 120 }],
      range: [0, 125], cooldownMs: 1100, lunge: 26, clashable: true,
    },
    CHAIN: {
      id: "CHAIN", desc: "The player's own three-hit combo: cut, cut, then a heavy fire finisher. Branch point after the first cut. Against a player who guards early, delay the second hit; against one who rolls, press on to the finisher.",
      clip: { sheet: "fk_3_atk", from: 0, to: 27, fps: 20, holds: { 3: 280, 8: 120, 20: 90, 21: 120 } },
      hits: [{ a: 4, b: 6, dmg: 10, posture: 14, reach: 125 }, { a: 12, b: 14, dmg: 11, posture: 16, reach: 130 }, { a: 22, b: 24, dmg: 18, posture: 28, reach: 150, kind: "heavy" }],
      range: [0, 140], cooldownMs: 2600, lunge: 26, gate: gate(0),
    },
    EMBER: {
      id: "EMBER", desc: "PERILOUS: the player's own fire slash (Flame Burst). The blade glows, then a huge arc of fire sweeps forward. Unblockable: counter it with a perfectly timed attack press or roll through it. A tool for breaking turtles and punishing a player who relies on guard.",
      clip: { sheet: "fk_sp_atk", from: 0, to: 17, fps: 20, holds: { 9: 700, 11: 80 } },
      hits: [{ a: 12, b: 14, dmg: 22, posture: 24, reach: 230, band: 70, kind: "perilous" }],
      range: [40, 230], cooldownMs: 7000, lunge: 24, perilous: true,
    },
  },
  weights: {
    close: [["CUT", 3], ["CHAIN", 3], ["EMBER", 1], ["BACKSTEP", 1]],
    mid: [["CHAIN", 2], ["EMBER", 2], ["APPROACH", 2], ["CUT", 1]],
    far: [["EMBER", 2], ["APPROACH", 2]],
  },
  persona: "You are the Echo: a dark mirror of the player's own fighting style, built from how they actually fought. You know their habits (see snapshot.profile and snapshot.habits): how they roll, how early they tap guard, whether they turtle or trade. Use exactly the moves that beat THEM. You are cold, patient and a little sad.",
  taunts: [
    { id: "SELF", text: "I am what you do.", when: "the player has repeated a habit the data shows (same roll direction, early guard taps)." },
    { id: "AGAIN", text: "You always do that.", when: "the player just fell for a pattern they have fallen for before." },
  ],
  intro: "Everything you have done, I have kept.", outro: "Then... I was never the shadow.",
  phase2: { hpPct: 0.5, speed: 1.15, cooldown: 0.75, hold: 0.8 },
};

/** Give the rules bot some dance: retreat and circle weights per distance band (scaled per boss). */
function dance(b: BossDef, retreat: number, circle: number) {
  b.weights.close.push(["RETREAT", retreat], ["CIRCLE", circle * 0.8]);
  b.weights.mid.push(["CIRCLE", circle * 1.2], ["RETREAT", retreat * 0.4]);
  b.weights.far.push(["CIRCLE", circle * 0.6]);
}
dance(MB, 1, 1);
dance(CM, 0.5, 0.5);
dance(WH, 1.5, 2);
dance(ECHO, 1, 1);
CM.spacing = { engage: 105, disengage: 200, personal: 90, engageMs: [6500, 9500], disengageMs: [1000, 1700], attacksPerEngage: [3, 5] };
WH.spacing = { engage: 95, disengage: 270, personal: 80, engageMs: [2500, 4200], disengageMs: [1300, 2300], attacksPerEngage: [1, 3] };
export const BOSSES: Record<string, BossDef> = { mb: MB, cm: CM, wh: WH, echo: ECHO };
/** Order of the demo run. */
export const ENCOUNTERS = ["mb", "cm", "wh", "echo"];
