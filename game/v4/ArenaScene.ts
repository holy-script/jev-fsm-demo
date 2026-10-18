import * as Phaser from "phaser";
import { chip, inReach, pressGuard, resolveEnemyHit, type Defender, type Outcome } from "./combat";
import {
  AIR_ATTACK, BOLT, EMISSIVE_DEPTH, NOVA, JUMP_COUNTER, CLASH, COUNTER, DEATHBLOW, ENEMY, GATE_WAIT, FX, FX_EXTRA, HERO, HERO_ATTACKS, HERO_CLIPS, SCALE, SKILLS, VIEW_H, VIEW_W,
  type EnemyAttack, type HitDef, type PlayerAttack,
} from "./data";
import { AREAS } from "./areas";
import { AreaView } from "./world";
import { BOSSES, DEFAULT_SPACING, ENCOUNTERS, GENERIC_ACTIONS, type BossDef, type Spacing } from "./bosses";
import { BossBrain, Telemetry, type Decision, type Snapshot } from "./brain";
import { Fighter } from "./fighter";
import { ProjectileSystem, type Projectile } from "./projectiles";
import { Sfx } from "./sfx";
import { addRecord, loadStats, saveStats, type BrainTag, type FightRecord } from "./stats";
import { deleteSave, loadSave, newRun, writeSave, type RunSave } from "./save";
import { GameInput, blankFrame, type InputFrame } from "./input";
import { loadMemory, memoryFor, profile, remember, saveMemory, type MemoryStore } from "./memory";
import { MashRun, QteRun, type DeathblowGrade } from "./qte";
import { loadSettings, type ArenaSettings } from "./settings";
import type { ArenaHooks } from "./createArenaGame";
import type { ArenaManifest } from "./manifest";
import { Vfx } from "./vfx";

/** Phase 1 test arena: Fire Knight against a Metal Bladekeeper training enemy on a flat floor. The point is the kernel (combat model,
 *  combo chain, reverse perfect parry, animator), not the content; phases 3 to 5 replace the enemy, map and HUD. Controls:
 *  WASD/arrows move, J or click attack (press again inside the chain window), Space/K guard (tap just before a hit = perfect parry),
 *  Shift/L roll. Dev: P toggles the enemy AI, O/I force its attacks, R resets. */

type PMode = "free" | "attack" | "guard" | "roll" | "hurt" | "dead" | "qte" | "air" | "dash" | "land" | "cast";
type EMode = "idle" | "attack" | "recoil" | "flinch" | "broken" | "dead";
export interface ArenaLogEntry {
  t: number;
  type: string;
  [k: string]: unknown;
}
/** QTE prompt ids map to the three combat actions, so prompts show whatever keys the player has bound. */
const QTE_ACTION: Record<string, "attack" | "guard" | "roll"> = { J: "attack", K: "guard", L: "roll" };
const FLOOR = { l: 80, r: 880, t: 270, b: 500 };

export class ArenaScene extends Phaser.Scene {
  now = 0;
  hitstop = 0;
  /** multiplies simulation time (slow-motion during QTEs); the QTE logic itself runs on real time */
  timeScale = 1;
  rawDt = 0;
  settings!: ArenaSettings;
  qte: QteRun | null = null;
  mash: MashRun | null = null;
  qteKind: "deathblow" | "clash" | null = null;
  /** tests set this to force the deathblow prompt keys */
  qteKeys: string[] | null = null;
  private pendingClash: { a: EnemyAttack; h: HitDef; i: number } | null = null;
  log: ArenaLogEntry[] = [];
  player!: Fighter;
  enemy!: Fighter;
  vfx!: Vfx;
  projs!: ProjectileSystem;
  private lastEnemyOutcome: Outcome | null = null;
  private slots: { action: "skill" | "bolt" | "nova"; base: number; icon: Phaser.GameObjects.Image; key: Phaser.GameObjects.Text; cost: Phaser.GameObjects.Text }[] = [];
  dev = false;

  p = {
    hp: HERO.hp, posture: 0, mode: "free" as PMode, chain: 0, atk: null as PlayerAttack | null, hitDone: [] as boolean[],
    queued: false, earlyAt: -1e9, recovering: false, dash: 0, invulnUntil: 0, rollStart: 0, rollCdUntil: 0, rollDir: { x: 1, y: 0 },
    hurtUntil: 0, lastHitAt: -1e9, riposteUntil: 0, spirit: 0, counterAt: -1e9,
    vz: 0, airAtk: false, dashStart: 0, dashDone: 0, dashDir: { x: 1, y: 0 }, dashCdUntil: 0, jumpCdUntil: 0, landUntil: 0,
    boltCdUntil: 0, novaCdUntil: 0, castKind: null as null | "bolt" | "nova", castReleaseAt: 0, castUntil: 0, castDone: false,
    def: { guarding: false, guardPressedAt: -1e9, noDeflect: false, invulnerable: false, rolling: false } as Defender,
  };
  e = {
    hp: 160, posture: 0, mode: "idle" as EMode, auto: true, atk: null as EnemyAttack | null, hitDone: [] as boolean[], thinkAt: 0,
    cd: {} as Record<string, number>, stance: "engage" as "engage" | "disengage", stanceUntil: 0, stanceAt: 0, stanceAttacks: 0, stanceCap: 3, circleDir: 1, circleUntil: 0, rushUntil: 0, leapAt: -1e9, action: null as { id: string; until: number } | null, lastActions: [] as string[], gate: null as { a: EnemyAttack; startedAt: number; decision: string | null; token: number } | null, resumeAt: 0, feinting: false, phase2: false, recoilUntil: 0, brokenUntil: 0, poiseUntil: 0, lastHitAt: -1e9, dash: 0, reverseFrames: 0, reversedAttack: "", strikeAt: 0,
  };

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  area?: AreaView;
  private hud!: Phaser.GameObjects.Graphics;
  private hudObjects: Phaser.GameObjects.GameObject[] = [];
  private pips: Phaser.GameObjects.Image[] = [];
  private trail = { p: 1, e: 1 };
  private texts: Record<string, Phaser.GameObjects.Text> = {};
  sfx!: Sfx;
  /** menu: title backdrop (no input, AI idle, HUD hidden); play: the fight */
  mode: "menu" | "play" = "play";
  run: RunSave | null = null;
  /** guided demo: combat assist is forced on (not saved) */
  demo = false;
  get assist() {
    return this.settings.assist || this.demo;
  }
  private fight = { brain: "jev" as BrainTag, mixed: false, hp0: 100 };
  inp!: GameInput;
  frame!: InputFrame;
  /** test hook: a scripted player (tests/arena/bot.mjs) supplies the frame's input instead of the keyboard */
  botFrame: (() => Partial<InputFrame>) | null = null;
  private manifest!: ArenaManifest;
  boss!: BossDef;
  brain!: BossBrain;
  telemetry = new Telemetry();
  memory: MemoryStore = {};
  hooks?: ArenaHooks;
  private gateToken = 0;
  private standingStill = 0;
  private distHist: { t: number; d: number }[] = [];
  private lastTaunt = -1e9;
  private remembered = false;

  constructor() {
    super("arena");
  }

  create() {
    this.manifest = this.registry.get("manifest") as ArenaManifest;
    this.dev = new URLSearchParams(window.location.search).has("dev");
    this.mode = this.dev ? "play" : "menu";
    this.settings = loadSettings();
    this.cameras.main.setBackgroundColor("#101a14");
    this.vfx = new Vfx(this, this.manifest.vfx);
    this.projs = new ProjectileSystem(this, this.vfx);
    this.hooks = this.registry.get("hooks") as ArenaHooks | undefined;
    this.memory = loadMemory();
    this.brain = new BossBrain({ onDecision: (d) => this.onDecision(d) });
    this.player = new Fighter(this, "fk", this.manifest.sheets, HERO.radius);
    this.boss = BOSSES[new URLSearchParams(window.location.search).get("boss") ?? "mb"] ?? BOSSES.mb;
    this.sfx = new Sfx(this, this.manifest, () => this.settings);
    this.buildArea();
    this.enemy = this.makeEnemy();
    this.hud = this.add.graphics().setDepth(2000);
    this.buildHudPlates();
    this.inp = new GameInput(this, this.settings.keymap);
    this.frame = this.inp.poll();
    const K = Phaser.Input.Keyboard.KeyCodes;
    const kb = this.input.keyboard!;
    this.keys = Object.fromEntries(Object.entries({ P: K.F1, O: K.F2, I: K.F3, R: K.F4, F: K.F, N: K.F6 }).map(([n, c]) => [n, kb.addKey(c)]));
    const t = (k: string, x: number, y: number, size = 14, color = "#e6edf3", origin = 0) => (this.texts[k] = this.add.text(x, y, "", { fontFamily: "monospace", fontSize: size + "px", color }).setDepth(2100).setOrigin(origin, 0));
    t("enemyName", VIEW_W / 2, 31, 15, "#2f2012", 0.5);
    this.texts.enemyName.setOrigin(0.5, 0.5).setFontStyle("bold");
    t("enemyTitle", VIEW_W / 2, 110, 12, "#e8dcc0", 0.5);
    this.texts.enemyTitle.setStroke("#000", 3).setFontStyle("italic");
    t("combo", 330, VIEW_H - 124, 26, "#ffd166");
    this.texts.combo.setStroke("#000", 4).setFontStyle("bold");
    t("help", 12, VIEW_H - 22, 11, "#8b949e");
    t("debug", 12, 8, 11, "#58a6ff");
    t("qtekey", VIEW_W / 2, 150, 34, "#ffffff", 0.5);
    t("qtemsg", VIEW_W / 2, 110, 16, "#ffd166", 0.5);
    this.texts.help.setText("WASD move   J/click attack (press again in the chain window)   Space guard (tap just before a hit = PARRY)   Shift roll   I jump   U dash   E flame burst" + (this.dev ? "   F1 ai  F2/F3 enemy attacks  F4 reset  F6 next boss" : ""));
    this.game.events.on("arena:settings", () => this.applySettings());
    this.brain.mode = this.settings.brain;
    this.reset();
    if (this.mode === "menu") {
      this.e.auto = false;
      this.setHudVisible(false);
    }
    this.hooks?.onBoss?.(this.boss.name);
    if (process.env.NODE_ENV !== "production") (window as unknown as { __arena?: ArenaScene; __bosses?: typeof BOSSES }).__arena = this;
    if (process.env.NODE_ENV !== "production") (window as unknown as { __bosses?: typeof BOSSES; __areas?: typeof AREAS }).__bosses = BOSSES;
    if (process.env.NODE_ENV !== "production") (window as unknown as { __areas?: typeof AREAS; __consts?: unknown }).__areas = AREAS;
    if (process.env.NODE_ENV !== "production") (window as unknown as { __consts?: unknown }).__consts = { HERO, DEATHBLOW, CLASH, COUNTER, ENEMY };
  }

  reset() {
    this.now = 0;
    this.hitstop = 0;
    this.log = [];
    Object.assign(this.p, { hp: HERO.hp, posture: 0, mode: "free", chain: 0, atk: null, hitDone: [], queued: false, earlyAt: -1e9, recovering: false, dash: 0, invulnUntil: 0, rollCdUntil: 0, hurtUntil: 0, lastHitAt: -1e9, riposteUntil: 0, spirit: 0, counterAt: -1e9 });
    this.timeScale = 1;
    this.qte = null;
    this.mash = null;
    this.qteKind = null;
    this.pendingClash = null;
    this.player.anim.speed = 1;
    this.enemy.anim.speed = 1;
    Object.assign(this.p.def, { guarding: false, guardPressedAt: -1e9, noDeflect: false, invulnerable: false, rolling: false });
    Object.assign(this.p, { vz: 0, airAtk: false, dashDone: 0, dashCdUntil: 0, jumpCdUntil: 0, landUntil: 0, boltCdUntil: 0, novaCdUntil: 0, castKind: null, castDone: false });
    this.projs.clear();
    this.player.z = 0;
    this.player.stopTrail();
    Object.assign(this.e, { hp: this.boss.hp, posture: 0, mode: "idle", stance: "engage", stanceUntil: 0, stanceAt: 0, stanceAttacks: 0, circleUntil: 0, rushUntil: 0, leapAt: -1e9, atk: null, hitDone: [], thinkAt: 1200, cd: {}, recoilUntil: 0, brokenUntil: 0, poiseUntil: 0, lastHitAt: -1e9, dash: 0, reverseFrames: 0, reversedAttack: "", strikeAt: 0, action: null, lastActions: [], gate: null, resumeAt: 0, feinting: false, phase2: false });
    this.telemetry.reset();
    this.brain.reset();
    this.brain.mode = this.settings.brain; // every new fight starts on the brain chosen in Settings (F still swaps it mid-fight)
    this.fight = { brain: this.brain.mode, mixed: false, hp0: HERO.hp };
    if (this.perk("ember")) this.p.spirit = 2;
    this.gateToken++;
    this.standingStill = 0;
    this.remembered = false;
    this.player.x = 330;
    this.player.y = 400;
    this.player.face = 1;
    this.enemy.x = 620;
    this.enemy.y = 400;
    this.enemy.face = -1;
    this.player.sprite.clearTint();
    this.enemy.sprite.clearTint();
    this.player.play({ ...HERO_CLIPS.idle }, { loop: true });
    this.enemy.play({ ...this.boss.clips.idle }, { loop: true });
  }

  note(type: string, extra: Record<string, unknown> = {}) {
    this.log.push({ t: Math.round(this.now), type, ...extra });
    if (this.log.length > 400) this.log.shift();
  }

  // ---------------------------------------------------------------- frame loop
  update(_: number, deltaMs: number) {
    const raw = Math.min(deltaMs, 50);
    this.rawDt = raw;
    let dt = raw * this.timeScale;
    if (this.hitstop > 0) {
      this.hitstop -= raw;
      dt = 0;
    }
    this.now += dt;
    this.frame = this.inp.poll();
    if (this.botFrame) this.frame = { ...blankFrame(), ...this.botFrame() };
    if (this.mode === "menu") this.frame = blankFrame();
    else if (this.run && this.e.mode !== "dead" && this.p.mode !== "dead") this.run.playMs += raw;
    if (this.frame.pause) this.hooks?.onPause?.();
    if (Phaser.Input.Keyboard.JustDown(this.keys.R)) this.reset();
    if (Phaser.Input.Keyboard.JustDown(this.keys.P)) this.e.auto = !this.e.auto;
    if (Phaser.Input.Keyboard.JustDown(this.keys.F) && this.mode === "play") this.toggleBrain();
    if (Phaser.Input.Keyboard.JustDown(this.keys.N) && this.e.mode === "dead") this.nextBoss();
    if (Phaser.Input.Keyboard.JustDown(this.keys.O)) this.forceEnemyAttack("SLASH");
    if (Phaser.Input.Keyboard.JustDown(this.keys.I)) this.forceEnemyAttack("TWIN");
    this.updatePlayer(dt);
    this.updateEnemy(dt);
    this.updateProjectiles(dt);
    this.separate();
    this.player.tick(dt);
    this.enemy.tick(dt);
    this.area?.update(raw);
    this.updateQte(raw);
    if (!this.distHist.length || this.now - this.distHist[this.distHist.length - 1].t >= 100) {
      this.distHist.push({ t: this.now, d: Math.abs(this.enemy.x - this.player.x) });
      while (this.distHist.length && this.now - this.distHist[0].t > 1200) this.distHist.shift();
    }
    this.drawHud();
  }

  private dirInput() {
    return this.frame.dir;
  }

  private step(f: Fighter, dx: number, dy: number) {
    f.x = Phaser.Math.Clamp(f.x + dx, FLOOR.l, FLOOR.r);
    f.y = Phaser.Math.Clamp(f.y + dy, FLOOR.t, FLOOR.b);
    for (const o of this.area?.obstacles ?? []) {
      // obstacles are ellipses on the floor plane (depth counts for about half of width)
      const ox = f.x - o.x, oy = (f.y - o.y) / 0.55, d = Math.hypot(ox, oy), min = o.r + f.radius * 0.6;
      if (d < min) {
        const n = d > 0.01 ? [ox / d, oy / d] : [1, 0];
        f.x = Phaser.Math.Clamp(o.x + n[0] * min, FLOOR.l, FLOOR.r);
        f.y = Phaser.Math.Clamp(o.y + n[1] * min * 0.55, FLOOR.t, FLOOR.b);
      }
    }
  }

  /** Burn a pending dash (lunge / knockback) at a fixed speed. dash is signed px along x. */
  private burn(f: Fighter, o: { dash: number }, dt: number) {
    if (!o.dash) return;
    const s = Math.min(Math.abs(o.dash), (700 * dt) / 1000) * Math.sign(o.dash);
    this.step(f, s, 0);
    o.dash -= s;
    if (Math.abs(o.dash) < 0.5) o.dash = 0;
  }

  /** Keep the two bodies from overlapping (depth counts for less than width). */
  private separate() {
    if (this.player.z > 30 || this.enemy.z > 30) return; // a jumping fighter passes over the other
    const dx = this.enemy.x - this.player.x;
    const dy = (this.enemy.y - this.player.y) * 2.2;
    const d = Math.hypot(dx, dy);
    const min = HERO.radius + this.boss.radius;
    if (d < min && d > 0.01) {
      const push = (min - d) / 2;
      const ux = dx / d, uy = dy / d / 2.2;
      this.step(this.player, -ux * push, -uy * push);
      this.step(this.enemy, ux * push, uy * push);
    }
  }

  // ---------------------------------------------------------------- player
  private updatePlayer(dt: number) {
    const p = this.p, f = this.player;
    const press = { attack: this.frame.attack, guard: this.frame.guard, roll: this.frame.roll, skill: this.frame.skill, jump: this.frame.jump, dash: this.frame.dash, bolt: this.frame.bolt, nova: this.frame.nova };
    if (press.attack) p.counterAt = this.now; // a perilous strike landing within COUNTER ms of this is countered
    if (press.attack) {
      this.telemetry.react("attack", this.now);
      this.telemetry.record("attack", this.now);
      const em = this.e.mode;
      if (em === "attack" && this.e.atk && this.enemy.anim.frame < this.e.atk.hits[0].a) this.telemetry.swings.greedy++;
      else if (em === "idle" || em === "recoil" || em === "flinch" || em === "broken") this.telemetry.swings.punish++;
    }
    if (press.guard) {
      this.telemetry.react("guard", this.now);
      this.telemetry.record("guard", this.now);
    }
    if (press.roll) {
      this.telemetry.react("roll", this.now);
      this.telemetry.record("roll", this.now);
    }
    const guardHeld = this.frame.guardHeld;
    const rollT = this.now - p.rollStart;
    p.def.invulnerable = this.now < p.invulnUntil;
    p.def.rolling = (p.mode === "roll" && rollT >= HERO.rollIFrames[0] && rollT <= HERO.rollIFrames[1]) || (p.mode === "dash" && this.now - p.dashStart <= HERO.dashIFramesMs);
    if (this.e.mode !== "dead" && p.mode !== "dead") f.face = this.enemy.x >= f.x ? 1 : -1;
    if (this.now - p.lastHitAt > HERO.postureRegenDelayMs && p.mode !== "hurt") p.posture = Math.max(0, p.posture - (HERO.postureRegen * (this.perk("breath") ? 1.5 : 1) * (p.def.guarding ? 0.5 : 1) * dt) / 1000);
    this.burn(f, p, dt);
    if (p.mode === "dead") return;
    if (p.mode === "qte") return this.qteInput(press);
    const dir = this.dirInput();

    switch (p.mode) {
      case "free": {
        this.standingStill = this.dirInput().any ? 0 : this.standingStill + dt;
        if (press.roll && this.now >= p.rollCdUntil) return this.startRoll(dir);
        if (press.jump && this.now >= p.jumpCdUntil) return this.startJump();
        if (press.dash && this.now >= p.dashCdUntil) return this.startDash(dir);
        if (press.guard) return this.startGuard();
        if (press.skill) return this.startSkill("FLAME");
        if (press.bolt) return this.startBolt();
        if (press.nova) return this.startNova();
        if (press.attack) return this.canDeathblow() ? this.startDeathblow() : this.startAttack("L1");
        if (dir.any) {
          this.step(f, (dir.x * HERO.speed * dt) / 1000, (dir.y * HERO.speed * dt) / 1000);
          f.ensure(HERO_CLIPS.run);
        } else f.ensure(HERO_CLIPS.idle);
        break;
      }
      case "attack": {
        const a = p.atk!;
        const frame = f.anim.frame;
        const lastHit = a.hits[a.hits.length - 1].b;
        if (press.attack) {
          if (!p.recovering && frame < a.chainFrom) p.earlyAt = this.now;
          else p.queued = true;
        }
        if (!p.recovering && !p.queued && this.now - p.earlyAt <= 150 && frame >= a.chainFrom) p.queued = true;
        if (!p.recovering) this.playerHits(a, frame);
        // cancel into defence once the damaging frames are over
        if (frame > lastHit || p.recovering) {
          if (press.roll && this.now >= p.rollCdUntil) return this.startRoll(dir);
          if (press.dash && this.now >= p.dashCdUntil) return this.startDash(dir);
          if (press.jump && this.now >= p.jumpCdUntil) return this.startJump();
          if (press.guard) return this.startGuard();
        }
        break;
      }
      case "guard": {
        if (!guardHeld) {
          p.def.guarding = false;
          p.mode = "free";
          return;
        }
        if (press.roll && this.now >= p.rollCdUntil) return this.startRoll(dir);
        if (f.anim.done) f.anim.hold(HERO_CLIPS.guardUp.sheet, HERO_CLIPS.guardUp.to);
        if (dir.any) this.step(f, (dir.x * HERO.guardSpeed * dt) / 1000, (dir.y * HERO.guardSpeed * dt) / 1000);
        break;
      }
      case "roll": {
        const s = (HERO.rollSpeed * dt) / 1000;
        this.step(f, p.rollDir.x * s, p.rollDir.y * s);
        if (rollT >= HERO.rollMs) {
          p.mode = "free";
          p.rollCdUntil = this.now + HERO.rollCdMs;
        }
        break;
      }
      case "hurt": {
        if (this.now >= p.hurtUntil) p.mode = "free";
        break;
      }
      case "air": {
        p.vz -= (HERO.gravity * dt) / 1000;
        f.z += (p.vz * dt) / 1000;
        if (dir.any) this.step(f, (dir.x * HERO.airSpeed * dt) / 1000, (dir.y * HERO.airSpeed * dt) / 1000);
        if (press.attack && !p.atk && !p.airAtk) return this.startAirAttack();
        if (press.bolt && !p.atk) this.startBolt();
        if (p.atk) this.playerHits(p.atk, f.anim.frame);
        else {
          const c = p.vz > 0 ? HERO_CLIPS.jumpUp : HERO_CLIPS.jumpDown;
          if (f.anim.sheet !== c.sheet) f.play(c, { loop: true });
        }
        if (f.z <= 0 && p.vz < 0) this.land();
        break;
      }
      case "dash": {
        const u = Math.min(1, (this.now - p.dashStart) / HERO.dashMs);
        const target = HERO.dashDist * (1 - (1 - u) * (1 - u));
        const stepPx = target - p.dashDone;
        p.dashDone = target;
        this.step(f, p.dashDir.x * stepPx, p.dashDir.y * stepPx);
        if (u >= 1) p.mode = "free";
        break;
      }
      case "cast": {
        if (!p.castDone && this.now >= p.castReleaseAt) this.releaseCast();
        if (this.now >= p.castUntil) {
          p.mode = "free";
          p.castKind = null;
        } else if (p.castDone) {
          if (press.roll && this.now >= p.rollCdUntil) return this.startRoll(dir);
          if (press.dash && this.now >= p.dashCdUntil) return this.startDash(dir);
        }
        break;
      }
      case "land": {
        if (press.roll && this.now >= p.rollCdUntil) return this.startRoll(dir);
        if (press.dash && this.now >= p.dashCdUntil) return this.startDash(dir);
        if (press.attack) return this.startAttack("L1");
        if (this.now >= p.landUntil) p.mode = "free";
        break;
      }
    }
  }

  // ---- vertical movement: jump, air attack, landing; and the dash
  private startJump() {
    const p = this.p, f = this.player;
    p.mode = "air";
    p.atk = null;
    p.chain = 0;
    p.def.guarding = false;
    p.vz = HERO.jumpV;
    p.airAtk = false;
    p.jumpCdUntil = this.now + HERO.jumpCdMs;
    f.z = 0.01;
    f.play(HERO_CLIPS.jumpUp, { loop: true });
    this.vfx.play(FX_EXTRA.smokeA, f.x, f.y - 4, { scale: 0.6, alpha: 0.7 });
    this.sfx.whoosh(0.2, 0.2, 300, 900);
    this.telemetry.record("jump", this.now);
    this.note("jump");
  }

  private startAirAttack() {
    const p = this.p, f = this.player, a = AIR_ATTACK;
    p.atk = a;
    p.airAtk = true;
    p.hitDone = a.hits.map(() => false);
    p.recovering = false;
    p.queued = false;
    p.dash += f.face * this.reachableLunge(a.lunge);
    f.startTrail(160, 0xffe0b0, 40, 0.4, 220);
    f.play(a.clip, {
      onDone: () => {
        if (p.mode === "air") p.atk = null;
        else if (p.mode === "attack") {
          p.mode = "free";
          p.atk = null;
          p.recovering = false;
        }
      },
    });
    this.telemetry.react("attack", this.now);
    this.sfx.swing(false);
    this.note("attack", { id: "AIR", chain: 0 });
  }

  private land() {
    const p = this.p, f = this.player;
    f.z = 0;
    p.vz = 0;
    this.sfx.thud(0.35);
    this.vfx.play(FX_EXTRA.smokeA, f.x, f.y - 4, { scale: 0.7, alpha: 0.8 });
    this.note("land");
    if (p.atk) {
      p.mode = "attack"; // the air attack finishes on the ground
      return;
    }
    p.mode = "land";
    p.landUntil = this.now + HERO.landLagMs;
    f.play(HERO_CLIPS.land);
  }

  private startDash(dir: { x: number; y: number; any: boolean }) {
    const p = this.p, f = this.player;
    const away = { x: -f.face, y: 0 };
    const d = dir.any ? { x: dir.x, y: dir.y } : away;
    p.mode = "dash";
    p.atk = null;
    p.chain = 0;
    p.def.guarding = false;
    p.dashStart = this.now;
    p.dashDone = 0;
    p.dashDir = d;
    p.dashCdUntil = this.now + HERO.dashCdMs;
    // moving backwards while facing the enemy: the run cycle is played in REVERSE so the knight backs away rather than moonwalks forwards
    const back = d.x * f.face < -0.3;
    const run = HERO_CLIPS.run;
    f.play(back ? { ...run, from: run.to, to: run.from, fps: 36 } : { ...run, fps: 36 }, { loop: true });
    f.startTrail(HERO.dashMs + 80, 0x8fd0ff, 26, 0.55, 300, true);
    this.vfx.play(FX_EXTRA.smokeA, f.x, f.y - 4, { scale: 0.7, alpha: 0.8, flip: d.x < 0 });
    this.sfx.whoosh(0.3, 0.2, 500, 1800);
    this.telemetry.record("dash", this.now);
    this.note("dash", { back });
  }

  /** What a skill costs after the Kindled Blade gift. */
  skillCost(base: number) {
    return this.perk("kindled") ? Math.max(1, base - 1) : base;
  }

  // ---- fire skills: Ember Bolt (a projectile) and Inferno Ring (an explosion around the knight)
  private startBolt() {
    const p = this.p, f = this.player;
    const cost = this.skillCost(BOLT.cost);
    if (p.spirit < cost || this.now < p.boltCdUntil || this.e.mode === "dead") return;
    p.spirit -= cost;
    p.boltCdUntil = this.now + BOLT.cdMs;
    this.telemetry.record("skill", this.now);
    this.note("skill", { id: "BOLT", spirit: p.spirit });
    this.sfx.skill();
    if (p.mode === "air") return this.spawnBolt(); // thrown from the air: no wind-up, no lock
    p.mode = "cast";
    p.atk = null;
    p.chain = 0;
    p.def.guarding = false;
    p.castKind = "bolt";
    p.castDone = false;
    p.castReleaseAt = this.now + BOLT.releaseMs;
    p.castUntil = this.now + BOLT.castMs;
    f.play(BOLT.clip);
  }

  private spawnBolt() {
    const f = this.player, dx = this.enemy.x >= f.x ? 1 : -1;
    const vy = Phaser.Math.Clamp((this.enemy.y - f.y) * 1.1, -130, 130);
    this.projs.spawn({ id: "BOLT", owner: "player", look: "ember", x: f.x + dx * 54, y: f.y, z: f.z + 30, vx: dx * BOLT.speed, vy, dmg: BOLT.dmg, posture: BOLT.posture, radius: BOLT.radius, life: BOLT.life });
    this.note("bolt");
  }

  private startNova() {
    const p = this.p, f = this.player;
    const cost = this.skillCost(NOVA.cost);
    if (p.spirit < cost || this.now < p.novaCdUntil || this.e.mode === "dead") return;
    p.spirit -= cost;
    p.novaCdUntil = this.now + NOVA.cdMs;
    p.mode = "cast";
    p.atk = null;
    p.chain = 0;
    p.def.guarding = false;
    p.castKind = "nova";
    p.castDone = false;
    p.castReleaseAt = this.now + NOVA.releaseMs;
    p.castUntil = this.now + NOVA.castMs;
    p.invulnUntil = Math.max(p.invulnUntil, this.now + NOVA.iframesMs); // a burst out of trouble
    f.play(HERO_CLIPS.guardUp);
    f.startTrail(NOVA.releaseMs, 0xff8a3c, 45, 0.5, 320, true);
    this.telemetry.record("skill", this.now);
    this.sfx.skill();
    this.note("skill", { id: "NOVA", spirit: p.spirit });
  }

  private releaseCast() {
    const p = this.p;
    p.castDone = true;
    if (p.castKind === "bolt") this.spawnBolt();
    else if (p.castKind === "nova") this.novaBlast();
  }

  private novaBlast() {
    const f = this.player, en = this.enemy;
    this.vfx.play(FX_EXTRA.burst2, f.x, f.y - 30, { scale: 3.6, depth: EMISSIVE_DEPTH });
    this.vfx.play(FX_EXTRA.burst, f.x, f.y - 20, { scale: 2.0, add: true, alpha: 0.3, depth: EMISSIVE_DEPTH + 0.01 }); // the white flash frames need additive blending
    this.sfx.whirl();
    this.sfx.deathblow();
    this.shake(0.01, 200);
    this.hitstop = Math.max(this.hitstop, 90);
    const cleared = this.projs.clearEnemy(f.x, f.y, NOVA.radius);
    let hit = false;
    if (this.e.mode !== "dead" && Math.abs(en.x - f.x) < NOVA.radius + en.radius && Math.abs(en.y - f.y) < NOVA.band) {
      hit = true;
      this.playerHitsEnemy({ id: "NOVA", clip: { sheet: "", from: 0, to: 0 }, hits: [], chainFrom: 99, lunge: 0 }, { a: 0, b: 0, dmg: NOVA.dmg, posture: NOVA.posture, reach: 0, kind: "heavy" }, 0);
      this.e.dash += Math.sign(en.x - f.x || 1) * 46;
      if (this.e.mode === "attack") {
        // the blast interrupts whatever the boss was doing
        this.e.mode = "idle";
        this.e.atk = null;
        this.e.gate = null;
        this.e.feinting = false;
        this.enemy.anim.speed = 1;
        this.e.thinkAt = this.now + 450;
      }
    }
    this.note("nova", { hit, cleared });
  }

  // ---- projectiles: collision against the fighters, reflection of a deflected enemy projectile
  spawnProjectile(o: Parameters<ProjectileSystem["spawn"]>[0]) {
    if (o.owner === "enemy") this.telemetry.attackStart(o.id, this.now);
    return this.projs.spawn(o);
  }

  private updateProjectiles(dt: number) {
    if (!this.projs.list.length) return;
    this.projs.update(dt, FLOOR);
    const pl = this.player, en = this.enemy;
    for (const pr of [...this.projs.list]) {
      if (pr.owner === "player") {
        if (this.e.mode === "dead") continue;
        const hitE = Math.abs(pr.x - en.x) < en.radius + pr.radius && Math.abs(pr.y - en.y) < (en.radius + pr.radius) * 0.75 && Math.abs(pr.z - (en.z + 25)) < 140;
        if (!hitE) continue;
        this.playerHitsEnemy({ id: pr.reflected ? "REFLECT" : pr.id, clip: { sheet: "", from: 0, to: 0 }, hits: [], chainFrom: 99, lunge: 0 }, { a: 0, b: 0, dmg: pr.dmg, posture: pr.posture, reach: 0, kind: pr.kind }, 0);
        this.projs.destroy(pr, true);
      } else {
        if (this.now < pr.ignorePlayerUntil || this.p.mode === "dead") continue;
        const hitP = Math.abs(pr.x - pl.x) < HERO.radius + pr.radius && Math.abs(pr.y - pl.y) < (HERO.radius + pr.radius) * 0.75 && Math.abs(pr.z - (pl.z + 25)) < 40;
        if (!hitP) continue;
        const hit: HitDef = { a: 0, b: 0, dmg: pr.dmg, posture: pr.posture, reach: 0, kind: pr.kind };
        const pseudo: EnemyAttack = { id: pr.id, desc: "", clip: { sheet: "", from: 0, to: 0 }, hits: [hit], range: [0, 0], cooldownMs: 0, lunge: 0 };
        this.lastEnemyOutcome = null;
        this.enemyHits(pseudo, hit, 0, { inRange: true, srcX: pr.x, projectile: pr });
        const out = this.lastEnemyOutcome;
        if (out === "deflected") this.reflect(pr);
        else if (out === "dodged") pr.ignorePlayerUntil = this.now + 500; // it slips past
        else this.projs.destroy(pr, true);
      }
    }
  }

  /** A perfect parry sends an enemy projectile back, faster and harder. */
  private reflect(pr: Projectile) {
    pr.owner = "player";
    pr.reflected = true;
    pr.vx = -pr.vx * 1.3;
    pr.vy = Phaser.Math.Clamp((this.enemy.y - pr.y) * 1.2, -140, 140);
    pr.dmg = Math.round(pr.dmg * 1.6) + 4;
    pr.posture = pr.posture * 1.5 + 10;
    pr.life = 1600;
    pr.z = 30;
    pr.sprite.setFlipX(pr.vx < 0).setTint(0xffd23f);
    this.popup(pr.x, pr.y - 70, "REFLECT", "#ffd23f");
    this.sfx.deflect();
  }

  private startSkill(id: string) {
    const p = this.p, sk = SKILLS[id];
    const cost = this.skillCost(sk.cost);
    if (p.spirit < cost || this.e.mode === "dead") return;
    p.spirit -= cost;
    this.telemetry.record("skill", this.now);
    this.startAttack(id, sk);
    this.note("skill", { id, spirit: p.spirit });
  }

  private startRoll(dir: { x: number; y: number; any: boolean }) {
    const p = this.p;
    p.def.guarding = false;
    p.mode = "roll";
    p.atk = null;
    p.rollStart = this.now;
    p.rollDir = dir.any ? { x: dir.x, y: dir.y } : { x: -this.player.face, y: 0 };
    {
      const ex = this.enemy.x - this.player.x, ey = this.enemy.y - this.player.y, m = Math.hypot(ex, ey) || 1;
      this.telemetry.rollDir((p.rollDir.x * ex + p.rollDir.y * ey) / m);
    }
    this.player.play(HERO_CLIPS.roll);
    this.player.startTrail(HERO.rollMs - 80, 0xffa860, 40, 0.42, 260);
    this.vfx.play(FX_EXTRA.smokeA, this.player.x, this.player.y - 4, { scale: 0.6, alpha: 0.7 });
    this.sfx.roll();
    this.note("roll");
  }

  private startGuard() {
    const p = this.p;
    p.mode = "guard";
    p.atk = null;
    p.chain = 0;
    pressGuard(p.def, this.now);
    this.player.play(HERO_CLIPS.guardUp);
    this.note("guard", { noDeflect: p.def.noDeflect });
  }

  private startAttack(id: string, skill?: PlayerAttack) {
    const p = this.p, a = skill ?? HERO_ATTACKS[id];
    p.mode = "attack";
    p.atk = a;
    p.chain = skill ? 0 : id === "L1" ? 1 : p.chain + 1;
    p.hitDone = a.hits.map(() => false);
    p.queued = false;
    p.recovering = false;
    p.dash += this.player.face * this.reachableLunge(a.lunge);
    if (a.lunge >= 20) this.player.startTrail(120, 0xffe0b0, 36, 0.35, 200); // the lunge leaves a brief afterimage
    this.player.play(a.clip, {
      onDone: () => {
        if (p.queued && a.next) return this.startAttack(a.next);
        p.recovering = true;
        p.chain = 0;
        if (!a.recover) {
          p.mode = "free";
          p.atk = null;
          return;
        }
        p.queued = false;
        this.player.play(a.recover, {
          onDone: () => {
            if (p.queued) return this.startAttack("L1");
            p.mode = "free";
            p.atk = null;
            p.recovering = false;
          },
        });
      },
    });
    if (skill) this.sfx.skill();
    else this.sfx.swing(id === "L3");
    this.note("attack", { id, chain: p.chain });
  }

  /** Do not lunge through the enemy. */
  private reachableLunge(px: number) {
    const gap = Math.abs(this.enemy.x - this.player.x) - (HERO.radius + this.boss.radius);
    return Phaser.Math.Clamp(gap, 0, px);
  }

  private playerHits(a: PlayerAttack, frame: number) {
    const p = this.p;
    a.hits.forEach((h, i) => {
      if (p.hitDone[i] || frame < h.a) return;
      if (frame > h.b) {
        p.hitDone[i] = true; // window passed without connecting
        this.note("whiff", { id: a.id, hit: i });
        return;
      }
      if (this.e.mode === "dead") return;
      if (Math.abs(this.player.z - this.enemy.z) > (a.id === "AIR" ? HERO.airReachZ : HERO.groundReachZ)) return;
      if (inReach(this.player.x, this.player.y, this.player.face, this.enemy.x, this.enemy.y, h.reach * (this.perk("reach") ? 1.15 : 1), h.band ?? 38, this.boss.radius)) {
        p.hitDone[i] = true;
        this.playerHitsEnemy(a, h, i);
      }
    });
  }

  private playerHitsEnemy(a: PlayerAttack, h: HitDef, i: number) {
    const e = this.e;
    const broken = e.mode === "broken";
    const riposte = this.now < this.p.riposteUntil;
    const jc = a.id === "AIR" && this.now - e.leapAt <= JUMP_COUNTER.windowMs;
    let dmg = h.dmg * (riposte ? 1.5 : 1) * (jc ? JUMP_COUNTER.dmgMul : 1);
    if (broken) dmg *= ENEMY.deathblowMult;
    dmg = Math.round(dmg);
    e.hp = Math.max(0, e.hp - dmg);
    e.lastHitAt = this.now;
    const mid = { x: (this.player.x + this.enemy.x) / 2, y: this.enemy.y - 45 * SCALE * 0.6 };
    this.vfx.play(FX.sparkHit, this.enemy.x - this.player.face * 6, mid.y, { flip: this.player.face < 0, scale: broken ? 1.8 : 1.2 });
    this.enemy.hitFlash(80);
    this.sfx.hit(h.kind === "heavy" || broken);
    this.hitstop = Math.max(this.hitstop, h.kind === "heavy" || broken ? 110 : 55);
    this.popup(this.enemy.x, this.enemy.y - 130, broken ? "DEATHBLOW " + dmg : String(dmg), broken ? "#ff5d5d" : "#ffd166");
    this.shake(h.kind === "heavy" || broken ? 0.006 : 0.002, 90);
    this.p.spirit = Math.min(HERO.spirit, this.p.spirit + HERO.spiritHit);
    if (jc) {
      // the jump counter: the boss's own swing is thrown back and a lot of posture comes off it
      e.leapAt = -1e9;
      this.popup(this.enemy.x, this.enemy.y - 170, "JUMP COUNTER", "#ffd23f");
      this.sfx.deflect();
      this.p.spirit = Math.min(HERO.spirit, this.p.spirit + 1);
      if (e.mode === "attack" && e.atk) this.reverseEnemy(e.atk, h, JUMP_COUNTER.posture);
      else e.posture = Math.min(100, e.posture + JUMP_COUNTER.posture);
      this.enemy.ghost(0xffd23f, 0.5, 320, true);
    }
    if (a.id === "FLAME") this.vfx.play(FX_EXTRA.burst2, this.enemy.x, this.enemy.y - 30, { scale: 2.2, depth: EMISSIVE_DEPTH });
    this.note("playerHit", { id: a.id, hit: i, dmg, broken, riposte, chain: this.p.chain });
    if (broken) {
      e.posture = 0;
      e.mode = "idle";
      e.poiseUntil = this.now + ENEMY.poiseMs;
    } else {
      e.posture = Math.min(100, e.posture + h.posture * (this.boss.postureMul ?? 1));
      if (e.posture >= ENEMY.posture) return this.breakEnemy();
    }
    if (e.hp <= 0) return this.killEnemy();
    // flinch unless mid-attack (armoured while swinging) or inside the poise window
    // light hits do not stagger a boss (hyper-armour): only heavy hits, ripostes or a boss close to breaking do
    const staggers = h.kind === "heavy" || riposte || e.posture >= 70;
    if (staggers && e.mode !== "attack" && e.mode !== "broken" && e.mode !== "recoil" && this.now >= e.poiseUntil) {
      e.mode = "flinch";
      e.poiseUntil = this.now + ENEMY.poiseMs;
      this.enemy.play(this.boss.clips.hit, { onDone: () => e.mode === "flinch" && ((e.mode = "idle"), (e.thinkAt = this.now + 300)) });
    }
    e.dash += this.player.face * (h.kind === "heavy" ? 26 : 8);
  }

  // ---------------------------------------------------------------- enemy
  forceEnemyAttack(id: string) {
    if (this.e.mode === "dead" || this.e.mode === "broken") return;
    this.startEnemyAttack(this.boss.attacks[id]);
  }

  private startEnemyAttack(a: EnemyAttack) {
    const e = this.e;
    e.mode = "attack";
    e.atk = a;
    e.stanceAttacks++;
    e.hitDone = a.hits.map(() => false);
    e.cd[a.id] = this.now + a.cooldownMs * (this.phase() === 2 ? this.boss.phase2.cooldown : 1);
    this.enemy.face = this.player.x >= this.enemy.x ? 1 : -1;
    const hm = this.phase() === 2 ? this.boss.phase2.hold : 1;
    const holds = Object.fromEntries(Object.entries(a.clip.holds ?? {}).map(([k, v]) => [k, v * hm]));
    e.feinting = false;
    this.telemetry.attackStart(a.id, this.now);
    this.enemy.play({ ...a.clip, holds }, {
      onDone: () => {
        if (e.mode !== "attack") return;
        e.mode = "idle";
        e.atk = null;
        e.thinkAt = this.now + 500 * (this.boss.pace ?? 1);
      },
    });
    let lead = 0;
    const pi = Math.max(0, a.hits.findIndex((h) => h.kind === "perilous" || h.kind === "sweep"));
    for (let f = a.clip.from; f < a.hits[pi].a; f++) lead += 1000 / (a.clip.fps ?? 12) + (holds[f] ?? 0);
    e.strikeAt = this.now + lead;
    if (a.perilous) this.sfx.warn("thrust");
    const sweepy = a.hits.some((h) => h.kind === "sweep");
    this.popup(this.enemy.x, this.enemy.y - 135, sweepy ? "JUMP!" : a.perilous ? "!!" : "!", sweepy ? "#ffd23f" : a.perilous ? "#ff3b3b" : "#ff5d5d");
    this.note("enemyAttack", { id: a.id, strikeAt: Math.round(e.strikeAt) });
  }

  private updateEnemy(dt: number) {
    const e = this.e, f = this.enemy;
    if (this.now - e.lastHitAt > ENEMY.postureRegenDelayMs && e.mode !== "broken") e.posture = Math.max(0, e.posture - (ENEMY.postureRegen * dt) / 1000);
    this.burn(f, e, dt);
    if (e.mode === "dead") return;
    if (e.mode !== "attack" && e.mode !== "recoil" && e.mode !== "broken") f.face = this.player.x >= f.x ? 1 : -1;
    if (!e.phase2 && this.phase() === 2 && e.hp > 0) {
      e.phase2 = true;
      this.popup(this.enemy.x, this.enemy.y - 175, "PHASE 2", "#ff9f43");
      this.note("phase2");
    }
    if (e.gate) return this.updateGate();
    if (e.resumeAt && this.now >= e.resumeAt) {
      e.resumeAt = 0;
      f.anim.speed = 1;
    }
    switch (e.mode) {
      case "idle": {
        if (!e.auto || this.p.mode === "dead") {
          f.ensure(this.boss.clips.idle);
          break;
        }
        this.enemyThink(dt);
        break;
      }
      case "attack": {
        if (e.feinting || !e.atk) break;
        const a = e.atk;
        const frame = f.anim.frame;
        for (let i = 0; i < a.hits.length; i++) {
          const h = a.hits[i];
          if (e.hitDone[i] || frame < h.a) continue;
          e.hitDone[i] = true;
          if (i === 0) {
            e.dash += f.face * this.enemyLunge(a.lunge);
            this.sfx.swing(a.hits.some((x) => x.kind === "heavy"), true);
          }
          this.enemyHits(a, h, i);
          if (a.gate && a.gate.afterHit === i && e.mode === "attack" && this.qteKind !== "clash") this.startGate(a);
          break; // one hit per frame so a gate can interrupt before the next
        }
        break;
      }
      case "recoil": {
        if (this.now >= e.recoilUntil) {
          e.mode = "idle";
          e.thinkAt = this.now + 400 * (this.boss.pace ?? 1);
        }
        break;
      }
      case "broken": {
        if (this.now >= e.brokenUntil) {
          e.mode = "idle";
          e.posture = 30;
          e.thinkAt = this.now + 500;
          this.note("recovered");
        }
        break;
      }
    }
  }

  private enemyLunge(px: number) {
    const gap = Math.abs(this.player.x - this.enemy.x) - (HERO.radius + this.boss.radius);
    return Phaser.Math.Clamp(gap, 0, px);
  }

  private enemyHits(a: EnemyAttack, h: HitDef, i: number, opts?: { inRange: boolean; srcX: number; projectile?: Projectile }) {
    const f = this.enemy, p = this.p;
    const inRange = opts ? opts.inRange : inReach(f.x, f.y, f.face, this.player.x, this.player.y, h.reach, h.band ?? 38, HERO.radius, h.around);
    if (!opts && a.clashable && inRange && p.mode === "attack" && p.atk && !p.recovering && this.playerInStrike()) return this.startClash(a, h, i);
    const countered = h.kind === "perilous" && this.now - p.counterAt <= HERO.counterMs;
    const out: Outcome = resolveEnemyHit(p.def, this.now, h, inRange, countered, (this.assist ? HERO.assistDeflectMs : HERO.deflectMs) + (this.perk("keen") ? 40 : 0), this.player.z >= HERO.leapZ);
    this.note("enemyHit", { id: a.id, hit: i, outcome: out, frame: f.anim.frame });
    this.telemetry.outcome(a.id, out);
    this.lastEnemyOutcome = out;
    const srcX = opts?.srcX ?? f.x;
    const mid = { x: (this.player.x + srcX) / 2, y: this.player.y - 40 * SCALE * 0.6 };
    switch (out) {
      case "missed":
      case "dodged":
        if (out === "dodged") {
          this.popup(this.player.x, this.player.y - 130, a.perilous ? "SLIP" : "dodge", "#8fd3ff");
          if (a.perilous) this.sfx.slip();
          if (a.perilous) {
            this.e.posture = Math.min(100, this.e.posture + 20);
            this.e.lastHitAt = this.now;
            p.spirit = Math.min(HERO.spirit, p.spirit + 0.5);
            if (this.e.posture >= ENEMY.posture) this.breakEnemy();
          }
        }
        break;
      case "leapt":
        this.popup(this.player.x, this.player.y - 150, "LEAP", "#ffd23f");
        this.sfx.slip();
        p.spirit = Math.min(HERO.spirit, p.spirit + 1);
        this.e.leapAt = this.now;
        this.telemetry.record("counter", this.now);
        break;
      case "deflected":
        if (opts?.projectile) this.p.riposteUntil = this.now + 800; // the projectile is sent back by the caller
        else this.reverseEnemy(a, h, h.posture * 1.3 * (this.perk("wrist") ? 1.3 : 1));
        this.vfx.play(FX.sparkParry, mid.x, mid.y, { scale: 1.6, flip: f.face > 0 });
        this.vfx.play(FX.smear, mid.x, mid.y - 6, { scale: 1.4, flip: f.face < 0, tint: 0x8fd3ff, add: true });
        this.popup(this.player.x, this.player.y - 130, "PARRY", "#8fd3ff");
        this.sfx.deflect();
        this.sfx.riposteReady();
        this.telemetry.deflectLead(this.now - p.def.guardPressedAt);
        this.telemetry.record("deflect", this.now);
        p.spirit = Math.min(HERO.spirit, p.spirit + HERO.spiritDeflect);
        break;
      case "countered":
        this.reverseEnemy(a, h, COUNTER.enemyPosture * (this.perk("wrist") ? 1.3 : 1));
        this.vfx.play(FX.sparkParry, this.enemy.x, mid.y, { scale: 2.2, flip: f.face > 0 });
        this.vfx.play(FX_EXTRA.holy, this.enemy.x, mid.y - 10, { scale: 1.4, add: true });
        this.popup(this.player.x, this.player.y - 140, "COUNTER", "#ffd166");
        this.sfx.deflect();
        this.sfx.slip();
        this.telemetry.record("counter", this.now);
        p.spirit = Math.min(HERO.spirit, p.spirit + HERO.spiritCounter);
        break;
      case "blocked": {
        const dmg = chip(this.bdmg(h));
        p.hp = Math.max(0, p.hp - dmg);
        p.posture = Math.min(HERO.posture, p.posture + h.posture);
        p.lastHitAt = this.now;
        p.dash += -this.player.face * 16;
        this.vfx.play(FX.sparkBlock, mid.x, mid.y, { scale: 1.1, flip: f.face > 0 });
        this.hitstop = Math.max(this.hitstop, 50);
        this.shake(0.002, 70);
        this.popup(this.player.x, this.player.y - 130, "block", "#a5d6a7");
        this.sfx.block();
        if (p.hp <= 0) this.killPlayer();
        else if (p.posture >= HERO.posture) this.breakPlayer();
        break;
      }
      case "hit": {
        p.hp = Math.max(0, p.hp - this.bdmg(h));
        p.posture = Math.min(HERO.posture, p.posture + this.bdmg(h) * HERO.postureHitFraction);
        p.lastHitAt = this.now;
        p.def.guarding = false;
        p.atk = null;
        p.chain = 0;
        p.dash += -this.player.face * 22;
        this.vfx.play(FX.sparkHit, this.player.x, mid.y, { scale: 1.3, flip: f.face > 0 });
        this.player.hitFlash(100, 0xff8888);
        this.hitstop = Math.max(this.hitstop, 80);
        this.shake(0.006, 140);
        this.popup(this.player.x, this.player.y - 130, String(this.bdmg(h)), "#ff6b6b");
        this.sfx.hurt();
        this.sfx.hit(true);
        this.telemetry.record("hurt", this.now);
        if (p.hp <= 0) return this.killPlayer();
        p.mode = "hurt";
        p.hurtUntil = this.now + HERO.hurtMs;
        p.invulnUntil = this.now + HERO.hurtInvulnMs;
        this.player.play(HERO_CLIPS.hurt);
        break;
      }
    }
  }

  /** The reverse parry: the attacker's own swing is played backwards from where it had got to and it is thrown off balance. */
  private reverseEnemy(a: EnemyAttack, h: HitDef, posture: number) {
    const e = this.e, f = this.enemy, p = this.p;
    e.mode = "recoil";
    e.recoilUntil = this.now + ENEMY.recoilMs;
    e.reversedAttack = a.id;
    e.reverseFrames = f.anim.reverseTo(a.clip.from, 300, () => {
      if (e.mode !== "recoil") return;
      if (e.posture >= ENEMY.posture) this.breakEnemy();
      else f.play(this.boss.clips.broken, { loop: true });
    });
    e.dash += -f.face * 34;
    e.posture = Math.min(100, e.posture + posture);
    e.lastHitAt = this.now;
    p.riposteUntil = this.now + 800;
    this.hitstop = Math.max(this.hitstop, 120);
    this.shake(0.004, 120);
    void h;
  }


  // ---------------------------------------------------------------- bosses and the brain
  private makeEnemy() {
    const f = new Fighter(this, this.boss.prefix, this.manifest.sheets, this.boss.radius, this.boss.nativeDir, this.boss.tint, this.boss.hue);
    return f;
  }

  private buildArea() {
    this.area?.destroy();
    const def = AREAS[this.boss.area];
    this.area = new AreaView(this, def);
    if (this.sfx && this.manifest.music) this.sfx.playMusic(def.music, 0.25);
    this.note("area", { id: def.id });
    if (this.mode === "menu" || (this.dev && new URLSearchParams(window.location.search).has("nocard"))) return;
    const t1 = this.add.text(VIEW_W / 2, 230, def.name, { fontFamily: "monospace", fontSize: "34px", color: "#f5e6c8", stroke: "#000", strokeThickness: 5 }).setOrigin(0.5).setDepth(2500).setAlpha(0);
    const t2 = this.add.text(VIEW_W / 2, 270, def.subtitle, { fontFamily: "monospace", fontSize: "14px", color: "#cdbf9f", stroke: "#000", strokeThickness: 3 }).setOrigin(0.5).setDepth(2500).setAlpha(0);
    const t3 = this.add.text(VIEW_W / 2, 300, `"${this.boss.intro}"`, { fontFamily: "monospace", fontSize: "13px", fontStyle: "italic", color: "#e8d9b0", stroke: "#000", strokeThickness: 3 }).setOrigin(0.5).setDepth(2500).setAlpha(0);
    this.tweens.add({ targets: [t1, t2, t3], alpha: 1, duration: 450, hold: 1700, yoyo: true, onComplete: () => (t1.destroy(), t2.destroy(), t3.destroy()) });
  }

  /** Switch to another boss and restart the fight. */
  loadBoss(id: string) {
    if (!BOSSES[id]) return;
    this.boss = BOSSES[id];
    this.enemy.destroy();
    this.enemy = this.makeEnemy();
    this.buildArea();
    this.reset();
    this.hooks?.onBoss?.(this.boss.name);
    this.note("boss", { id });
  }
  nextBoss() {
    const i = ENCOUNTERS.indexOf(this.boss.id);
    this.loadBoss(ENCOUNTERS[(i + 1) % ENCOUNTERS.length]);
  }

  phase(): 1 | 2 {
    return this.e.hp / this.boss.hp <= this.boss.phase2.hpPct ? 2 : 1;
  }

  private perk(id: string) {
    return !!this.run?.perks.includes(id);
  }

  /** damage of an enemy hit after the boss's tuning multiplier */
  private bdmg(h: HitDef) {
    return Math.max(1, Math.round(h.dmg * (this.boss.dmgMul ?? 1) * (this.assist ? HERO.assistDamage : 1)));
  }

  private onDecision(d: Decision) {
    this.hooks?.onDecision?.(d);
    this.note("decision", { kind: d.kind, choice: d.choice, source: d.source, ms: d.latencyMs, error: d.error });
  }

  setHudVisible(v: boolean) {
    this.hud.setVisible(v);
    for (const o of this.hudObjects) (o as Phaser.GameObjects.Image).setVisible(v);
    for (const t of Object.values(this.texts)) t.setVisible(v);
  }

  toggleBrain() {
    const m = this.brain.toggle();
    this.fight.mixed = true;
    this.popup(this.enemy.x, this.enemy.y - 170, `brain: ${m === "jev" ? "JEV" : "RULES"}`, "#58a6ff");
    this.hooks?.onBrain?.(m);
  }

  /** Called once when a fight ends: learn from it, record it for the Jev-vs-rules comparison, advance the run, tell the UI. */
  private endFight(won: boolean) {
    if (this.remembered) return;
    this.commitMemory(won);
    const v = Object.values(this.telemetry.vsMove);
    const sum = (f: (m: (typeof v)[number]) => number) => v.reduce((s, m) => s + f(m), 0);
    const st = this.brain.stats;
    const rec: FightRecord = {
      boss: this.boss.id, brain: this.fight.mixed ? "mixed" : this.fight.brain, won, ms: Math.round(this.now), hpLost: Math.round(this.fight.hp0 - this.p.hp),
      thrown: sum((m) => m.thrown), deflected: sum((m) => m.deflected), countered: sum((m) => m.countered), blocked: sum((m) => m.blocked), dodged: sum((m) => m.dodged), hit: sum((m) => m.hit),
      decisions: { jev: st.jev.n, rules: st.rules.n, fallback: st.fallback.n }, jevMs: st.jev.ms, at: Date.now(),
    };
    saveStats(addRecord(loadStats(), rec));
    const run = this.run;
    let final = false;
    if (run) {
      if (won) {
        run.cleared.push(this.boss.id);
        run.bossIndex = Math.min(run.bossIndex + 1, ENCOUNTERS.length);
        final = run.bossIndex >= ENCOUNTERS.length;
        run.finished = final;
      } else run.deaths++;
      writeSave(run);
    }
    this.note("fightEnd", { won, boss: this.boss.id, brain: rec.brain });
    // a beat of silence and the last popup before the UI takes over
    this.time.delayedCall(won ? 1800 : 1400, () => this.hooks?.onFight?.({ record: rec, won, boss: this.boss.id, bossName: this.boss.name, outro: this.boss.outro, final, deaths: run?.deaths ?? 0, playMs: run?.playMs ?? 0 }));
  }

  // ---- run control, called by the React shell (createArenaGame's api)
  startRun(slot: number, fresh: boolean) {
    if (fresh) deleteSave(slot);
    this.run = loadSave(slot) ?? newRun(slot);
    if (fresh || this.run.finished) this.run = newRun(slot);
    writeSave(this.run);
    this.mode = "play";
    this.brain.mode = this.settings.brain;
    this.setHudVisible(true);
    this.loadBoss(ENCOUNTERS[Math.min(this.run.bossIndex, ENCOUNTERS.length - 1)]);
    this.e.auto = true;
  }
  /** Shrine: keep a perk for the rest of the run. */
  choosePerk(id: string) {
    if (!this.run || this.run.perks.includes(id) || this.run.perks.length >= 3) return;
    this.run.perks.push(id);
    writeSave(this.run);
    this.note("perk", { id });
  }
  /** After a victory: the next boss of the run (or back to the first when the run is over and replayed). */
  continueRun() {
    const i = this.run ? this.run.bossIndex : ENCOUNTERS.indexOf(this.boss.id) + 1;
    this.loadBoss(ENCOUNTERS[i % ENCOUNTERS.length]);
    this.e.auto = true;
  }
  retry() {
    this.reset();
    this.e.auto = true;
  }
  toTitle() {
    this.mode = "menu";
    this.run = null;
    this.setHudVisible(false);
    this.loadBoss("mb");
    this.e.auto = false;
  }
  applySettings() {
    this.settings = loadSettings();
    this.inp.setKeymap(this.settings.keymap);
    if (!this.settings.music) this.sfx.stopMusic();
    else if (this.manifest.music) this.sfx.playMusic(AREAS[this.boss.area].music, 0.25);
  }

  private commitMemory(won: boolean) {
    if (this.remembered) return;
    this.remembered = true;
    remember(this.memory, this.boss.id, won, this.telemetry.landed, this.telemetry.habits());
    saveMemory(this.memory);
  }

  private say(text: string) {
    this.popup(this.enemy.x, this.enemy.y - 175, `"${text}"`, "#e6edf3");
    this.sfx.blip(this.boss.id);
    this.note("taunt", { text });
  }

  private distTrend(): "closing" | "holding" | "opening" {
    const h = this.distHist;
    if (h.length < 4) return "holding";
    const d = h[h.length - 1].d - h[0].d;
    return d < -18 ? "closing" : d > 18 ? "opening" : "holding";
  }

  /** Attacks Jev may pick right now (in range, off cooldown, fairness) plus the generic movement actions. */
  availableActions(): string[] {
    const e = this.e, f = this.enemy;
    const dist = Math.abs(this.player.x - f.x), dy = Math.abs(this.player.y - f.y);
    const last2 = e.lastActions.slice(-2).map((id) => this.boss.attacks[id]?.perilous);
    const capped = last2.length === 2 && last2.every(Boolean);
    const out: string[] = [];
    for (const a of Object.values(this.boss.attacks)) {
      if (dist < a.range[0] || dist > a.range[1] || dy > 45 || this.now < (e.cd[a.id] ?? 0)) continue;
      if (a.perilous && capped) continue;
      out.push(a.id);
    }
    const sp = this.spacingOf();
    if (e.stance === "engage") {
      if (dist > 100 || dy > 35) out.push("APPROACH");
      if (dist < 150) out.push("BACKSTEP");
      if (dist < 170) out.push("RETREAT");
      if (dist >= 60 && dist <= 240) out.push("CIRCLE");
    } else {
      // disengaged: no walking back in until the stance ends; back off if crowded, otherwise circle
      if (dist < sp.disengage - 20) out.push("RETREAT");
      if (dist >= 60) out.push("CIRCLE");
    }
    out.push("WAIT");
    return out;
  }

  snapshot(available: string[], gate?: EnemyAttack): Snapshot {
    const e = this.e, p = this.p;
    const dist = Math.round(Math.abs(this.player.x - this.enemy.x));
    const reachable: Record<string, boolean> = {};
    for (const a of Object.values(this.boss.attacks)) reachable[a.id] = available.includes(a.id);
    const last = e.lastActions;
    let streak = 0;
    for (let i = last.length - 1; i >= 0 && last[i] === last[last.length - 1]; i--) streak++;
    const lastTwo = last.slice(-2).map((id) => this.boss.attacks[id]?.perilous);
    const snap: Snapshot = {
      boss: { name: this.boss.name, phase: this.phase(), hpPct: Math.round((e.hp / this.boss.hp) * 100), posturePct: Math.round(e.posture), mode: e.mode, lastActions: last.slice(-5), sameActionStreak: streak },
      player: { hpPct: Math.round((p.hp / HERO.hp) * 100), posturePct: Math.round(p.posture), spirit: Math.floor(p.spirit), state: p.mode, airborne: this.player.z > 10, distancePx: dist, guardHeld: p.def.guarding, riposteReady: this.now < p.riposteUntil, standingStillMs: Math.round(this.standingStill) },
      recent: this.telemetry.recent(this.now, 8000),
      vsMove: this.telemetry.summary(),
      lastOutcome: this.telemetry.lastOutcome,
      habits: this.telemetry.habits(),
      memory: memoryFor(this.memory, this.boss.id),
      reachable,
      spacing: { stance: e.stance, secondsInStance: Math.round((this.now - e.stanceAt) / 100) / 10, preferredPx: e.stance === "engage" ? this.spacingOf().engage : this.spacingOf().disengage, trend: this.distTrend() },
      fairness: { perilousStreak: lastTwo.filter(Boolean).length, perilousCapped: lastTwo.length === 2 && lastTwo.every(Boolean) },
    };
    if (this.boss.id === "echo") snap.profile = profile(this.memory);
    if (gate) snap.gate = { move: gate.id, afterHit: gate.gate?.afterHit ?? 0 };
    return snap;
  }

  private spacingOf(): Spacing {
    return { ...DEFAULT_SPACING, ...(this.boss.spacing ?? {}) };
  }

  private setStance(s: "engage" | "disengage") {
    const e = this.e, sp = this.spacingOf();
    const r = (a: [number, number]) => a[0] + Math.random() * (a[1] - a[0]);
    e.stance = s;
    e.stanceAt = this.now;
    e.stanceAttacks = 0;
    e.stanceUntil = this.now + r(s === "engage" ? sp.engageMs : sp.disengageMs);
    e.stanceCap = Math.max(1, Math.round(r(sp.attacksPerEngage)));
    if (s === "engage") e.rushUntil = this.now + 700; // coming back in is quick
    this.note("stance", { stance: s });
  }

  /** The macro rhythm: press for a few attacks, back off for a moment, come back. Only switches between actions. */
  private updateStance() {
    const e = this.e;
    if (e.stanceUntil === 0) return this.setStance("engage");
    if (e.stance === "engage" && (this.now >= e.stanceUntil || e.stanceAttacks >= e.stanceCap)) this.setStance("disengage");
    else if (e.stance === "disengage" && this.now >= e.stanceUntil) this.setStance("engage");
  }

  /** The run cycle played backwards: the boss backs away while still facing the player. */
  private runBack() {
    const r = this.boss.clips.run;
    return { ...r, from: r.to, to: r.from };
  }

  /** Micro movement between actions: personal space when engaged; hold the gap and drift sideways when disengaged. Returns true if it moved. */
  private spacingMove(dt: number, spd: number, dx: number, dist: number): boolean {
    const e = this.e, f = this.enemy, sp = this.spacingOf();
    const away = -Math.sign(dx) || 1;
    if (e.stance === "engage") {
      if (dist >= sp.personal) return false;
      this.step(f, (away * spd * 0.85 * dt) / 1000, 0);
      f.ensure(this.runBack());
      return true;
    }
    if (dist < sp.disengage - 20) {
      this.step(f, (away * spd * dt) / 1000, 0);
      f.ensure(this.runBack());
      return true;
    }
    if (this.now >= e.circleUntil) {
      e.circleDir = Math.random() < 0.5 ? 1 : -1;
      e.circleUntil = this.now + 900 + Math.random() * 700;
    }
    if (f.y <= 276) e.circleDir = 1;
    if (f.y >= 494) e.circleDir = -1;
    this.step(f, 0, (e.circleDir * spd * 0.4 * dt) / 1000);
    f.ensure(this.boss.clips.run);
    return true;
  }

  /** Idle: pick the next action. The answer is requested while the boss is still recovering so it is usually ready when the pause ends. */
  private enemyThink(dt: number) {
    const e = this.e, f = this.enemy, sp = this.spacingOf();
    const dx = this.player.x - f.x, dy = this.player.y - f.y, dist = Math.abs(dx);
    const spd = this.boss.speed * (this.phase() === 2 ? this.boss.phase2.speed : 1);
    const away = -Math.sign(dx) || 1;
    // an ongoing explicit action
    if (e.action) {
      const act = e.action;
      if (act.id === "APPROACH") {
        const m = Math.hypot(dx, dy) || 1;
        const rush = this.now < e.rushUntil ? 1.5 : 1;
        this.step(f, dist > sp.engage - 10 ? ((dx / m) * spd * rush * dt) / 1000 : 0, ((dy / m) * spd * 0.6 * dt) / 1000);
        f.ensure(this.boss.clips.run);
        if ((dist <= sp.engage + 5 && Math.abs(dy) <= 30) || this.now >= act.until) e.action = null;
      } else if (act.id === "BACKSTEP" || act.id === "RETREAT") {
        this.step(f, (away * spd * (act.id === "RETREAT" ? 1 : 0.9) * dt) / 1000, 0);
        f.ensure(this.runBack());
        if (this.now >= act.until || (act.id === "RETREAT" && dist >= sp.disengage - 15)) e.action = null;
      } else if (act.id === "CIRCLE") {
        if (f.y <= 276) e.circleDir = 1;
        if (f.y >= 494) e.circleDir = -1;
        const want = e.stance === "engage" ? sp.engage + 50 : sp.disengage;
        this.step(f, dist > want + 30 ? Math.sign(dx) * spd * 0.5 * dt / 1000 : dist < want - 30 ? away * spd * 0.5 * dt / 1000 : 0, (e.circleDir * spd * 0.65 * dt) / 1000);
        f.ensure(this.boss.clips.run);
        if (this.now >= act.until) e.action = null;
      } else {
        f.ensure(this.boss.clips.idle);
        if (this.now >= act.until) e.action = null;
      }
      if (!e.action) e.thinkAt = this.now + 150;
      return;
    }
    this.updateStance();
    if (!this.spacingMove(dt, spd, dx, dist)) f.ensure(this.boss.clips.idle);
    const avail = this.availableActions();
    if (this.brain.needsRequest) this.brain.request(this.boss, this.snapshot(avail), avail);
    if (this.now < e.thinkAt) return;
    const d = this.brain.take(this.boss, this.snapshot(avail), avail);
    if (!d) return;
    this.applyDecision(d);
  }

  private applyDecision(d: Decision) {
    const e = this.e, a = this.boss.attacks[d.choice];
    e.lastActions.push(d.choice);
    if (e.lastActions.length > 12) e.lastActions.shift();
    if (d.taunt && d.taunt !== "NONE" && this.now - this.lastTaunt > 14000) {
      const t = this.boss.taunts?.find((x) => x.id === d.taunt);
      if (t) {
        this.lastTaunt = this.now;
        this.say(t.text);
      }
    }
    if (a) return this.startEnemyAttack(a);
    if (!(d.choice in GENERIC_ACTIONS)) return;
    const ms = { APPROACH: 1600, BACKSTEP: 450, RETREAT: 1000, CIRCLE: 1100 }[d.choice as "APPROACH"] ?? 650;
    if (d.choice === "RETREAT" && e.stance === "engage") this.setStance("disengage");
    if (d.choice === "APPROACH" && e.stance === "disengage") this.setStance("engage");
    e.action = { id: d.choice, until: this.now + ms };
  }

  // ---------------------------------------------------------------- combo gates
  private startGate(a: EnemyAttack) {
    const e = this.e, f = this.enemy;
    f.anim.speed = 0;
    const token = ++this.gateToken;
    e.gate = { a, startedAt: performance.now(), decision: null, token };
    const snap = this.snapshot(this.availableActions(), a);
    this.brain.gate(this.boss, a, a.gate!, snap, this.phase()).then((d) => {
      if (e.gate && e.gate.token === token) e.gate.decision = d.choice;
    });
    this.note("gateStart", { id: a.id });
  }

  private updateGate() {
    const e = this.e, f = this.enemy, g = e.gate!;
    if (e.mode !== "attack") {
      e.gate = null;
      f.anim.speed = 1;
      return;
    }
    if (!g.decision && performance.now() - g.startedAt < GATE_WAIT) return;
    e.gate = null;
    const choice = g.decision ?? g.a.gate!.default;
    this.note("gate", { id: g.a.id, choice, timedOut: g.decision === null });
    f.anim.speed = 1;
    if (choice === "DELAY") {
      f.anim.speed = 0;
      e.resumeAt = this.now + 350;
    } else if (choice === "FEINT") {
      e.feinting = true;
      f.anim.reverseTo(g.a.clip.from, 300, () => {
        if (e.mode !== "attack") return;
        e.mode = "idle";
        e.atk = null;
        e.feinting = false;
        e.thinkAt = this.now + 450;
      });
    } else if (choice === "END") {
      e.mode = "idle";
      e.atk = null;
      e.thinkAt = this.now + 500;
    }
  }

  // ---------------------------------------------------------------- quick-time events
  private qteWindow() {
    return this.settings.qte === "assist" ? DEATHBLOW.assistFactor : 1;
  }

  private canDeathblow() {
    if (this.settings.qte === "off" || this.e.mode !== "broken") return false;
    return Math.abs(this.enemy.x - this.player.x) <= 170 && Math.abs(this.enemy.y - this.player.y) <= 60;
  }

  private startDeathblow() {
    const p = this.p, e = this.e;
    p.mode = "qte";
    p.atk = null;
    p.chain = 0;
    this.qteKind = "deathblow";
    e.brokenUntil = Infinity;
    this.player.x = this.enemy.x - this.player.face * DEATHBLOW.gap;
    this.player.y = this.enemy.y;
    this.player.ensure(HERO_CLIPS.idle);
    const k = this.qteWindow();
    const keys = this.qteKeys ?? Array.from({ length: DEATHBLOW.prompts }, () => DEATHBLOW.keys[Math.floor(Math.random() * DEATHBLOW.keys.length)]);
    this.qte = new QteRun(keys.map((key) => ({ key, windowMs: DEATHBLOW.windowMs * k })), 110 * k, 260 * k);
    this.timeScale = DEATHBLOW.slowmo;
    this.note("qteStart", { keys });
  }

  private startClash(a: EnemyAttack, h: HitDef, i: number) {
    const p = this.p;
    p.mode = "qte";
    this.qteKind = "clash";
    this.pendingClash = { a, h, i };
    const need = this.settings.qte === "off" ? 0 : this.settings.qte === "assist" ? CLASH.assistNeed : CLASH.need;
    this.mash = new MashRun(need, CLASH.ms * (this.settings.qte === "assist" ? 1.4 : 1));
    this.timeScale = CLASH.slowmo;
    this.player.anim.speed = 0;
    this.enemy.anim.speed = 0;
    this.popup((this.player.x + this.enemy.x) / 2, this.player.y - 150, "CLASH!", "#ffffff");
    this.sfx.clash(0.9);
    this.vfx.play(FX.sparkParry, (this.player.x + this.enemy.x) / 2, this.player.y - 55, { scale: 1.8 });
    this.note("clashStart", { need });
  }

  private playerInStrike() {
    const a = this.p.atk!, f = this.player.anim.frame;
    return f >= a.hits[0].a - 2 && f <= a.hits[a.hits.length - 1].b + 1;
  }

  private qteInput(press: { attack: boolean; guard: boolean; roll: boolean }) {
    if (this.qteKind === "deathblow" && this.qte) {
      for (const [on, key] of [[press.attack, "J"], [press.guard, "K"], [press.roll, "L"]] as [boolean, string][]) {
        if (!on) continue;
        const g = this.qte.press(key);
        if (g) {
          this.popup(this.player.x, this.player.y - 140, g.toUpperCase(), g === "perfect" ? "#ffd166" : g === "good" ? "#a5d6a7" : "#ff6b6b");
          this.note("qtePress", { key, grade: g });
          if (g === "miss") this.sfx.locked();
          else this.sfx.spirit();
        }
      }
    } else if (this.qteKind === "clash" && this.mash && press.attack) this.mash.press();
  }

  private updateQte(raw: number) {
    if (this.qte && this.qteKind === "deathblow") {
      this.qte.update(raw);
      if (this.qte.done) this.finishDeathblow();
    } else if (this.mash && this.qteKind === "clash") {
      this.mash.update(raw);
      if (this.mash.done) this.finishClash();
    }
  }

  private finishDeathblow() {
    const q = this.qte!, p = this.p, e = this.e;
    const sum = q.summary;
    this.qte = null;
    this.qteKind = null;
    this.timeScale = 1;
    const dmg = Math.round(this.boss.hp * DEATHBLOW.damage[sum.grade as DeathblowGrade]);
    e.hp = Math.max(0, e.hp - dmg);
    e.posture = 0;
    e.lastHitAt = this.now;
    p.spirit = Math.min(HERO.spirit, p.spirit + (sum.grade === "execute" ? 2 : sum.grade === "clean" ? 1 : 0));
    const clip = sum.grade === "execute" ? { sheet: "fk_3_atk", from: 16, to: 27, fps: 20 } : sum.grade === "clean" ? { sheet: "fk_2_atk", from: 7, to: 15, fps: 22 } : { sheet: "fk_1_atk", from: 0, to: 6, fps: 22 };
    p.mode = "attack";
    p.recovering = true;
    p.queued = false;
    p.atk = { id: "FINISH", clip, hits: [{ a: 99, b: 99, dmg: 0, posture: 0, reach: 0 }], chainFrom: 99, lunge: 0 };
    this.player.play(clip, { onDone: () => ((p.mode = "free"), (p.atk = null), (p.recovering = false)) });
    const y = this.enemy.y - 60;
    this.vfx.play(sum.grade === "execute" ? FX_EXTRA.burst : FX.sparkHit, this.enemy.x, y, { scale: sum.grade === "execute" ? 2.2 : 1.6, add: sum.grade === "execute" });
    this.enemy.hitFlash(140);
    this.hitstop = sum.grade === "execute" ? 240 : 140;
    if (sum.grade === "execute") this.sfx.deathblow();
    else this.sfx.hit(true);
    this.shake(sum.grade === "execute" ? 0.012 : 0.006, 220);
    this.popup(this.enemy.x, this.enemy.y - 150, (sum.grade === "execute" ? "EXECUTE " : sum.grade === "clean" ? "DEATHBLOW " : "scuffed ") + dmg, sum.grade === "scuffed" ? "#ff9f43" : "#ff5d5d");
    this.note("deathblow", { grade: sum.grade, dmg, perfect: sum.perfect, good: sum.good, miss: sum.miss });
    if (e.hp <= 0) return this.killEnemy();
    e.mode = "flinch";
    e.poiseUntil = this.now + 1400;
    this.enemy.play(this.boss.clips.hit, { onDone: () => e.mode === "flinch" && ((e.mode = "idle"), (e.thinkAt = this.now + 500)) });
  }

  private finishClash() {
    const m = this.mash!, c = this.pendingClash!, p = this.p;
    const won = m.won;
    this.mash = null;
    this.qteKind = null;
    this.pendingClash = null;
    this.timeScale = 1;
    this.player.anim.speed = 1;
    this.enemy.anim.speed = 1;
    this.note("clashEnd", { won, count: m.count });
    if (won) {
      p.mode = "attack"; // the swing resumes
      this.reverseEnemy(c.a, c.h, CLASH.enemyPosture + c.h.posture);
      p.spirit = Math.min(HERO.spirit, p.spirit + 1);
      this.vfx.play(FX.sparkHit, this.enemy.x, this.enemy.y - 60, { scale: 1.8 });
      this.popup(this.player.x, this.player.y - 140, "CLASH WON", "#ffd166");
      this.sfx.deflect();
    } else {
      const dmg = Math.round(this.bdmg(c.h) * CLASH.lossDamageFraction);
      p.hp = Math.max(0, p.hp - dmg);
      p.posture = Math.min(HERO.posture, p.posture + CLASH.lossPostureHero);
      p.lastHitAt = this.now;
      p.atk = null;
      p.chain = 0;
      p.dash += -this.player.face * 30;
      this.popup(this.player.x, this.player.y - 140, "CLASH LOST " + dmg, "#ff6b6b");
      this.shake(0.005, 120);
      if (p.hp <= 0) return this.killPlayer();
      p.mode = "hurt";
      p.hurtUntil = this.now + HERO.hurtMs;
      p.invulnUntil = this.now + HERO.hurtInvulnMs;
      this.player.play(HERO_CLIPS.hurt);
    }
  }

  // ---------------------------------------------------------------- big state changes
  private breakEnemy() {
    const e = this.e;
    e.mode = "broken";
    e.brokenUntil = this.now + ENEMY.brokenMs;
    e.posture = ENEMY.posture;
    e.atk = null;
    this.enemy.play(this.boss.clips.broken, { loop: true });
    this.popup(this.enemy.x, this.enemy.y - 150, "POSTURE BROKEN", "#ff9f43");
    this.sfx.postureBreak();
    this.note("enemyBroken");
  }
  private breakPlayer() {
    const p = this.p;
    p.mode = "hurt";
    p.def.guarding = false;
    p.hurtUntil = this.now + 1400;
    p.posture = 45;
    this.player.play(HERO_CLIPS.hurt);
    this.popup(this.player.x, this.player.y - 150, "POSTURE BROKEN", "#ff9f43");
    this.sfx.postureBreak();
    this.note("playerBroken");
  }
  private killEnemy() {
    this.e.mode = "dead";
    this.enemy.play(this.boss.clips.death);
    this.popup(this.enemy.x, this.enemy.y - 150, "VICTORY  (N: next)", "#ffd166");
    this.sfx.deathblow();
    this.endFight(true);
    this.note("enemyDead");
  }
  private killPlayer() {
    this.p.mode = "dead";
    this.p.def.guarding = false;
    this.player.play(HERO_CLIPS.death);
    this.popup(this.player.x, this.player.y - 150, "YOU DIED (R)", "#ff6b6b");
    this.sfx.hurt();
    this.endFight(false);
    this.note("playerDead");
  }

  // ---------------------------------------------------------------- feedback
  private shake(intensity: number, ms: number) {
    if (!this.settings.shake) return;
    this.cameras.main.shake(ms, intensity);
  }
  private popup(x: number, y: number, text: string, color: string) {
    const t = this.add.text(x, y, text, { fontFamily: "monospace", fontSize: "18px", color, stroke: "#000", strokeThickness: 3 }).setOrigin(0.5).setDepth(2200);
    this.tweens.add({ targets: t, y: y - 34, alpha: 0, duration: 900, onComplete: () => t.destroy() });
  }

  /** Static HUD art from the UI pack (immunitys), drawn once: dark nine-slice plates behind the bars, a parchment banner for the boss name. */
  private buildHudPlates() {
    const mk = (o: Phaser.GameObjects.GameObject) => (this.hudObjects.push(o), o);
    const ns = (x: number, y: number, w: number, h: number, ox = 0, oy = 0) =>
      mk(this.add.nineslice(x, y, "ui_30", undefined, w, h, 10, 10, 10, 10).setOrigin(ox, oy).setScale(2).setDepth(1990)) as Phaser.GameObjects.NineSlice;
    ns(16, VIEW_H - 92, 150, 38);                         // player plate (screen 300 x 76)
    ns(VIEW_W / 2, 60, 230, 24, 0.5, 0);                  // boss plate (screen 460 x 48)
    mk(this.add.image(VIEW_W / 2, 2, "ui_44").setOrigin(0.5, 0).setScale(1.7).setDepth(1991)); // parchment strip for the name
    this.pips = [];
    // the skill bar: three fire skills beside the player plate (key, cost, icon)
    const defs = [
      { action: "skill" as const, base: 2, sheet: "fire_02_explosion_spritesheet", frame: 3 },
      { action: "bolt" as const, base: BOLT.cost, sheet: "fire_spell_firebolt_spritesheet", frame: 1 },
      { action: "nova" as const, base: NOVA.cost, sheet: "fire_02_explosion_2_spritesheet", frame: 8 },
    ];
    this.slots = defs.map((d, i) => {
      const x = 328 + i * 58, y = VIEW_H - 84;
      ns(x, y, 26, 26); // nine-slice panel (drawn at 2x)
      const icon = mk(this.add.image(x + 26, y + 26, d.sheet, d.frame).setScale(1.15).setDepth(2001)) as Phaser.GameObjects.Image;
      const key = mk(this.add.text(x + 5, y + 3, "", { fontFamily: "monospace", fontSize: "11px", color: "#ffe9b0", stroke: "#000", strokeThickness: 3 }).setDepth(2002)) as Phaser.GameObjects.Text;
      const cost = mk(this.add.text(x + 47, y + 36, "", { fontFamily: "monospace", fontSize: "12px", color: "#8fd0ff", stroke: "#000", strokeThickness: 3 }).setOrigin(1, 0).setDepth(2002)) as Phaser.GameObjects.Text;
      return { action: d.action, base: d.base, icon, key, cost };
    });
    for (let i = 0; i < HERO.spirit; i++) this.pips.push(mk(this.add.image(36 + i * 28, VIEW_H - 51, "ui_37").setOrigin(0, 0).setScale(1.1).setDepth(2001)) as Phaser.GameObjects.Image);
  }

  private drawHud() {
    const g = this.hud, p = this.p, e = this.e;
    g.clear();
    // easing "damage trail" behind each health bar: drops slowly to the real value, jumps up at once
    const tr = this.trail, hpP = p.hp / HERO.hp, hpE = e.hp / this.boss.hp;
    tr.p = hpP >= tr.p ? hpP : Math.max(hpP, tr.p - 0.0035);
    tr.e = hpE >= tr.e ? hpE : Math.max(hpE, tr.e - 0.0035);
    const bar = (x: number, y: number, w: number, h: number, v: number, color: number, trail?: number) => {
      g.fillStyle(0x140e08, 1).fillRect(x - 2, y - 2, w + 4, h + 4);
      g.fillStyle(0x2a1d12, 1).fillRect(x, y, w, h);
      if (trail !== undefined && trail > v) g.fillStyle(0xf2e6c4, 0.85).fillRect(x, y, w * Math.min(1, trail), h);
      const fw = Math.max(0, w * Math.min(1, v));
      g.fillStyle(color, 1).fillRect(x, y, fw, h);
      g.fillStyle(0xffffff, 0.22).fillRect(x, y, fw, Math.max(1, Math.floor(h / 4)));
    };
    const pbx = 34, pby = VIEW_H - 80;
    bar(pbx, pby, 264, 12, hpP, 0xd1453b, tr.p);
    bar(pbx, pby + 18, 264, 6, p.posture / HERO.posture, p.mode === "hurt" && p.posture >= 44 ? 0xff9f43 : 0xe3b341);
    bar(VIEW_W / 2 - 210, 74, 420, 12, hpE, 0xb02a37, tr.e);
    bar(VIEW_W / 2 - 210, 92, 420, 6, e.posture / ENEMY.posture, e.mode === "broken" ? 0xff5d5d : 0xe3b341);
    // skill bar: dim what the spirit cannot pay for, show the bound key and the cost, sweep a cooldown over the icon
    this.slots.forEach((sl, i) => {
      const cost = this.skillCost(sl.base), ok = p.spirit >= cost;
      sl.icon.setAlpha(ok ? 1 : 0.3);
      sl.key.setText(this.inp.label(sl.action));
      sl.cost.setText(String(cost)).setColor(ok ? "#8fd0ff" : "#8a8a8a");
      const cdUntil = sl.action === "bolt" ? p.boltCdUntil : sl.action === "nova" ? p.novaCdUntil : 0;
      const cdTotal = sl.action === "bolt" ? BOLT.cdMs : NOVA.cdMs;
      const frac = Math.max(0, Math.min(1, (cdUntil - this.now) / cdTotal));
      if (frac > 0) g.fillStyle(0x000000, 0.55).fillRect(328 + i * 58 + 4, VIEW_H - 84 + 4 + 44 * (1 - frac), 44, 44 * frac);
    });
    // phase 2 notch on the boss bar
    g.fillStyle(0xf2e6c4, 0.9).fillRect(VIEW_W / 2 - 210 + 420 * this.boss.phase2.hpPct - 1, 72, 2, 16);
    // spirit: flame icons, faded until earned
    this.pips.forEach((im, i) => {
      const fill = Math.max(0, Math.min(1, p.spirit - i));
      im.setTexture(fill >= 1 ? "ui_31" : "ui_37").setAlpha(fill >= 1 ? 1 : 0.4 + 0.6 * fill);
      if (fill >= 1) im.setTint(0x8fd0ff);
      else im.clearTint();
    });
    // perilous telegraph ring closing on the enemy; white inside the counter window
    if (e.mode === "attack" && e.atk?.perilous && this.now < e.strikeAt) {
      const left = e.strikeAt - this.now;
      const total = (e.atk.clip.holds ? Object.values(e.atk.clip.holds).reduce((a, b) => a + b, 0) : 800) + 200;
      const r = 16 + 56 * Math.min(1, left / total);
      const inWin = left <= HERO.counterMs;
      const sweepRing = e.atk.hits.some((h) => h.kind === "sweep");
      g.lineStyle(3, inWin ? 0xffffff : sweepRing ? 0xffd23f : 0xff3b3b, 1).strokeCircle(this.enemy.x, this.enemy.y - 55, r);
      g.lineStyle(1, 0xff3b3b, 0.6).strokeCircle(this.enemy.x, this.enemy.y - 55, 16);
    }
    // QTE overlay
    const q = this.qte, m = this.mash;
    this.texts.qtekey.setText("");
    this.texts.qtemsg.setText("");
    if (q && q.current) {
      const c = q.current, cx = VIEW_W / 2, cy = 190;
      const r = 20 + 60 * Math.max(0, 1 - q.t / c.windowMs);
      const err = Math.abs(q.t - c.windowMs);
      const col = err <= q.perfectMs ? 0xffd166 : err <= q.goodMs ? 0xa5d6a7 : 0xffffff;
      g.fillStyle(0x000000, 0.6).fillCircle(cx, cy, 24);
      g.lineStyle(4, col, 1).strokeCircle(cx, cy, r);
      g.lineStyle(2, 0x888888, 1).strokeCircle(cx, cy, 20);
      this.texts.qtekey.setPosition(cx, cy - 20).setText(this.inp.label(QTE_ACTION[c.key] ?? "attack"));
      q.prompts.forEach((_, i) => {
        const gr = q.grades[i];
        g.fillStyle(gr === "perfect" ? 0xffd166 : gr === "good" ? 0xa5d6a7 : gr === "miss" ? 0xff6b6b : i === q.i ? 0xffffff : 0x555555, 1).fillCircle(cx - 24 + i * 24, cy + 52, 5);
      });
      this.texts.qtemsg.setText("DEATHBLOW: press the key as the ring closes");
    }
    if (m) {
      const cx = VIEW_W / 2, cy = 190;
      g.fillStyle(0x000000, 0.6).fillRect(cx - 82, cy - 8, 164, 22);
      g.fillStyle(0xffd166, 1).fillRect(cx - 80, cy - 6, 160 * Math.min(1, m.count / Math.max(1, m.need)), 18);
      this.texts.qtemsg.setText("CLASH: mash J!");
    }
    this.texts.enemyName.setText(this.boss.name);
    this.texts.enemyTitle.setText(this.boss.title);
    this.texts.help.setAlpha(Phaser.Math.Clamp(1 - (this.now - 9000) / 3000, 0, 1) * (this.mode === "play" ? 1 : 0));
    this.texts.combo.setText(p.chain > 1 ? `x${p.chain}` : "");
    if (this.dev) this.texts.debug.setText(`p:${p.mode} chain:${p.chain} hp:${Math.round(p.hp)} post:${Math.round(p.posture)} | e:${e.mode} hp:${e.hp} post:${Math.round(e.posture)} ai:${e.auto} | ${this.player.anim.sheet}#${this.player.anim.frame}`);
  }
}
