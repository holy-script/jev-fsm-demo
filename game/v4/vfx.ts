import * as Phaser from "phaser";
import { SCALE } from "./data";

/** One-shot sprite effects from the pimen spritesheets. Created by name (manifest.vfx keys); each plays once and removes itself. */
export class Vfx {
  constructor(private scene: Phaser.Scene, vfxSheets: Record<string, { frames: number }>) {
    for (const [key, s] of Object.entries(vfxSheets)) {
      if (scene.anims.exists("vfx:" + key)) continue;
      scene.anims.create({ key: "vfx:" + key, frames: scene.anims.generateFrameNumbers(key, { start: 0, end: s.frames - 1 }), frameRate: 22, repeat: 0 });
    }
  }

  play(key: string, x: number, y: number, o: { scale?: number; flip?: boolean; tint?: number; rot?: number; fps?: number; add?: boolean; depth?: number } = {}) {
    if (!this.scene.anims.exists("vfx:" + key)) return null;
    const s = this.scene.add.sprite(x, y, key, 0).setScale((o.scale ?? 1) * SCALE).setFlipX(!!o.flip).setRotation(o.rot ?? 0).setDepth(o.depth ?? 900);
    if (o.tint !== undefined) s.setTint(o.tint);
    if (o.add) s.setBlendMode(Phaser.BlendModes.ADD);
    s.play({ key: "vfx:" + key, frameRate: o.fps ?? 22 });
    s.once(Phaser.Animations.Events.ANIMATION_COMPLETE, () => s.destroy());
    return s;
  }
}
