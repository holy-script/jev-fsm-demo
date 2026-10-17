import * as Phaser from "phaser";
import { DIFFICULTY, resetSave, save, saveSettings, settings } from "./settings";
import { VIEW_H, VIEW_W } from "./data";
import type { DuelHooks } from "./DuelScene";

interface Item {
  label: () => string;
  act: (dir: number) => void; // dir: -1 / 0 (select) / +1
  enabled?: () => boolean;
  hint?: () => string;
}

const cycle = <T,>(arr: readonly T[], cur: T, dir: number) => arr[(arr.indexOf(cur) + (dir || 1) + arr.length) % arr.length];

/** Title screen and pause menu (one scene, two modes). */
export class MenuScene extends Phaser.Scene {
  private mode: "title" | "pause" = "title";
  private screen: "main" | "settings" | "credits" | "stats" = "main";
  private items: Item[] = [];
  private texts: Phaser.GameObjects.Text[] = [];
  private hint!: Phaser.GameObjects.Text;
  private heading!: Phaser.GameObjects.Text;
  private sub!: Phaser.GameObjects.Text;
  private idx = 0;
  private embers: { x: number; y: number; v: number; s: number }[] = [];
  private g!: Phaser.GameObjects.Graphics;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;

  constructor() {
    super("menu");
  }
  init(data: { mode?: "title" | "pause" }) {
    this.mode = data.mode ?? "title";
    this.screen = "main";
    this.idx = 0;
    this.texts = [];
    this.embers = [];
  }

  create() {
    const font = { fontFamily: "monospace", color: "#efe6d2", stroke: "#000", strokeThickness: 5 };
    this.g = this.add.graphics();
    this.heading = this.add.text(VIEW_W / 2, 170, "", { ...font, fontSize: "76px", strokeThickness: 9 }).setOrigin(0.5);
    this.sub = this.add.text(VIEW_W / 2, 236, "", { ...font, fontSize: "20px", color: "#b9a98a" }).setOrigin(0.5);
    this.hint = this.add.text(VIEW_W / 2, VIEW_H - 60, "", { ...font, fontSize: "16px", color: "#9aa4b2", strokeThickness: 3 }).setOrigin(0.5);
    for (let i = 0; i < 60; i++) this.embers.push({ x: Math.random() * VIEW_W, y: Math.random() * VIEW_H, v: 12 + Math.random() * 30, s: 1 + Math.random() * 2 });
    this.keys = this.input.keyboard!.addKeys("UP,DOWN,LEFT,RIGHT,W,S,A,D,ENTER,SPACE,J,ESC") as Record<string, Phaser.Input.Keyboard.Key>;
    const k = this.keys;
    const move = (d: number) => {
      const n = this.items.length;
      do this.idx = (this.idx + d + n) % n; while (this.items[this.idx].enabled && !this.items[this.idx].enabled!());
      this.refresh();
    };
    k.UP.on("down", () => move(-1));
    k.W.on("down", () => move(-1));
    k.DOWN.on("down", () => move(1));
    k.S.on("down", () => move(1));
    for (const key of [k.ENTER, k.SPACE, k.J]) key.on("down", () => this.activate(0));
    for (const key of [k.LEFT, k.A]) key.on("down", () => this.activate(-1));
    for (const key of [k.RIGHT, k.D]) key.on("down", () => this.activate(1));
    k.ESC.on("down", () => this.back());
    this.build();
  }

  private activate(dir: number) {
    const it = this.items[this.idx];
    if (!it || (it.enabled && !it.enabled())) return;
    it.act(dir);
    this.refresh();
  }

  private back() {
    if (this.screen !== "main") {
      this.screen = "main";
      this.idx = 0;
      this.build();
    } else if (this.mode === "pause") this.resume();
  }

  private resume() {
    this.scene.stop();
    this.scene.resume("duel");
  }

  private startGame() {
    const hooks = this.registry.get("hooks") as DuelHooks;
    this.scene.stop();
    this.scene.start("duel", hooks);
  }

  private quitToTitle() {
    this.scene.stop("duelhud");
    this.scene.stop("duel");
    this.scene.start("menu", { mode: "title" });
  }

  private build() {
    this.texts.forEach((t) => t.destroy());
    this.texts = [];
    const title = this.mode === "title";
    if (this.screen === "main") {
      this.heading.setText(title ? "REAPER'S DANCE" : "PAUSED").setFontSize(title ? 76 : 52);
      this.sub.setText(title ? "a duel that learns" : "");
      this.items = title
        ? [
            { label: () => "Continue", enabled: () => save.cleared.length > 0 || save.tutorialDone, act: () => this.startGame(), hint: () => save.cleared.length ? `${save.cleared.length} foe(s) defeated` : "The tutorial is done: onward to the Hall." },
            { label: () => "New Game", act: () => { resetSave(); this.startGame(); } },
            { label: () => "Settings", act: () => { this.screen = "settings"; this.idx = 0; this.build(); } },
            { label: () => "Jev vs Rules", act: () => { this.screen = "stats"; this.idx = 0; this.build(); }, hint: () => "How the Jev brain compares with the plain rules bot, from your recent boss fights." },
            { label: () => "Credits", act: () => { this.screen = "credits"; this.idx = 0; this.build(); } },
          ]
        : [
            { label: () => "Resume", act: () => this.resume() },
            { label: () => "Skip tutorial", enabled: () => !!(this.scene.get("duel") as unknown as { isTutorial?: () => boolean }).isTutorial?.(), act: () => { (this.scene.get("duel") as unknown as { skipTutorial: () => void }).skipTutorial(); this.resume(); } },
            { label: () => "Skills (shrine)", act: () => { this.scene.setVisible(false); this.scene.launch("skills", { from: "menu" }); this.scene.pause(); } },
            { label: () => "Settings", act: () => { this.screen = "settings"; this.idx = 0; this.build(); } },
            { label: () => "Jev vs Rules", act: () => { this.screen = "stats"; this.idx = 0; this.build(); } },
            { label: () => "Quit to title", act: () => this.quitToTitle() },
          ];
      if (title && !(save.cleared.length || save.tutorialDone)) this.idx = 1;
    } else if (this.screen === "settings") {
      this.heading.setText("SETTINGS").setFontSize(52);
      this.sub.setText("");
      this.items = [
        {
          label: () => `Combat timing   < ${settings.beat === "beat" ? "Choreographed" : "Classic"} >`,
          act: (d) => { settings.beat = settings.beat === "beat" ? "classic" : "beat"; void d; },
          hint: () => settings.beat === "beat" ? "Attacks land on a steady beat grid, with deliberate off-beat delays as the tricks. Takes effect next fight." : "The original timing: shorter, uneven wind-ups. Takes effect next fight.",
        },
        {
          label: () => `Difficulty   < ${DIFFICULTY[settings.difficulty].label} >`,
          act: (d) => { settings.difficulty = cycle(["assist", "duelist", "shadow"] as const, settings.difficulty, d); },
          hint: () => DIFFICULTY[settings.difficulty].blurb,
        },
        { label: () => `Music   < ${settings.music ? "On" : "Off"} >`, act: () => { settings.music = !settings.music; } },
        {
          label: () => `Sound volume   < ${Math.round(settings.sfx * 100)}% >`,
          act: (d) => { settings.sfx = Phaser.Math.Clamp(Math.round((settings.sfx + (d || 1) * 0.1) * 10) / 10, 0, 1); if (settings.sfx === 0 && d > 0) settings.sfx = 0; },
        },
        { label: () => "Back", act: () => this.back() },
      ];
    } else if (this.screen === "stats") {
      this.heading.setText("JEV VS RULES").setFontSize(52);
      this.sub.setText("your recent boss fights, by which brain ran the boss");
      this.items = [{ label: () => "Back", act: () => this.back() }];
    } else {
      this.heading.setText("CREDITS").setFontSize(52);
      this.sub.setText("");
      this.items = [{ label: () => "Back", act: () => this.back() }];
    }
    this.items.forEach((it, i) => {
      const t = this.add.text(VIEW_W / 2, 340 + i * 52, "", { fontFamily: "monospace", fontSize: "26px", color: "#efe6d2", stroke: "#000", strokeThickness: 4 }).setOrigin(0.5).setInteractive({ useHandCursor: true });
      t.on("pointerover", () => { if (!it.enabled || it.enabled()) { this.idx = i; this.refresh(); } });
      t.on("pointerdown", () => { this.idx = i; this.activate(0); });
      this.texts.push(t);
    });
    if (this.screen === "credits") {
      this.texts.push(this.add.text(VIEW_W / 2, 330, CREDITS, { fontFamily: "monospace", fontSize: "15px", color: "#cfc7b4", align: "center", lineSpacing: 6, stroke: "#000", strokeThickness: 3 }).setOrigin(0.5, 0));
      this.items[0] && this.texts[0].setY(VIEW_H - 120);
    }
    if (this.screen === "stats") {
      this.texts.push(this.add.text(VIEW_W / 2, 230, statsText(), { fontFamily: "monospace", fontSize: "17px", color: "#cfc7b4", align: "center", lineSpacing: 8, stroke: "#000", strokeThickness: 3 }).setOrigin(0.5, 0));
      this.texts[0].setY(VIEW_H - 120);
    }
    this.refresh();
  }

  private refresh() {
    this.texts.slice(0, this.items.length).forEach((t, i) => {
      const it = this.items[i];
      const on = !it.enabled || it.enabled();
      t.setText(it.label()).setAlpha(on ? 1 : 0.35).setColor(i === this.idx ? "#ffd36b" : "#efe6d2").setScale(i === this.idx ? 1.08 : 1);
    });
    this.hint.setText(this.items[this.idx]?.hint?.() ?? (this.screen === "main" ? "↑↓ select   ENTER confirm   ESC back" : "←→ change   ESC back"));
    saveSettings();
  }

  update(_t: number, dt: number) {
    const g = this.g;
    g.clear();
    g.fillStyle(this.mode === "pause" ? 0x05070a : 0x07090d, this.mode === "pause" ? 0.82 : 1).fillRect(0, 0, VIEW_W, VIEW_H);
    if (this.mode === "title") g.fillGradientStyle(0x2a1208, 0x2a1208, 0x07090d, 0x07090d, 0.55).fillRect(0, 0, VIEW_W, VIEW_H);
    for (const e of this.embers) {
      e.y -= (e.v * dt) / 1000;
      e.x += Math.sin((e.y + e.x) / 40) * 0.2;
      if (e.y < -4) { e.y = VIEW_H + 4; e.x = Math.random() * VIEW_W; }
      g.fillStyle(0xff8a3b, 0.15 + 0.35 * (e.y / VIEW_H)).fillRect(e.x, e.y, e.s, e.s);
    }
  }
}

/** Per brain: fights, how often the player won, and how the player fared against its attacks. Lower "answered" = the brain is harder to read. */
function statsText() {
  const runs = save.runs ?? [];
  if (!runs.length) return "No boss fights recorded yet.\nFight a boss, then toggle the brain with F to compare.";
  const line = (brain: "JEV" | "RULES") => {
    const r = runs.filter((x) => x.brain === brain);
    if (!r.length) return `${brain.padEnd(6)}  no fights yet`;
    const sum = (k: "thrown" | "hit" | "deflected" | "dodged" | "secs") => r.reduce((a, x) => a + x[k], 0);
    const thrown = Math.max(1, sum("thrown")), wins = r.filter((x) => x.won).length, mins = Math.max(0.1, sum("secs") / 60);
    const pct = (n: number) => `${Math.round((n / thrown) * 100)}%`;
    return `${brain.padEnd(6)}  ${r.length} fights   you won ${wins}   hit you ${pct(sum("hit"))} of attacks   you deflected ${pct(sum("deflected"))}   dodged ${pct(sum("dodged"))}   ${Math.round(sum("hit") / mins * 10) / 10} hits/min`;
  };
  return [line("JEV"), line("RULES"), "", "More hits on you and fewer deflects means the brain reads you better."].join("\n");
}

const CREDITS = [
  "Hero, Shield Skeleton: Szadi art - Hero and Opponents",
  "Mecha-Stone Golem: Darkpixel",
  "Bringer of Death: Clembod",
  "Tiles and music: pixel-boy - Ninja Adventure (CC0)",
  "Sword sounds: StarNinjas, via OpenGameArt (CC0)",
  "Hit, impact and shard effects: v-ktor (CC BY 4.0)",
  "Smoke and heal effects: Pimen",
  "",
  "Boss brain: Jev, by TypeSafe",
  "Built with Phaser and Next.js",
].join("\n");
