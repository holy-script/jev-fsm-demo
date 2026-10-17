import * as Phaser from "phaser";
import type { Fighter } from "./engine";

interface PlayOpts {
  scale?: number;
  tint?: number;
  rot?: number;
  flipX?: boolean;
  alpha?: number;
  add?: boolean; // additive blending (glowy)
  depth?: number;
  fps?: number;
}

/**
 * Effects that stand in for missing animations (hurt, heal, break...): tintable sprite bursts, afterimages and squash.
 * The sheets are white-on-transparent, so one burst can be gold (deflect), red (hit) or grey (stone).
 */
export class Vfx {
  constructor(private scene: Phaser.Scene) {}

  play(key: string, x: number, y: number, o: PlayOpts = {}) {
    const full = "vfx_" + key;
    if (!this.scene.textures.exists(full)) return;
    const s = this.scene.add.sprite(x, y, full).setScale(o.scale ?? 1).setDepth(o.depth ?? 40).setAlpha(o.alpha ?? 1).setRotation(o.rot ?? 0).setFlipX(!!o.flipX);
    if (o.tint !== undefined) s.setTint(o.tint);
    if (o.add) s.setBlendMode(Phaser.BlendModes.ADD);
    s.play({ key: full, frameRate: o.fps ?? 26 });
    s.once("animationcomplete", () => s.destroy());
    return s;
  }

  // ---- named effects
  deflect(x: number, y: number) {
    this.play("hit03", x, y, { scale: 1.9, tint: 0xfff2b0, add: true });
    this.play("impact01", x, y, { scale: 1.1, tint: 0xffffff, alpha: 0.85, fps: 30 });
  }
  hit(x: number, y: number, heavy: boolean, tint = 0xffe9c2) {
    this.play("hit03", x, y, { scale: heavy ? 1.7 : 1.15, tint, add: true });
    this.play("hit01", x, y, { scale: heavy ? 1.6 : 1.1, tint, rot: Math.random() * Math.PI, add: true });
  }
  blockSplash(x: number, y: number, dir: number) {
    this.play("splash", x, y, { scale: 1.4, tint: 0x9fd0ff, flipX: dir < 0, add: true });
  }
  blood(x: number, y: number, dir: number) {
    this.play("blood", x, y, { scale: 1.5, tint: 0xff2a2a, flipX: dir < 0, depth: 41 });
  }
  postureBreak(x: number, y: number, color = 0xffd36b) {
    this.play("break01", x, y, { scale: 2.3, tint: color, add: true });
    this.play("impact01", x, y, { scale: 2.1, tint: color, alpha: 0.8 });
  }
  deathblow(x: number, y: number) {
    this.play("impact01", x, y, { scale: 3.4, tint: 0xff5d5d, add: true, fps: 22 });
    this.play("break01", x, y, { scale: 3, tint: 0xff5d5d, add: true });
    this.play("hit03", x, y, { scale: 2.6, tint: 0xffffff, add: true });
  }
  shards(x: number, y: number, tint = 0xcfc7b8, scale = 1.7) {
    this.play("shards", x, y, { scale, tint });
  }
  shock(x: number, y: number, tint: number, scale = 1.5) {
    this.play("impact01", x, y, { scale, tint, alpha: 0.9 });
  }
  dust(x: number, y: number, scale = 0.9) {
    this.play("smoke", x, y, { scale, tint: 0xcdbfa8, alpha: 0.7, depth: 9, fps: 22 });
  }
  heal(x: number, y: number) {
    this.play("heal", x, y, { scale: 1.1, add: true, fps: 20, depth: 41 });
  }

  /** A fading copy of a fighter's current frame: trails for rolls, lunges and dashes. */
  afterimage(f: Fighter, tint: number, alpha = 0.4, life = 240) {
    const src = f.sprite;
    const g = this.scene.add.sprite(src.x, src.y, src.texture.key, src.frame.name).setOrigin(src.originX, src.originY).setScale(src.scaleX, src.scaleY).setFlipX(src.flipX).setDepth(src.depth - 0.01);
    g.setTintFill(tint).setAlpha(alpha);
    this.scene.tweens.add({ targets: g, alpha: 0, duration: life, onComplete: () => g.destroy() });
  }

  /** A quick squash-and-stretch: gives bodies without a hurt animation a visible reaction. */
  squash(f: Fighter, sx = 1.14, sy = 0.86, ms = 70) {
    const base = f.baseScale;
    this.scene.tweens.killTweensOf(f.sprite);
    f.sprite.setScale(base);
    this.scene.tweens.add({ targets: f.sprite, scaleX: base * sx, scaleY: base * sy, duration: ms, yoyo: true, ease: "Quad.easeOut", onComplete: () => f.sprite.setScale(base) });
  }
}
