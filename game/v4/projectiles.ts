import * as Phaser from "phaser";
import { EMISSIVE_DEPTH, PROJ_LOOKS, SCALE } from "./data";
import type { Vfx } from "./vfx";

/** A thing in flight: Ember Bolt, a boss's energy orb, a thrown dagger. Movement, drawing and clean-up live here; the scene decides who it hits. */
export interface Projectile {
  id: string;
  owner: "player" | "enemy";
  look: string;
  x: number;
  y: number;
  /** height of the projectile's centre above the floor: a jump (player z about 45+) clears an enemy projectile at z 25 */
  z: number;
  vx: number;
  vy: number;
  radius: number;
  life: number;
  dmg: number;
  posture: number;
  kind: "normal" | "heavy";
  reflected: boolean;
  /** after being dodged it keeps flying but must not hit the player again for a moment */
  ignorePlayerUntil: number;
  sprite: Phaser.GameObjects.Sprite;
  trailT: number;
}
export type ProjectileSpec = Pick<Projectile, "id" | "owner" | "look" | "x" | "y" | "vx" | "vy" | "dmg" | "posture"> & Partial<Pick<Projectile, "z" | "radius" | "life" | "kind">>;

export class ProjectileSystem {
  list: Projectile[] = [];
  spawned = 0;
  constructor(private scene: Phaser.Scene, private vfx: Vfx) {}

  spawn(o: ProjectileSpec): Projectile {
    const look = PROJ_LOOKS[o.look];
    const anim = `proj:${o.look}`;
    if (!this.scene.anims.exists(anim)) this.scene.anims.create({ key: anim, frames: this.scene.anims.generateFrameNumbers(look.sheet, { start: look.loop[0], end: look.loop[1] }), frameRate: look.fps, repeat: -1 });
    const sprite = this.scene.add.sprite(o.x, o.y - (o.z ?? 25), look.sheet, look.loop[0]).setScale(look.scale * SCALE);
    if (look.additive) sprite.setBlendMode(Phaser.BlendModes.ADD);
    sprite.play(anim);
    const angle = Math.atan2(o.vy, o.vx);
    if (look.rotate !== false) sprite.setRotation(Math.abs(angle) > Math.PI / 2 ? angle - Math.PI : angle).setFlipX(Math.abs(angle) > Math.PI / 2);
    const pr: Projectile = {
      id: o.id, owner: o.owner, look: o.look, x: o.x, y: o.y, z: o.z ?? 25, vx: o.vx, vy: o.vy, radius: o.radius ?? 16, life: o.life ?? 1800, dmg: o.dmg, posture: o.posture,
      kind: o.kind ?? "normal", reflected: false, ignorePlayerUntil: 0, sprite, trailT: 0,
    };
    this.list.push(pr);
    this.spawned++;
    return pr;
  }

  /** Move everything; returns the ones that left the arena or ran out of time (already destroyed). */
  update(dtMs: number, bounds: { l: number; r: number; t: number; b: number }) {
    for (const pr of [...this.list]) {
      pr.x += (pr.vx * dtMs) / 1000;
      pr.y += (pr.vy * dtMs) / 1000;
      pr.life -= dtMs;
      pr.sprite.setPosition(Math.round(pr.x), Math.round(pr.y - pr.z)).setDepth(EMISSIVE_DEPTH + pr.y / 10000);
      pr.trailT -= dtMs;
      if (pr.trailT <= 0) {
        pr.trailT = 55;
        const look = PROJ_LOOKS[pr.look];
        const g = this.scene.add.image(pr.sprite.x, pr.sprite.y, pr.sprite.texture.key, pr.sprite.frame.name).setOrigin(pr.sprite.originX, pr.sprite.originY).setScale(pr.sprite.scaleX * 0.9, pr.sprite.scaleY * 0.9)
          .setRotation(pr.sprite.rotation).setFlipX(pr.sprite.flipX).setDepth(pr.sprite.depth - 0.0001).setTintFill(look.trail).setAlpha(0.4);
        if (look.additive) g.setBlendMode(Phaser.BlendModes.ADD);
        this.scene.tweens.add({ targets: g, alpha: 0, duration: 200, onComplete: () => g.destroy() });
      }
      if (pr.life <= 0 || pr.x < bounds.l - 120 || pr.x > bounds.r + 120 || pr.y < bounds.t - 140 || pr.y > bounds.b + 140) this.destroy(pr, false);
    }
  }

  /** Remove a projectile, with its impact effect if it hit something. */
  destroy(pr: Projectile, impact: boolean) {
    const i = this.list.indexOf(pr);
    if (i < 0) return;
    this.list.splice(i, 1);
    if (impact) {
      const look = PROJ_LOOKS[pr.look];
      this.vfx.play(look.impactSheet ?? look.sheet, pr.x, pr.y - pr.z, { range: look.impact, scale: look.scale, add: !!look.additive, fps: 24, depth: EMISSIVE_DEPTH });
    }
    pr.sprite.destroy();
  }

  /** Destroy every enemy projectile within a circle (the Inferno Ring). Returns how many. */
  clearEnemy(x: number, y: number, r: number): number {
    let n = 0;
    for (const pr of [...this.list]) if (pr.owner === "enemy" && Math.hypot(pr.x - x, (pr.y - y) * 1.6) <= r) { this.destroy(pr, true); n++; }
    return n;
  }

  clear() {
    for (const pr of [...this.list]) this.destroy(pr, false);
  }
}
