import * as Phaser from "phaser";
import { Fighter, World, angleTo, dist, inShape, type DuelManifest } from "./engine";
import { BOSSES, GAME, GLYPH, HERO, HERO_MOVES, LIGHT_CHAIN, TILE, ZOOM, type AtkType, type BossDef, type GateDef, type HitDef, type MoveDef, type SpawnDef } from "./data";
import { DIFFICULTY, save, saveGame, settings } from "./settings";
import { Telemetry, askGate, askIdle, rulesGate, rulesIdle, type Decision, type DuelSnapshot, type Outcome } from "./brain";
import { Sfx } from "./sfx";

export interface DuelHooks {
  onMissingAssets: () => void;
  onLog: (line: string) => void;
  onDecision: (d: Decision & { t: number }) => void;
}

export interface HudState {
  hp: number; posture: number; heals: number;
  bossVisible: boolean; bossName: string; bossHp: number; bossSegs: number; bossSeg: number; bossPosture: number; bossGuard: boolean;
  message: string; sub: string; auto: boolean; music: boolean;
  brain: "JEV" | "RULES"; thinking: boolean; last: string; bossArmor: boolean;
}
interface Proj { x: number; y: number; vx: number; vy: number; spr: Phaser.GameObjects.Sprite; dmg: number; post: number; defl: number; moveId: string; reflected: boolean; consumed: boolean; dodged: boolean; born: number }
interface Beam { x: number; y: number; ang: number; until: number; len: number; half: number; spr: Phaser.GameObjects.Sprite; dmg: number; post: number; moveId: string; hit: boolean; dodged: boolean }
interface GateRt { def: GateDef; requested: boolean; asking: boolean; ans: string | null; applied: boolean }
const GATE_WAIT = 450; // how long a poised boss waits for Jev's branch answer before taking the default
const ASK_TIMEOUT = 1500;

type PMode = "free" | "guard" | "attack" | "roll" | "kick" | "heal" | "hurt" | "broken" | "dead";
type BMode = "idle" | "move" | "attack" | "recover" | "guard" | "flinch" | "broken" | "dead";

interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; color: number; size: number }
interface Ring { x: number; y: number; life: number; max: number; color: number; r: number }

const FPS: Record<string, number> = {
  hero_idle: 8, hero_walk: 12, hero_run: 14, hero_block: 8, hero_blockUp: 14, hero_blockHigh: 12, hero_roll: 24, hero_hitA: 12, hero_hitB: 10,
  hero_dead: 8, hero_kick: 16, cap_idle: 6, cap_walk: 8, cap_hit: 12, cap_dead: 7, cap_block: 8, cap_jump: 10,
  golem_idle: 5, golem_glow: 10, golem_arm: 12, golem_block: 12, golem_hit: 10, golem_melee: 12, golem_laser: 10, golem_armor: 10, golem_dead: 8, fx_beam: 14, fx_fist: 14,
};
const LOOP = new Set(["hero_idle", "hero_walk", "hero_run", "hero_block", "cap_idle", "cap_walk", "golem_idle"]);

export class DuelScene extends Phaser.Scene {
  private hooks!: DuelHooks;
  private man!: DuelManifest;
  private world!: World;
  private def: BossDef = BOSSES[0];
  private bossIdx = 0;
  private projs: Proj[] = [];
  private beams: Beam[] = [];
  private sfx!: Sfx;
  private player!: Fighter;
  private boss!: Fighter;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private fx!: Phaser.GameObjects.Graphics;
  private glyphText!: Phaser.GameObjects.Text;
  private sparks: Spark[] = [];
  private rings: Ring[] = [];
  private hitstop = 0;
  private cam = { x: 0, y: 0 };
  private locked = false;
  hud!: HudState;

  // player
  private p = {
    hp: 0, posture: 0, mode: "free" as PMode, since: 0, move: null as MoveDef | null, hit: [] as boolean[], chain: 0, chainUntil: 0,
    guardSince: 0, lastGuardPress: -9999, noDeflect: false, guardPrev: false, rollCd: 0, invulnUntil: 0, heals: 0, lastPostureHit: 0,
    rollDir: { x: 1, y: 0 }, dir: 0, atkBuf: 0, heavyBuf: 0, rollBuf: 0, kickBuf: 0, healBuf: 0,
  };
  // boss
  private b = {
    hp: 0, seg: 0, posture: 0, mode: "idle" as BMode, since: 0, until: 0, move: null as MoveDef | null, hit: [] as boolean[], dodged: [] as boolean[],
    held: false, holdIdx: 0, holdUntil: 0, atkDir: 0, awake: false, auto: true, nextThink: 0, lastPostureHit: 0, slipped: false,
    cd: {} as Record<string, number>, poiseUntil: 0, armorUntil: 0, spawned: [] as boolean[], buffed: false, last: "", sounded: false, glyph: null as { type: keyof typeof GLYPH; until: number } | null, moveDir: 0,
    decision: null as (Decision & { at: number }) | null, asking: false, askId: 0, askedAt: 0, nextAsk: 0,
    moveKind: "approach" as "approach" | "backstep" | "circle", circleDir: 1 as 1 | -1, history: [] as string[],
    gates: [] as GateRt[], moveToken: 0, endSince: 0, res: [] as (Outcome | null)[],
  };
  private tel = new Telemetry();
  private moving = false;
  private stillSince = 0;

  constructor() {
    super("duel");
  }
  init(hooks: DuelHooks) {
    this.hooks = hooks;
  }

  // ------------------------------------------------------------ setup
  create() {
    this.man = this.cache.json.get("manifest") as DuelManifest;
    for (const [key, s] of Object.entries(this.man.sheets)) {
      if (this.anims.exists(key)) continue;
      this.anims.create({ key, frames: this.anims.generateFrameNumbers(key, { start: 0, end: s.frames - 1 }), frameRate: FPS[key] ?? 14, repeat: LOOP.has(key) ? -1 : 0 });
    }
    const map = this.make.tilemap({ key: "duel_map" });
    const ts = map.addTilesetImage("duel_tiles", "duel_tiles")!;
    map.createLayer("ground", ts)!.setDepth(0).setTint(0xc9b3a4);
    map.createLayer("walls", ts)!.setDepth(1);
    this.world = new World(map);
    this.cameras.main.setBackgroundColor("#0b0d12").setZoom(ZOOM).setBounds(0, 0, map.widthInPixels, map.heightInPixels).setRoundPixels(true);

    this.sfx = new Sfx(this, this.man);
    this.player = new Fighter(this, "hero", this.man.sheets, HERO.radius, 1);
    this.fx = this.add.graphics().setDepth(40);
    this.glyphText = this.add.text(0, 0, "!", { fontFamily: "monospace", fontSize: "14px", color: "#fff", fontStyle: "bold" }).setOrigin(0.5).setDepth(45).setResolution(2).setVisible(false);

    this.keys = this.input.keyboard!.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE,SHIFT,J,K,E,Q,R,M,Z,X,C,V,B,G,N,T,Y,F,ONE,TWO,ESC") as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.mouse?.disableContextMenu();
    const buf = (field: "atkBuf" | "heavyBuf" | "rollBuf" | "kickBuf" | "healBuf") => () => (this.p[field] = this.time.now + 220);
    this.keys.J.on("down", buf("atkBuf"));
    this.keys.K.on("down", buf("heavyBuf"));
    this.keys.SHIFT.on("down", buf("rollBuf"));
    this.keys.E.on("down", buf("kickBuf"));
    this.keys.Q.on("down", buf("healBuf"));
    this.input.on("pointerdown", (ptr: Phaser.Input.Pointer) => {
      if (!ptr.rightButtonDown()) this.p.atkBuf = this.time.now + 220;
    });
    this.keys.R.on("down", () => this.reset(this.bossIdx));
    this.keys.ESC.on("down", () => {
      this.scene.launch("menu", { mode: "pause" });
      this.scene.pause();
    });
    this.keys.M.on("down", () => {
      this.sfx.toggleMusic();
      this.hud.music = this.sfx.musicOn;
    });
    this.keys.N.on("down", () => (this.hud.auto = this.b.auto = !this.b.auto));
    this.keys.F.on("down", () => {
      this.hud.brain = this.hud.brain === "JEV" ? "RULES" : "JEV";
      this.b.decision = null;
      this.b.asking = false;
      this.b.askId++;
      this.hooks.onLog(`boss brain: ${this.hud.brain}`);
    });
    this.keys.G.on("down", () => this.forceGuard());
    this.keys.T.on("down", () => this.refill());
    this.keys.Y.on("down", () => this.debugWake());
    ["Z", "X", "C", "V", "B"].forEach((k, i) => this.keys[k].on("down", () => this.def.dummyKeys[i] && this.forceMove(this.def.dummyKeys[i])));
    this.keys.ONE.on("down", () => this.reset(0));
    this.keys.TWO.on("down", () => this.reset(1));

    this.hud = { hp: 1, posture: 0, heals: HERO.heals, bossVisible: false, bossName: BOSSES[0].name, bossHp: 1, bossSegs: BOSSES[0].segments, bossSeg: 0, bossPosture: 0, bossGuard: false, message: "", sub: "", auto: true, music: true, brain: "JEV", thinking: false, last: "", bossArmor: false };
    this.registry.set("hud", this.hud);
    if (process.env.NODE_ENV !== "production") (window as unknown as { __duel?: DuelScene }).__duel = this; // for scripted tests
    this.scene.launch("duelhud");
    this.reset(0);
  }

  private spawnBoss(idx: number) {
    this.bossIdx = idx;
    this.def = BOSSES[idx];
    this.boss?.sprite.destroy();
    this.boss = new Fighter(this, this.def.prefix, this.man.sheets, this.def.radius, this.def.scale);
    this.boss.x = this.world.spawns.boss.x;
    this.boss.y = this.world.spawns.boss.y;
    this.boss.face = -1;
    Object.assign(this.b, { hp: this.def.segmentHp, seg: 0, posture: 0, mode: "idle", since: this.time.now, until: 0, move: null, awake: false, held: false, holdIdx: 0, cd: {}, glyph: null, last: "", nextThink: 0,
      decision: null, asking: false, askId: this.b.askId + 1, nextAsk: 0, history: [], gates: [], moveToken: this.b.moveToken + 1, endSince: 0, res: [], armorUntil: 0, poiseUntil: 0, spawned: [], buffed: false });
    this.hud.bossName = this.def.name;
    this.hud.bossSegs = this.def.segments;
    this.tel.reset();
    this.boss.play(this.def.anims.idle, undefined, { loop: true, restart: true });
  }

  private clearEntities() {
    this.projs.forEach((p) => p.spr.destroy());
    this.beams.forEach((p) => p.spr.destroy());
    this.projs = [];
    this.beams = [];
  }

  private reset(idx = this.bossIdx) {
    const w = this.world;
    const s = w.spawns;
    this.clearEntities();
    this.player.x = s.player.x;
    this.player.y = s.player.y;
    this.player.face = 1;
    Object.assign(this.p, { hp: HERO.maxHp, posture: 0, mode: "free", since: this.time.now, move: null, chain: 0, heals: HERO.heals, invulnUntil: 0, rollCd: 0 });
    this.spawnBoss(idx);
    this.player.freeze(false);
    this.boss.freeze(false);
    w.gateOpen = true;
    this.locked = false;
    this.cameras.main.setBounds(0, 0, this.world.w * TILE, this.world.h * TILE);
    this.cam.x = this.player.x;
    this.cam.y = this.player.y - 20;
    this.sfx.playMusic("temple", 0.22);
    this.hud.message = "";
    this.hud.sub = "";
    this.hud.bossVisible = false;
    this.player.play("idle", undefined, { loop: true, restart: true });
  }

  /** After a boss falls: heal a little, then the next guardian rises in the same arena. */
  private nextBoss() {
    if (this.p.mode === "dead") return;
    this.p.hp = Math.min(HERO.maxHp, this.p.hp + 40);
    this.p.posture = 0;
    this.p.heals = Math.min(HERO.heals, this.p.heals + 1);
    this.clearEntities();
    this.spawnBoss(this.bossIdx + 1);
    this.hud.message = "";
    this.hud.sub = "";
    this.wake();
  }

  private refill() {
    this.p.hp = HERO.maxHp;
    this.p.posture = 0;
    this.p.heals = HERO.heals;
    this.b.posture = 0;
    this.b.hp = this.def.segmentHp;
    this.b.armorUntil = 0;
    if (this.b.mode === "broken") this.setB("recover", 300);
  }

  private debugWake() {
    this.player.x = this.world.spawns.boss.x - 110;
    this.player.y = this.world.spawns.boss.y + 40;
    this.wake();
  }

  private wake() {
    if (this.b.awake) return;
    this.b.awake = true;
    this.world.gateOpen = false;
    this.locked = true;
    const a = this.world.arena;
    this.cameras.main.setBounds(a.l - 24, a.t - 40, a.r - a.l + 48, a.b - a.t + 60);
    this.sfx.playMusic(this.def.music, 0.28);
    this.hud.bossVisible = true;
    this.hud.message = this.def.name;
    this.hud.sub = this.def.title;
    this.time.delayedCall(2600, () => (this.hud.message = this.p.mode === "dead" ? this.hud.message : ""));
    this.setB("recover", 900);
    this.hooks.onLog("boss awake - the gate is sealed");
  }

  // ------------------------------------------------------------ helpers
  private setP(m: PMode) {
    this.p.mode = m;
    this.p.since = this.time.now;
  }
  private setB(m: BMode, untilMs = 0) {
    this.b.mode = m;
    this.b.since = this.time.now;
    this.b.until = this.time.now + untilMs;
  }
  private bossActive() {
    return this.b.awake && this.b.mode !== "dead";
  }
  private aimAtBoss() {
    return angleTo(this.player.x, this.player.y, this.boss.x, this.boss.y);
  }
  private chest(f: Fighter, h = 28) {
    return { x: f.x, y: f.y - h };
  }

  private burst(x: number, y: number, n: number, color: number, speed: number, size = 2) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = speed * (0.4 + Math.random() * 0.8);
      this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 20, life: 0, max: 280 + Math.random() * 240, color, size: size * (0.6 + Math.random() * 0.8) });
    }
  }
  private ring(x: number, y: number, color: number, r = 26) {
    this.rings.push({ x, y, life: 0, max: 260, color, r });
  }
  private popup(x: number, y: number, text: string, color = "#ffffff") {
    const t = this.add.text(x, y, text, { fontFamily: "monospace", fontSize: "9px", color, stroke: "#000", strokeThickness: 2 }).setOrigin(0.5).setDepth(60).setResolution(2);
    this.tweens.add({ targets: t, y: y - 16, alpha: 0, duration: 800, ease: "Cubic.easeOut", onComplete: () => t.destroy() });
  }
  private stop(ms: number) {
    this.hitstop = Math.max(this.hitstop, ms);
  }

  // ------------------------------------------------------------ frame loop
  update(now: number, deltaMs: number) {
    this.fx.clear();
    this.hud.hp = this.p.hp / HERO.maxHp;
    this.hud.posture = this.p.posture / HERO.maxPosture;
    this.hud.heals = this.p.heals;
    this.hud.bossHp = ((this.def.segments - 1 - this.b.seg) * this.def.segmentHp + Math.max(0, this.b.hp)) / (this.def.segments * this.def.segmentHp);
    this.hud.bossSeg = this.b.seg;
    this.hud.bossPosture = this.b.posture / this.def.maxPosture;
    this.hud.bossGuard = this.b.mode === "guard";
    this.hud.bossArmor = this.time.now < this.b.armorUntil;
    this.hud.thinking = this.b.asking || this.b.gates.some((g) => g.asking && !g.applied);

    if (this.hitstop > 0) {
      this.hitstop -= deltaMs;
      this.player.sprite.anims.timeScale = 0;
      this.boss.sprite.anims.timeScale = 0;
    } else {
      const dt = Math.min(deltaMs, 50) / 1000;
      this.updatePlayer(now, dt);
      if (this.bossActive()) {
        const dd = dist(this.player.x, this.player.y, this.boss.x, this.boss.y);
        this.tel.sampleDistance(now, dd);
        this.tel.watchRetreat(now, dd);
      }
      this.updateBoss(now, dt);
      this.updateProjectiles(now, dt);
      this.updateBeams(now);
      this.separate(dt);
      this.checkWake();
    }
    this.player.tickFx(deltaMs);
    this.boss.tickFx(deltaMs);
    this.player.sync();
    this.boss.sync();
    this.updateCamera(deltaMs / 1000);
    this.drawFx(now, deltaMs);
  }

  private checkWake() {
    if (this.b.awake || this.p.mode === "dead") return;
    const a = this.world.arena, g = this.world.gate!;
    const { x, y } = this.player;
    if (x > a.l && x < a.r && y > a.t && y < g.t - 6) this.wake();
  }

  private separate(dt: number) {
    if (!this.bossActive() || this.p.mode === "roll" || this.p.mode === "dead") return;
    const d = dist(this.player.x, this.player.y, this.boss.x, this.boss.y);
    const min = HERO.radius + this.def.radius + 6;
    if (d < min && d > 0.01) {
      const push = ((min - d) * 0.5) + 0.3;
      const a = angleTo(this.boss.x, this.boss.y, this.player.x, this.player.y);
      this.player.move(this.world, Math.cos(a) * push * Math.min(1, dt * 30), Math.sin(a) * push * Math.min(1, dt * 30));
    }
  }

  // ------------------------------------------------------------ player
  private isIframes(now: number) {
    return now < this.p.invulnUntil || (this.p.mode === "roll" && now - this.p.since >= HERO.rollIframes[0] && now - this.p.since <= HERO.rollIframes[1]);
  }

  private updatePlayer(now: number, dt: number) {
    const p = this.p, f = this.player, k = this.keys;
    f.sprite.anims.timeScale = 1;
    const ix = (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
    const iy = (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);
    const len = Math.hypot(ix, iy) || 1;
    const mx = ix / len, my = iy / len, moving = ix !== 0 || iy !== 0;
    const guardHeld = k.SPACE.isDown || this.input.activePointer.rightButtonDown();
    const guardPressed = guardHeld && !p.guardPrev;
    p.guardPrev = guardHeld;
    this.moving = moving;
    if (moving || (p.mode !== "free" && p.mode !== "guard")) this.stillSince = now;

    if (p.mode !== "broken" && p.mode !== "dead" && now - p.lastPostureHit > HERO.postureRegenDelayMs)
      p.posture = Math.max(0, p.posture - HERO.postureRegenPerSec * dt * (p.mode === "guard" ? 0.5 : 1));

    const lockFace = () => {
      if (this.bossActive()) f.face = this.boss.x >= f.x ? 1 : -1;
      else if (ix !== 0) f.face = ix > 0 ? 1 : -1;
    };

    switch (p.mode) {
      case "free":
      case "guard": {
        lockFace();
        const guarding = p.mode === "guard";
        if (guardPressed) {
          this.tel.record("guard", now);
          this.tel.react("guard", now);
          p.noDeflect = now - p.lastGuardPress < GAME.deflectSpamMs;
          p.lastGuardPress = now;
          p.guardSince = now;
        }
        if (guardHeld && !guarding) this.setP("guard");
        else if (!guardHeld && guarding) this.setP("free");
        const speed = p.mode === "guard" ? HERO.guardSpeed : HERO.speed;
        if (moving) f.move(this.world, mx * speed * dt, my * speed * dt);
        if (p.mode === "guard") f.play(now - p.guardSince < 120 ? "blockUp" : "block", undefined, { loop: true });
        else f.play(moving ? "run" : "idle", moving ? 14 : 8, { loop: true });

        if (p.rollBuf > now && now >= p.rollCd) return this.startRoll(now, mx, my, moving);
        if (p.healBuf > now && p.heals > 0 && p.hp < HERO.maxHp) return this.startHeal(now);
        if (p.kickBuf > now) return this.startMove(now, "KICK", "kick");
        if (p.heavyBuf > now) return this.startMove(now, "D", "attack");
        if (p.atkBuf > now) {
          if (now > p.chainUntil) p.chain = 0;
          return this.startMove(now, LIGHT_CHAIN[p.chain % LIGHT_CHAIN.length], "attack");
        }
        break;
      }
      case "attack":
      case "kick": {
        const mv = p.move!;
        this.runPlayerMove(now, dt, mv, ix, iy);
        const lastHit = Math.max(...mv.hits.map((h) => h.frames[1]));
        if (p.mode === "attack" && f.frame > lastHit) {
          // cancel windows: chain the next light, roll, or guard out of recovery
          if (p.rollBuf > now && now >= p.rollCd) return this.startRoll(now, mx, my, moving);
          if (p.atkBuf > now && mv.id !== "D") {
            p.chain++;
            return this.startMove(now, LIGHT_CHAIN[p.chain % LIGHT_CHAIN.length], "attack");
          }
          if (p.heavyBuf > now) return this.startMove(now, "D", "attack");
          if (guardHeld) {
            this.setP("guard");
            p.guardSince = now;
            p.noDeflect = true;
          }
        }
        if ((p.mode as PMode) !== "free" && (p.mode as PMode) !== "guard" && f.done) {
          if (mv.id !== "D" && mv.id !== "KICK") p.chainUntil = now + 420;
          else p.chain = 0;
          this.setP("free");
        }
        break;
      }
      case "roll": {
        const t = now - p.since;
        const sp = t < HERO.rollMs * 0.8 ? HERO.rollSpeed : HERO.rollSpeed * 0.25;
        f.move(this.world, p.rollDir.x * sp * dt, p.rollDir.y * sp * dt);
        if (f.done || t > HERO.rollMs + 140) {
          p.rollCd = now + HERO.rollCooldownMs;
          this.setP("free");
        }
        break;
      }
      case "heal": {
        lockFace();
        if (moving) f.move(this.world, mx * HERO.guardSpeed * 0.5 * dt, my * HERO.guardSpeed * 0.5 * dt);
        f.play("blockUp", 6, { loop: true });
        if (Math.random() < 0.3) this.burst(f.x + Phaser.Math.Between(-8, 8), f.y - 10, 1, 0x6bff9a, 22, 1.6);
        if (now - p.since >= HERO.healMs) {
          p.hp = Math.min(HERO.maxHp, p.hp + HERO.healAmount);
          p.heals--;
          this.sfx.heal();
          this.ring(f.x, f.y - 24, 0x6bff9a, 22);
          this.setP("free");
        }
        break;
      }
      case "hurt":
        if (now - p.since > 340) this.setP("free");
        break;
      case "broken":
        if (Math.random() < 0.25) this.burst(f.x + Phaser.Math.Between(-6, 6), f.y - 58, 1, 0xffe27a, 18, 1.6);
        if (now - p.since > HERO.brokenMs) {
          p.posture = 45;
          this.setP("free");
        }
        break;
      case "dead":
        break;
    }
  }

  private startMove(now: number, id: string, mode: "attack" | "kick") {
    const p = this.p, f = this.player, mv = HERO_MOVES[id];
    p.move = mv;
    p.hit = mv.hits.map(() => false);
    p.atkBuf = p.heavyBuf = p.kickBuf = 0;
    this.tel.record(id === "KICK" ? "kick" : "attack", now);
    this.tel.react("attack", now);
    this.setP(mode);
    f.face = this.bossActive() ? (this.boss.x >= f.x ? 1 : -1) : f.face;
    p.dir = this.bossActive() ? this.aimAtBoss() : f.face > 0 ? 0 : Math.PI;
    f.play(mv.anim, mv.fps, { restart: true });
    this.sfx.swing(id === "D");
  }

  private runPlayerMove(now: number, dt: number, mv: MoveDef, ix: number, iy: number) {
    const p = this.p, f = this.player;
    const fr = f.frame;
    if (this.bossActive() && fr < Math.min(...mv.hits.map((h) => h.frames[0]))) p.dir = this.aimAtBoss(); // aim assist until the swing commits
    for (const l of mv.lunge ?? []) if (fr >= l.frames[0] && fr <= l.frames[1]) f.move(this.world, Math.cos(p.dir) * l.speed * dt, Math.sin(p.dir) * l.speed * dt);
    mv.hits.forEach((h, i) => {
      if (p.hit[i] || fr < h.frames[0]) return;
      if (fr > h.frames[1]) return void (p.hit[i] = true);
      if (!this.bossActive()) return;
      if (inShape(h.shape, f.x, f.y, p.dir, this.boss.x, this.boss.y, this.def.radius)) {
        p.hit[i] = true;
        this.playerHitsBoss(mv, h, now);
      }
    });
    void ix; void iy;
  }

  private startRoll(now: number, mx: number, my: number, moving: boolean) {
    const p = this.p, f = this.player;
    p.rollBuf = 0;
    let dx = mx, dy = my;
    if (!moving) {
      // no direction held: roll away from the boss (or backwards)
      const a = this.bossActive() ? this.aimAtBoss() + Math.PI : f.face > 0 ? Math.PI : 0;
      dx = Math.cos(a);
      dy = Math.sin(a);
    }
    this.tel.record("roll", now);
    this.tel.react("roll", now);
    p.rollDir = { x: dx, y: dy };
    if (Math.abs(dx) > 0.2) f.face = dx > 0 ? 1 : -1;
    this.setP("roll");
    f.play("roll", undefined, { restart: true });
    this.sfx.roll();
  }

  private startHeal(now: number) {
    this.p.healBuf = 0;
    this.tel.record("heal", now);
    this.setP("heal");
  }

  // ------------------------------------------------------------ player attacks the boss
  private playerHitsBoss(mv: MoveDef, h: HitDef, now: number) {
    const b = this.b, bp = this.chest(this.boss, this.def.headY * 0.45);
    if (b.mode === "dead") return;
    if (b.mode === "broken") return this.deathblow(now);

    if (b.mode === "guard") {
      if (this.def.stoneGuard) {
        // stone guard: shrugs off light attacks and kicks; only a heavy breaks it
        if (mv.id === "D") {
          b.posture = Math.min(100, b.posture + 36);
          b.lastPostureHit = now;
          this.boss.freeze(false);
          this.setB("flinch", 1100);
          this.boss.play(this.def.anims.hit, undefined, { restart: true });
          this.popup(this.boss.x, this.boss.y - this.def.headY - 14, "GUARD BROKEN", "#ffd36b");
          this.sfx.guardBreak();
          this.burst(bp.x, bp.y, 18, 0xcfc7b8, 150, 2.4);
          this.stop(GAME.hitstopHeavy);
          this.cameras.main.shake(160, 0.006);
          this.checkBossBreak(now);
        } else {
          this.p.posture = Math.min(100, this.p.posture + 6);
          this.p.lastPostureHit = now;
          this.player.move(this.world, -this.player.face * 8, 0);
          this.sfx.stoneHit();
          this.burst(bp.x, bp.y, 6, 0xb8b0a2, 80, 1.8);
          this.popup(this.boss.x, this.boss.y - this.def.headY - 14, mv.id === "KICK" ? "NO EFFECT" : "STONE GUARD", "#b8b0a2");
          this.stop(GAME.hitstopLight);
        }
        return;
      }
      if (mv.id === "KICK") {
        b.posture = Math.min(100, b.posture + 28);
        b.lastPostureHit = now;
        this.setB("flinch", 900);
        this.boss.play(this.def.anims.hit, undefined, { restart: true });
        this.popup(this.boss.x, this.boss.y - this.def.headY - 14, "GUARD BREAK", "#ffd36b");
        this.sfx.guardBreak();
        this.burst(bp.x, bp.y, 14, 0xffd36b, 120, 2);
        this.stop(GAME.hitstopHeavy);
        return;
      }
      b.posture = Math.min(100, b.posture + h.posture * 0.3);
      b.lastPostureHit = now;
      this.p.posture = Math.min(100, this.p.posture + 5);
      this.p.lastPostureHit = now;
      this.player.move(this.world, -this.player.face * 8, 0);
      this.sfx.block(0.7);
      this.burst(bp.x, bp.y, 8, 0xffa94d, 90, 1.8);
      this.stop(GAME.hitstopLight);
      this.checkBossBreak(now);
      return;
    }

    const armored = now < b.armorUntil;
    b.hp -= h.damage * (armored ? 0.5 : 1) * DIFFICULTY[settings.difficulty].dealt;
    b.posture = Math.min(100, b.posture + h.posture * (armored ? 0.7 : 1));
    b.lastPostureHit = now;
    this.boss.hitFlash(70);
    this.burst(bp.x, bp.y, h.type === "heavy" ? 14 : 9, 0xffe9c2, h.type === "heavy" ? 140 : 100, 2);
    this.sfx.hit(h.type === "heavy");
    this.stop(h.type === "heavy" ? GAME.hitstopHeavy : GAME.hitstopLight);
    this.cameras.main.shake(h.type === "heavy" ? 120 : 60, h.type === "heavy" ? 0.004 : 0.002);
    if (b.mode !== "attack" && now >= b.poiseUntil && !this.def.noFlinch && !armored) {
      // a flinch grants a short poise window, so spammed light attacks can't stunlock the boss
      this.setB("flinch", 260);
      b.poiseUntil = now + 1100;
      this.boss.play(this.def.anims.hit, undefined, { restart: true });
    }
    if (b.hp <= 0) return this.segmentEmpty(now);
    this.checkBossBreak(now);
  }

  private checkBossBreak(now: number) {
    const b = this.b;
    if (b.posture < 100 || b.mode === "broken" || b.mode === "dead") return;
    this.breakBoss(now, 3400);
  }

  private breakBoss(now: number, ms: number) {
    const b = this.b;
    this.boss.freeze(false);
    b.held = false;
    this.setB("broken", ms);
    this.boss.play(this.def.anims.hit, 6, { restart: true });
    this.popup(this.boss.x, this.boss.y - this.def.headY - 14, "POSTURE BROKEN", "#ffd36b");
    this.sfx.postureBreak();
    this.ring(this.boss.x, this.boss.y - this.def.headY * 0.45, 0xffd36b, 34);
    this.stop(170);
    this.cameras.main.shake(180, 0.006);
    b.glyph = null;
    this.hooks.onLog("posture broken - deathblow window");
    void now;
  }

  private segmentEmpty(now: number) {
    const b = this.b;
    if (b.seg >= this.def.segments - 1) return this.killBoss();
    b.hp = 0;
    this.breakBoss(now, 7000); // health gone: only a deathblow can finish this segment
    b.posture = 100;
    this.hooks.onLog("segment emptied - land the deathblow");
  }

  private deathblow(now: number) {
    const b = this.b;
    this.sfx.deathblow();
    this.stop(260);
    this.cameras.main.flash(180, 255, 240, 200);
    this.cameras.main.shake(260, 0.01);
    this.popup(this.boss.x, this.boss.y - this.def.headY - 14, "DEATHBLOW", "#ff5d5d");
    this.burst(this.boss.x, this.boss.y - this.def.headY * 0.45, 30, 0xff5d5d, 200, 2.5);
    if (b.seg >= this.def.segments - 1) return this.killBoss();
    b.seg++;
    b.hp = this.def.segmentHp;
    b.posture = 0;
    this.setB("flinch", 1300);
    this.boss.play(this.def.anims.hit, undefined, { restart: true });
    this.hooks.onLog(`deathblow - segment ${b.seg + 1} of ${this.def.segments}`);
    void now;
  }

  private killBoss() {
    this.b.hp = 0;
    this.setB("dead");
    this.boss.sprite.clearTint();
    this.boss.freeze(false);
    this.boss.play(this.def.anims.dead, undefined, { restart: true });
    this.world.gateOpen = true;
    this.b.glyph = null;
    this.b.armorUntil = 0;
    this.b.asking = false;
    this.b.askId++;
    this.projs.forEach((p) => p.spr.destroy());
    this.beams.forEach((p) => p.spr.destroy());
    this.projs = [];
    this.beams = [];
    const more = this.bossIdx + 1 < BOSSES.length;
    this.hud.message = more ? "DEMISE" : "VICTORY";
    this.hud.sub = more ? `${BOSSES[this.bossIdx + 1].name} stirs…` : "R to fight again";
    this.sfx.playMusic("temple", 0.22);
    this.hooks.onLog(`${this.def.name} defeated`);
    if (!save.cleared.includes(this.def.id)) save.cleared.push(this.def.id);
    saveGame();
    if (more) this.time.delayedCall(4200, () => this.nextBoss());
  }

  // ------------------------------------------------------------ boss
  private moveType(mv: MoveDef): AtkType {
    return mv.kind === "beam" ? "beam" : mv.hits[0]?.type ?? "normal";
  }
  private firstAct(mv: MoveDef) {
    const fs = [...mv.hits.map((h) => h.frames[0]), ...(mv.spawns ?? []).map((x) => x.frame), ...(mv.beam ? [mv.beam.frame] : []), ...(mv.buff ? [mv.buff.frame] : [])];
    return Math.min(...fs);
  }
  private deflectMs() {
    return DIFFICULTY[settings.difficulty].deflectMs;
  }
  private phase(): 1 | 2 {
    return this.b.seg >= 1 ? 2 : 1;
  }
  private mul() {
    return this.phase() === 2 ? { fps: 1.12, hold: 0.8, cd: 0.8, speed: 1.15 } : { fps: 1, hold: 1, cd: 1, speed: 1 };
  }

  private updateBoss(now: number, dt: number) {
    const b = this.b, f = this.boss;
    f.sprite.anims.timeScale = b.held ? 0 : 1;
    if (!b.awake) return void f.play(this.def.anims.idle, undefined, { loop: true });
    if (b.mode === "dead") return;

    if (b.mode !== "broken" && now - b.lastPostureHit > 1800) {
      const frac = (this.def.segments - 1 - b.seg) * 0.4 + Math.max(0.2, b.hp / this.def.segmentHp);
      b.posture = Math.max(0, b.posture - 14 * dt * Math.min(1, 0.4 + frac * 0.6));
    }
    const toPlayer = angleTo(f.x, f.y, this.player.x, this.player.y);
    const d = dist(f.x, f.y, this.player.x, this.player.y);
    if (!f.flashing) {
      if (now < b.armorUntil) f.sprite.setTint(0x9fe8ff);
      else f.sprite.clearTint();
    }
    const faceP = () => (f.face = this.player.x >= f.x ? 1 : -1);

    switch (b.mode) {
      case "idle":
        faceP();
        f.play(this.def.anims.idle, undefined, { loop: true });
        if (b.auto && this.p.mode !== "dead") {
          this.ensureRequest(now);
          this.takeDecision(now);
        }
        break;
      case "move": {
        faceP();
        f.play(this.def.anims.walk, undefined, { loop: true });
        const ang = b.moveKind === "backstep" ? toPlayer + Math.PI : b.moveKind === "circle" ? toPlayer + (b.circleDir * Math.PI) / 2 : toPlayer;
        const sp = this.def.speed * this.mul().speed * (b.moveKind === "backstep" ? 1.25 : b.moveKind === "circle" ? 0.9 : 1);
        const moved = f.move(this.world, Math.cos(ang) * sp * dt, Math.sin(ang) * sp * dt);
        if (b.auto) this.ensureRequest(now); // keep Jev's next answer in flight while we walk
        if ((b.moveKind === "approach" && d <= 64) || now >= b.until || !moved) this.setB("idle");
        break;
      }
      case "recover":
        faceP();
        f.play(this.def.anims.idle, undefined, { loop: true });
        if (b.auto) this.ensureRequest(now); // prefetch: the answer is usually ready by the time recovery ends
        if (now >= b.until) this.setB("idle");
        break;
      case "guard":
        faceP();
        f.play(this.def.anims.block, undefined, { loop: this.def.guardLoop ?? true });
        if (b.auto) this.ensureRequest(now);
        if (now >= b.until) this.setB("recover", 250);
        break;
      case "flinch":
        if (now >= b.until) this.setB("recover", 250);
        break;
      case "broken":
        if (Math.random() < 0.2) this.burst(f.x + Phaser.Math.Between(-8, 8), f.y - 78, 1, 0xffe27a, 18, 1.6);
        if (now >= b.until) {
          b.posture = b.hp <= 0 ? 0 : 35;
          if (b.hp <= 0) b.hp = 1; // segment survived the window: it recovers a sliver
          this.setB("recover", 500);
        }
        break;
      case "attack":
        this.runBossMove(now, dt);
        break;
    }
    if (b.glyph && now > b.glyph.until) b.glyph = null;
  }

  // ---- idle gate: which action next?
  private spaceBehind() {
    const a = angleTo(this.player.x, this.player.y, this.boss.x, this.boss.y);
    const x = this.boss.x + Math.cos(a) * 30, y = this.boss.y + Math.sin(a) * 30;
    return !this.world.blocked({ l: x - 5, r: x + 5, t: y - 3, b: y + 3 });
  }

  private availableActions(now: number): string[] {
    const b = this.b;
    const d = dist(this.boss.x, this.boss.y, this.player.x, this.player.y);
    const out = ["WAIT", "CIRCLE"];
    if (d > 46) out.push("APPROACH");
    if (d < 170 && this.spaceBehind()) out.push("BACKSTEP");
    if (now >= (b.cd.GUARD ?? 0)) out.push("GUARD");
    for (const [id, mv] of Object.entries(this.def.moves)) if (now >= (b.cd[id] ?? 0) && d <= (mv.reach ?? 90) * 1.3 && !(mv.kind === "buff" && now < b.armorUntil)) out.push(id);
    return out;
  }

  private snapshot(now: number): DuelSnapshot {
    const b = this.b, p = this.p;
    const d = dist(this.boss.x, this.boss.y, this.player.x, this.player.y);
    const last = b.history[b.history.length - 1];
    let streak = 0;
    for (let i = b.history.length - 1; i >= 0 && b.history[i] === last; i--) streak++;
    const state = p.mode === "attack" || p.mode === "kick" ? "attacking" : p.mode === "roll" ? "rolling" : p.mode === "guard" ? "guarding" : p.mode === "heal" ? "healing"
      : p.mode === "hurt" || p.mode === "broken" ? "staggered" : this.moving ? "moving" : "standing";
    const reachable: Record<string, boolean> = {};
    for (const [id, mv] of Object.entries(this.def.moves)) reachable[id] = d <= (mv.reach ?? 90);
    return {
      boss: { segment: b.seg + 1, ofSegments: this.def.segments, phase: this.phase(), hpPct: Math.round((Math.max(0, b.hp) / this.def.segmentHp) * 100), posturePct: Math.round(b.posture), armored: now < b.armorUntil, mode: b.mode, lastActions: b.history.slice(-5), sameActionStreak: streak },
      player: {
        hpPct: Math.round(p.hp), posturePct: Math.round(p.posture), healsLeft: p.heals, state, distancePx: Math.round(d), distanceTrend: this.tel.trend(),
        standingStillMs: Math.round(now - this.stillSince), guardHeld: p.mode === "guard",
      },
      recent: this.tel.recent(now, 8000),
      vsMove: this.tel.summary(),
      lastOutcome: this.tel.lastOutcome,
      reachable,
    };
  }

  private setDecision(d: Decision, now: number) {
    d.label = `${this.b.last || "start"} → ${d.choice}`;
    this.b.decision = { ...d, at: now };
    this.hud.last = `${d.source === "jev" ? "JEV" : d.source.toUpperCase()}: ${d.choice}${d.probabilities ? " " + Math.round((d.probabilities[d.choice] ?? 0) * 100) + "%" : ""}`;
    this.hooks.onDecision({ ...d, t: now });
  }

  private ensureRequest(now: number) {
    const b = this.b;
    if (b.decision || b.asking || now < b.nextAsk || this.p.mode === "dead") return;
    const avail = this.availableActions(now);
    const snap = this.snapshot(now);
    if (this.hud.brain === "RULES") return this.setDecision(rulesIdle(this.def, snap, avail), now);
    b.asking = true;
    b.askedAt = now;
    const id = ++b.askId;
    askIdle(this.def, snap, avail, "")
      .catch((e: Error) => rulesIdle(this.def, snap, avail, "fallback", e.message))
      .then((d) => {
        if (id !== b.askId) return; // brain toggled / fight reset while Jev was thinking
        b.asking = false;
        this.setDecision(d, this.time.now);
      });
  }

  private takeDecision(now: number) {
    const b = this.b;
    if (b.decision) {
      const d = b.decision;
      b.decision = null;
      b.nextAsk = now + 100;
      if (now - d.at > 3500) return; // stale: ask again
      const avail = this.availableActions(now);
      if (!avail.includes(d.choice)) {
        const r = rulesIdle(this.def, this.snapshot(now), avail, "fallback", `${d.choice} no longer available`);
        this.setDecision(r, now);
        b.decision = null;
        return this.execAction(r.choice, now);
      }
      return this.execAction(d.choice, now);
    }
    if (b.asking && now - b.askedAt > ASK_TIMEOUT) {
      // Jev is too slow: don't stand there; play a rules move and let the late answer be dropped
      b.askId++;
      b.asking = false;
      const avail = this.availableActions(now);
      const r = rulesIdle(this.def, this.snapshot(now), avail, "fallback", "Jev timed out");
      this.setDecision(r, now);
      b.decision = null;
      this.execAction(r.choice, now);
    }
  }

  private execAction(id: string, now: number) {
    const b = this.b;
    b.last = id;
    if (!this.def.moves[id]) {
      b.history.push(id);
      if (b.history.length > 12) b.history.shift();
    }
    switch (id) {
      case "APPROACH":
        b.moveKind = "approach";
        return this.setB("move", 1000);
      case "BACKSTEP":
        b.moveKind = "backstep";
        return this.setB("move", 520);
      case "CIRCLE":
        b.moveKind = "circle";
        b.circleDir = Math.random() < 0.5 ? -1 : 1;
        return this.setB("move", 850);
      case "WAIT":
        return this.setB("recover", 450 + Math.random() * 300);
      case "GUARD":
        return this.forceGuard();
      default:
        this.forceMove(id);
    }
    void now;
  }

  forceGuard() {
    if (!this.bossActive() || this.b.mode === "broken") return;
    this.boss.freeze(false);
    this.b.held = false;
    this.b.last = "GUARD";
    this.b.cd.GUARD = this.time.now + 5000;
    this.setB("guard", this.def.stoneGuard ? 2200 : 1600);
  }

  // ---- attacks
  private forceMove(id: string) {
    const b = this.b, m = this.mul();
    if (!this.b.awake) this.debugWake();
    if (b.mode === "dead" || b.mode === "broken") return;
    const mv = this.def.moves[id];
    const now = this.time.now;
    b.move = mv;
    b.hit = mv.hits.map(() => false);
    b.dodged = mv.hits.map(() => false);
    b.res = mv.hits.map(() => null);
    b.spawned = [];
    b.buffed = false;
    b.gates = (mv.gates ?? []).map((def) => ({ def, requested: false, asking: false, ans: null, applied: false }));
    b.moveToken++;
    b.endSince = 0;
    b.held = false;
    b.holdIdx = 0;
    b.slipped = false;
    b.sounded = false;
    b.last = id;
    b.history.push(id);
    if (b.history.length > 12) b.history.shift();
    b.cd[id] = now + (mv.cooldown ?? 1500) * m.cd;
    this.setB("attack");
    this.boss.face = this.player.x >= this.boss.x ? 1 : -1;
    b.atkDir = angleTo(this.boss.x, this.boss.y, this.player.x, this.player.y);
    this.boss.play(mv.anim, mv.fps * m.fps, { restart: true });
    this.tel.attackStart(id, now, dist(this.boss.x, this.boss.y, this.player.x, this.player.y));
    const mtype = this.moveType(mv);
    const gl = GLYPH[mtype];
    if (gl) {
      b.glyph = { type: mtype, until: now + (mv.holds?.[0]?.ms ?? 400) * m.hold + 360 };
      this.sfx.warn(mtype);
    }
    this.hooks.onLog(`boss: ${mv.label}`);
  }

  private endMove(now: number, recoverMs: number) {
    const b = this.b;
    b.held = false;
    this.boss.freeze(false);
    b.glyph = null;
    b.moveToken++; // late gate answers for this move are ignored
    this.setB("recover", recoverMs);
    void now;
  }

  // ---- projectiles, beams, buffs
  private runMoveEffects(mv: MoveDef, fr: number, now: number) {
    const b = this.b;
    const spawns: SpawnDef[] | undefined = this.phase() === 2 && mv.spawnsP2 ? mv.spawnsP2 : mv.spawns;
    spawns?.forEach((sp, i) => {
      if (b.spawned[i] || fr < sp.frame) return;
      b.spawned[i] = true;
      this.spawnProjectile(mv, sp, i === 0 ? b.atkDir : angleTo(this.boss.x, this.boss.y, this.player.x, this.player.y));
    });
    if (mv.beam && !b.spawned[99] && fr >= mv.beam.frame) {
      b.spawned[99] = true;
      this.spawnBeam(mv, now);
    }
    if (mv.buff && !b.buffed && fr >= mv.buff.frame) {
      b.buffed = true;
      b.armorUntil = now + mv.buff.ms;
      this.ring(this.boss.x, this.boss.y - this.def.headY * 0.45, 0x9fe8ff, 46);
      this.burst(this.boss.x, this.boss.y - this.def.headY * 0.45, 20, 0x9fe8ff, 120, 2.2);
      this.popup(this.boss.x, this.boss.y - this.def.headY - 14, "ARMORED", "#9fe8ff");
      this.sfx.buff();
      this.stop(90);
    }
  }

  private spawnProjectile(mv: MoveDef, sp: SpawnDef, ang: number) {
    const f = this.boss, speed = sp.speed;
    const x = f.x + Math.cos(ang) * (this.def.radius + 8), y = f.y + Math.sin(ang) * (this.def.radius + 8);
    const spr = this.add.sprite(x, y - 20, "fx_fist").setScale(1.25).setDepth(10 + y / 100).setRotation(ang);
    spr.anims.play({ key: "fx_fist", frameRate: 14, repeat: -1 });
    this.projs.push({ x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, spr, dmg: sp.damage, post: sp.posture, defl: sp.deflectPosture, moveId: mv.id, reflected: false, consumed: false, dodged: false, born: this.time.now });
    this.sfx.throwFist();
  }

  private endProjectile(pr: Proj) {
    if (!pr.consumed && !pr.reflected) this.tel.outcome(pr.moveId, pr.dodged ? "dodged" : "missed");
    pr.consumed = true;
    this.burst(pr.x, pr.y - 20, 8, 0xcfc7b8, 90, 1.8);
    pr.spr.destroy();
  }

  private updateProjectiles(now: number, dt: number) {
    for (const pr of this.projs) {
      if (pr.spr.active === false) continue;
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      pr.spr.setPosition(pr.x, pr.y - 20).setDepth(10 + pr.y / 100);
      if (this.world.blocked({ l: pr.x - 3, r: pr.x + 3, t: pr.y - 3, b: pr.y + 3 }) || now - pr.born > 3500) {
        this.endProjectile(pr);
        continue;
      }
      if (pr.reflected) {
        if (this.b.mode !== "dead" && dist(pr.x, pr.y, this.boss.x, this.boss.y) < this.def.radius + 8) {
          const b = this.b;
          b.posture = Math.min(100, b.posture + pr.defl);
          b.lastPostureHit = now;
          this.boss.hitFlash(90);
          this.sfx.hit(true);
          this.popup(this.boss.x, this.boss.y - this.def.headY - 14, "REFLECTED", "#fff2b0");
          this.stop(GAME.hitstopHeavy);
          this.checkBossBreak(now);
          pr.consumed = true;
          pr.spr.destroy();
        }
        continue;
      }
      if (pr.consumed || dist(pr.x, pr.y, this.player.x, this.player.y) > 13) continue;
      if (this.p.mode === "dead") continue;
      if (this.isIframes(now)) {
        pr.dodged = true; // passes through a rolling player
        continue;
      }
      pr.consumed = true;
      const h: HitDef = { frames: [0, 0], type: "normal", damage: pr.dmg, posture: pr.post, deflectPosture: 0, shape: { kind: "circle", range: 0 } };
      if (this.p.mode === "guard") {
        const inWindow = !this.p.noDeflect && now - this.p.guardSince <= this.deflectMs();
        if (inWindow) {
          this.tel.outcome(pr.moveId, "deflected");
          this.hurtPlayer(h, "deflect", now);
          pr.consumed = false;
          pr.reflected = true;
          pr.vx = -pr.vx * 1.25;
          pr.vy = -pr.vy * 1.25;
          pr.spr.setRotation(pr.spr.rotation + Math.PI);
          pr.born = now;
        } else {
          this.tel.outcome(pr.moveId, "blocked");
          this.hurtPlayer(h, "block", now);
          pr.spr.destroy();
        }
      } else {
        this.tel.outcome(pr.moveId, "hit");
        this.hurtPlayer(h, "hit", now);
        pr.spr.destroy();
      }
    }
    this.projs = this.projs.filter((pr) => pr.spr.active !== false && !(pr.consumed && !pr.reflected));
  }

  private spawnBeam(mv: MoveDef, now: number) {
    const bm = mv.beam!, ang = this.b.atkDir;
    const ox = this.boss.x + Math.cos(ang) * (this.def.radius + 6), oy = this.boss.y + Math.sin(ang) * (this.def.radius + 6);
    const spr = this.add.sprite(ox, oy - 14, "fx_beam").setOrigin(40 / 300, 33 / 100).setRotation(ang).setScale(bm.length / 260, 0.75).setDepth(10 + oy / 100 + 0.2);
    spr.anims.play({ key: "fx_beam", frameRate: 14, repeat: -1 });
    this.beams.push({ x: ox, y: oy, ang, until: now + bm.ms, len: bm.length, half: bm.halfWidth, spr, dmg: bm.damage, post: bm.posture, moveId: mv.id, hit: false, dodged: false });
    this.sfx.beamFire();
    this.cameras.main.shake(bm.ms, 0.003);
  }

  private updateBeams(now: number) {
    for (const bm of this.beams) {
      const dx = this.player.x - bm.x, dy = this.player.y - bm.y;
      const t = dx * Math.cos(bm.ang) + dy * Math.sin(bm.ang);
      const perp = Math.abs(-dx * Math.sin(bm.ang) + dy * Math.cos(bm.ang));
      if (this.p.mode !== "dead" && !bm.hit && t > 0 && t < bm.len && perp < bm.half + HERO.radius * 0.6) {
        if (this.isIframes(now)) bm.dodged = true;
        else {
          bm.hit = true;
          this.tel.outcome(bm.moveId, "hit");
          this.hurtPlayer({ frames: [0, 0], type: "sweep", damage: bm.dmg, posture: bm.post, deflectPosture: 0, shape: { kind: "circle", range: 0 } }, "hit", now);
        }
      }
      if (now >= bm.until) {
        if (!bm.hit) this.tel.outcome(bm.moveId, bm.dodged ? "dodged" : "missed");
        bm.spr.destroy();
        bm.until = -1;
      }
    }
    this.beams = this.beams.filter((bm) => bm.until >= 0);
  }

  // ---- combo gates: Jev decides how a combo continues
  private requestGate(g: GateRt, now: number) {
    const b = this.b, mv = b.move!;
    g.requested = true;
    const label = `${mv.id} branch ${b.gates.indexOf(g) + 1}`;
    const phase = this.phase();
    // only offer a chain into a move that is off cooldown, so branches can't be spammed past the normal limits
    const gate: GateDef = { ...g.def, options: g.def.options.filter((o) => !this.def.moves[o.id] || now >= (b.cd[o.id] ?? 0)) };
    const snap = { ...this.snapshot(now), gate: { move: mv.id, step: g.def.after + 1 } };
    const finish = (d: Decision) => {
      d.label = `${label} → ${d.choice}`;
      g.ans = d.choice;
      g.asking = false;
      this.hud.last = `${d.source === "jev" ? "JEV" : d.source.toUpperCase()}: ${d.choice}${d.probabilities ? " " + Math.round((d.probabilities[d.choice] ?? 0) * 100) + "%" : ""}`;
      this.hooks.onDecision({ ...d, t: this.time.now });
    };
    if (!b.auto) {
      g.ans = g.def.default; // training dummy: combos run their default path so they stay predictable
      return;
    }
    if (this.hud.brain === "RULES") return finish(rulesGate(gate, phase));
    g.asking = true;
    const token = b.moveToken;
    askGate(this.def, mv, gate, snap, phase, label)
      .catch((e: Error) => rulesGate(gate, phase, "fallback", e.message))
      .then((d) => {
        if (token !== b.moveToken || g.applied) return;
        finish(d);
      });
  }

  /** Returns "abort" when the choice ended or replaced the current move. */
  private applyGate(g: GateRt, now: number): "ok" | "abort" {
    const b = this.b, m = this.mul();
    g.applied = true;
    g.asking = false;
    const choice = g.ans ?? g.def.default;
    if (choice === "CONTINUE") return "ok";
    if (choice === "DELAY") {
      b.held = true;
      b.holdUntil = now + 360 * m.hold;
      return "ok";
    }
    if (choice === "FEINT") {
      b.held = false;
      this.boss.freeze(false);
      b.glyph = null;
      b.moveToken++;
      this.setB("guard", 800);
      this.popup(this.boss.x, this.boss.y - this.def.headY - 14, "FEINT", "#8fd0ff");
      return "abort";
    }
    if (choice === "END") {
      this.endMove(now, 380);
      return "abort";
    }
    if (this.def.moves[choice]) {
      b.held = false;
      this.boss.freeze(false);
      this.forceMove(choice); // chain straight into the next move
      return "abort";
    }
    return "ok";
  }

  private runBossMove(now: number, dt: number) {
    const b = this.b, f = this.boss, mv = b.move!, m = this.mul();
    const fr = f.frame;
    const firstHit = this.firstAct(mv);
    const holds = mv.holds ?? [];

    if (!b.held && b.holdIdx < holds.length && fr >= holds[b.holdIdx].frame) {
      b.held = true;
      b.holdUntil = now + holds[b.holdIdx].ms * m.hold;
      b.holdIdx++;
    }
    if (b.held && now >= b.holdUntil) {
      const cur = holds[b.holdIdx - 1];
      const g = b.gates.find((x) => !x.applied && x.def.at === cur?.frame);
      if (g && g.requested && g.ans === null && now < b.holdUntil + GATE_WAIT) {
        // poised on the frame, waiting for Jev's branch decision
      } else {
        if (g && this.applyGate(g, now) === "abort") return;
        if (now >= b.holdUntil) b.held = false;
      }
    }
    const holding = b.held;
    f.sprite.anims.timeScale = holding ? 0 : 1;
    const aimLocked = !!mv.beam && b.held && now >= b.holdUntil - mv.beam.lockMs;
    if ((fr < firstHit - 1 || holding) && !aimLocked) {
      b.atkDir = angleTo(f.x, f.y, this.player.x, this.player.y);
      f.face = Math.cos(b.atkDir) >= 0 ? 1 : -1;
    }
    if (!b.sounded && !holding && fr >= firstHit - 1) {
      b.sounded = true;
      const mt = this.moveType(mv);
      if (mv.kind === "buff") this.sfx.charge();
      else if (mv.kind !== "beam" && mv.kind !== "projectile") this.sfx.swing(mt === "heavy" || mt === "sweep", true);
    }
    for (const l of mv.lunge ?? []) if (!holding && fr >= l.frames[0] && fr <= l.frames[1]) {
      const near = dist(f.x, f.y, this.player.x, this.player.y) > this.def.radius + HERO.radius + 8;
      if (near) f.move(this.world, Math.cos(b.atkDir) * l.speed * dt, Math.sin(b.atkDir) * l.speed * dt);
    }

    if (!holding) this.runMoveEffects(mv, fr, now);

    if (!holding) mv.hits.forEach((h, i) => {
      if (b.hit[i] || fr < h.frames[0]) return;
      if (fr > h.frames[1]) {
        if (!b.res[i]) {
          b.res[i] = b.dodged[i] ? "dodged" : "missed";
          this.tel.outcome(mv.id, b.res[i]!);
        }
        return void (b.hit[i] = true);
      }
      this.resolveBossHit(mv, h, i, now);
    });
    if (b.mode !== "attack") return; // a slip / deflect / break during this frame already took over

    // once a hit has resolved we know how the player answered: ask Jev how the combo should go on
    for (const g of b.gates) if (!g.requested && !g.applied && b.hit[g.def.after]) this.requestGate(g, now);

    const ended = mv.endFrame !== undefined ? fr >= mv.endFrame : f.done;
    if (ended && !holding) {
      const g = b.gates.find((x) => !x.applied && x.def.at === "end");
      if (g) {
        if (!b.endSince) b.endSince = now;
        if (g.requested && g.ans === null && now - b.endSince < GATE_WAIT) return; // poised, waiting on Jev
        if (this.applyGate(g, now) === "abort") return;
      }
      const mt2 = this.moveType(mv);
      this.endMove(now, mt2 === "heavy" || mt2 === "sweep" || mv.kind === "beam" || mv.kind === "buff" ? 750 : 520);
    }
  }

  private resolveBossHit(mv: MoveDef, h: HitDef, i: number, now: number) {
    const b = this.b, p = this.p, f = this.boss;
    if (p.mode === "dead") return void (b.hit[i] = true);
    const inRange = inShape(h.shape, f.x, f.y, b.atkDir, this.player.x, this.player.y, HERO.radius);
    if (!inRange) return;

    if (h.type !== "grab" && this.isIframes(now)) {
      b.dodged[i] = true;
      if (h.type === "thrust" && !b.slipped) {
        b.slipped = true;
        b.hit[i] = true;
        b.res[i] = "slipped";
        this.tel.outcome(mv.id, "slipped");
        this.slip(now);
      }
      return; // dodged: not consumed, so a late roll end can still be hit within the window
    }
    b.hit[i] = true;
    b.slipped = false;

    if (h.type === "grab") {
      b.res[i] = "hit";
      this.tel.outcome(mv.id, "hit");
      return this.hurtPlayer(h, "grab", now);
    }
    if (p.mode === "guard" && (h.type === "normal" || h.type === "heavy")) {
      const inWindow = !p.noDeflect && now - p.guardSince <= this.deflectMs();
      b.res[i] = inWindow ? "deflected" : "blocked";
      this.tel.outcome(mv.id, b.res[i]!);
      return this.hurtPlayer(h, inWindow ? "deflect" : "block", now);
    }
    b.res[i] = "hit";
    this.tel.outcome(mv.id, "hit");
    this.hurtPlayer(h, "hit", now);
  }

  private slip(now: number) {
    const b = this.b;
    b.posture = Math.min(100, b.posture + 30);
    b.lastPostureHit = now;
    this.boss.freeze(false);
    b.held = false;
    b.moveToken++;
    this.setB("flinch", 700);
    this.boss.play(this.def.anims.hit, undefined, { restart: true });
    b.glyph = null;
    this.popup(this.boss.x, this.boss.y - this.def.headY - 14, "SLIP", "#ff8a8a");
    this.sfx.slip();
    this.ring(this.boss.x, this.boss.y - this.def.headY * 0.45, 0xff8a8a, 30);
    this.stop(130);
    this.checkBossBreak(now);
  }

  // ------------------------------------------------------------ the boss hurts the player
  private hurtPlayer(h: HitDef, kind: "hit" | "block" | "deflect" | "grab", now: number) {
    const p = this.p, f = this.player, b = this.b;
    const cp = this.chest(f, 30);
    const away = angleTo(this.boss.x, this.boss.y, f.x, f.y);

    if (kind === "deflect") {
      this.tel.record("deflect", now);
      b.posture = Math.min(100, b.posture + h.deflectPosture);
      b.lastPostureHit = now;
      this.sfx.deflect();
      this.burst(cp.x + f.face * 10, cp.y, 22, 0xfff2b0, 170, 2.2);
      this.ring(cp.x + f.face * 10, cp.y, 0xffffff, 28);
      this.popup(f.x, f.y - 74, "DEFLECT", "#fff2b0");
      this.stop(GAME.hitstopDeflect);
      this.cameras.main.shake(90, 0.003);
      f.move(this.world, Math.cos(away) * 6, Math.sin(away) * 6);
      this.boss.move(this.world, -Math.cos(away) * 6, -Math.sin(away) * 6);
      this.checkBossBreak(now);
      return;
    }
    const dmgMul = (this.time.now < this.b.armorUntil ? 1.25 : 1) * DIFFICULTY[settings.difficulty].received;
    if (kind === "block") {
      p.hp -= h.damage * dmgMul * HERO.chipFraction;
      p.posture += h.posture;
      p.lastPostureHit = now;
      this.sfx.block(1);
      this.burst(cp.x + f.face * 10, cp.y, 10, 0xffa94d, 110, 1.8);
      this.stop(GAME.hitstopLight);
      f.move(this.world, Math.cos(away) * 14, Math.sin(away) * 14);
      if (p.hp <= 0) return this.killPlayer();
      if (p.posture >= HERO.maxPosture) this.breakPlayer(now);
      return;
    }
    // unblocked hit / grab
    this.tel.record("hurt", now);
    const mult = p.mode === "broken" ? 1.5 : 1;
    p.hp -= h.damage * mult * dmgMul;
    p.posture += h.posture * 0.4;
    p.lastPostureHit = now;
    this.sfx.hurt();
    this.burst(cp.x, cp.y, 12, 0xff4d4d, 130, 2);
    this.stop(kind === "grab" ? 200 : GAME.hitstopHeavy);
    this.cameras.main.shake(180, kind === "grab" ? 0.01 : 0.006);
    f.move(this.world, Math.cos(away) * (kind === "grab" ? 30 : 20), Math.sin(away) * (kind === "grab" ? 30 : 20));
    if (p.hp <= 0) return this.killPlayer();
    if (p.posture >= HERO.maxPosture) return this.breakPlayer(now);
    p.invulnUntil = now + 450;
    this.setP("hurt");
    f.play("hitA", undefined, { restart: true });
    this.popup(f.x, f.y - 74, kind === "grab" ? "GRABBED" : h.type === "thrust" || h.type === "sweep" ? "UNBLOCKABLE" : "HIT", "#ff9a9a");
  }

  private breakPlayer(now: number) {
    this.setP("broken");
    this.player.play("hitB", 4, { restart: true });
    this.popup(this.player.x, this.player.y - 74, "POSTURE BROKEN", "#ffd36b");
    this.sfx.postureBreak();
    this.cameras.main.shake(200, 0.008);
    this.p.invulnUntil = now + 300;
  }

  private killPlayer() {
    this.p.hp = 0;
    this.setP("dead");
    this.player.play("dead", undefined, { restart: true });
    save.deaths++;
    saveGame();
    this.hud.message = "YOU DIED";
    this.hud.sub = "R to try again";
    this.sfx.stopMusic();
    this.hooks.onLog("player died");
  }

  // ------------------------------------------------------------ camera + fx
  private updateCamera(dt: number) {
    const cam = this.cameras.main, p = this.player, b = this.boss;
    let tx = p.x, ty = p.y - 22;
    if (this.bossActive()) {
      tx = p.x * 0.62 + b.x * 0.38;
      ty = p.y * 0.62 + b.y * 0.38 - 22;
    }
    const k = Math.min(1, dt * 5);
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.y += (ty - this.cam.y) * k;
    cam.centerOn(this.cam.x, this.cam.y);
  }

  private drawFx(now: number, deltaMs: number) {
    const g = this.fx;
    // sealed gate
    if (this.world.gate && !this.world.gateOpen) {
      const gt = this.world.gate;
      const y = (gt.t + gt.b) / 2;
      const a = 0.35 + 0.15 * Math.sin(now / 120);
      g.fillStyle(0x8a4bff, a * 0.5).fillRect(gt.l, y - 14, gt.r - gt.l, 28);
      g.fillStyle(0xc9a0ff, a).fillRect(gt.l, y - 2, gt.r - gt.l, 4);
    }
    // laser charge: aim line along the floor + a swelling orb
    const bb = this.b;
    if (bb.mode === "attack" && bb.move?.kind === "beam" && bb.held && bb.holdIdx === 1) {
      const ang = bb.atkDir, len = bb.move.beam!.length;
      const ox = this.boss.x + Math.cos(ang) * (this.def.radius + 6), oy = this.boss.y + Math.sin(ang) * (this.def.radius + 6);
      const locked = now >= bb.holdUntil - bb.move.beam!.lockMs;
      const pulse = 0.35 + 0.3 * Math.sin(now / (locked ? 35 : 80));
      g.lineStyle(bb.move.beam!.halfWidth * 2, locked ? 0xff4b2b : 0xff8a2b, locked ? 0.35 + pulse * 0.4 : pulse * 0.25).lineBetween(ox, oy - 14, ox + Math.cos(ang) * len, oy - 14 + Math.sin(ang) * len);
      if (locked) g.lineStyle(2, 0xffffff, 0.8).lineBetween(ox, oy - 14, ox + Math.cos(ang) * len, oy - 14 + Math.sin(ang) * len);
      g.fillStyle(0x8fe8ff, 0.9).fillCircle(ox, oy - 14, 5 + 3 * Math.sin(now / 50));
    }
    // danger glyph over the boss
    const b = this.b;
    if (b.glyph && b.mode === "attack") {
      const gl = GLYPH[b.glyph.type]!;
      const gx = this.boss.x, gy = this.boss.y - this.def.headY - 14;
      const pulse = 1 + 0.18 * Math.sin(now / 55);
      g.fillStyle(gl.color, 0.95).fillCircle(gx, gy, 9 * pulse);
      g.lineStyle(2, 0xffffff, 0.9).strokeCircle(gx, gy, 9 * pulse);
      this.glyphText.setVisible(true).setPosition(gx, gy);
    } else this.glyphText.setVisible(false);

    for (const s of this.sparks) {
      s.life += deltaMs;
      s.x += (s.vx * deltaMs) / 1000;
      s.y += (s.vy * deltaMs) / 1000;
      s.vy += (380 * deltaMs) / 1000;
      const a = Math.max(0, 1 - s.life / s.max);
      g.fillStyle(s.color, a).fillRect(s.x, s.y, s.size, s.size);
    }
    this.sparks = this.sparks.filter((s) => s.life < s.max);
    for (const r of this.rings) {
      r.life += deltaMs;
      const t = r.life / r.max;
      g.lineStyle(2, r.color, 1 - t).strokeCircle(r.x, r.y, r.r * (0.4 + t));
    }
    this.rings = this.rings.filter((r) => r.life < r.max);
  }
}
