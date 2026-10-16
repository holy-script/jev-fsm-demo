// Boss definitions: each boss is a table of FSM states. Jev only ever *picks* the next state; the engine runs it.
// Frame indices are 0-based into the sprite strips prepared by tools/prep_assets.py. Box sizes are unscaled sprite pixels.

export interface HitBox {
  dx: number; // gap between body centre and the near edge of the box, in the facing direction
  w: number;
  h: number;
  dy?: number; // height of the box's bottom above the feet
}

export type SpawnEvent =
  | { frame: number; type: "projectile"; kind: "fireball" | "bolt"; speed: number; dy: number; damage: number; angle?: number; lob?: number }
  | { frame: number; type: "rain"; count: number; spread: number; stagger: number; damage: number }
  | { frame: number; type: "pillar"; offsets: number[]; offsetsP2?: number[]; delay: number; damage: number };

export interface AttackDef {
  anim: string;
  fps: number;
  cooldown: number; // ms
  range: [number, number]; // useful horizontal distance (px) - shown to Jev, used by the rules bot
  damage?: number;
  hit?: { frames: [number, number]; box: HitBox };
  lunge?: { frames: [number, number]; speed: number };
  events?: SpawnEvent[];
  repeat?: number; // plays the animation N times back to back (combos)
}

export interface MoveDef {
  mode: "hold" | "toward" | "away" | "hop";
  anim: string;
  speed: number;
  cooldown?: number;
}

export interface StateDef {
  desc: string;
  attack?: AttackDef;
  move?: MoveDef;
}

export interface BossDef {
  id: string;
  name: string;
  title: string;
  sheet: string; // prefix of the sheet keys in manifest.json
  nativeDir: 1 | -1; // which way the art faces
  scale: number;
  hp: number;
  arena: number;
  tint: number; // background tint
  persona: string;
  states: Record<string, StateDef>;
}

const hold = (desc: string): StateDef => ({ desc, move: { mode: "hold", anim: "Idle", speed: 0 } });

export const PLAYER = {
  sheet: "knight",
  nativeDir: 1 as const,
  maxHp: 100,
  speed: 150,
  jump: 440,
  gravity: 900,
  dashSpeed: 340,
  dashTime: 0.2,
  dashCooldown: 0.65,
  attackDamage: 18,
  attackHit: { frames: [3, 4] as [number, number], box: { dx: 4, w: 56, h: 46 } },
  hurtW: 18,
};

export const BOSSES: BossDef[] = [
  {
    id: "slime",
    name: "GLOOP",
    title: "The Bloated Slime",
    sheet: "slime",
    nativeDir: 1,
    scale: 2,
    hp: 160,
    arena: 1,
    tint: 0xffffff,
    persona:
      "Gloop is a slow, simple brute. It is only dangerous when it lunges, which has a long wind-up. It cannot attack from range, so keep it at a distance it can cross only with a lunge.",
    states: {
      IDLE: hold("Rest in place and watch the player."),
      CRAWL_TOWARD: { desc: "Crawl slowly toward the player to close distance.", move: { mode: "toward", anim: "Walk", speed: 36 } },
      CRAWL_AWAY: { desc: "Crawl slowly away from the player to reset spacing.", move: { mode: "away", anim: "Walk", speed: 36 } },
      LUNGE: {
        desc: "Wind up, then lunge forward in a heavy melee slam. Long wind-up, so the player can dodge it; punishes a player standing close.",
        attack: {
          anim: "Attack", fps: 18, cooldown: 1600, range: [30, 130], damage: 14,
          hit: { frames: [9, 15], box: { dx: 10, w: 70, h: 34 } },
          lunge: { frames: [8, 14], speed: 150 },
        },
      },
    },
  },
  {
    id: "worm",
    name: "EMBER",
    title: "The Fire Worm",
    sheet: "worm",
    nativeDir: 1,
    scale: 1.8,
    hp: 220,
    arena: 2,
    tint: 0xffb89a,
    persona:
      "Ember is a slow zoner that only attacks from range with fire. Flat fireballs are easy to jump when the player is grounded; a lobbed fireball lands where the player stands, so it punishes a player who stands still or jumps in the air. A fan covers more height. It has no melee, so being close to it is low-risk for the player; its goal is to keep the player at mid range and bait jumps.",
    states: {
      IDLE: hold("Coil up and watch the player."),
      CRAWL_TOWARD: { desc: "Crawl toward the player.", move: { mode: "toward", anim: "Walk", speed: 48 } },
      CRAWL_AWAY: { desc: "Crawl away from the player to open up range.", move: { mode: "away", anim: "Walk", speed: 48 } },
      FIREBALL: {
        desc: "Spit one flat fireball straight at the player's height. Easy to jump over when grounded; good as a poke.",
        attack: { anim: "Attack", fps: 14, cooldown: 1400, range: [90, 420], events: [{ frame: 11, type: "projectile", kind: "fireball", speed: 240, dy: 26, damage: 14 }] },
      },
      LOB: {
        desc: "Lob an arcing fireball that lands on the spot the player is standing at launch. Punishes standing still; dodge by moving.",
        attack: { anim: "Attack", fps: 14, cooldown: 2600, range: [120, 420], events: [{ frame: 11, type: "projectile", kind: "fireball", speed: 0, dy: 30, damage: 16, lob: 0.95 }] },
      },
      FAN: {
        desc: "Spit three fireballs in a vertical fan. Covers more height, so jumping over is less reliable. Strong at close to mid range.",
        attack: {
          anim: "Attack", fps: 14, cooldown: 4200, range: [70, 320],
          events: [-11, 0, 11].map((angle) => ({ frame: 11, type: "projectile" as const, kind: "fireball" as const, speed: 230, dy: 26, damage: 12, angle })),
        },
      },
    },
  },
  {
    id: "wizard",
    name: "MORVANE",
    title: "The Evil Wizard",
    sheet: "wizard",
    nativeDir: 1,
    scale: 1.25,
    hp: 260,
    arena: 3,
    tint: 0xc7aaff,
    persona:
      "Morvane is a cowardly spellcaster who wins by controlling space. It is weak in melee range, so a smart wizard keeps its distance, retreats when pressured, and uses a hop to escape. Bolts are aimed at the player's current position. Bolt rain falls from above on and around the player after a short warning, punishing a player who stands still.",
    states: {
      IDLE: hold("Stand ready and watch the player."),
      APPROACH: { desc: "Walk toward the player to get into casting range.", move: { mode: "toward", anim: "Walk", speed: 60 } },
      RETREAT: { desc: "Run away from the player to open up distance.", move: { mode: "away", anim: "Run", speed: 125 } },
      HOP_BACK: { desc: "Leap backwards away from the player to escape a close threat quickly.", move: { mode: "hop", anim: "Jump", speed: 200, cooldown: 2400 } },
      BOLT: {
        desc: "Cast a fast magic bolt aimed straight at the player's position. Good from mid to long range; the bolt can be jumped or dashed through.",
        attack: { anim: "Attack", fps: 14, cooldown: 1000, range: [130, 440], events: [{ frame: 8, type: "projectile", kind: "bolt", speed: 310, dy: 40, damage: 14 }] },
      },
      BOLT_RAIN: {
        desc: "Call bolts down from the sky around the player after a short warning. Punishes a player who stands still or stays at close range. Long cooldown.",
        attack: { anim: "Attack", fps: 12, cooldown: 5500, range: [0, 520], events: [{ frame: 8, type: "rain", count: 4, spread: 52, stagger: 160, damage: 12 }] },
      },
    },
  },
  {
    id: "bringer",
    name: "THE BRINGER",
    title: "Bringer of Death",
    sheet: "bringer",
    nativeDir: -1,
    scale: 1.5,
    hp: 360,
    arena: 2,
    tint: 0x8a7fa8,
    persona:
      "The Bringer is the final boss: a patient, lethal duelist with a long-reach scythe and a spell that summons dark pillars where the player stands. At close range its scythe is its best tool; at mid/long range the soul pillar punishes a stationary player. Below half health it becomes enraged: faster, and the pillars come in threes. A smart Bringer mixes spacing with surprise and does not repeat itself.",
    states: {
      IDLE: hold("Stand menacingly and watch the player."),
      STALK: { desc: "Walk toward the player to get into scythe range.", move: { mode: "toward", anim: "Walk", speed: 72 } },
      BACKOFF: { desc: "Step back from the player to reset spacing or bait an attack.", move: { mode: "away", anim: "Walk", speed: 62 } },
      SCYTHE: {
        desc: "A single heavy scythe sweep with a lunge step. Strong at close range; has a clear wind-up and some recovery.",
        attack: {
          anim: "Attack", fps: 14, cooldown: 1300, range: [20, 120], damage: 24,
          hit: { frames: [4, 6], box: { dx: 4, w: 84, h: 52 } },
          lunge: { frames: [3, 5], speed: 140 },
        },
      },
      SCYTHE_COMBO: {
        desc: "Two scythe sweeps in a row with no pause. Very strong at close range but leaves the Bringer committed for a long time; punishes a player who dodges the first sweep poorly.",
        attack: {
          anim: "Attack", fps: 17, cooldown: 4500, range: [20, 110], damage: 20, repeat: 2,
          hit: { frames: [4, 6], box: { dx: 4, w: 84, h: 52 } },
          lunge: { frames: [3, 5], speed: 120 },
        },
      },
      SOUL_PILLAR: {
        desc: "Raise the hand and summon a dark pillar on the player's current position after a short warning. Punishes a stationary player at any range; one pillar, or three when enraged.",
        attack: {
          anim: "Cast", fps: 11, cooldown: 3600, range: [0, 600],
          events: [{ frame: 5, type: "pillar", offsets: [0], offsetsP2: [-80, 0, 80], delay: 700, damage: 20 }],
        },
      },
    },
  },
];
