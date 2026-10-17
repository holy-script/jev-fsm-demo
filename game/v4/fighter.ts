import * as Phaser from "phaser";
import { Animator } from "./anim";
import { SCALE, playOpts, type Clip } from "./data";
import type { ArenaManifest } from "./manifest";

/** A sprite-backed combatant. (x, y) is the point between the feet (y is depth on the floor). All frames of a character share one
 *  foot anchor measured from its idle sheet, so lunges and recoil authored in the art come through unchanged. */
export class Fighter {
  x = 0;
  y = 0;
  face: 1 | -1 = 1;
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly anim = new Animator();
  private shown = "";
  private flash = 0;
  private readonly ax: number;
  private readonly ay: number;
  private readonly fw: number;
  private readonly fh: number;

  constructor(scene: Phaser.Scene, readonly prefix: string, sheets: ArenaManifest["sheets"], readonly radius: number, private nativeDir: 1 | -1 = 1) {
    const idle = sheets[`${prefix}_idle`];
    this.fw = idle.frameW;
    this.fh = idle.frameH;
    this.ax = (idle.first[0] + idle.first[2]) / 2;
    this.ay = idle.first[3];
    this.sprite = scene.add.sprite(0, 0, `${prefix}_idle`, 0).setScale(SCALE).setOrigin(this.ax / this.fw, this.ay / this.fh);
  }

  play(c: Clip, o: { loop?: boolean; onDone?: () => void } = {}) {
    this.anim.play(c.sheet, c.from, c.to, { ...playOpts(c), ...o });
  }
  /** Start `c` unless it is already the clip being played (for looping locomotion). */
  ensure(c: Clip) {
    if (this.anim.sheet === c.sheet && this.anim.loop && this.anim.from === c.from && this.anim.to === c.to) return;
    this.play(c, { loop: true });
  }

  hitFlash(ms = 90, color = 0xffffff) {
    this.flash = ms;
    this.sprite.setTintFill(color);
  }

  /** Advance the animation and push everything to the sprite. */
  tick(dtMs: number) {
    this.anim.update(dtMs);
    if (this.flash > 0 && (this.flash -= dtMs) <= 0) this.sprite.clearTint();
    const key = this.anim.sheet || `${this.prefix}_idle`;
    const id = `${key}#${this.anim.frame}`;
    if (id !== this.shown) {
      this.sprite.setTexture(key, this.anim.frame);
      this.shown = id;
    }
    this.sprite.setFlipX(this.face !== this.nativeDir);
    // flipping mirrors around the frame centre, so mirror the origin too to keep the feet on (x, y)
    this.sprite.setOrigin(this.face !== this.nativeDir ? 1 - this.ax / this.fw : this.ax / this.fw, this.ay / this.fh);
    this.sprite.setPosition(Math.round(this.x), Math.round(this.y));
    this.sprite.setDepth(10 + this.y / 100);
  }
}
