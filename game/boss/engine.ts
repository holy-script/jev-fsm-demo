import * as Phaser from "phaser";

export const TILE = 16;
export const VIEW_W = 640;
export const VIEW_H = 368;

export interface SheetInfo {
  file: string;
  frameW: number;
  frameH: number;
  frames: number;
  bbox: { x: number; y: number; w: number; h: number };
  body: { x: number; y: number; w: number; h: number };
}
export interface Manifest {
  sheets: Record<string, SheetInfo & { w?: number; h?: number }>;
  tiles: { file: string };
}

export interface Rect {
  l: number;
  r: number;
  t: number;
  b: number;
}
export const overlap = (a: Rect, b: Rect) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

/** Tile collision read from the Tiled map: `ground` is solid, `platforms` can be stood on but jumped up through. */
export class World {
  private solid: boolean[][];
  private plat: boolean[][];
  constructor(map: Phaser.Tilemaps.Tilemap) {
    const read = (name: string) => map.getLayer(name)!.data.map((row) => row.map((t) => t.index > 0));
    this.solid = read("ground");
    this.plat = read("platforms");
  }
  private isSolid(c: number, r: number) {
    return !!this.solid[r]?.[c];
  }
  private isPlatformTop(c: number, r: number) {
    return !!this.plat[r]?.[c] && !this.plat[r - 1]?.[c];
  }
  /** Floor height at tile column range, if a floor top lies between prevY and newY (feet moving down). */
  landing(l: number, r: number, prevY: number, newY: number, drop: boolean): number | null {
    const c0 = Math.floor(l / TILE), c1 = Math.floor((r - 0.01) / TILE);
    const r0 = Math.floor(prevY / TILE), r1 = Math.floor(newY / TILE);
    for (let row = r0; row <= r1; row++) {
      const top = row * TILE;
      if (top < prevY - 0.5) continue; // feet were already below this surface
      for (let c = c0; c <= c1; c++) {
        if (this.isSolid(c, row) || (!drop && this.isPlatformTop(c, row))) return top;
      }
    }
    return null;
  }
}

/** A physics body with a sprite attached. (x, y) is the point between the feet. */
export class Actor {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  dir: 1 | -1 = 1;
  onGround = false;
  w: number;
  h: number;
  sprite: Phaser.GameObjects.Sprite;
  private ox: number;
  private oy: number;
  private frameW: number;
  tint = 0xffffff;

  constructor(
    scene: Phaser.Scene,
    public prefix: string,
    sheets: Manifest["sheets"],
    public nativeDir: 1 | -1,
    public scale: number,
    hurtW?: number,
  ) {
    const idle = sheets[`${prefix}_Idle`];
    this.frameW = idle.frameW;
    this.ox = idle.body.x + idle.body.w / 2;
    this.oy = idle.body.y + idle.body.h;
    this.w = (hurtW ?? Math.max(16, idle.body.w * 0.7)) * scale;
    this.h = idle.body.h * scale;
    this.sprite = scene.add.sprite(0, 0, `${prefix}_Idle`).setScale(scale).setOrigin(this.ox / idle.frameW, this.oy / idle.frameH);
  }

  get rect(): Rect {
    return { l: this.x - this.w / 2, r: this.x + this.w / 2, t: this.y - this.h, b: this.y };
  }

  play(name: string, fps?: number, restart = false) {
    const key = `${this.prefix}_${name}`;
    if (!restart && this.sprite.anims.currentAnim?.key === key && this.sprite.anims.isPlaying) return;
    this.sprite.anims.play(fps ? { key, frameRate: fps } : key, false);
  }
  get frame() {
    return (this.sprite.anims.currentFrame?.index ?? 1) - 1;
  }
  get animDone() {
    return !this.sprite.anims.isPlaying;
  }

  step(world: World, dt: number, gravity: number, drop = false, bounds = [0, VIEW_W]) {
    this.x = Phaser.Math.Clamp(this.x + this.vx * dt, bounds[0] + this.w / 2, bounds[1] - this.w / 2);
    this.vy = Math.min(this.vy + gravity * dt, 520);
    const prev = this.y;
    const next = prev + this.vy * dt;
    this.onGround = false;
    if (this.vy >= 0) {
      const floor = world.landing(this.x - this.w / 2 + 2, this.x + this.w / 2 - 2, prev, next, drop);
      if (floor !== null) {
        this.y = floor;
        this.vy = 0;
        this.onGround = true;
        return;
      }
    }
    this.y = next;
  }

  sync() {
    const flip = this.dir !== this.nativeDir;
    this.sprite.setFlipX(flip);
    this.sprite.setOrigin(flip ? 1 - this.ox / this.frameW : this.ox / this.frameW, this.sprite.originY);
    this.sprite.setPosition(Math.round(this.x), Math.round(this.y));
  }

  /** World-space rect of an attack box in front of the actor. */
  boxInFront(b: { dx: number; w: number; h: number; dy?: number }): Rect {
    const s = this.scale;
    const near = b.dx * s, far = (b.dx + b.w) * s;
    const l = this.dir > 0 ? this.x + near : this.x - far;
    const r = this.dir > 0 ? this.x + far : this.x - near;
    const bottom = this.y - (b.dy ?? 0) * s;
    return { l, r, t: bottom - b.h * s, b: bottom };
  }
}
