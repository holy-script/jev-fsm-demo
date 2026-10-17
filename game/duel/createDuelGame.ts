import * as Phaser from "phaser";
import { DuelScene, type DuelHooks } from "./DuelScene";
import { HudScene } from "./HudScene";
import { VIEW_H, VIEW_W } from "./data";
import type { DuelManifest } from "./engine";

/** Loads duel-assets/manifest.json (written by tools/prep_duel_assets.py), then everything it names, then starts the duel. */
class BootScene extends Phaser.Scene {
  private hooks!: DuelHooks;
  constructor() {
    super("boot");
  }
  init(hooks: DuelHooks) {
    this.hooks = hooks;
  }
  preload() {
    this.load.json("manifest", "/duel-assets/manifest.json");
  }
  create() {
    if (!this.cache.json.exists("manifest")) return this.hooks.onMissingAssets();
    const m = this.cache.json.get("manifest") as DuelManifest;
    for (const [key, s] of Object.entries(m.sheets)) this.load.spritesheet(key, "/" + s.file, { frameWidth: s.frameW, frameHeight: s.frameH });
    this.load.image("duel_tiles", "/" + m.tiles.file);
    this.load.tilemapTiledJSON("duel_map", "/maps/duel_arena.json");
    for (const [k, f] of Object.entries(m.audio)) this.load.audio(k, "/" + f);
    for (const [k, f] of Object.entries(m.music)) this.load.audio("music_" + k, "/" + f);
    this.load.once("complete", () => this.scene.start("duel", this.hooks));
    this.load.start();
  }
}

export function createDuelGame(parent: HTMLElement, hooks: DuelHooks) {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: VIEW_W,
    height: VIEW_H,
    backgroundColor: "#0b0d12",
    pixelArt: true,
    roundPixels: true,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [],
  });
  game.scene.add("boot", BootScene, true, hooks);
  game.scene.add("duel", DuelScene, false);
  game.scene.add("duelhud", HudScene, false);
  return () => game.destroy(true);
}
