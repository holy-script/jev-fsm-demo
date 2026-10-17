import * as Phaser from "phaser";
import { Fighter, World, angleTo, dist, inShape, type DuelManifest } from "./engine";
import { AREAS, BOSSES, ENCOUNTERS, GAME, GLYPH, HERO, HERO_MOVES, LIGHT_CHAIN, SPIRIT, TILE, ZOOM, type AtkType, type BossDef, type AreaDef, type GateDef, type HitDef, type MoveDef, type SpawnDef } from "./data";
import { DIFFICULTY, save, saveGame, settings } from "./settings";
import { Vfx } from "./vfx";
import { awardPoint, has } from "./skills";
import { runTutorial, type TutorialHost } from "./tutorial";
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
  brain: "JEV" | "RULES"; thinking: boolean; last: string; bossArmor: boolean; brainActual?: "JEV" | "RULES";
  spirit: number; maxSpirit: number; riposte: boolean; art: boolean; tool: boolean;
  dialog: { who: string; text: string; done: boolean; i: number; n: number } | null;
  card: { text: string; sub: string; alpha: number } | null;
  objective: { title: string; text: string; progress?: string; hint?: string } | null;
}
interface Proj { x: number; y: number; vx: number; vy: number; spr: Phaser.GameObjects.Sprite; dmg: number; post: number; defl: number; moveId: string; reflected: boolean; consumed: boolean; dodged: boolean; born: number }
interface Beam { x: number; y: number; ang: number; until: number; len: number; half: number; spr: Phaser.GameObjects.Sprite; dmg: number; post: number; moveId: string; hit: boolean; dodged: boolean }
interface GateRt { def: GateDef; requested: boolean; asking: boolean; ans: string | null; applied: boolean }
const GATE_WAIT = 450; // how long a poised boss waits for Jev's branch answer before taking the default
const ASK_TIMEOUT = 1500;
const SKILL_IDS = ["keen", "echo", "wrist", "rollcut", "whirl", "reach", "blades", "well", "gourd"];
const CAPTAIN_STEP = (speed: number) => speed * 0.55; // speed of the post-string recoil step

type PMode = "free" | "guard" | "attack" | "roll" | "kick" | "heal" | "hurt" | "broken" | "dead";
type BMode = "idle" | "move" | "attack" | "recover" | "guard" | "flinch" | "broken" | "dead";

interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; color: number; size: number }
interface Ring { x: number; y: number; life: number; max: number; color: number; r: number }

const FPS: Record<string, number> = {
  hero_idle: 8, hero_walk: 12, hero_run: 14, hero_block: 8, hero_blockUp: 14, hero_blockHigh: 12, hero_roll: 24, hero_hitA: 12, hero_hitB: 10,
  hero_dead: 8, hero_kick: 16, cap_idle: 6, cap_walk: 8, cap_hit: 12, cap_dead: 7, cap_block: 8, cap_jump: 10,
  vfx_hit01: 28, vfx_hit03: 28, vfx_hit05: 28, vfx_impact01: 30, vfx_break01: 28, vfx_blood: 22, vfx_shards: 26, vfx_splash: 28, vfx_smoke: 22, vfx_heal: 20,
  sk_idle: 5, sk_walk: 9, sk_atkA: 14, sk_atkB: 12, sk_hit: 12, sk_dead: 8, sp_idle: 5, sp_walk: 9, sp_atkA: 14, sp_atkB: 14, sp_hit: 12, sp_dead: 8,
  golem_idle: 5, golem_glow: 10, golem_arm: 12, golem_block: 12, golem_hit: 10, golem_melee: 12, golem_laser: 10, golem_armor: 10, golem_dead: 8, fx_beam: 14, fx_fist: 14,
};
const LOOP = new Set(["hero_idle", "hero_walk", "hero_run", "hero_block", "cap_idle", "cap_walk", "golem_idle", "sk_idle", "sk_walk", "sp_idle", "sp_walk"]);

export class DuelScene extends Phaser.Scene {
  private hooks!: DuelHooks;
  private man!: DuelManifest;
  private world!: World;
  private def: BossDef = ENCOUNTERS[0];
  private bossIdx = 0;
  private areaId = "monastery";
  private zoneId = "";
  private map?: Phaser.Tilemaps.Tilemap;
  private mapObjs: Phaser.GameObjects.GameObject[] = [];
  private travelling = false;
  private card: { text: string; sub: string; t0: number } | null = null;
  // tutorial / dialogue state
  private dlg: { lines: { who: string; text: string }[]; i: number; shown: number; resolve: () => void } | null = null;
  private waiters: { cond: () => boolean; resolve: (v: boolean) => void; start: number; opts: { progress?: () => string; hints?: { afterMs: number; text: string }[]; timeoutMs?: number } }[] = [];
  private cnt: Record<string, number> = {};
  private shadeLoop: { moves: string[]; gap: number; i: number; next: number } | null = null;
  private shadeGuardEvery = 0;
  private shadeGuardNext = 0;
  private shadeSpeed = 1;
  private ringAidOn = false;
  private npc?: Fighter;
  private npcLabel?: Phaser.GameObjects.Text;
  private tutorialOn = false;
  private tutCancelled = false;
  private movedTotal = 0;
  private movedBase = 0;
  private lastPx = 0;
  private lastPy = 0;
  private shrineResolve: (() => void) | null = null;
  private projs: Proj[] = [];
  private blades: { x: number; y: number; vx: number; vy: number; born: number }[] = [];
  private beams: Beam[] = [];
  private sfx!: Sfx;
  private vfx!: Vfx;
  private afterAt = 0;
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
    spirit: 0, riposteUntil: 0, artBuf: 0, toolBuf: 0, thrown: false,
  };
  // boss
  private b = {
    hp: 0, seg: 0, posture: 0, mode: "idle" as BMode, since: 0, until: 0, move: null as MoveDef | null, hit: [] as boolean[], dodged: [] as boolean[],
    held: false, holdIdx: 0, holdUntil: 0, atkDir: 0, awake: false, auto: true, nextThink: 0, lastPostureHit: 0, slipped: false,
    cd: {} as Record<string, number>, poiseUntil: 0, armorUntil: 0, spawned: [] as boolean[], buffed: false, last: "", sounded: false, glyph: null as { type: keyof typeof GLYPH; until: number } | null, moveDir: 0,
    decision: null as (Decision & { at: number }) | null, asking: false, askId: 0, askedAt: 0, nextAsk: 0,
    moveKind: "approach" as "approach" | "backstep" | "circle", circleDir: 1 as 1 | -1, history: [] as string[],
    gates: [] as GateRt[], plan: null as number[] | null, holdTotal: 0, moveToken: 0, endSince: 0, res: [] as (Outcome | null)[],
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
    this.loadArea("monastery");

    this.sfx = new Sfx(this, this.man);
    this.vfx = new Vfx(this);
    this.player = new Fighter(this, "hero", this.man.sheets, HERO.radius, 1);
    this.fx = this.add.graphics().setDepth(40);
    this.glyphText = this.add.text(0, 0, "!", { fontFamily: "monospace", fontSize: "14px", color: "#fff", fontStyle: "bold" }).setOrigin(0.5).setDepth(45).setResolution(2).setVisible(false);

    this.keys = this.input.keyboard!.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE,SHIFT,J,K,E,Q,R,M,Z,X,C,V,B,G,N,T,Y,F,ONE,TWO,ESC,L,I,ENTER") as Record<string, Phaser.Input.Keyboard.Key>;
    this.input.mouse?.disableContextMenu();
    const buf = (field: "atkBuf" | "heavyBuf" | "rollBuf" | "kickBuf" | "healBuf" | "artBuf" | "toolBuf") => () => (this.p[field] = this.time.now + 220);
    this.keys.J.on("down", buf("atkBuf"));
    this.keys.K.on("down", buf("heavyBuf"));
    this.keys.SHIFT.on("down", buf("rollBuf"));
    this.keys.E.on("down", buf("kickBuf"));
    this.keys.L.on("down", buf("artBuf"));
    this.keys.I.on("down", buf("toolBuf"));
    this.keys.Q.on("down", buf("healBuf"));
    this.input.on("pointerdown", (ptr: Phaser.Input.Pointer) => {
      if (!ptr.rightButtonDown()) this.p.atkBuf = this.time.now + 220;
    });
    this.keys.R.on("down", () => {
      if (this.tutorialOn) {
        this.p.hp = HERO.maxHp;
        this.p.posture = 0;
        return;
      }
      this.reset(this.bossIdx);
    });
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
    this.keys.ONE.on("down", () => !this.tutorialOn && this.reset(this.idxOf("captain")));
    this.keys.TWO.on("down", () => !this.tutorialOn && this.reset(this.idxOf("golem")));

    this.events.on("skills-closed", () => this.finishShrine());
    this.hud = { hp: 1, posture: 0, heals: HERO.heals, bossVisible: false, bossName: BOSSES[0].name, bossHp: 1, bossSegs: BOSSES[0].segments, bossSeg: 0, bossPosture: 0, bossGuard: false, message: "", sub: "", auto: true, music: true, brain: "JEV", thinking: false, last: "", bossArmor: false, spirit: 0, maxSpirit: 3, riposte: false, art: false, tool: false, dialog: null, objective: null, card: null };
    this.registry.set("hud", this.hud);
    if (process.env.NODE_ENV !== "production") (window as unknown as { __duel?: DuelScene }).__duel = this; // for scripted tests
    this.scene.launch("duelhud");
    for (const k of [this.keys.ENTER, this.keys.SPACE, this.keys.J]) k.on("down", () => this.dlgAdvance());
    this.begin();
  }

  /** The tests and dev mode (?dev=1) use the two bosses; the real game starts with the tutorial. */
  private seq(): BossDef[] {
    return this.registry.get("dev") ? BOSSES : ENCOUNTERS;
  }
  private idxOf(id: string) {
    return Math.max(0, this.seq().findIndex((d) => d.id === id));
  }
  private spawnBoss(idx: number) {
    this.bossIdx = idx;
    this.def = this.seq()[idx];
    this.boss?.sprite.destroy();
    this.boss = new Fighter(this, this.def.prefix, this.man.sheets, this.def.radius, this.def.scale, this.def.nativeDir ?? 1, this.def.anchorX);
    const home = this.def.training ? this.world.spawns.shade : this.world.spawns.boss;
    this.boss.x = home.x;
    this.boss.y = home.y;
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
    const want = this.areaFor(this.seq()[idx]);
    if (want !== this.areaId) this.loadArea(want);
    const w = this.world;
    const s = w.spawns;
    this.clearEntities();
    this.player.x = s.player.x;
    this.player.y = s.player.y;
    this.player.face = 1;
    Object.assign(this.p, { hp: HERO.maxHp, posture: 0, mode: "free", since: this.time.now, move: null, chain: 0, heals: HERO.heals, invulnUntil: 0, rollCd: 0, spirit: 1, riposteUntil: 0 });
    this.blades = [];
    this.spawnBoss(idx);
    this.player.freeze(false);
    this.boss.freeze(false);
    w.gateOpen = true;
    this.locked = false;
    this.cameras.main.setBounds(0, 0, this.world.w * TILE, this.world.h * TILE);
    this.cam.x = this.player.x;
    this.cam.y = this.player.y - 20;
    this.sfx.playMusic(AREAS[this.areaId].music, 0.22);
    this.hud.message = "";
    this.hud.sub = "";
    this.hud.bossVisible = false;
    this.player.play("idle", undefined, { loop: true, restart: true });
  }

  /** After a boss falls: heal a little, then the next guardian rises in the same arena. */
  private nextBoss(heal = 40) {
    if (this.p.mode === "dead") return;
    const nextDef = this.seq()[this.bossIdx + 1];
    if (this.areaFor(nextDef) !== this.areaId) return this.travel(this.bossIdx + 1);
    this.p.hp = Math.min(HERO.maxHp, this.p.hp + heal);
    this.p.posture = 0;
    if (heal >= 40) this.p.heals = Math.min(HERO.heals, this.p.heals + 1);
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
    this.p.spirit = this.maxSpirit();
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
    this.hud.spirit = this.p.spirit;
    this.hud.maxSpirit = this.maxSpirit();
    this.hud.riposte = this.time.now < this.p.riposteUntil;
    this.hud.art = has("whirl");
    this.hud.tool = has("blades");
    this.hud.brainActual = this.def.brain === "rules" ? "RULES" : this.hud.brain;
    this.hud.thinking = this.b.asking || this.b.gates.some((g) => g.asking && !g.applied);

    if (this.hitstop > 0) {
      this.hitstop -= deltaMs;
      this.player.sprite.anims.timeScale = 0;
      this.boss.sprite.anims.timeScale = 0;
    } else if (this.travelling) {
      this.player.sprite.anims.timeScale = 0;
    } else if (this.dlg) {
      this.updateDialogue(deltaMs / 1000);
      this.player.sprite.anims.timeScale = 0;
      this.boss.sprite.anims.timeScale = 0;
    } else {
      const dt = Math.min(deltaMs, 50) / 1000;
      if (this.def.training && this.p.mode !== "dead") this.p.hp = Math.max(this.p.hp, 20); // tutorial mercy
      this.movedTotal += dist(this.lastPx, this.lastPy, this.player.x, this.player.y);
      this.updatePlayer(now, dt);
      if (this.bossActive()) {
        const dd = dist(this.player.x, this.player.y, this.boss.x, this.boss.y);
        this.tel.sampleDistance(now, dd);
        this.tel.watchRetreat(now, dd);
      }
      this.updateBoss(now, dt);
      this.updateProjectiles(now, dt);
      this.updateBeams(now);
      this.updateBlades(now, dt);
      this.separate(dt);
      this.checkWake();
      this.updateWaiters(now);
    }
    this.lastPx = this.player.x;
    this.lastPy = this.player.y;
    this.updateNpc(now);
    this.updateZone(now);
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
        if (p.artBuf > now) {
          p.artBuf = 0;
          if (!has("whirl")) this.lockedMsg("not learned");
          else if (p.spirit < SPIRIT.whirlCost) this.lockedMsg("need spirit");
          else return this.startMove(now, "WHIRL", "attack");
        }
        if (p.toolBuf > now) {
          p.toolBuf = 0;
          if (!has("blades")) this.lockedMsg("not learned");
          else if (p.spirit < SPIRIT.bladeCost) this.lockedMsg("need spirit");
          else if (!this.bossActive()) this.lockedMsg("no target");
          else return this.startMove(now, "THROW", "attack");
        }
        if (p.kickBuf > now) return this.startMove(now, "KICK", "kick");
        if (p.heavyBuf > now) return this.startMove(now, "D", "attack");
        if (p.atkBuf > now) {
          if (now < p.riposteUntil && this.bossActive()) return this.startMove(now, "RIPOSTE", "attack");
          if (now > p.chainUntil) p.chain = 0;
          return this.startMove(now, LIGHT_CHAIN[p.chain % LIGHT_CHAIN.length], "attack");
        }
        break;
      }
      case "attack":
      case "kick": {
        const mv = p.move!;
        this.runPlayerMove(now, dt, mv, ix, iy);
        const lastHit = mv.hits.length ? Math.max(...mv.hits.map((h) => h.frames[1])) : 99;
        if (p.mode === "attack" && f.frame > lastHit) {
          // cancel windows: chain the next light, roll, or guard out of recovery
          if (p.rollBuf > now && now >= p.rollCd) return this.startRoll(now, mx, my, moving);
          if (p.atkBuf > now && mv.id !== "D" && !["RIPOSTE", "ROLLCUT", "WHIRL", "THROW"].includes(mv.id)) {
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
        if ((p.mode as PMode) !== "free" && (p.mode as PMode) !== "guard" && (mv.endFrame !== undefined ? f.frame >= mv.endFrame : f.done)) {
          if (mv.id !== "D" && mv.id !== "KICK" && mv.id !== "RIPOSTE" && mv.id !== "WHIRL" && mv.id !== "THROW") p.chainUntil = now + 420;
          else p.chain = 0;
          this.setP("free");
        }
        break;
      }
      case "roll": {
        const t = now - p.since;
        const sp = t < HERO.rollMs * 0.8 ? HERO.rollSpeed : HERO.rollSpeed * 0.25;
        f.move(this.world, p.rollDir.x * sp * dt, p.rollDir.y * sp * dt);
        if (now >= this.afterAt && t < HERO.rollMs * 0.85) {
          this.afterAt = now + 45;
          this.vfx.afterimage(f, 0x8fd0ff, 0.35, 230);
        }
        if (p.atkBuf > now && t > HERO.rollMs * 0.3 && has("rollcut") && this.bossActive()) {
          p.rollCd = now + HERO.rollCooldownMs;
          return this.startMove(now, "ROLLCUT", "attack");
        }
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
        if (!f.flashing && Math.floor((now - p.since) / 170) % 2 === 1) f.hitFlash(85, 0x6bff9a); // green pulse: no drinking animation, so the body glows instead
        if (now - p.since >= HERO.healMs * (has("gourd") ? 0.7 : 1)) {
          p.hp = Math.min(HERO.maxHp, p.hp + HERO.healAmount);
          p.heals--;
          this.tutEvent("heal");
          this.vfx.heal(f.x, f.y - 34);
          f.hitFlash(160, 0xc8ffd9);
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
    p.thrown = false;
    this.tel.record(id === "KICK" ? "kick" : id === "WHIRL" ? "art" : id === "THROW" ? "tool" : id === "RIPOSTE" ? "riposte" : "attack", now);
    this.tel.react("attack", now);
    if (id === "WHIRL") p.spirit -= SPIRIT.whirlCost;
    if (id === "THROW") p.spirit -= SPIRIT.bladeCost;
    if (id === "RIPOSTE") {
      p.riposteUntil = 0;
      this.vfx.afterimage(f, 0xfff2b0, 0.5, 260);
    }
    this.setP(mode);
    f.face = this.bossActive() ? (this.boss.x >= f.x ? 1 : -1) : f.face;
    p.dir = this.bossActive() ? this.aimAtBoss() : f.face > 0 ? 0 : Math.PI;
    f.play(mv.anim, mv.fps * (this.beatMode() ? 0.85 : 1), { restart: true }); // a touch slower in choreographed mode
    if (id === "WHIRL") this.sfx.whirl();
    else if (id !== "THROW") this.sfx.swing(id === "D");
  }

  private runPlayerMove(now: number, dt: number, mv: MoveDef, ix: number, iy: number) {
    const p = this.p, f = this.player;
    const fr = f.frame;
    if (this.bossActive() && fr < Math.min(...mv.hits.map((h) => h.frames[0]))) p.dir = this.aimAtBoss(); // aim assist until the swing commits
    for (const l of mv.lunge ?? []) if (fr >= l.frames[0] && fr <= l.frames[1]) f.move(this.world, Math.cos(p.dir) * l.speed * dt, Math.sin(p.dir) * l.speed * dt);
    if (mv.id === "THROW" && !p.thrown && fr >= 2) {
      p.thrown = true;
      this.spawnBlade();
    }
    if (mv.id === "WHIRL" && !p.thrown && fr >= 3) {
      p.thrown = true;
      for (let i = 0; i < 3; i++) this.vfx.play("hit05", f.x, f.y - 30, { scale: 2.4, tint: 0xfff2b0, rot: (i * Math.PI * 2) / 3, add: true });
      this.vfx.shock(f.x, f.y - 8, 0xfff2b0, 1.9);
    }
    if (mv.id === "ROLLCUT" || mv.id === "RIPOSTE") if (now - this.afterAt > 40) {
      this.afterAt = now;
      this.vfx.afterimage(f, 0xfff2b0, 0.3, 200);
    }
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

  // ------------------------------------------------------------ areas
  private areaFor(def: BossDef): string {
    return this.registry.get("dev") ? "monastery" : def.area ?? "monastery";
  }

  /** Builds an area: its tilemap, tints, background and collision world. */
  private loadArea(id: string) {
    const area: AreaDef = AREAS[id];
    this.mapObjs.forEach((o) => o.destroy());
    this.mapObjs = [];
    this.map?.destroy();
    const map = this.make.tilemap({ key: area.map });
    const ts = map.addTilesetImage("duel_tiles", "duel_tiles")!;
    this.mapObjs.push(map.createLayer("ground", ts)!.setDepth(0).setTint(area.groundTint), map.createLayer("walls", ts)!.setDepth(1).setTint(area.wallTint));
    this.map = map;
    this.world = new World(map);
    this.areaId = id;
    this.zoneId = "";
    this.cameras.main.setBackgroundColor(area.bg).setZoom(ZOOM).setBounds(0, 0, map.widthInPixels, map.heightInPixels).setRoundPixels(true);
    if (area.stars) {
      const g = this.add.graphics().setDepth(-5);
      for (let i = 0; i < 160; i++) g.fillStyle(0xdfe6ff, 0.25 + Math.random() * 0.6).fillRect(Math.random() * map.widthInPixels, Math.random() * map.heightInPixels, Math.random() < 0.15 ? 2 : 1, Math.random() < 0.15 ? 2 : 1);
      this.mapObjs.push(g);
    }
  }

  /** Fade out, load the next area and its encounter, fade in with a title card. */
  private travel(idx: number) {
    if (this.travelling) return;
    this.travelling = true;
    this.cameras.main.fadeOut(700, 0, 0, 0);
    this.cameras.main.once("camerafadeoutcomplete", () => {
      this.reset(idx);
      this.travelling = false;
      const area = AREAS[this.areaId];
      this.showCard(area.name, area.zones[0].sub);
      this.cameras.main.fadeIn(900, 0, 0, 0);
      this.hooks.onLog(`arrived: ${area.name}`);
    });
  }

  private showCard(text: string, sub: string) {
    this.card = { text, sub, t0: this.time.now };
  }
  private updateZone(now: number) {
    const area = AREAS[this.areaId];
    const ty = this.player.y / TILE;
    const z = area.zones.find((zz) => ty >= zz.yMin && ty <= zz.yMax);
    if (z && z.id !== this.zoneId) {
      if (this.zoneId && !this.travelling) this.showCard(z.name, z.sub);
      this.zoneId = z.id;
    }
    const c = this.card;
    if (!c) return void (this.hud.card = null);
    const t = now - c.t0;
    if (t > 3600) {
      this.card = null;
      this.hud.card = null;
      return;
    }
    this.hud.card = { text: c.text, sub: c.sub, alpha: t < 500 ? t / 500 : t > 2800 ? Math.max(0, 1 - (t - 2800) / 800) : 1 };
  }

  // ------------------------------------------------------------ dialogue, objectives and the tutorial
  private clearInputBuffers() {
    const p = this.p;
    p.atkBuf = p.heavyBuf = p.rollBuf = p.kickBuf = p.healBuf = p.artBuf = p.toolBuf = 0;
  }

  say(who: string, lines: string[]): Promise<void> {
    if (this.tutCancelled) return Promise.reject(new Error("cancelled"));
    return new Promise((resolve) => {
      this.dlg = { lines: lines.map((text) => ({ who, text })), i: 0, shown: 0, resolve };
      this.clearInputBuffers();
    });
  }
  private dlgAdvance() {
    const d = this.dlg;
    if (!d) return;
    if (d.shown < d.lines[d.i].text.length) {
      d.shown = d.lines[d.i].text.length;
      return;
    }
    d.i++;
    d.shown = 0;
    if (d.i >= d.lines.length) {
      this.dlg = null;
      this.hud.dialog = null;
      this.clearInputBuffers();
      d.resolve();
    }
  }
  private updateDialogue(dt: number) {
    const d = this.dlg;
    if (!d) return;
    const line = d.lines[d.i];
    const before = Math.floor(d.shown / 3);
    d.shown = Math.min(line.text.length, d.shown + dt * 48);
    if (Math.floor(d.shown / 3) !== before && d.shown < line.text.length) this.sfx.blip(line.who);
    this.hud.dialog = { who: line.who, text: line.text.slice(0, Math.floor(d.shown)), done: d.shown >= line.text.length, i: d.i + 1, n: d.lines.length };
  }

  private until(cond: () => boolean, opts: { progress?: () => string; hints?: { afterMs: number; text: string }[]; timeoutMs?: number } = {}): Promise<boolean> {
    if (this.tutCancelled) return Promise.reject(new Error("cancelled"));
    return new Promise((resolve) => this.waiters.push({ cond, resolve, start: this.time.now, opts }));
  }
  private updateWaiters(now: number) {
    for (const w of [...this.waiters]) {
      const o = this.hud.objective;
      if (w.cond()) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        if (o) {
          this.sfx.skill();
          this.popup(this.player.x, this.player.y - 80, "✓", "#7ee787");
        }
        w.resolve(true);
        continue;
      }
      if (o) {
        o.progress = w.opts.progress?.();
        const hint = [...(w.opts.hints ?? [])].reverse().find((h) => now - w.start >= h.afterMs);
        o.hint = hint?.text;
      }
      if (w.opts.timeoutMs && now - w.start > w.opts.timeoutMs) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        w.resolve(false);
      }
    }
  }

  isTutorial() {
    return this.tutorialOn;
  }
  /** Skips the rest of the tutorial (pause menu). */
  skipTutorial() {
    if (!this.tutorialOn) return;
    this.tutCancelled = true;
    this.dlg = null;
    this.hud.dialog = null;
    this.waiters.splice(0).forEach((w) => w.resolve(false));
    this.finishTutorial();
  }

  /** Which encounter to start with when loading a save. */
  private firstEncounter() {
    const seq = this.seq();
    const i = seq.findIndex((d) => !d.training && !save.cleared.includes(d.id));
    return i < 0 ? seq.length - 1 : i;
  }
  private begin() {
    if (this.registry.get("dev")) return this.reset(0);
    if (!save.tutorialDone) {
      this.reset(this.idxOf("shade"));
      this.startTutorial();
    } else this.reset(this.firstEncounter());
  }

  private startTutorial() {
    this.tutorialOn = true;
    this.tutCancelled = false;
    this.b.awake = true;
    this.b.auto = false;
    this.hud.bossVisible = true;
    this.world.gateOpen = false; // the way north stays sealed until the lessons are done
    this.sfx.playMusic("temple", 0.2);
    // the Instructor: a pale, translucent echo of the hero
    const sp = this.world.spawns.npc;
    this.npc = new Fighter(this, "hero", this.man.sheets, 6, 1);
    this.npc.x = sp.x;
    this.npc.y = sp.y;
    this.npc.sprite.setAlpha(0.55).setTintFill(0x9fd0ff); // a flat, translucent blue silhouette
    this.npc.play("idle", undefined, { loop: true });
    this.npcLabel = this.add.text(sp.x, sp.y - 70, "INSTRUCTOR", { fontFamily: "monospace", fontSize: "8px", color: "#9fd0ff", stroke: "#000", strokeThickness: 2 }).setOrigin(0.5).setDepth(60).setResolution(2);

    const self = this;
    const host: TutorialHost = {
      say: (who, lines) => self.say(who, lines),
      objective: (o) => { self.hud.objective = o ? { ...o } : null; },
      count: (k) => self.cnt[k] ?? 0,
      resetCounts: () => { self.cnt = {}; self.movedBase = self.movedTotal; },
      until: (cond, opts) => self.until(cond, opts),
      shade: {
        loop: (moves, gap) => { self.shadeLoop = { moves, gap, i: 0, next: Infinity }; },
        stop: () => { self.shadeLoop = null; self.shadeGuardEvery = 0; },
        guardLoop: (every) => { self.shadeGuardEvery = every; self.shadeGuardNext = self.time.now + 1200; },
        speed: (mul) => { self.shadeSpeed = mul; },
      },
      ringAid: (on) => { self.ringAidOn = on; },
      player: {
        setHp: (f) => { self.p.hp = HERO.maxHp * f; },
        giveHeals: (n) => { self.p.heals = Math.max(self.p.heals, n); },
        fill: () => { self.p.hp = HERO.maxHp; self.p.posture = 0; },
        giveSpirit: (n) => { self.p.spirit = Math.min(self.maxSpirit(), Math.max(self.p.spirit, n)); },
      },
      openShrine: () => self.shrineWait(),
      finish: async () => self.finishTutorial(),
      moved: () => self.movedTotal - self.movedBase,
    };
    runTutorial(host).catch((e: Error) => {
      if (e?.message !== "cancelled") console.error(e);
    });
  }

  private shrineWait(): Promise<void> {
    if (this.registry.get("dev")) return Promise.resolve();
    return new Promise((resolve) => {
      this.shrineResolve = resolve;
      this.scene.launch("skills", { from: "duel" });
      this.scene.pause();
    });
  }

  private finishTutorial() {
    if (!this.tutorialOn) return;
    this.tutorialOn = false;
    this.shadeLoop = null;
    this.shadeGuardEvery = 0;
    this.ringAidOn = false;
    this.hud.objective = null;
    save.tutorialDone = true;
    saveGame();
    this.p.hp = HERO.maxHp;
    this.p.posture = 0;
    this.world.gateOpen = true;
    const shade = this.boss;
    this.tweens.add({ targets: [shade.sprite, this.npc?.sprite, this.npcLabel].filter(Boolean), alpha: 0, duration: 900, onComplete: () => { this.npc?.sprite.destroy(); this.npcLabel?.destroy(); this.npc = undefined; } });
    this.time.delayedCall(950, () => {
      if (this.def.id !== "shade") return;
      this.spawnBoss(this.bossIdx + 1);
      this.hud.bossVisible = false;
      this.sfx.playMusic("castle", 0.22);
      this.hooks.onLog("tutorial complete: the gate is open");
    });
  }

  private updateNpc(now: number) {
    const n = this.npc;
    if (!n) return;
    n.face = this.player.x >= n.x ? 1 : -1;
    n.sync();
    n.sprite.y += Math.sin(now / 420) * 2.5 - 4; // hovers
    this.npcLabel?.setPosition(n.x, n.y - 72 + Math.sin(now / 420) * 2.5);
  }

  // ---- thrown blades (tool)
  private spawnBlade() {
    const f = this.player, a = this.aimAtBoss();
    this.blades.push({ x: f.x + Math.cos(a) * 12, y: f.y + Math.sin(a) * 12, vx: Math.cos(a) * 430, vy: Math.sin(a) * 430, born: this.time.now });
    this.sfx.throwBlade();
  }

  private updateBlades(now: number, dt: number) {
    for (const bl of this.blades) {
      bl.x += bl.vx * dt;
      bl.y += bl.vy * dt;
      if (now - bl.born > 1300 || this.world.blocked({ l: bl.x - 2, r: bl.x + 2, t: bl.y - 2, b: bl.y + 2 })) {
        bl.born = -1e9;
        continue;
      }
      if (this.bossActive() && dist(bl.x, bl.y, this.boss.x, this.boss.y) < this.def.radius + 8) {
        bl.born = -1e9;
        this.bladeHitsBoss(now);
      }
    }
    this.blades = this.blades.filter((b) => now - b.born <= 1300);
  }

  private bladeHitsBoss(now: number) {
    this.tutEvent("blade");
    const b = this.b, bp = this.chest(this.boss, this.def.headY * 0.45);
    this.sfx.bladeHit();
    this.vfx.hit(bp.x, bp.y, false, 0xdfe9ff);
    if (b.mode === "broken") return; // chip only; a deathblow needs a real strike
    if (b.mode === "guard") {
      if (this.def.stoneGuard) {
        this.popup(this.boss.x, this.boss.y - this.def.headY - 14, "NO EFFECT", "#b8b0a2");
        return;
      }
      b.posture = Math.min(100, b.posture + 12);
      b.lastPostureHit = now;
      this.boss.freeze(false);
      this.setB("flinch", 700);
      this.boss.play(this.def.anims.hit, undefined, { restart: true });
      this.popup(this.boss.x, this.boss.y - this.def.headY - 14, "GUARD NUDGED", "#dfe9ff");
      this.checkBossBreak(now);
      return;
    }
    const armored = now < b.armorUntil;
    b.hp -= 6 * (armored ? 0.5 : 1) * DIFFICULTY[settings.difficulty].dealt;
    if (this.def.training) b.hp = this.def.segmentHp;
    b.posture = Math.min(100, b.posture + 8 * (armored ? 0.7 : 1));
    b.lastPostureHit = now;
    this.boss.hitFlash(60, 0xdfe9ff);
    if (b.mode !== "attack" && now >= b.poiseUntil && !this.def.noFlinch && !armored) {
      this.setB("flinch", 220);
      b.poiseUntil = now + 1100;
      this.boss.play(this.def.anims.hit, undefined, { restart: true });
    }
    if (b.hp <= 0) return this.segmentEmpty(now);
    this.checkBossBreak(now);
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
    this.vfx.dust(f.x, f.y - 6);
    this.afterAt = 0;
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
          this.vfx.shards(bp.x, bp.y, 0xcfc7b8, 2.2);
          this.vfx.shock(bp.x, bp.y, 0xffd36b, 1.8);
          this.vfx.squash(this.boss, 1.2, 0.8, 90);
          this.burst(bp.x, bp.y, 18, 0xcfc7b8, 150, 2.4);
          this.stop(GAME.hitstopHeavy);
          this.cameras.main.shake(160, 0.006);
          this.checkBossBreak(now);
        } else {
          this.p.posture = Math.min(100, this.p.posture + 6);
          this.p.lastPostureHit = now;
          this.player.move(this.world, -this.player.face * 8, 0);
          this.sfx.stoneHit();
          this.vfx.shards(bp.x, bp.y, 0xb8b0a2, 1.0);
          this.burst(bp.x, bp.y, 6, 0xb8b0a2, 80, 1.8);
          this.popup(this.boss.x, this.boss.y - this.def.headY - 14, mv.id === "KICK" ? "NO EFFECT" : "STONE GUARD", "#b8b0a2");
          this.stop(GAME.hitstopLight);
        }
        return;
      }
      if (mv.id === "KICK" || mv.id === "WHIRL") {
        this.tutEvent(mv.id === "KICK" ? "kickbreak" : "whirl");
        b.posture = Math.min(100, b.posture + 28);
        b.lastPostureHit = now;
        this.setB("flinch", 900);
        this.boss.play(this.def.anims.hit, undefined, { restart: true });
        this.popup(this.boss.x, this.boss.y - this.def.headY - 14, "GUARD BREAK", "#ffd36b");
        this.sfx.guardBreak();
        this.vfx.shards(bp.x, bp.y, 0xffd36b, 1.8);
        this.vfx.shock(bp.x, bp.y, 0xffd36b, 1.4);
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
      this.vfx.blockSplash(bp.x, bp.y, -this.player.face);
      this.burst(bp.x, bp.y, 8, 0xffa94d, 90, 1.8);
      this.stop(GAME.hitstopLight);
      this.checkBossBreak(now);
      return;
    }

    const armored = now < b.armorUntil;
    b.hp -= h.damage * (armored ? 0.5 : 1) * DIFFICULTY[settings.difficulty].dealt;
    if (this.def.training) b.hp = this.def.segmentHp; // the Shade cannot be hurt, only broken
    this.tutEvent("hit");
    if (h.type === "heavy") this.tutEvent("heavy");
    if (mv.id === "RIPOSTE") this.tutEvent("riposte");
    if (mv.id === "ROLLCUT") this.tutEvent("rollcut");
    if (mv.id === "WHIRL") this.tutEvent("whirl");
    b.posture = Math.min(100, b.posture + h.posture * (armored ? 0.7 : 1));
    b.lastPostureHit = now;
    this.boss.hitFlash(70);
    this.vfx.hit(bp.x, bp.y, h.type === "heavy", this.def.noFlinch ? 0xcfc7b8 : 0xffe9c2);
    if (this.def.noFlinch) {
      this.vfx.squash(this.boss, 1.06, 0.95, 60); // no hurt animation: the body gives a little
      if (h.type === "heavy") this.vfx.shards(bp.x, bp.y, 0xb8b0a2, 1.4);
    }
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
    this.tutEvent("break");
    this.boss.freeze(false);
    b.held = false;
    this.setB("broken", ms);
    this.boss.play(this.def.anims.hit, 6, { restart: true });
    this.popup(this.boss.x, this.boss.y - this.def.headY - 14, "POSTURE BROKEN", "#ffd36b");
    this.sfx.postureBreak();
    this.vfx.postureBreak(this.boss.x, this.boss.y - this.def.headY * 0.55);
    this.vfx.squash(this.boss, 1.18, 0.84, 110);
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
    this.vfx.deathblow(this.boss.x, this.boss.y - this.def.headY * 0.5);
    this.stop(260);
    this.cameras.main.flash(180, 255, 240, 200);
    this.cameras.main.shake(260, 0.01);
    this.popup(this.boss.x, this.boss.y - this.def.headY - 14, "DEATHBLOW", "#ff5d5d");
    this.burst(this.boss.x, this.boss.y - this.def.headY * 0.45, 30, 0xff5d5d, 200, 2.5);
    if (this.def.training) {
      this.tutEvent("deathblow");
      b.posture = 0;
      this.boss.freeze(false);
      this.setB("flinch", 1600);
      this.boss.play(this.def.anims.hit, undefined, { restart: true });
      return;
    }
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
    const more = this.bossIdx + 1 < this.seq().length;
    this.hud.message = !more ? "VICTORY" : this.def.kind === "grunt" ? "DEFEATED" : "DEMISE";
    this.hud.sub = more ? `${this.seq()[this.bossIdx + 1].name} stirs…` : "R to fight again";
    this.sfx.playMusic(AREAS[this.areaId].music, 0.22);
    this.hooks.onLog(`${this.def.name} defeated`);
    if (!this.def.kind || this.def.kind === "boss") awardPoint(1);
    if (!save.cleared.includes(this.def.id)) save.cleared.push(this.def.id);
    saveGame();
    if (more) {
      if (this.def.kind === "grunt") this.time.delayedCall(2600, () => this.nextBoss(15));
      else this.time.delayedCall(4200, () => this.openShrine());
    }
  }

  // ------------------------------------------------------------ boss
  private moveType(mv: MoveDef): AtkType {
    return mv.kind === "beam" ? "beam" : mv.hits[0]?.type ?? "normal";
  }
  private firstAct(mv: MoveDef) {
    const fs = [...mv.hits.map((h) => h.frames[0]), ...(mv.spawns ?? []).map((x) => x.frame), ...(mv.beam ? [mv.beam.frame] : []), ...(mv.buff ? [mv.buff.frame] : [])];
    return Math.min(...fs);
  }
  private pendingNext = false;
  /** After a boss: the shrine (spend skill points), then the next guardian. The scripted tests skip the screen (?dev=1). */
  private openShrine() {
    if (this.p.mode === "dead") return;
    this.pendingNext = true;
    if (this.registry.get("dev")) return this.finishShrine();
    this.scene.launch("skills", { from: "duel" });
    this.scene.pause();
  }
  private finishShrine() {
    if (this.shrineResolve) {
      const r = this.shrineResolve;
      this.shrineResolve = null;
      r();
      return;
    }
    if (!this.pendingNext) return;
    this.pendingNext = false;
    this.nextBoss();
  }
  private tutEvent(name: string) {
    this.cnt[name] = (this.cnt[name] ?? 0) + 1;
  }
  private outcome(move: string, oc: Parameters<Telemetry["outcome"]>[1]) {
    this.tel.outcome(move, oc);
    this.tutEvent(`${move}:${oc}`);
  }
  private maxSpirit() {
    return SPIRIT.base + (has("well") ? SPIRIT.wellBonus : 0);
  }
  private gainSpirit(n: number) {
    this.p.spirit = Math.min(this.maxSpirit(), this.p.spirit + n);
    this.sfx.spirit();
  }
  /** Opens the riposte window: the next attack becomes a free, heavy counter. */
  private openRiposte(now: number, ms: number) {
    const mul = (has("reach") ? 1.5 : 1);
    this.p.riposteUntil = now + ms * mul + (has("echo") ? 300 : 0);
    this.sfx.riposteReady();
  }
  private lockedMsg(what: string) {
    this.popup(this.player.x, this.player.y - 74, what, "#9aa4b2");
    this.sfx.locked();
  }
  private beatMode() {
    return settings.beat === "beat" && !this.def.training;
  }
  private beatMs() {
    return 60000 / this.sfx.bpm;
  }
  /** First act frame (hit / spawn / beam / buff) strictly after `frame`, or null. */
  private actAfter(mv: MoveDef, frame: number): number | null {
    const fs = [...mv.hits.map((h) => h.frames[0]), ...(mv.spawns ?? []).map((x) => x.frame), ...(mv.beam ? [mv.beam.frame] : []), ...(mv.buff ? [mv.buff.frame] : [])].filter((f) => f > frame);
    return fs.length ? Math.min(...fs) : null;
  }
  /**
   * Choreographed timing: stretch each telegraph hold so the impact that follows it lands on the beat grid.
   * Returns the hold length in ms for every hold of the move.
   */
  private planHolds(mv: MoveDef, now: number): number[] {
    const holds = mv.holds ?? [];
    const m = this.mul(), bm = this.beatMs(), grid = mv.grid ?? 1;
    const fdur = 1000 / (mv.fps * m.fps);
    const b0 = this.sfx.beatPos();
    const plan: number[] = [];
    let t = 0, frame = 0, prevImpact = 0; // t and prevImpact are ms offsets from `now`
    holds.forEach((h, i) => {
      t += (h.frame - frame) * fdur;
      frame = h.frame;
      const next = this.actAfter(mv, h.frame);
      if (h.telegraph === false || next === null) {
        plan.push(h.ms * m.hold);
        t += h.ms * m.hold;
        return;
      }
      const natural = t + (next - h.frame) * fdur;
      const lead = i === 0 ? Math.max(1, (mv.leadBeats ?? 1.5) - (this.phase() === 2 ? 0.5 : 0)) : mv.gapBeats?.[i - 1] ?? 1;
      const ref = i === 0 ? 0 : prevImpact;
      let target = Math.ceil((b0 + ref / bm + lead) / grid - 1e-6) * grid; // beat position
      let tTarget = (target - b0) * bm;
      while (tTarget < natural + 90) tTarget += grid * bm; // never shorter than the animation allows
      const holdMs = tTarget - natural;
      plan.push(holdMs);
      t += holdMs;
      prevImpact = tTarget;
    });
    void now;
    return plan;
  }
  private recoverMs(heavy: boolean) {
    return this.beatMode() ? (heavy ? 1.25 : 0.75) * this.beatMs() : heavy ? 750 : 520;
  }
  private deflectMs() {
    return DIFFICULTY[settings.difficulty].deflectMs + (has("keen") ? 40 : 0);
  }
  /** The tutorial drives the Shade: it telegraphs a scripted list of moves, one after another. */
  private runShade(now: number) {
    const L = this.shadeLoop;
    if (L) {
      if (L.next === Infinity) L.next = now + L.gap;
      if (now >= L.next && this.p.mode !== "dead") {
        const id = L.moves[L.i++ % L.moves.length];
        L.next = Infinity;
        this.forceMove(id);
        return;
      }
    }
    if (this.shadeGuardEvery && now >= this.shadeGuardNext) {
      this.forceGuard();
      this.shadeGuardNext = now + this.shadeGuardEvery;
    }
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
      else if (this.def.tint) f.sprite.setTint(this.def.tint);
      else f.sprite.clearTint();
    }
    const faceP = () => (f.face = this.player.x >= f.x ? 1 : -1);

    switch (b.mode) {
      case "idle":
        faceP();
        f.play(this.def.anims.idle, undefined, { loop: true });
        if (this.def.training) this.runShade(now);
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
        // choreographed mode: after a string the boss takes a small fencing step back, giving the exchange room to breathe
        if (this.beatMode() && b.move && d < 80 && now - b.since < 0.6 * this.beatMs() && this.moveType(b.move) !== "beam")
          f.move(this.world, Math.cos(toPlayer + Math.PI) * CAPTAIN_STEP(this.def.speed) * dt, Math.sin(toPlayer + Math.PI) * CAPTAIN_STEP(this.def.speed) * dt);
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
        standingStillMs: Math.round(now - this.stillSince), guardHeld: p.mode === "guard", spirit: p.spirit, riposteReady: now < p.riposteUntil, skills: (SKILL_IDS.filter((id) => has(id))),
      },
      recent: this.tel.recent(now, 8000),
      vsMove: this.tel.summary(),
      lastOutcome: this.tel.lastOutcome,
      reachable,
      timing: { mode: settings.beat, beatMs: Math.round(this.beatMs()) },
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
    if (this.hud.brain === "RULES" || this.def.brain === "rules") return this.setDecision(rulesIdle(this.def, snap, avail), now);
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
        return this.setB("recover", this.beatMode() ? this.beatMs() : 450 + Math.random() * 300);
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
    b.plan = this.beatMode() ? this.planHolds(mv, now) : null;
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
      this.vfx.shock(this.boss.x, this.boss.y - this.def.headY * 0.45, 0x9fe8ff, 2.4);
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
    if (!pr.consumed && !pr.reflected) this.outcome(pr.moveId, pr.dodged ? "dodged" : "missed");
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
          this.vfx.deflect(this.boss.x, this.boss.y - this.def.headY * 0.45);
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
          this.outcome(pr.moveId, "deflected");
          this.hurtPlayer(h, "deflect", now);
          pr.consumed = false;
          pr.reflected = true;
          pr.vx = -pr.vx * 1.25;
          pr.vy = -pr.vy * 1.25;
          pr.spr.setRotation(pr.spr.rotation + Math.PI);
          pr.born = now;
        } else {
          this.outcome(pr.moveId, "blocked");
          this.hurtPlayer(h, "block", now);
          pr.spr.destroy();
        }
      } else {
        this.outcome(pr.moveId, "hit");
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
          this.outcome(bm.moveId, "hit");
          this.hurtPlayer({ frames: [0, 0], type: "sweep", damage: bm.dmg, posture: bm.post, deflectPosture: 0, shape: { kind: "circle", range: 0 } }, "hit", now);
        }
      }
      if (now >= bm.until) {
        if (!bm.hit) this.outcome(bm.moveId, bm.dodged ? "dodged" : "missed");
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
    if (this.hud.brain === "RULES" || this.def.brain === "rules") return finish(rulesGate(gate, phase));
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
      b.holdUntil = now + (this.beatMode() ? 0.5 * this.beatMs() : 360 * m.hold); // half a beat: lands off the beat
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
      this.endMove(now, this.beatMode() ? 0.5 * this.beatMs() : 380);
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
      const holdMs = (b.plan ? b.plan[b.holdIdx] : holds[b.holdIdx].ms * m.hold) * (this.def.training ? this.shadeSpeed : 1);
      b.holdUntil = now + holdMs;
      b.holdTotal = holdMs;
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
      if (near) {
        f.move(this.world, Math.cos(b.atkDir) * l.speed * dt, Math.sin(b.atkDir) * l.speed * dt);
        if (now >= this.afterAt) {
          this.afterAt = now + 60;
          const tcol = b.glyph ? GLYPH[b.glyph.type]?.color ?? 0xffffff : 0xffffff;
          this.vfx.afterimage(f, tcol, 0.3, 220);
        }
      }
    }

    if (!holding) this.runMoveEffects(mv, fr, now);

    if (!holding) mv.hits.forEach((h, i) => {
      if (b.hit[i] || fr < h.frames[0]) return;
      if (fr > h.frames[1]) {
        if (!b.res[i]) {
          b.res[i] = b.dodged[i] ? "dodged" : "missed";
          this.outcome(mv.id, b.res[i]!);
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
      this.endMove(now, this.recoverMs(mt2 === "heavy" || mt2 === "sweep" || mv.kind === "beam" || mv.kind === "buff"));
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
        this.outcome(mv.id, "slipped");
        this.slip(now);
      }
      return; // dodged: not consumed, so a late roll end can still be hit within the window
    }
    b.hit[i] = true;
    b.slipped = false;

    if (h.type === "grab") {
      b.res[i] = "hit";
      this.outcome(mv.id, "hit");
      return this.hurtPlayer(h, "grab", now);
    }
    if (p.mode === "guard" && (h.type === "normal" || h.type === "heavy")) {
      const inWindow = !p.noDeflect && now - p.guardSince <= this.deflectMs();
      b.res[i] = inWindow ? "deflected" : "blocked";
      this.outcome(mv.id, b.res[i]!);
      return this.hurtPlayer(h, inWindow ? "deflect" : "block", now);
    }
    b.res[i] = "hit";
    this.outcome(mv.id, "hit");
    this.hurtPlayer(h, "hit", now);
  }

  private slip(now: number) {
    const b = this.b;
    this.gainSpirit(1);
    this.openRiposte(now, SPIRIT.slipRiposteMs);
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
    this.vfx.shock(this.boss.x, this.boss.y - this.def.headY * 0.45, 0xff8a8a, 1.6);
    this.vfx.hit(this.boss.x, this.boss.y - this.def.headY * 0.45, true, 0xff8a8a);
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
      this.tutEvent("deflect");
      this.gainSpirit(1 + (has("echo") ? 1 : 0));
      this.openRiposte(now, SPIRIT.riposteMs);
      b.posture = Math.min(100, b.posture + h.deflectPosture * (has("wrist") ? 1.3 : 1));
      b.lastPostureHit = now;
      this.sfx.deflect();
      this.vfx.deflect(cp.x + f.face * 10, cp.y);
      f.hitFlash(70, 0xffffff);
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
      this.tutEvent("block");
      p.hp -= h.damage * dmgMul * HERO.chipFraction;
      p.posture += h.posture;
      p.lastPostureHit = now;
      this.sfx.block(1);
      this.vfx.blockSplash(cp.x + f.face * 12, cp.y, f.face);
      f.hitFlash(60, 0x9fd0ff);
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
    f.hitFlash(150, 0xff3b3b); // no dedicated hurt flash in the art: red body flash
    this.vfx.blood(cp.x, cp.y, -f.face);
    this.vfx.hit(cp.x, cp.y, kind === "grab", 0xff8a8a);
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
    this.vfx.postureBreak(this.player.x, this.player.y - 38);
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
    for (const bl of this.blades) g.lineStyle(2, 0xdfe9ff, 0.95).lineBetween(bl.x, bl.y - 22, bl.x - bl.vx * 0.035, bl.y - 22 - bl.vy * 0.035);
    if (now < this.p.riposteUntil && this.p.mode !== "dead") {
      const rp = 0.5 + 0.5 * Math.sin(now / 70);
      g.lineStyle(2, 0xfff2b0, 0.5 + 0.4 * rp).strokeEllipse(this.player.x, this.player.y, 30 + rp * 6, 12 + rp * 3);
    }
    // timing ring: closes in on the boss during a telegraph hold (training, and the Assist difficulty)
    if ((this.ringAidOn || (settings.difficulty === "assist" && !this.def.training)) && this.b.mode === "attack" && this.b.held && this.b.holdTotal > 0 && this.b.move && this.actAfter(this.b.move, this.b.move.holds?.[this.b.holdIdx - 1]?.frame ?? 99) !== null) {
      // the ring closes at the moment of IMPACT (the animation still has a frame or two to travel after the hold ends)
      const mvR = this.b.move!, hf = mvR.holds?.[this.b.holdIdx - 1]?.frame ?? 0, nf = this.actAfter(mvR, hf) ?? hf;
      const travel = ((nf - hf) * 1000) / (mvR.fps * this.mul().fps);
      const left = Math.max(0, Math.min(1, (this.b.holdUntil + travel - now) / (this.b.holdTotal + travel)));
      const r = 12 + 56 * left;
      g.lineStyle(3, left < 0.18 ? 0xffffff : 0xffd36b, 0.9).strokeCircle(this.boss.x, this.boss.y - this.def.headY * 0.5, r);
    }
    // choreographed mode: a faint pulse on the floor under the boss at every beat
    if (this.beatMode() && this.bossActive()) {
      const ph = ((this.sfx.beatPos() % 1) + 1) % 1;
      g.lineStyle(2, 0xfff2c0, 0.22 * (1 - ph)).strokeEllipse(this.boss.x, this.boss.y, 26 + ph * 46, 10 + ph * 18);
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
