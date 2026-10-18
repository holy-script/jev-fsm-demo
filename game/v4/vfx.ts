import * as Phaser from "phaser";
import { SCALE } from "./data";

/** One-shot sprite effects from the pimen spritesheets. Created by name (manifest.vfx keys); each plays once and removes itself. */
export class Vfx {
  private frames: Record<string, number> = {};
  constructor(private scene: Phaser.Scene, vfxSheets: Record<string, { frames: number }>) {
    for (const [k, s] of Object.entries(vfxSheets)) this.frames[k] = s.frames;
    for (const [key, s] of Object.entries(vfxSheets)) {
      if (scene.anims.exists("vfx:" + key)) continue;
      scene.anims.create({ key: "vfx:" + key, frames: scene.anims.generateFrameNumbers(key, { start: 0, end: s.frames - 1 }), frameRate: 22, repeat: 0 });
    }
  }

  /** The animation key for a frame range of a sheet (created on first use). Without a range it is the whole-sheet animation. */
  private animFor(key: string, range?: [number, number], loop = false) {
    if (!range && !loop) return "vfx:" + key;
    const k = `vfx:${key}:${range ? range.join("-") : "all"}:${loop ? "loop" : "once"}`;
    if (!this.scene.anims.exists(k)) {
      const n = this.frames[key] ?? 1;
      this.scene.anims.create({ key: k, frames: this.scene.anims.generateFrameNumbers(key, { start: range ? range[0] : 0, end: range ? range[1] : n - 1 }), frameRate: 22, repeat: loop ? -1 : 0 });
    }
    return k;
  }

  /** One-shot effect, destroyed when it finishes. `range` plays only part of the sheet; `loop` keeps it alive (the caller destroys it). */
  play(key: string, x: number, y: number, o: { scale?: number; flip?: boolean; tint?: number; rot?: number; fps?: number; add?: boolean; depth?: number; alpha?: number; range?: [number, number]; loop?: boolean } = {}) {
    if (!this.scene.anims.exists("vfx:" + key)) return null;
    const s = this.scene.add.sprite(x, y, key, o.range ? o.range[0] : 0).setScale((o.scale ?? 1) * SCALE).setFlipX(!!o.flip).setRotation(o.rot ?? 0).setDepth(o.depth ?? 900);
    if (o.tint !== undefined) s.setTint(o.tint);
    if (o.alpha !== undefined) s.setAlpha(o.alpha);
    if (o.add) s.setBlendMode(Phaser.BlendModes.ADD);
    s.play({ key: this.animFor(key, o.range, o.loop), frameRate: o.fps ?? 22 });
    if (!o.loop) s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => s.destroy());
    return s;
  }
}
