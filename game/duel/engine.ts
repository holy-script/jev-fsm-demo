import * as Phaser from "phaser";
import { TILE } from "./data";

export interface SheetInfo {
  file: string;
  frameW: number;
  frameH: number;
  frames: number;
  bbox: number[];
  first: number[];
}
export interface DuelManifest {
  sheets: Record<string, SheetInfo>;
  audio: Record<string, string>;
  music: Record<string, { file: string; bpm: number; phase: number; conf: number; seconds: number }>;
  tiles: { file: string };
}

export interface Rect {
  l: number;
  r: number;
  t: number;
  b: number;
}

const FACE_GIDS = new Set([15, 16, 17, 18]); // bottom row of the plateau tiles = cliff face = not walkable

/** Walkability and spawn points read from the Tiled map. */
export class World {
  readonly w: number;
  readonly h: number;
  private ground: number[][];
  private walls: number[][];
  gate: Rect | null = null;
  gateOpen = true;
  spawns: Record<string, { x: number; y: number }> = {};
  arena!: Rect;

  constructor(map: Phaser.Tilemaps.Tilemap) {
    this.w = map.width;
    this.h = map.height;
    const read = (n: string) => map.getLayer(n)!.data.map((row) => row.map((t) => Math.max(0, t.index)));
    this.ground = read("ground");
    this.walls = read("walls");
    for (const o of map.getObjectLayer("objects")!.objects) {
      if (o.type === "spawn") this.spawns[o.name] = { x: o.x!, y: o.y! };
      if (o.type === "gate") this.gate = { l: o.x! - 6 * TILE, r: o.x! + 6 * TILE, t: o.y! - TILE, b: o.y! + TILE };
      if (o.type === "arena") this.arena = { l: o.x!, t: o.y!, r: o.x! + o.width!, b: o.y! + o.height! };
    }
  }

  private blockedTile(tx: number, ty: number) {
    const g = this.ground[ty]?.[tx] ?? 0;
    return g === 0 || FACE_GIDS.has(g) || (this.walls[ty]?.[tx] ?? 0) !== 0;
  }

  blocked(r: Rect): boolean {
    for (let ty = Math.floor(r.t / TILE); ty <= Math.floor((r.b - 0.01) / TILE); ty++)
      for (let tx = Math.floor(r.l / TILE); tx <= Math.floor((r.r - 0.01) / TILE); tx++) if (this.blockedTile(tx, ty)) return true;
    if (!this.gateOpen && this.gate && r.l < this.gate.r && r.r > this.gate.l && r.t < this.gate.b && r.b > this.gate.t) return true;
    return false;
  }
}

/** A sprite-backed combatant. (x, y) is the point between the feet; the footprint is a small box there. */
export class Fighter {
  x = 0;
  y = 0;
  face: 1 | -1 = 1;
  sprite: Phaser.GameObjects.Sprite;
  private anchors: Record<string, { ax: number; ay: number }> = {};
  private flash = 0;
  readonly baseScale: number;

  constructor(scene: Phaser.Scene, public prefix: string, sheets: DuelManifest["sheets"], public radius: number, scale = 1) {
    const idle = sheets[`${prefix}_idle`];
    const ax = (idle.first[0] + idle.first[2]) / 2 - 3;
    const ay = idle.first[3];
    for (const [key, s] of Object.entries(sheets)) {
      if (!key.startsWith(prefix + "_")) continue;
      this.anchors[key] = s.frameH === idle.frameH ? { ax, ay } : { ax: (s.first[0] + s.first[2]) / 2 - 3, ay: s.first[3] };
    }
    this.baseScale = scale;
    this.sprite = scene.add.sprite(0, 0, `${prefix}_idle`).setScale(scale);
  }

  get rect(): Rect {
    return { l: this.x - this.radius, r: this.x + this.radius, t: this.y - this.radius * 0.6, b: this.y + this.radius * 0.6 };
  }

  play(name: string, fps?: number, opts: { restart?: boolean; loop?: boolean } = {}) {
    const key = `${this.prefix}_${name}`;
    const a = this.sprite.anims;
    if (!opts.restart && a.currentAnim?.key === key && (a.isPlaying || !opts.loop)) return;
    a.timeScale = 1;
    a.play({ key, frameRate: fps, repeat: opts.loop ? -1 : 0 }, false);
  }
  freeze(on: boolean) {
    this.sprite.anims.timeScale = on ? 0 : 1;
  }
  get frame() {
    return (this.sprite.anims.currentFrame?.index ?? 1) - 1;
  }
  get done() {
    return !this.sprite.anims.isPlaying;
  }

  /** Move with axis-separated footprint collision. Returns false if fully blocked. */
  move(world: World, dx: number, dy: number) {
    const saved = { x: this.x, y: this.y };
    this.x += dx;
    if (world.blocked(this.rect)) this.x = saved.x;
    this.y += dy;
    if (world.blocked(this.rect)) this.y = saved.y;
    return this.x !== saved.x || this.y !== saved.y;
  }

  get flashing() {
    return this.flash > 0;
  }
  hitFlash(ms = 80, color = 0xffffff) {
    this.flash = ms;
    this.sprite.setTintFill(color);
  }
  tickFx(dtMs: number) {
    if (this.flash > 0 && (this.flash -= dtMs) <= 0) this.sprite.clearTint();
  }

  sync() {
    const flip = this.face < 0;
    const key = this.sprite.anims.currentAnim?.key ?? `${this.prefix}_idle`;
    const an = this.anchors[key] ?? this.anchors[`${this.prefix}_idle`];
    const fw = this.sprite.width, fh = this.sprite.height;
    this.sprite.setFlipX(flip);
    this.sprite.setOrigin(flip ? 1 - an.ax / fw : an.ax / fw, an.ay / fh);
    this.sprite.setPosition(Math.round(this.x), Math.round(this.y));
    this.sprite.setDepth(10 + this.y / 100);
  }
}

export const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(bx - ax, by - ay);
export const angleTo = (ax: number, ay: number, bx: number, by: number) => Math.atan2(by - ay, bx - ax);
/** Is (px, py) inside a cone/circle shape whose apex is (ox, oy) pointing along `dir` (radians)? `pad` forgives the target's footprint. */
export function inShape(shape: { kind: string; range: number; half?: number }, ox: number, oy: number, dir: number, px: number, py: number, pad: number) {
  const d = dist(ox, oy, px, py);
  if (d > shape.range + pad) return false;
  if (shape.kind === "circle") return true;
  if (d < 6) return true;
  const diff = Math.abs(Phaser.Math.Angle.Wrap(angleTo(ox, oy, px, py) - dir));
  return diff <= ((shape.half ?? 60) * Math.PI) / 180 + Math.atan2(pad, Math.max(d, 1));
}
