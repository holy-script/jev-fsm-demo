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
  /** a fight ended (after a short pause); the shell shows the victory / defeat / ending screen */
  onFight?: (r: FightResult) => void;
  onBrain?: (mode: "jev" | "rules") => void;
}

export interface FightResult {
  record: import("./stats").FightRecord;
  won: boolean;
  boss: string;
  bossName: string;
  outro: string;
  /** the run is over (the last boss fell) */
  final: boolean;
  deaths: number;
  playMs: number;
}

/** What the React shell can ask of the running game. */
export interface ArenaApi {
  start: (slot: number, fresh: boolean) => void;
  next: () => void;
  retry: () => void;
  pause: () => void;
  resume: () => void;
  toTitle: () => void;
  settingsChanged: () => void;
  toggleBrain: () => void;
  clearMemory: () => void;
  choosePerk: (id: string) => void;
  setDemo: (on: boolean) => void;
  perks: () => string[];
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
    for (const [k, f] of Object.entries(m.audio ?? {})) this.load.audio(k, "/" + f);
    for (const [k, mu] of Object.entries(m.music ?? {})) this.load.audio("music_" + k, "/" + mu.file);
    this.registry.set("manifest", m);
    this.registry.set("hooks", this.hooks);
    this.load.once("complete", () => this.scene.start("arena"));
    this.load.start();
  }
}

export function createArenaGame(parent: HTMLElement, hooks: ArenaHooks): { destroy: () => void; api: ArenaApi } {
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
  const scene = () => game.scene.getScene("arena") as ArenaScene;
  const api: ArenaApi = {
    start: (slot, fresh) => scene().startRun(slot, fresh),
    next: () => scene().continueRun(),
    retry: () => scene().retry(),
    pause: () => {
      game.scene.pause("arena");
      game.sound.pauseAll();
    },
    resume: () => {
      game.scene.resume("arena");
      game.sound.resumeAll();
    },
    toTitle: () => {
      game.scene.resume("arena");
      game.sound.resumeAll();
      scene().toTitle();
    },
    settingsChanged: () => game.events.emit("arena:settings"),
    toggleBrain: () => scene().toggleBrain(),
    choosePerk: (id) => scene().choosePerk(id),
    setDemo: (on) => { scene().demo = on; },
    perks: () => scene().run?.perks ?? [],
    clearMemory: () => {
      try {
        localStorage.removeItem("arena.memory");
        localStorage.removeItem("arena.stats");
      } catch {
        /* ignore */
      }
      scene().memory = {};
    },
  };
  return { destroy: () => game.destroy(true), api };
}
