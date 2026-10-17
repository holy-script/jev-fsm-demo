import * as Phaser from "phaser";
import { DuelScene, type DuelHooks } from "./DuelScene";
import { HudScene } from "./HudScene";
import { MenuScene } from "./MenuScene";
import { SkillScene } from "./SkillScene";
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
    for (const [k, mu] of Object.entries(m.music)) this.load.audio("music_" + k, "/" + mu.file);
    const dev = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("dev"); // ?dev=1 skips the title (tests)
    this.registry.set("hooks", this.hooks);
    this.registry.set("dev", dev);
    this.load.once("complete", () => (dev ? this.scene.start("duel", this.hooks) : this.scene.start("menu", { mode: "title" })));
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
  game.scene.add("menu", MenuScene, false);
  game.scene.add("skills", SkillScene, false);
  if (process.env.NODE_ENV !== "production") (window as unknown as { __game?: Phaser.Game }).__game = game; // for scripted tests
  return () => game.destroy(true);
}
