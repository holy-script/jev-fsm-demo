import * as Phaser from "phaser";
import { ArenaScene } from "./ArenaScene";
import { VIEW_H, VIEW_W } from "./data";
import type { ArenaManifest } from "./manifest";

export interface ArenaHooks {
  onMissingAssets: () => void;
  /** every boss decision (idle or gate), for the Jev panel */
  onDecision?: (d: import("./brain").Decision) => void;
  onBoss?: (name: string) => void;
  onLog?: (line: string) => void;
  /** the pad's Start button (or any in-game pause request) */
  onPause?: () => void;
}

/** Loads arena-assets/manifest.json (written by tools/prep_arena_assets.py), then every sheet it names, then starts the arena. */
class BootScene extends Phaser.Scene {
  private hooks!: ArenaHooks;
  constructor() {
    super("boot");
  }
  init(hooks: ArenaHooks) {
    this.hooks = hooks;
  }
  preload() {
    this.load.json("manifest", "/arena-assets/manifest.json");
  }
  create() {
    if (!this.cache.json.exists("manifest")) return this.hooks.onMissingAssets();
    const m = this.cache.json.get("manifest") as ArenaManifest;
    for (const [key, s] of Object.entries(m.sheets)) this.load.spritesheet(key, "/" + s.file, { frameWidth: s.frameW, frameHeight: s.frameH });
    for (const [key, s] of Object.entries(m.vfx)) this.load.spritesheet(key, "/" + s.file, { frameWidth: s.frameW, frameHeight: s.frameH });
    for (const [key, e] of Object.entries(m.env)) this.load.image(key, "/" + e.file);
    this.registry.set("manifest", m);
    this.registry.set("hooks", this.hooks);
    this.load.once("complete", () => this.scene.start("arena"));
    this.load.start();
  }
}

export function createArenaGame(parent: HTMLElement, hooks: ArenaHooks) {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: VIEW_W,
    height: VIEW_H,
    backgroundColor: "#0b0d12",
    pixelArt: true,
    input: { gamepad: true },
    roundPixels: true,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: [],
  });
  game.scene.add("boot", BootScene, true, hooks);
  game.scene.add("arena", ArenaScene, false);
  if (process.env.NODE_ENV !== "production") (window as unknown as { __game?: Phaser.Game }).__game = game;
  return () => game.destroy(true);
}
