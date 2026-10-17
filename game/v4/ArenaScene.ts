import * as Phaser from "phaser";
import { chip, inReach, pressGuard, resolveEnemyHit, type Defender, type Outcome } from "./combat";
import {
  CLASH, COUNTER, DEATHBLOW, ENEMY, ENEMY_ATTACKS, FX, FX_EXTRA, HERO, HERO_ATTACKS, HERO_CLIPS, SCALE, SKILLS, VIEW_H, VIEW_W,
  type EnemyAttack, type HitDef, type PlayerAttack,
} from "./data";
import { Fighter } from "./fighter";
import { MashRun, QteRun, type DeathblowGrade } from "./qte";
import { loadSettings, type ArenaSettings } from "./settings";
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
    hp: ENEMY.hp, posture: 0, mode: "idle" as EMode, auto: true, atk: null as EnemyAttack | null, hitDone: [] as boolean[], thinkAt: 0,
    cd: {} as Record<string, number>, recoilUntil: 0, brokenUntil: 0, poiseUntil: 0, lastHitAt: -1e9, dash: 0, reverseFrames: 0, reversedAttack: "", strikeAt: 0,
  };

  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private gfx!: Phaser.GameObjects.Graphics;
  private hud!: Phaser.GameObjects.Graphics;
  private texts: Record<string, Phaser.GameObjects.Text> = {};
  private clickQueued = false;
  private manifest!: ArenaManifest;

  constructor() {
    super("arena");
  }

  create() {
    this.manifest = this.registry.get("manifest") as ArenaManifest;
    this.dev = new URLSearchParams(window.location.search).has("dev");
    this.settings = loadSettings();
    this.cameras.main.setBackgroundColor("#101a14");
    this.gfx = this.add.graphics().setDepth(0);
    this.drawFloor();
    this.vfx = new Vfx(this, this.manifest.vfx);
    this.player = new Fighter(this, "fk", this.manifest.sheets, HERO.radius);
    this.enemy = new Fighter(this, "mb", this.manifest.sheets, ENEMY.radius);
    this.hud = this.add.graphics().setDepth(2000);
    const K = Phaser.Input.Keyboard.KeyCodes;
    const kb = this.input.keyboard!;
    this.keys = Object.fromEntries(
      Object.entries({ W: K.W, A: K.A, S: K.S, D: K.D, UP: K.UP, DOWN: K.DOWN, LEFT: K.LEFT, RIGHT: K.RIGHT, J: K.J, K: K.K, SPACE: K.SPACE, SHIFT: K.SHIFT, L: K.L, E: K.E, P: K.P, O: K.O, I: K.I, R: K.R }).map(([n, c]) => [n, kb.addKey(c)]),
    );
    kb.addCapture("SPACE,UP,DOWN,LEFT,RIGHT");
    this.input.on("pointerdown", () => (this.clickQueued = true));
    const t = (k: string, x: number, y: number, size = 14, color = "#e6edf3", origin = 0) => (this.texts[k] = this.add.text(x, y, "", { fontFamily: "monospace", fontSize: size + "px", color }).setDepth(2100).setOrigin(origin, 0));
    t("enemyName", VIEW_W / 2, 18, 14, "#e6edf3", 0.5);
    t("combo", 40, VIEW_H - 120, 22, "#ffd166");
    t("help", 12, VIEW_H - 22, 11, "#8b949e");
    t("debug", 12, 8, 11, "#58a6ff");
    t("qtekey", VIEW_W / 2, 150, 34, "#ffffff", 0.5);
    t("qtemsg", VIEW_W / 2, 110, 16, "#ffd166", 0.5);
    this.texts.help.setText("WASD move   J/click attack (press again in the chain window)   Space guard (tap just before a hit = PARRY)   Shift roll   E flame burst (2 spirit)" + (this.dev ? "   P ai  O/I enemy attacks  R reset" : "   R reset"));
    this.reset();
    if (process.env.NODE_ENV !== "production") (window as unknown as { __arena?: ArenaScene }).__arena = this;
  }

  private drawFloor() {
    const g = this.gfx;
    g.fillStyle(0x16261c, 1).fillRect(0, 0, VIEW_W, VIEW_H);
    g.fillStyle(0x24382a, 1).fillRect(FLOOR.l - 40, FLOOR.t - 70, FLOOR.r - FLOOR.l + 80, FLOOR.b - FLOOR.t + 90);
    g.lineStyle(1, 0x2f4a38, 1);
    for (let x = FLOOR.l - 40; x <= FLOOR.r + 40; x += 64) g.lineBetween(x, FLOOR.t - 70, x, FLOOR.b + 20);
    for (let y = FLOOR.t - 70; y <= FLOOR.b + 20; y += 64) g.lineBetween(FLOOR.l - 40, y, FLOOR.r + 40, y);
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
    Object.assign(this.e, { hp: ENEMY.hp, posture: 0, mode: "idle", atk: null, hitDone: [], thinkAt: 1200, cd: {}, recoilUntil: 0, brokenUntil: 0, poiseUntil: 0, lastHitAt: -1e9, dash: 0, reverseFrames: 0, reversedAttack: "", strikeAt: 0 });
    this.player.x = 330;
    this.player.y = 400;
    this.player.face = 1;
    this.enemy.x = 620;
    this.enemy.y = 400;
    this.enemy.face = -1;
    this.player.sprite.clearTint();
    this.enemy.sprite.clearTint();
    this.player.play({ ...HERO_CLIPS.idle }, { loop: true });
    this.enemy.play({ ...ENEMY.clips.idle }, { loop: true });
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
    if (Phaser.Input.Keyboard.JustDown(this.keys.R)) this.reset();
    if (Phaser.Input.Keyboard.JustDown(this.keys.P)) this.e.auto = !this.e.auto;
    if (Phaser.Input.Keyboard.JustDown(this.keys.O)) this.forceEnemyAttack("SLASH");
    if (Phaser.Input.Keyboard.JustDown(this.keys.I)) this.forceEnemyAttack("TWIN");
    this.updatePlayer(dt);
    this.updateEnemy(dt);
    this.separate();
    this.player.tick(dt);
    this.enemy.tick(dt);
    this.updateQte(raw);
    this.drawHud();
  }

  private dirInput() {
    const k = this.keys;
    const x = (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
    const y = (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);
    const m = Math.hypot(x, y) || 1;
    return { x: x / m, y: y / m, any: x !== 0 || y !== 0 };
  }

  private step(f: Fighter, dx: number, dy: number) {
    f.x = Phaser.Math.Clamp(f.x + dx, FLOOR.l, FLOOR.r);
    f.y = Phaser.Math.Clamp(f.y + dy, FLOOR.t, FLOOR.b);
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
    const min = HERO.radius + ENEMY.radius;
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
    const press = {
      attack: Phaser.Input.Keyboard.JustDown(this.keys.J) || this.clickQueued,
      guard: Phaser.Input.Keyboard.JustDown(this.keys.SPACE) || Phaser.Input.Keyboard.JustDown(this.keys.K),
      roll: Phaser.Input.Keyboard.JustDown(this.keys.SHIFT) || Phaser.Input.Keyboard.JustDown(this.keys.L),
      skill: Phaser.Input.Keyboard.JustDown(this.keys.E),
    };
    if (press.attack) p.counterAt = this.now; // a perilous strike landing within COUNTER ms of this is countered
    this.clickQueued = false;
    const guardHeld = this.keys.SPACE.isDown || this.keys.K.isDown;
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
    this.player.play(HERO_CLIPS.roll);
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
    this.note("attack", { id, chain: p.chain });
  }

  /** Do not lunge through the enemy. */
  private reachableLunge(px: number) {
    const gap = Math.abs(this.enemy.x - this.player.x) - (HERO.radius + ENEMY.radius);
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
      if (inReach(this.player.x, this.player.y, this.player.face, this.enemy.x, this.enemy.y, h.reach, h.band ?? 38, ENEMY.radius)) {
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
      this.enemy.play(ENEMY.clips.hit, { onDone: () => e.mode === "flinch" && ((e.mode = "idle"), (e.thinkAt = this.now + 300)) });
    }
    e.dash += this.player.face * (h.kind === "heavy" ? 26 : 8);
  }

  // ---------------------------------------------------------------- enemy
  forceEnemyAttack(id: string) {
    if (this.e.mode === "dead" || this.e.mode === "broken") return;
    this.startEnemyAttack(ENEMY_ATTACKS[id]);
  }

  private startEnemyAttack(a: EnemyAttack) {
    const e = this.e;
    e.mode = "attack";
    e.atk = a;
    e.hitDone = a.hits.map(() => false);
    e.cd[a.id] = this.now + a.cooldownMs;
    this.enemy.face = this.player.x >= this.enemy.x ? 1 : -1;
    this.enemy.play(a.clip, {
      onDone: () => {
        if (e.mode !== "attack") return;
        e.mode = "idle";
        e.atk = null;
        e.thinkAt = this.now + 500;
      },
    });
    let lead = 0;
    for (let f = a.clip.from; f < a.hits[0].a; f++) lead += 1000 / (a.clip.fps ?? 12) + (a.clip.holds?.[f] ?? 0);
    e.strikeAt = this.now + lead;
    this.popup(this.enemy.x, this.enemy.y - 135, a.perilous ? "!!" : "!", a.perilous ? "#ff3b3b" : "#ff5d5d");
    this.note("enemyAttack", { id: a.id, strikeAt: Math.round(e.strikeAt) });
  }

  private updateEnemy(dt: number) {
    const e = this.e, f = this.enemy;
    if (this.now - e.lastHitAt > ENEMY.postureRegenDelayMs && e.mode !== "broken") e.posture = Math.max(0, e.posture - (ENEMY.postureRegen * dt) / 1000);
    this.burn(f, e, dt);
    if (e.mode === "dead") return;
    if (e.mode !== "attack" && e.mode !== "recoil" && e.mode !== "broken") f.face = this.player.x >= f.x ? 1 : -1;
    switch (e.mode) {
      case "idle": {
        if (!e.auto || this.p.mode === "dead") {
          f.ensure(ENEMY.clips.idle);
          break;
        }
        const dx = this.player.x - f.x, dy = this.player.y - f.y;
        const dist = Math.abs(dx);
        const choices = Object.values(ENEMY_ATTACKS).filter((a) => dist >= a.range[0] && dist <= a.range[1] && Math.abs(dy) < 40 && this.now >= (e.cd[a.id] ?? 0));
        if (this.now >= e.thinkAt && choices.length) {
          this.startEnemyAttack(choices[Math.floor(Math.random() * choices.length)]);
          break;
        }
        if (dist > 110 || Math.abs(dy) > 30) {
          const m = Math.hypot(dx, dy) || 1;
          this.step(f, dist > 110 ? ((dx / m) * ENEMY.speed * dt) / 1000 : 0, ((dy / m) * ENEMY.speed * 0.6 * dt) / 1000);
          f.ensure(ENEMY.clips.run);
        } else f.ensure(ENEMY.clips.idle);
        break;
      }
      case "attack": {
        const a = e.atk!;
        const frame = f.anim.frame;
        a.hits.forEach((h, i) => {
          if (e.hitDone[i] || frame < h.a) return;
          e.hitDone[i] = true;
          if (i === 0) e.dash += f.face * this.enemyLunge(a.lunge);
          this.enemyHits(a, h, i);
        });
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
    const gap = Math.abs(this.player.x - this.enemy.x) - (HERO.radius + ENEMY.radius);
    return Phaser.Math.Clamp(gap, 0, px);
  }

  private enemyHits(a: EnemyAttack, h: HitDef, i: number) {
    const f = this.enemy, p = this.p;
    const inRange = inReach(f.x, f.y, f.face, this.player.x, this.player.y, h.reach, h.band ?? 38, HERO.radius, h.around);
    if (a.clashable && inRange && p.mode === "attack" && p.atk && !p.recovering && this.playerInStrike()) return this.startClash(a, h, i);
    const countered = a.perilous === true && this.now - p.counterAt <= HERO.counterMs;
    const out: Outcome = resolveEnemyHit(p.def, this.now, h, inRange, countered);
    this.note("enemyHit", { id: a.id, hit: i, outcome: out, frame: f.anim.frame });
    const mid = { x: (this.player.x + f.x) / 2, y: this.player.y - 40 * SCALE * 0.6 };
    switch (out) {
      case "missed":
      case "dodged":
        if (out === "dodged") {
          this.popup(this.player.x, this.player.y - 130, a.perilous ? "SLIP" : "dodge", "#8fd3ff");
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
        p.spirit = Math.min(HERO.spirit, p.spirit + HERO.spiritDeflect);
        break;
      case "countered":
        this.reverseEnemy(a, h, COUNTER.enemyPosture);
        this.vfx.play(FX.sparkParry, this.enemy.x, mid.y, { scale: 2.2, flip: f.face > 0 });
        this.vfx.play(FX_EXTRA.holy, this.enemy.x, mid.y - 10, { scale: 1.4, add: true });
        this.popup(this.player.x, this.player.y - 140, "COUNTER", "#ffd166");
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
      else f.play(ENEMY.clips.broken, { loop: true });
    });
    e.dash += -f.face * 34;
    e.posture = Math.min(100, e.posture + posture);
    e.lastHitAt = this.now;
    p.riposteUntil = this.now + 800;
    this.hitstop = Math.max(this.hitstop, 120);
    this.shake(0.004, 120);
    void h;
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
    this.shake(sum.grade === "execute" ? 0.012 : 0.006, 220);
    this.popup(this.enemy.x, this.enemy.y - 150, (sum.grade === "execute" ? "EXECUTE " : sum.grade === "clean" ? "DEATHBLOW " : "scuffed ") + dmg, sum.grade === "scuffed" ? "#ff9f43" : "#ff5d5d");
    this.note("deathblow", { grade: sum.grade, dmg, perfect: sum.perfect, good: sum.good, miss: sum.miss });
    if (e.hp <= 0) return this.killEnemy();
    e.mode = "flinch";
    e.poiseUntil = this.now + 1400;
    this.enemy.play(ENEMY.clips.hit, { onDone: () => e.mode === "flinch" && ((e.mode = "idle"), (e.thinkAt = this.now + 500)) });
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
    this.enemy.play(ENEMY.clips.broken, { loop: true });
    this.popup(this.enemy.x, this.enemy.y - 150, "POSTURE BROKEN", "#ff9f43");
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
    this.note("playerBroken");
  }
  private killEnemy() {
    this.e.mode = "dead";
    this.enemy.play(ENEMY.clips.death);
    this.popup(this.enemy.x, this.enemy.y - 150, "VICTORY", "#ffd166");
    this.note("enemyDead");
  }
  private killPlayer() {
    this.p.mode = "dead";
    this.p.def.guarding = false;
    this.player.play(HERO_CLIPS.death);
    this.popup(this.player.x, this.player.y - 150, "YOU DIED (R)", "#ff6b6b");
    this.note("playerDead");
  }

  // ---------------------------------------------------------------- feedback
  private shake(intensity: number, ms: number) {
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
    bar(VIEW_W / 2 - 200, 40, 400, 12, e.hp / ENEMY.hp, 0xb02a37);
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
      this.texts.qtekey.setPosition(cx, cy - 20).setText(c.key);
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
    this.texts.enemyName.setText(ENEMY.name);
    this.texts.combo.setText(p.chain > 1 ? `x${p.chain}` : "");
    if (this.dev) this.texts.debug.setText(`p:${p.mode} chain:${p.chain} hp:${Math.round(p.hp)} post:${Math.round(p.posture)} | e:${e.mode} hp:${e.hp} post:${Math.round(e.posture)} ai:${e.auto} | ${this.player.anim.sheet}#${this.player.anim.frame}`);
  }
}
