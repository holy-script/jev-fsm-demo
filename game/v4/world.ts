import * as Phaser from "phaser";
import { ENV_SCALE, type AreaDef, type Obstacle } from "./areas";
import { VIEW_H, VIEW_W } from "./data";

/** Builds one area from its AreaDef: ground fill, animated water, ground patches, depth-sorted props, ambient light, vignette, particles.
 *  Fighters sort against the props with the same depth rule (10 + y / 100), so they walk behind trees and statues. */
export class AreaView {
  readonly obstacles: Obstacle[];
  private objects: Phaser.GameObjects.GameObject[] = [];
  private waterA?: Phaser.GameObjects.TileSprite;
  private waterB?: Phaser.GameObjects.TileSprite;

  constructor(private scene: Phaser.Scene, readonly def: AreaDef) {
    this.obstacles = def.obstacles;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T) => (this.objects.push(o), o);
    const tint = def.ground.tint;
    const ground = add(scene.add.tileSprite(0, 0, VIEW_W, VIEW_H, def.ground.fill).setOrigin(0).setTileScale(ENV_SCALE).setDepth(0));
    if (tint !== undefined) ground.setTint(tint);
    if (def.water) {
      const w = def.water;
      this.waterA = add(scene.add.tileSprite(w.x, w.y, w.w, w.h, "fill_water").setOrigin(0).setTileScale(ENV_SCALE).setDepth(0.5));
      this.waterB = add(scene.add.tileSprite(w.x, w.y, w.w, w.h, "fill_water").setOrigin(0).setTileScale(ENV_SCALE * 1.5).setDepth(0.6).setAlpha(0.28).setBlendMode(Phaser.BlendModes.ADD));
    }
    let gi = 0;
    for (const s of def.stamps) {
      const img = add(scene.add.image(s.x, s.y, s.k).setOrigin(0.5, 1).setScale(ENV_SCALE * (s.s ?? 1)).setFlipX(!!s.flip).setAlpha(s.alpha ?? 1));
      img.setDepth(s.g ? 1 + 0.001 * gi++ : 10 + s.y / 100);
    }
    if (def.portal) {
      if (!scene.anims.exists("env_portal")) scene.anims.create({ key: "env_portal", frames: scene.anims.generateFrameNumbers("env_portal", { start: 0, end: 31 }), frameRate: 14, repeat: -1 });
      const p = add(scene.add.sprite(def.portal.x, def.portal.y, "env_portal", 0).setOrigin(0.5, 0.5).setScale(def.portal.scale).setDepth(10 + def.portal.y / 100 + 0.5).setBlendMode(Phaser.BlendModes.ADD));
      p.play("env_portal");
    }
    add(scene.add.rectangle(0, 0, VIEW_W, VIEW_H, def.ambient.color, def.ambient.alpha).setOrigin(0).setDepth(1900).setBlendMode(Phaser.BlendModes.MULTIPLY));
    this.vignette(def.vignette);
    this.emit(def.particles);
  }

  private vignette(strength: number) {
    if (!this.scene.textures.exists("vignette")) {
      const t = this.scene.textures.createCanvas("vignette", VIEW_W, VIEW_H)!;
      const c = t.getContext();
      const g = c.createRadialGradient(VIEW_W / 2, VIEW_H / 2, VIEW_H * 0.35, VIEW_W / 2, VIEW_H / 2, VIEW_W * 0.62);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,1)");
      c.fillStyle = g;
      c.fillRect(0, 0, VIEW_W, VIEW_H);
      t.refresh();
    }
    this.objects.push(this.scene.add.image(0, 0, "vignette").setOrigin(0).setDepth(1950).setAlpha(strength));
  }

  private emit(kind: AreaDef["particles"]) {
    const sc = this.scene;
    if (!sc.textures.exists("p_dot")) {
      const g = sc.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0xffffff, 1).fillRect(0, 0, 4, 4);
      g.generateTexture("p_dot", 4, 4);
      g.destroy();
    }
    const common = { x: { min: 0, max: VIEW_W } };
    let em: Phaser.GameObjects.Particles.ParticleEmitter;
    if (kind === "leaves") {
      em = sc.add.particles(0, 0, "p_dot", { ...common, y: -10, lifespan: 9000, speedY: { min: 40, max: 90 }, speedX: { min: -30, max: 20 }, rotate: { min: 0, max: 360 }, scale: { min: 1.2, max: 2.4 }, tint: [0xd9732a, 0xe0a33a, 0xc2552b, 0x8a9a3a], frequency: 520, alpha: { start: 0.9, end: 0.5 } });
    } else if (kind === "mist") {
      em = sc.add.particles(0, 0, "p_dot", { ...common, y: { min: 180, max: 520 }, lifespan: 7000, speedX: { min: 8, max: 26 }, speedY: { min: -4, max: 4 }, scale: { min: 8, max: 18 }, tint: 0xc8d8ff, frequency: 700, alpha: { start: 0, end: 0.07, ease: "Sine.easeInOut" }, blendMode: Phaser.BlendModes.ADD });
    } else {
      em = sc.add.particles(0, 0, "p_dot", { ...common, y: { min: 280, max: 540 }, lifespan: 5200, speedY: { min: -34, max: -14 }, speedX: { min: -8, max: 8 }, scale: { min: 0.8, max: 2 }, tint: [0xb9a8ff, 0xffffff, 0xff9bf0], frequency: 170, alpha: { start: 0.9, end: 0 }, blendMode: Phaser.BlendModes.ADD });
    }
    em.setDepth(1800);
    this.objects.push(em);
  }

  update(dtMs: number) {
    if (this.waterA) {
      this.waterA.tilePositionX += dtMs * 0.006;
      this.waterA.tilePositionY += dtMs * 0.002;
    }
    if (this.waterB) {
      this.waterB.tilePositionX -= dtMs * 0.01;
      this.waterB.tilePositionY += dtMs * 0.004;
    }
  }

  destroy() {
    for (const o of this.objects) o.destroy();
    this.objects = [];
  }
}
