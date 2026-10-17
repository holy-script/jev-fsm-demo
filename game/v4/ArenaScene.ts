import * as Phaser from "phaser";
import { chip, inReach, pressGuard, resolveEnemyHit, type Defender, type Outcome } from "./combat";
import {
  CLASH, COUNTER, DEATHBLOW, ENEMY, GATE_WAIT, FX, FX_EXTRA, HERO, HERO_ATTACKS, HERO_CLIPS, SCALE, SKILLS, VIEW_H, VIEW_W,
  type EnemyAttack, type HitDef, type PlayerAttack,
} from "./data";
import { AREAS } from "./areas";
import { AreaView } from "./world";
import { BOSSES, ENCOUNTERS, GENERIC_ACTIONS, type BossDef } from "./bosses";
import { BossBrain, Telemetry, type Decision, type Snapshot } from "./brain";
import { Fighter } from "./fighter";
import { Sfx } from "./sfx";
import { addRecord, loadStats, saveStats, type BrainTag, type FightRecord } from "./stats";
import { deleteSave, loadSave, newRun, writeSave, type RunSave } from "./save";
import { GameInput, type InputFrame } from "./input";
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

type PMode = "free" | "attack" | "guard" | "roll" | "hurt" | "dead" | "qte";
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
  dev = false;

  p = {
    hp: HERO.hp, posture: 0, mode: "free" as PMode, chain: 0, atk: null as PlayerAttack | null, hitDone: [] as boolean[],
    queued: false, earlyAt: -1e9, recovering: false, dash: 0, invulnUntil: 0, rollStart: 0, rollCdUntil: 0, rollDir: { x: 1, y: 0 },
    hurtUntil: 0, lastHitAt: -1e9, riposteUntil: 0, spirit: 0, counterAt: -1e9, def: { guarding: false, guardPressedAt: -1e9, noDeflect: false, invulnerable: false } as Defender,
  };
  e = {
    hp: 160, posture: 0, mode: "idle" as EMode, auto: true, atk: null as EnemyAttack | null, hitDone: [] as boolean[], thinkAt: 0,
    cd: {} as Record<string, number>, action: null as { id: string; until: number } | null, lastActions: [] as string[], gate: null as { a: EnemyAttack; startedAt: number; decision: string | null; token: number } | null, resumeAt: 0, feinting: false, phase2: false, recoilUntil: 0, brokenUntil: 0, poiseUntil: 0, lastHitAt: -1e9, dash: 0, reverseFrames: 0, reversedAttack: "", strikeAt: 0,
  };

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  area?: AreaView;
  private hud!: Phaser.GameObjects.Graphics;
  private texts: Record<string, Phaser.GameObjects.Text> = {};
  sfx!: Sfx;
  /** menu: title backdrop (no input, AI idle, HUD hidden); play: the fight */
  mode: "menu" | "play" = "play";
  run: RunSave | null = null;
  private fight = { brain: "jev" as BrainTag, mixed: false, hp0: 100 };
  inp!: GameInput;
  frame!: InputFrame;
  private manifest!: ArenaManifest;
  boss!: BossDef;
  brain!: BossBrain;
  telemetry = new Telemetry();
  memory: MemoryStore = {};
  hooks?: ArenaHooks;
  private gateToken = 0;
  private standingStill = 0;
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
    this.hooks = this.registry.get("hooks") as ArenaHooks | undefined;
    this.memory = loadMemory();
    this.brain = new BossBrain({ onDecision: (d) => this.onDecision(d) });
    this.player = new Fighter(this, "fk", this.manifest.sheets, HERO.radius);
    this.boss = BOSSES[new URLSearchParams(window.location.search).get("boss") ?? "mb"] ?? BOSSES.mb;
    this.sfx = new Sfx(this, this.manifest, () => this.settings);
    this.buildArea();
    this.enemy = this.makeEnemy();
    this.hud = this.add.graphics().setDepth(2000);
    this.inp = new GameInput(this, this.settings.keymap);
    this.frame = this.inp.poll();
    const K = Phaser.Input.Keyboard.KeyCodes;
    const kb = this.input.keyboard!;
    this.keys = Object.fromEntries(Object.entries({ P: K.P, O: K.O, I: K.I, R: K.R, F: K.F, N: K.N }).map(([n, c]) => [n, kb.addKey(c)]));
    const t = (k: string, x: number, y: number, size = 14, color = "#e6edf3", origin = 0) => (this.texts[k] = this.add.text(x, y, "", { fontFamily: "monospace", fontSize: size + "px", color }).setDepth(2100).setOrigin(origin, 0));
    t("enemyName", VIEW_W / 2, 18, 14, "#e6edf3", 0.5);
    t("combo", 40, VIEW_H - 120, 22, "#ffd166");
    t("help", 12, VIEW_H - 22, 11, "#8b949e");
    t("debug", 12, 8, 11, "#58a6ff");
    t("qtekey", VIEW_W / 2, 150, 34, "#ffffff", 0.5);
    t("qtemsg", VIEW_W / 2, 110, 16, "#ffd166", 0.5);
    this.texts.help.setText("WASD move   J/click attack (press again in the chain window)   Space guard (tap just before a hit = PARRY)   Shift roll   E flame burst (2 spirit)" + (this.dev ? "   P ai  O/I enemy attacks  R reset" : "   R reset"));
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
    if (process.env.NODE_ENV !== "production") (window as unknown as { __areas?: typeof AREAS }).__areas = AREAS;
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
    Object.assign(this.p.def, { guarding: false, guardPressedAt: -1e9, noDeflect: false, invulnerable: false });
    Object.assign(this.e, { hp: this.boss.hp, posture: 0, mode: "idle", atk: null, hitDone: [], thinkAt: 1200, cd: {}, recoilUntil: 0, brokenUntil: 0, poiseUntil: 0, lastHitAt: -1e9, dash: 0, reverseFrames: 0, reversedAttack: "", strikeAt: 0, action: null, lastActions: [], gate: null, resumeAt: 0, feinting: false, phase2: false });
    this.telemetry.reset();
    this.brain.reset();
    this.brain.mode = this.settings.brain; // every new fight starts on the brain chosen in Settings (F still swaps it mid-fight)
    this.fight = { brain: this.brain.mode, mixed: false, hp0: HERO.hp };
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
    if (this.mode === "menu") this.frame = { dir: { x: 0, y: 0, any: false }, attack: false, guard: false, roll: false, skill: false, guardHeld: false, pause: false, pad: false };
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
    this.separate();
    this.player.tick(dt);
    this.enemy.tick(dt);
    this.area?.update(raw);
    this.updateQte(raw);
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
    const press = { attack: this.frame.attack, guard: this.frame.guard, roll: this.frame.roll, skill: this.frame.skill };
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
    p.def.invulnerable = this.now < p.invulnUntil || (p.mode === "roll" && rollT >= HERO.rollIFrames[0] && rollT <= HERO.rollIFrames[1]);
    if (this.e.mode !== "dead" && p.mode !== "dead") f.face = this.enemy.x >= f.x ? 1 : -1;
    if (this.now - p.lastHitAt > HERO.postureRegenDelayMs && p.mode !== "hurt") p.posture = Math.max(0, p.posture - (HERO.postureRegen * (p.def.guarding ? 0.5 : 1) * dt) / 1000);
    this.burn(f, p, dt);
    if (p.mode === "dead") return;
    if (p.mode === "qte") return this.qteInput(press);
    const dir = this.dirInput();

    switch (p.mode) {
      case "free": {
        this.standingStill = this.dirInput().any ? 0 : this.standingStill + dt;
        if (press.roll && this.now >= p.rollCdUntil) return this.startRoll(dir);
        if (press.guard) return this.startGuard();
        if (press.skill) return this.startSkill("FLAME");
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
    }
  }

  private startSkill(id: string) {
    const p = this.p, sk = SKILLS[id];
    if (p.spirit < sk.cost || this.e.mode === "dead") return;
    p.spirit -= sk.cost;
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
      if (inReach(this.player.x, this.player.y, this.player.face, this.enemy.x, this.enemy.y, h.reach, h.band ?? 38, this.boss.radius)) {
        p.hitDone[i] = true;
        this.playerHitsEnemy(a, h, i);
      }
    });
  }

  private playerHitsEnemy(a: PlayerAttack, h: HitDef, i: number) {
    const e = this.e;
    const broken = e.mode === "broken";
    const riposte = this.now < this.p.riposteUntil;
    let dmg = h.dmg * (riposte ? 1.5 : 1);
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
    if (a.id === "FLAME") this.vfx.play(FX_EXTRA.burst, this.enemy.x, this.enemy.y - 20, { scale: 1.6, add: true });
    this.note("playerHit", { id: a.id, hit: i, dmg, broken, riposte, chain: this.p.chain });
    if (broken) {
      e.posture = 0;
      e.mode = "idle";
      e.poiseUntil = this.now + ENEMY.poiseMs;
    } else {
      e.posture = Math.min(100, e.posture + h.posture);
      if (e.posture >= ENEMY.posture) return this.breakEnemy();
    }
    if (e.hp <= 0) return this.killEnemy();
    // flinch unless mid-attack (armoured while swinging) or inside the poise window
    if (e.mode !== "attack" && e.mode !== "broken" && e.mode !== "recoil" && this.now >= e.poiseUntil) {
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
        e.thinkAt = this.now + 500;
      },
    });
    let lead = 0;
    const pi = Math.max(0, a.hits.findIndex((h) => h.kind === "perilous"));
    for (let f = a.clip.from; f < a.hits[pi].a; f++) lead += 1000 / (a.clip.fps ?? 12) + (holds[f] ?? 0);
    e.strikeAt = this.now + lead;
    if (a.perilous) this.sfx.warn("thrust");
    this.popup(this.enemy.x, this.enemy.y - 135, a.perilous ? "!!" : "!", a.perilous ? "#ff3b3b" : "#ff5d5d");
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
          e.thinkAt = this.now + 400;
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

  private enemyHits(a: EnemyAttack, h: HitDef, i: number) {
    const f = this.enemy, p = this.p;
    const inRange = inReach(f.x, f.y, f.face, this.player.x, this.player.y, h.reach, h.band ?? 38, HERO.radius, h.around);
    if (a.clashable && inRange && p.mode === "attack" && p.atk && !p.recovering && this.playerInStrike()) return this.startClash(a, h, i);
    const countered = h.kind === "perilous" && this.now - p.counterAt <= HERO.counterMs;
    const out: Outcome = resolveEnemyHit(p.def, this.now, h, inRange, countered);
    this.note("enemyHit", { id: a.id, hit: i, outcome: out, frame: f.anim.frame });
    this.telemetry.outcome(a.id, out);
    const mid = { x: (this.player.x + f.x) / 2, y: this.player.y - 40 * SCALE * 0.6 };
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
      case "deflected":
        this.reverseEnemy(a, h, h.posture * 1.3);
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
        this.reverseEnemy(a, h, COUNTER.enemyPosture);
        this.vfx.play(FX.sparkParry, this.enemy.x, mid.y, { scale: 2.2, flip: f.face > 0 });
        this.vfx.play(FX_EXTRA.holy, this.enemy.x, mid.y - 10, { scale: 1.4, add: true });
        this.popup(this.player.x, this.player.y - 140, "COUNTER", "#ffd166");
        this.sfx.deflect();
        this.sfx.slip();
        this.telemetry.record("counter", this.now);
        p.spirit = Math.min(HERO.spirit, p.spirit + HERO.spiritCounter);
        break;
      case "blocked": {
        const dmg = chip(h.dmg);
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
        p.hp = Math.max(0, p.hp - h.dmg);
        p.posture = Math.min(HERO.posture, p.posture + h.dmg * HERO.postureHitFraction);
        p.lastHitAt = this.now;
        p.def.guarding = false;
        p.atk = null;
        p.chain = 0;
        p.dash += -this.player.face * 22;
        this.vfx.play(FX.sparkHit, this.player.x, mid.y, { scale: 1.3, flip: f.face > 0 });
        this.player.hitFlash(100, 0xff8888);
        this.hitstop = Math.max(this.hitstop, 80);
        this.shake(0.006, 140);
        this.popup(this.player.x, this.player.y - 130, String(h.dmg), "#ff6b6b");
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
    this.enemy.sprite.destroy();
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

  private onDecision(d: Decision) {
    this.hooks?.onDecision?.(d);
    this.note("decision", { kind: d.kind, choice: d.choice, source: d.source, ms: d.latencyMs, error: d.error });
  }

  setHudVisible(v: boolean) {
    this.hud.setVisible(v);
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
    if (dist > 100 || dy > 35) out.push("APPROACH");
    if (dist < 150) out.push("BACKSTEP");
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
      player: { hpPct: Math.round((p.hp / HERO.hp) * 100), posturePct: Math.round(p.posture), spirit: Math.floor(p.spirit), state: p.mode, distancePx: dist, guardHeld: p.def.guarding, riposteReady: this.now < p.riposteUntil, standingStillMs: Math.round(this.standingStill) },
      recent: this.telemetry.recent(this.now, 8000),
      vsMove: this.telemetry.summary(),
      lastOutcome: this.telemetry.lastOutcome,
      habits: this.telemetry.habits(),
      memory: memoryFor(this.memory, this.boss.id),
      reachable,
      fairness: { perilousStreak: lastTwo.filter(Boolean).length, perilousCapped: lastTwo.length === 2 && lastTwo.every(Boolean) },
    };
    if (this.boss.id === "echo") snap.profile = profile(this.memory);
    if (gate) snap.gate = { move: gate.id, afterHit: gate.gate?.afterHit ?? 0 };
    return snap;
  }

  /** Idle: pick the next action. The answer is requested while the boss is still recovering so it is usually ready when the pause ends. */
  private enemyThink(dt: number) {
    const e = this.e, f = this.enemy;
    const dx = this.player.x - f.x, dy = this.player.y - f.y, dist = Math.abs(dx);
    const spd = this.boss.speed * (this.phase() === 2 ? this.boss.phase2.speed : 1);
    // an ongoing walk / wait / backstep
    if (e.action) {
      const act = e.action;
      if (act.id === "APPROACH") {
        const m = Math.hypot(dx, dy) || 1;
        this.step(f, dist > 90 ? ((dx / m) * spd * dt) / 1000 : 0, ((dy / m) * spd * 0.6 * dt) / 1000);
        f.ensure(this.boss.clips.run);
        if ((dist <= 100 && Math.abs(dy) <= 30) || this.now >= act.until) e.action = null;
      } else if (act.id === "BACKSTEP") {
        this.step(f, (-Math.sign(dx) * spd * 0.9 * dt) / 1000, 0);
        f.ensure(this.boss.clips.run);
        if (this.now >= act.until) e.action = null;
      } else {
        f.ensure(this.boss.clips.idle);
        if (this.now >= act.until) e.action = null;
      }
      if (!e.action) e.thinkAt = this.now + 150;
      return;
    }
    f.ensure(this.boss.clips.idle);
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
    const ms = d.choice === "APPROACH" ? 1600 : d.choice === "BACKSTEP" ? 450 : 650;
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
    const dmg = DEATHBLOW.damage[sum.grade as DeathblowGrade];
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
      const dmg = Math.round(c.h.dmg * CLASH.lossDamageFraction);
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

  private drawHud() {
    const g = this.hud, p = this.p, e = this.e;
    g.clear();
    const bar = (x: number, y: number, w: number, h: number, v: number, color: number) => {
      g.fillStyle(0x000000, 0.65).fillRect(x - 2, y - 2, w + 4, h + 4);
      g.fillStyle(color, 1).fillRect(x, y, Math.max(0, w * Math.min(1, v)), h);
    };
    bar(40, VIEW_H - 80, 260, 12, p.hp / HERO.hp, 0xd1453b);
    bar(40, VIEW_H - 62, 260, 6, p.posture / HERO.posture, p.mode === "hurt" && p.posture >= 44 ? 0xff9f43 : 0xe3b341);
    bar(VIEW_W / 2 - 200, 40, 400, 12, e.hp / this.boss.hp, 0xb02a37);
    bar(VIEW_W / 2 - 200, 58, 400, 6, e.posture / ENEMY.posture, e.mode === "broken" ? 0xff5d5d : 0xe3b341);
    // spirit pips
    for (let i = 0; i < HERO.spirit; i++) {
      const fill = Math.max(0, Math.min(1, p.spirit - i));
      g.fillStyle(0x000000, 0.65).fillRect(40 + i * 22 - 1, VIEW_H - 48 - 1, 18, 10);
      g.fillStyle(0x58a6ff, 1).fillRect(40 + i * 22, VIEW_H - 48, 16 * fill, 8);
    }
    // perilous telegraph ring closing on the enemy; white inside the counter window
    if (e.mode === "attack" && e.atk?.perilous && this.now < e.strikeAt) {
      const left = e.strikeAt - this.now;
      const total = (e.atk.clip.holds ? Object.values(e.atk.clip.holds).reduce((a, b) => a + b, 0) : 800) + 200;
      const r = 16 + 56 * Math.min(1, left / total);
      const inWin = left <= HERO.counterMs;
      g.lineStyle(3, inWin ? 0xffffff : 0xff3b3b, 1).strokeCircle(this.enemy.x, this.enemy.y - 55, r);
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
    this.texts.enemyName.setText(`${this.boss.name}, ${this.boss.title}`);
    this.texts.combo.setText(p.chain > 1 ? `x${p.chain}` : "");
    if (this.dev) this.texts.debug.setText(`p:${p.mode} chain:${p.chain} hp:${Math.round(p.hp)} post:${Math.round(p.posture)} | e:${e.mode} hp:${e.hp} post:${Math.round(e.posture)} ai:${e.auto} | ${this.player.anim.sheet}#${this.player.anim.frame}`);
  }
}
