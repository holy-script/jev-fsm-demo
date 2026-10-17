/** The four arenas (one per boss). Each is composed from stamps cut out of the immunitys tilesets (see docs/09 section 13): a repeating
 *  ground fill, ground patches, sorted props (trees, ruins, walls) and obstacles. All art is drawn at ENV_SCALE (= the character SCALE) so
 *  pixels match. Stamp keys are manifest.env ids (fmt = Forgotten Memories patches, fmp = its props, rrp = Resurrected props, rrw = its walls).
 *  Positions are screen px; props anchor at their bottom centre. */
export const ENV_SCALE = 2;

export interface Stamp {
  k: string;
  x: number;
  y: number;
  /** scale multiplier on top of ENV_SCALE's pixel size, default 1 means ENV_SCALE; use 1.5 for 3x */
  s?: number;
  flip?: boolean;
  /** ground layer: drawn under everything, in listed order. Otherwise depth-sorted with the fighters by y. */
  g?: boolean;
  alpha?: number;
}
export interface Obstacle {
  x: number;
  y: number;
  r: number;
}
export interface AreaDef {
  id: string;
  name: string;
  subtitle: string;
  ground: { fill: string; /** tint multiplied onto the fill */ tint?: number };
  /** an animated water rect (x, y, w, h) drawn over the ground */
  water?: { x: number; y: number; w: number; h: number };
  stamps: Stamp[];
  obstacles: Obstacle[];
  ambient: { color: number; alpha: number };
  vignette: number;
  particles: "leaves" | "motes" | "mist" | "embers";
  /** music key from the manifest (Ninja Adventure tracks): beat-analysed, 65-90 BPM */
  music: string;
  portal?: { x: number; y: number; scale: number };
}

const dirtArena = (y: number): Stamp[] => [
  { k: "fmt_11", x: 250, y, s: 1.5, g: true }, { k: "fmt_11", x: 480, y: y + 20, s: 1.5, g: true, flip: true }, { k: "fmt_11", x: 710, y, s: 1.5, g: true },
];

export const AREAS: Record<string, AreaDef> = {
  forest: {
    id: "forest", name: "THE FOREST EDGE", subtitle: "Where the path ends, the duel begins.",
    ground: { fill: "fill_grass" },
    stamps: [
      ...dirtArena(520),
      { k: "fmt_16", x: 70, y: 330, g: true }, { k: "fmt_00", x: 905, y: 340, g: true },
      { k: "fmp_04", x: 150, y: 250 }, { k: "fmp_00", x: 380, y: 205 }, { k: "fmp_01", x: 560, y: 215 }, { k: "fmp_03", x: 700, y: 200 },
      { k: "fmp_02", x: 830, y: 225 }, { k: "fmp_03", x: 925, y: 245 }, { k: "fmp_37", x: 270, y: 235 }, { k: "fmp_38", x: 770, y: 240 },
      { k: "fmp_05", x: 60, y: 275 }, { k: "fmp_10", x: 470, y: 232 }, { k: "fmp_17", x: 640, y: 240 }, { k: "fmp_16", x: 330, y: 250 },
      { k: "fmp_08", x: 790, y: 440 }, { k: "fmp_33", x: 175, y: 450 }, { k: "fmp_13", x: 120, y: 505 }, { k: "fmp_17", x: 905, y: 520 },
      { k: "fmp_40", x: 35, y: 530 }, { k: "fmp_29", x: 600, y: 535 },
    ],
    obstacles: [{ x: 790, y: 440, r: 18 }, { x: 175, y: 450, r: 22 }],
    ambient: { color: 0xffd9a8, alpha: 0.14 }, vignette: 0.35, particles: "leaves", music: "captain",
  },
  river: {
    id: "river", name: "RIVER SHRINE", subtitle: "The water remembers every blade.",
    ground: { fill: "fill_grass" },
    water: { x: 0, y: 0, w: 960, h: 240 },
    stamps: [
      { k: "fmt_00", x: 130, y: 250, s: 1.5, g: true }, { k: "fmt_16", x: 830, y: 250, s: 1.5, g: true },
      ...dirtArena(530),
      { k: "rrw_38", x: 384, y: 262 }, { k: "rrw_38", x: 1152, y: 262 },
      { k: "rrp_03", x: 95, y: 275 }, { k: "rrp_04", x: 865, y: 275 }, { k: "rrp_00", x: 480, y: 262 },
      { k: "rrp_22", x: 480, y: 470, g: true, alpha: 0.9 },
      { k: "fmp_20", x: 230, y: 292 }, { k: "fmp_21", x: 730, y: 295 }, { k: "fmp_40", x: 100, y: 520 }, { k: "fmp_39", x: 870, y: 525 },
      { k: "fmp_35", x: 250, y: 470 }, { k: "fmp_35", x: 760, y: 420 },
    ],
    obstacles: [{ x: 95, y: 275, r: 20 }, { x: 865, y: 275, r: 20 }, { x: 230, y: 292, r: 12 }, { x: 730, y: 295, r: 12 }, { x: 480, y: 262, r: 12 }, { x: 250, y: 470, r: 12 }, { x: 760, y: 420, r: 12 }],
    ambient: { color: 0xa9c8ff, alpha: 0.3 }, vignette: 0.42, particles: "mist", music: "temple",
  },
  ruins: {
    id: "ruins", name: "SUNKEN RUINS", subtitle: "What the wind has not buried, it guards.",
    ground: { fill: "fill_dusk1" },
    stamps: [
      { k: "fmt_04", x: 480, y: 540, s: 1.5, g: true, alpha: 0.9 },
      { k: "rrw_31", x: 384, y: 275 }, { k: "rrw_31", x: 900, y: 275, flip: true },
      { k: "rrw_19", x: 60, y: 300 }, { k: "rrw_19", x: 910, y: 300 },
      { k: "rrp_22", x: 480, y: 465, g: true }, { k: "rrp_24", x: 480, y: 440, g: true },
      { k: "rrp_03", x: 190, y: 300 }, { k: "rrp_04", x: 770, y: 300 },
      { k: "rrp_05", x: 330, y: 450 }, { k: "rrp_05", x: 640, y: 420 }, { k: "rrp_15", x: 120, y: 480 }, { k: "rrp_15", x: 860, y: 500 },
      { k: "fmp_15", x: 480, y: 520 }, { k: "fmp_14", x: 230, y: 520 },
    ],
    obstacles: [{ x: 190, y: 300, r: 22 }, { x: 770, y: 300, r: 22 }, { x: 330, y: 450, r: 14 }, { x: 640, y: 420, r: 14 }, { x: 120, y: 480, r: 18 }, { x: 860, y: 500, r: 18 }],
    ambient: { color: 0x6677b5, alpha: 0.5 }, vignette: 0.6, particles: "mist", music: "crypt",
  },
  gate: {
    id: "gate", name: "ECHO'S GATE", subtitle: "You have been here before.",
    ground: { fill: "fill_dusk2" },
    stamps: [
      { k: "fmt_04", x: 480, y: 540, s: 1.5, g: true, alpha: 0.85 },
      { k: "rrw_38", x: 384, y: 205 }, { k: "rrw_38", x: 1152, y: 205 },
      { k: "rrp_07", x: 480, y: 290, s: 1.5 },
      { k: "rrp_03", x: 175, y: 300 }, { k: "rrp_04", x: 785, y: 300 },
      { k: "rrp_00", x: 90, y: 285 }, { k: "rrp_00", x: 870, y: 285 },
      { k: "rrp_22", x: 480, y: 465, g: true }, { k: "rrp_12", x: 480, y: 395, g: true },
      { k: "rrp_17", x: 300, y: 500 }, { k: "rrp_15", x: 680, y: 495 },
    ],
    obstacles: [{ x: 175, y: 300, r: 22 }, { x: 785, y: 300, r: 22 }, { x: 90, y: 285, r: 12 }, { x: 870, y: 285, r: 12 }, { x: 300, y: 500, r: 16 }, { x: 680, y: 495, r: 16 }],
    ambient: { color: 0x7254e8, alpha: 0.46 }, vignette: 0.6, particles: "motes", music: "final",
    portal: { x: 480, y: 168, scale: 2.1 },
  },
};
