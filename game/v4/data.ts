import type { PlayOpts } from "./anim";

export const VIEW_W = 960;
export const VIEW_H = 540;
export const SCALE = 2; // chierit sprites are about 45 px tall; at 2x the hero is about 90 px on a 540 px view

/** A clip: a frame range of one sheet. from > to plays backwards. */
export interface Clip {
  sheet: string;
  from: number;
  to: number;
  fps?: number;
  holds?: Record<number, number>;
}
/** One damaging window. Frames are sheet frame numbers; the hit is resolved once, the first frame the animation enters [a, b]. */
export interface HitDef {
  a: number;
  b: number;
  dmg: number;
  posture: number;
  /** forward reach in px from the attacker (art is at SCALE, so about 2x the sprite pixels) */
  reach: number;
  /** vertical tolerance in px (the game is top-down: y is depth) */
  band?: number;
  /** can the hit be deflected (normal) or does it need a roll (sweep) */
  kind?: "normal" | "heavy" | "sweep" | "perilous";
  /** hits on both sides of the attacker (ground blades) instead of only in front */
  around?: boolean;
}

export interface PlayerAttack {
  id: string;
  clip: Clip;
  hits: HitDef[];
  /** accept the chain input from this frame on; the buffered press continues into `next` when the clip ends */
  chainFrom: number;
  next?: string;
  /** played when the chain is not continued */
  recover?: Clip;
  /** forward step (px) spread over the frames before the first hit */
  lunge: number;
}

export interface EnemyAttack {
  id: string;
  clip: Clip;
  hits: HitDef[];
  /** minimum distance to start it, maximum distance (the brain chooses by range) */
  range: [number, number];
  cooldownMs: number;
  lunge: number;
  /** unblockable: guard does nothing; counter it with a well-timed attack press, slip it with a roll */
  perilous?: boolean;
  /** a player swing that is in its strike frames when this one connects turns into a clash */
  clashable?: boolean;
}

export const HERO = {
  hp: 100,
  posture: 100,
  speed: 150,
  guardSpeed: 70,
  rollSpeed: 330,
  rollMs: 400,
  rollIFrames: [40, 300] as [number, number],
  rollCdMs: 220,
  deflectMs: 160, // guard pressed this recently before the hit connects = perfect deflect
  deflectSpamMs: 260, // pressing again inside this window of the previous press gives no window
  chipFraction: 0.12,
  postureHitFraction: 0.4,
  postureRegen: 24,
  postureRegenDelayMs: 1100,
  hurtMs: 380,
  hurtInvulnMs: 700,
  radius: 18,
  spirit: 5,
  spiritDeflect: 1,
  spiritCounter: 1,
  spiritHit: 0.25,
  /** a press of attack this many ms before a perilous strike lands counters it */
  counterMs: 200,
};

/** The Fire Knight skill: Flame Burst (key E), fk_sp_atk. Frames 1-9 charge the blade, 11-14 release the fire slash. */
export const SKILLS: Record<string, PlayerAttack & { cost: number }> = {
  FLAME: {
    id: "FLAME", cost: 2, clip: { sheet: "fk_sp_atk", from: 0, to: 17, fps: 20, holds: { 9: 60, 11: 80 } },
    hits: [{ a: 12, b: 14, dmg: 24, posture: 34, reach: 220, band: 70, kind: "heavy" }], chainFrom: 99, lunge: 30,
  },
};

/** Deathblow quick-time event: prompts the player must hit as the ring closes. */
export const DEATHBLOW = {
  prompts: 3,
  windowMs: 720,
  assistFactor: 1.6, // window and tolerance scale in the "assist" setting
  keys: ["J", "K", "L"],
  slowmo: 0.22,
  damage: { execute: 70, clean: 45, scuffed: 20 },
  /** distance the knight steps to before the finisher */
  gap: 70,
};
export const CLASH = { need: 7, ms: 1100, assistNeed: 4, slowmo: 0.15, enemyPosture: 22, lossPostureHero: 26, lossDamageFraction: 0.5 };
export const COUNTER = { enemyPosture: 45 };

/** The Fire Knight chain is built from the three authored sheets, which share their first frames: L1 plays 1_atk to its first impact,
 *  L2 continues inside 2_atk at frame 7 (the follow-through into the second swing), L3 inside 3_atk at frame 16 (into the fire finisher).
 *  That avoids replaying the wind-up on each press, which is what makes it read as a combo and not three separate attacks. */
export const HERO_ATTACKS: Record<string, PlayerAttack> = {
  L1: {
    id: "L1", clip: { sheet: "fk_1_atk", from: 0, to: 6, fps: 22 }, hits: [{ a: 4, b: 6, dmg: 8, posture: 14, reach: 120 }],
    chainFrom: 3, next: "L2", recover: { sheet: "fk_1_atk", from: 7, to: 10, fps: 16 }, lunge: 26,
  },
  L2: {
    id: "L2", clip: { sheet: "fk_2_atk", from: 7, to: 15, fps: 22 }, hits: [{ a: 11, b: 14, dmg: 9, posture: 16, reach: 130 }],
    chainFrom: 10, next: "L3", recover: { sheet: "fk_2_atk", from: 16, to: 18, fps: 16 }, lunge: 20,
  },
  L3: {
    id: "L3", clip: { sheet: "fk_3_atk", from: 16, to: 27, fps: 20, holds: { 21: 70, 22: 40 } }, hits: [{ a: 22, b: 24, dmg: 18, posture: 30, reach: 150, kind: "heavy" }],
    chainFrom: 99, lunge: 14,
  },
};
export const HERO_CLIPS = {
  idle: { sheet: "fk_idle", from: 0, to: 7, fps: 8 } as Clip,
  run: { sheet: "fk_run", from: 0, to: 7, fps: 14 } as Clip,
  roll: { sheet: "fk_roll", from: 0, to: 7, fps: 20 } as Clip,
  guardUp: { sheet: "fk_defend", from: 0, to: 4, fps: 30 } as Clip,
  hurt: { sheet: "fk_take_hit", from: 0, to: 5, fps: 16 } as Clip,
  death: { sheet: "fk_death", from: 0, to: 12, fps: 10 } as Clip,
};

/** Training enemy: Metal Bladekeeper. Its attacks are one wind-up frame then an instant strike, so the telegraph is a hold on frame 0. */
export const ENEMY = {
  id: "mb",
  name: "Metal Bladekeeper",
  hp: 160,
  posture: 100,
  speed: 105,
  radius: 20,
  brokenMs: 2600,
  recoilMs: 750,
  flinchMs: 320,
  poiseMs: 1000,
  deathblowMult: 2.5,
  postureRegen: 14,
  postureRegenDelayMs: 1800,
  clips: {
    idle: { sheet: "mb_idle", from: 0, to: 7, fps: 8 } as Clip,
    run: { sheet: "mb_run", from: 0, to: 7, fps: 14 } as Clip,
    hit: { sheet: "mb_take_hit", from: 0, to: 5, fps: 16 } as Clip,
    broken: { sheet: "mb_take_hit", from: 5, to: 5 } as Clip,
    death: { sheet: "mb_death", from: 0, to: 11, fps: 10 } as Clip,
  },
};
export const ENEMY_ATTACKS: Record<string, EnemyAttack> = {
  SLASH: {
    id: "SLASH", clip: { sheet: "mb_1_atk", from: 0, to: 5, fps: 18, holds: { 0: 520 } }, hits: [{ a: 1, b: 3, dmg: 14, posture: 18, reach: 125 }],
    range: [0, 120], cooldownMs: 1400, lunge: 40, clashable: true,
  },
  TWIN: {
    id: "TWIN", clip: { sheet: "mb_2_atk", from: 0, to: 7, fps: 18, holds: { 0: 560, 3: 150 } },
    hits: [{ a: 1, b: 2, dmg: 10, posture: 14, reach: 125 }, { a: 4, b: 5, dmg: 12, posture: 16, reach: 135 }],
    range: [40, 170], cooldownMs: 2000, lunge: 50, clashable: true,
  },
  // Perilous: ground blades erupt on both sides at frames 3-8. The telegraph is a long hold on frame 2 with a closing ring.
  BLOOM: {
    id: "BLOOM", clip: { sheet: "mb_sp_atk", from: 0, to: 10, fps: 16, holds: { 2: 800 } },
    hits: [{ a: 3, b: 8, dmg: 24, posture: 20, reach: 200, band: 80, kind: "perilous", around: true }],
    range: [0, 210], cooldownMs: 6500, lunge: 0, perilous: true,
  },
};

export const FX_EXTRA = {
  burst: "fire_02_explosion_2_spritesheet",
  fireBolt: "fire_spell_firebolt_spritesheet",
  hitFire: "fire_spell_fire_breath_hit_effect_spritesheet",
  smokeA: "smoke_n_dust_03_smokendust_p03_vfx_2",
  holy: "holy_holy_vfx_02",
};
export const FX = {
  sparkHit: "battle_vfx_hit_spark_hit_effect_01_1", // orange
  sparkParry: "battle_vfx_hit_spark_hit_effect_01_2", // blue
  sparkBlock: "battle_vfx_hit_spark_hit_effect_01_3", // green-white
  smear: "battle_vfx_slashes_and_thrusts_smear_01_horizontal_1",
};

export const playOpts = (c: Clip): PlayOpts => ({ fps: c.fps, holds: c.holds });
