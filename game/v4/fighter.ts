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
  /** height above the ground in px (jumps, leaps); the sprite lifts, the shadow stays */
  z = 0;
  /** afterimages spawned so far (tests and tuning) */
  ghosts = 0;
  private shadow: Phaser.GameObjects.Image;
  private trail: { left: number; every: number; next: number; color: number; alpha: number; life: number; add: boolean } | null = null;
  private shown = "";
  private flash = 0;
  private readonly ax: number;
  private readonly ay: number;
  private readonly fw: number;
  private readonly fh: number;

  constructor(private scene: Phaser.Scene, readonly prefix: string, sheets: ArenaManifest["sheets"], readonly radius: number, private nativeDir: 1 | -1 = 1, private baseTint?: number, hue?: number) {
    const idle = sheets[`${prefix}_idle`];
    this.fw = idle.frameW;
    this.fh = idle.frameH;
    this.ax = (idle.first[0] + idle.first[2]) / 2;
    this.ay = idle.first[3];
    this.sprite = scene.add.sprite(0, 0, `${prefix}_idle`, 0).setScale(SCALE).setOrigin(this.ax / this.fw, this.ay / this.fh);
    if (!scene.textures.exists("shadow")) {
      const g = scene.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0x000000, 1).fillEllipse(24, 8, 48, 16);
      g.generateTexture("shadow", 48, 16);
      g.destroy();
    }
    this.shadow = scene.add.image(0, 0, "shadow").setAlpha(0.38);
    if (baseTint !== undefined) this.sprite.setTint(baseTint);
    if (hue !== undefined) this.sprite.preFX?.addColorMatrix().hue(hue, false); // WebGL only; canvas just shows the original colours
  }

  play(c: Clip, o: { loop?: boolean; onDone?: () => void } = {}) {
    this.anim.play(c.sheet, c.from, c.to, { ...playOpts(c), ...o });
  }
  /** Start `c` unless it is already the clip being played (for looping locomotion). */
  ensure(c: Clip) {
    if (this.anim.sheet === c.sheet && this.anim.loop && this.anim.from === c.from && this.anim.to === c.to) return;
    this.play(c, { loop: true });
  }

  /** Leave afterimages behind the sprite for `ms`: ghost copies of the current frame, tinted and fading. */
  startTrail(ms: number, color = 0xffffff, every = 40, alpha = 0.5, life = 260, add = false) {
    this.trail = { left: ms, every, next: 0, color, alpha, life, add };
  }
  stopTrail() {
    this.trail = null;
  }
  /** One ghost right now (a burst, for example at the start of a dash or when a boss vanishes). */
  ghost(color = 0xffffff, alpha = 0.5, life = 260, add = false) {
    const s = this.sprite;
    const g = this.scene.add.image(s.x, s.y, s.texture.key, s.frame.name).setOrigin(s.originX, s.originY).setScale(s.scaleX, s.scaleY).setFlipX(s.flipX).setDepth(s.depth - 0.005).setTintFill(color).setAlpha(alpha);
    if (add) g.setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({ targets: g, alpha: 0, duration: life, onComplete: () => g.destroy() });
    this.ghosts++;
  }

  /** Remove everything this fighter put in the scene. */
  destroy() {
    this.sprite.destroy();
    this.shadow.destroy();
  }

  hitFlash(ms = 90, color = 0xffffff) {
    this.flash = ms;
    this.sprite.setTintFill(color);
  }

  /** Advance the animation and push everything to the sprite. */
  tick(dtMs: number) {
    this.anim.update(dtMs);
    if (this.flash > 0 && (this.flash -= dtMs) <= 0) {
      this.sprite.clearTint();
      if (this.baseTint !== undefined) this.sprite.setTint(this.baseTint);
    }
    const key = this.anim.sheet || `${this.prefix}_idle`;
    const id = `${key}#${this.anim.frame}`;
    if (id !== this.shown) {
      this.sprite.setTexture(key, this.anim.frame);
      this.shown = id;
    }
    this.sprite.setFlipX(this.face !== this.nativeDir);
    // flipping mirrors around the frame centre, so mirror the origin too to keep the feet on (x, y)
    this.sprite.setOrigin(this.face !== this.nativeDir ? 1 - this.ax / this.fw : this.ax / this.fw, this.ay / this.fh);
    this.sprite.setPosition(Math.round(this.x), Math.round(this.y - this.z));
    this.sprite.setDepth(10 + this.y / 100);
    this.shadow.setPosition(Math.round(this.x), Math.round(this.y)).setDepth(10 + this.y / 100 - 0.02).setScale(Math.max(0.35, 1 - Math.min(this.z, 160) / 280) * (this.radius / 18)).setAlpha(Math.max(0.15, 0.38 - this.z / 600));
    const t = this.trail;
    if (t) {
      t.left -= dtMs;
      t.next -= dtMs;
      if (t.next <= 0) {
        this.ghost(t.color, t.alpha, t.life, t.add);
        t.next = t.every;
      }
      if (t.left <= 0) this.trail = null;
    }
  }
}
