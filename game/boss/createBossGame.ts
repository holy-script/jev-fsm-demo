import * as Phaser from "phaser";
import { BossScene, type BossHooks } from "./BossScene";
import { VIEW_H, VIEW_W, type Manifest } from "./engine";

/** Loads manifest.json (written by tools/prep_assets.py), then every sheet/tileset/map it names, then starts the fight. */
class BootScene extends Phaser.Scene {
  private hooks!: BossHooks;
  constructor() {
    super("boot");
  }
  init(hooks: BossHooks) {
    this.hooks = hooks;
  }
  preload() {
    this.load.json("manifest", "/game-assets/manifest.json");
  }
  create() {
    if (!this.cache.json.exists("manifest")) {
      this.hooks.onMissingAssets();
      return;
    }
    const m = this.cache.json.get("manifest") as Manifest;
    for (const [key, s] of Object.entries(m.sheets)) {
      if (s.frames) this.load.spritesheet(key, "/" + s.file, { frameWidth: s.frameW, frameHeight: s.frameH });
      else this.load.image(key, "/" + s.file);
    }
    this.load.image("arena_tiles", "/" + m.tiles.file);
    for (const n of [1, 2, 3]) this.load.tilemapTiledJSON(`arena_${n}`, `/maps/arena_${n}.json`);
    this.load.once("complete", () => this.scene.start("boss", this.hooks));
    this.load.start();
  }
}

export function createBossGame(parent: HTMLElement, hooks: BossHooks) {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: VIEW_W,
    height: VIEW_H,
    backgroundColor: "#10151c",
    pixelArt: true,
    roundPixels: true,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [],
  });
  game.scene.add("boot", BootScene, true, hooks);
  game.scene.add("boss", BossScene, false);
  return () => game.destroy(true);
}
