import * as Phaser from "phaser";
import { Actor, World, overlap, VIEW_H, VIEW_W, type Manifest, type Rect } from "./engine";
import { BOSSES, PLAYER, type AttackDef, type BossDef, type SpawnEvent } from "./defs";
import { askJev, rulesDecision, type BossDecision, type BossSnapshot } from "./brain";

export interface BossHooks {
  onDecision: (d: BossDecision & { boss: string; from: string }) => void;
  onMode: (m: "JEV" | "RULES") => void;
  onStatus: (s: { boss: number; bossName: string; phase: string; deaths: number; hitsTaken: number; seconds: number }) => void;
  onMissingAssets: () => void;
}

const FLOOR_Y = 19 * 16;
const DECISION_MS = Number(process.env.NEXT_PUBLIC_JEV_DECISION_INTERVAL_MS ?? 500);
const FPS_OVERRIDE: Record<string, number> = { knight_Attack: 16, knight_Dash: 20, slime_Attack: 18, fx_spell: 14, fx_fireball: 14, fx_bolt: 14, fx_fireball_hit: 18, fx_bolt_hit: 16 };
const LOOPING = /_(Idle|Walk|Run|Fall)$|^fx_fireball$|^fx_bolt$/;
const INTRO_MS = 2400;

type PMode = "free" | "attack" | "dash" | "hurt" | "dead";
type Phase = "intro" | "fight" | "bossDead" | "playerDead" | "finished";

interface Proj {
  s: Phaser.GameObjects.Sprite;
  x: number; y: number; vx: number; vy: number; g: number;
  dmg: number; r: number; hitAnim: string; splash: boolean; dead: boolean;
}
interface Pillar { x: number; at: number; dmg: number; s?: Phaser.GameObjects.Sprite; hit: boolean }
interface Timed { at: number; fn: () => void }

interface BossRun {
  state: string;
  since: number;
  atk?: { def: AttackDef; fired: Set<string>; hitDone: boolean; loops: number };
  hopping: boolean;
  cd: Record<string, number>;
  needsDecision: boolean;
  pending?: BossDecision;
  lastAsk: number;
  inFlight: boolean;
  history: string[];
  staggerUntil: number;
  staggerImmuneUntil: number;
  phase: 1 | 2;
}

export class BossScene extends Phaser.Scene {
  private hooks!: BossHooks;
  private sheets!: Manifest["sheets"];
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;

  // arena
  private world!: World;
  private arenaObjs: Phaser.GameObjects.GameObject[] = [];
  private bgs: { s: Phaser.GameObjects.TileSprite; f: number }[] = [];

  // actors
  private player!: Actor;
  private boss!: Actor;
  private def!: BossDef;
  private run!: BossRun;
  private bossIdx = 0;
  private runId = 0;
  private bossHp = 0;
  private playerHp = PLAYER.maxHp;

  // player state
  private pMode: PMode = "free";
  private pHit = false;
  private pInvuln = 0;
  private pDashReady = 0;
  private pModeSince = 0;
  private coyote = 0;
  private jumpBuf = 0;
  private atkBuf = 0;
  private dashBuf = 0;
  private dropUntil = 0;
  private dashDir: 1 | -1 = 1;
  private stillSince = 0;

  // world state
  private phase: Phase = "intro";
  private phaseSince = 0;
  private hitstop = 0;
  private projs: Proj[] = [];
  private pillars: Pillar[] = [];
  private timed: Timed[] = [];
  private warnings: { x: number; until: number; from: number }[] = [];
  private inputLog: { t: number; type: "attack" | "dash" | "jump" }[] = [];
  private dmgLog: { t: number; to: "player" | "boss"; amt: number }[] = [];
  private mode: "JEV" | "RULES" = "JEV";
  private showDebug = true;

  // stats
  private deaths = 0;
  private hitsTaken = 0;
  private runStart = 0;

  // ui
  private gfx!: Phaser.GameObjects.Graphics;
  private banner!: Phaser.GameObjects.Text;
  private sub!: Phaser.GameObjects.Text;
  private hudText!: Phaser.GameObjects.Text;
  private stateText!: Phaser.GameObjects.Text;
  private nameText!: Phaser.GameObjects.Text;

  constructor() {
    super("boss");
  }

  init(hooks: BossHooks) {
    this.hooks = hooks;
  }

  // ---------------------------------------------------------------- setup
  create() {
    this.sheets = (this.cache.json.get("manifest") as Manifest).sheets;
    for (const [key, s] of Object.entries(this.sheets)) {
      if (!s.frames || this.anims.exists(key)) continue;
      this.anims.create({
        key,
        frames: this.anims.generateFrameNumbers(key, { start: 0, end: s.frames - 1 }),
        frameRate: FPS_OVERRIDE[key] ?? (/_Death$/.test(key) ? 10 : 12),
        repeat: LOOPING.test(key) ? -1 : 0,
      });
    }
    const kb = this.input.keyboard!;
    this.keys = kb.addKeys("A,D,W,S,SPACE,J,K,SHIFT,R,T,H,ENTER,ONE,TWO,THREE,FOUR") as Record<string, Phaser.Input.Keyboard.Key>;
    this.cursors = kb.createCursorKeys();
    this.input.mouse?.disableContextMenu();
    this.input.on("pointerdown", () => (this.atkBuf = this.time.now + 140));
    this.keys.J.on("down", () => (this.atkBuf = this.time.now + 140));
    this.keys.K.on("down", () => (this.dashBuf = this.time.now + 140));
    this.keys.SHIFT.on("down", () => (this.dashBuf = this.time.now + 140));
    for (const k of ["W", "SPACE"]) this.keys[k].on("down", () => (this.jumpBuf = this.time.now + 120));
    this.cursors.up.on("down", () => (this.jumpBuf = this.time.now + 120));
    this.keys.T.on("down", () => {
      this.mode = this.mode === "JEV" ? "RULES" : "JEV";
      this.hooks.onMode(this.mode);
    });
    this.keys.H.on("down", () => (this.showDebug = !this.showDebug));
    this.keys.R.on("down", () => this.startBoss(this.bossIdx, true));
    this.keys.ENTER.on("down", () => {
      if (this.phase === "finished") this.restartRun();
    });
    ["ONE", "TWO", "THREE", "FOUR"].forEach((k, i) => this.keys[k].on("down", () => i < BOSSES.length && this.practice(i)));

    this.gfx = this.add.graphics().setDepth(20);
    const font = { fontFamily: "monospace", color: "#ffffff" };
    this.banner = this.add.text(VIEW_W / 2, 120, "", { ...font, fontSize: "30px", align: "center", stroke: "#000", strokeThickness: 5 }).setOrigin(0.5).setDepth(30);
    this.sub = this.add.text(VIEW_W / 2, 164, "", { ...font, fontSize: "13px", align: "center", stroke: "#000", strokeThickness: 3 }).setOrigin(0.5).setDepth(30);
    this.hudText = this.add.text(8, 22, "", { ...font, fontSize: "11px", stroke: "#000", strokeThickness: 3 }).setDepth(21);
    this.nameText = this.add.text(VIEW_W / 2, 21, "", { ...font, fontSize: "10px", stroke: "#000", strokeThickness: 3 }).setOrigin(0.5, 0).setDepth(21);
    this.stateText = this.add.text(0, 0, "", { ...font, fontSize: "10px", stroke: "#000", strokeThickness: 3 }).setOrigin(0.5, 1).setDepth(21);

    this.hooks.onMode(this.mode);
    this.restartRun();
  }

  private restartRun() {
    this.deaths = 0;
    this.hitsTaken = 0;
    this.playerHp = PLAYER.maxHp;
    this.runStart = this.time.now;
    this.startBoss(0, false);
  }

  private practice(i: number) {
    this.playerHp = PLAYER.maxHp;
    this.startBoss(i, false);
  }

  private clearArena() {
    this.arenaObjs.forEach((o) => o.destroy());
    this.arenaObjs = [];
    this.bgs = [];
    this.projs.forEach((p) => p.s.destroy());
    this.projs = [];
    this.pillars.forEach((p) => p.s?.destroy());
    this.pillars = [];
    this.timed = [];
    this.warnings = [];
    this.player?.sprite.destroy();
    this.boss?.sprite.destroy();
  }

  private startBoss(idx: number, retry: boolean) {
    this.clearArena();
    this.bossIdx = idx;
    this.def = BOSSES[idx];
    this.runId++;
    if (retry && this.phase === "playerDead") this.playerHp = PLAYER.maxHp;
    else if (retry) this.playerHp = Math.max(this.playerHp, PLAYER.maxHp * 0.5);

    // --- Tiled arena
    const map = this.make.tilemap({ key: `arena_${this.def.arena}` });
    const ts = map.addTilesetImage("arena_tiles", "arena_tiles")!;
    for (const name of ["ground", "platforms"]) {
      const layer = map.createLayer(name, ts)!;
      layer.setTint(this.def.tint).setDepth(0);
      this.arenaObjs.push(layer);
    }
    this.world = new World(map);
    const spawns = map.getObjectLayer("spawns")!.objects;
    const at = (n: string) => spawns.find((o) => o.name === n)!;

    ([1, 2, 3, 4] as const).forEach((i, n) => {
      const info = this.sheets[`bg${i}`];
      const s = this.add.tileSprite(0, 0, VIEW_W, VIEW_H, `bg${i}`).setOrigin(0).setDepth(-10 + i).setTint(this.def.tint);
      const k = VIEW_H / (info.h ?? VIEW_H);
      s.setTileScale(k, k);
      this.arenaObjs.push(s);
      this.bgs.push({ s, f: [0, 0.04, 0.08, 0.14][n] });
    });

    // --- actors
    this.player = new Actor(this, PLAYER.sheet, this.sheets, PLAYER.nativeDir, 1, PLAYER.hurtW);
    this.player.sprite.setDepth(6);
    this.player.x = at("player").x!;
    this.player.y = at("player").y!;
    this.player.dir = 1;
    this.boss = new Actor(this, this.def.sheet, this.sheets, this.def.nativeDir, this.def.scale);
    this.boss.sprite.setDepth(5);
    this.boss.x = at("boss").x!;
    this.boss.y = at("boss").y!;
    this.boss.dir = -1;

    this.pMode = "free";
    this.pInvuln = 0;
    this.pDashReady = 0;
    this.stillSince = this.time.now;
    this.bossHp = this.def.hp;
    this.run = {
      state: "IDLE", since: this.time.now, hopping: false, cd: {}, needsDecision: true, lastAsk: this.time.now + INTRO_MS,
      inFlight: false, history: [], staggerUntil: 0, staggerImmuneUntil: 0, phase: 1,
    };
    this.inputLog = [];
    this.dmgLog = [];
    this.setPhase("intro");
    this.banner.setText(`${this.def.name}\n${this.def.title}`).setAlpha(1);
    this.sub.setText(`Boss ${idx + 1} of ${BOSSES.length}`);
    this.emitStatus();
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseSince = this.time.now;
  }

  private emitStatus() {
    this.hooks.onStatus({
      boss: this.bossIdx,
      bossName: this.def.name,
      phase: this.phase,
      deaths: this.deaths,
      hitsTaken: this.hitsTaken,
      seconds: Math.round((this.time.now - this.runStart) / 1000),
    });
  }

  // ---------------------------------------------------------------- main loop
  update(now: number, deltaMs: number) {
    if (this.hitstop > 0) {
      this.hitstop -= deltaMs;
      return;
    }
    const dt = Math.min(deltaMs, 50) / 1000;

    if (this.phase === "intro" && now - this.phaseSince > INTRO_MS) {
      this.setPhase("fight");
      this.banner.setText("");
      this.sub.setText("");
    }
    if (this.phase === "bossDead" && now - this.phaseSince > 3200) this.nextBoss();

    this.updatePlayer(now, dt);
    if (this.phase === "fight") this.updateBossBrain(now);
    this.updateBoss(now, dt);
    this.updateTimed(now);
    this.updateProjectiles(now, dt);
    this.updatePillars(now);
    this.separate(dt);

    this.player.sync();
    this.boss.sync();
    this.bgs.forEach((b) => (b.s.tilePositionX = this.player.x * b.f));
    this.drawHud(now);
  }

  private nextBoss() {
    if (this.bossIdx + 1 >= BOSSES.length) {
      this.setPhase("finished");
      const secs = Math.round((this.time.now - this.runStart) / 1000);
      this.banner.setText("BOSS RUSH COMPLETE").setAlpha(1);
      this.sub.setText(`time ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}   deaths ${this.deaths}   hits taken ${this.hitsTaken}\n\nENTER to run it again`);
      this.emitStatus();
      return;
    }
    this.playerHp = Math.min(PLAYER.maxHp, this.playerHp + 40);
    this.startBoss(this.bossIdx + 1, false);
  }

  /** Keep the player out of the boss's body. */
  private separate(dt: number) {
    if (this.pMode === "dash" || this.pMode === "dead" || this.bossHp <= 0) return;
    if (overlap(this.player.rect, this.boss.rect)) {
      const s = this.player.x < this.boss.x ? -1 : 1;
      this.player.x = Phaser.Math.Clamp(this.player.x + s * 140 * dt, this.player.w / 2, VIEW_W - this.player.w / 2);
    }
  }

  // ---------------------------------------------------------------- player
  private setPMode(m: PMode) {
    this.pMode = m;
    this.pModeSince = this.time.now;
    this.pHit = false;
  }

  private updatePlayer(now: number, dt: number) {
    const p = this.player;
    const k = this.keys;
    const ix = (k.D.isDown || this.cursors.right.isDown ? 1 : 0) - (k.A.isDown || this.cursors.left.isDown ? 1 : 0);
    const jumpHeld = k.W.isDown || k.SPACE.isDown || this.cursors.up.isDown;
    const down = k.S.isDown || this.cursors.down.isDown;
    if (ix !== 0 || !p.onGround) this.stillSince = now;
    if (p.onGround) this.coyote = now + 90;

    switch (this.pMode) {
      case "free": {
        if (ix) p.dir = ix as 1 | -1;
        const target = ix * PLAYER.speed;
        const accel = (p.onGround ? 1500 : 900) * dt;
        p.vx = p.vx < target ? Math.min(target, p.vx + accel) : Math.max(target, p.vx - accel);
        if (this.jumpBuf > now && now < this.coyote) {
          if (down && p.onGround && this.onPlatform()) this.dropUntil = now + 220;
          else {
            p.vy = -PLAYER.jump;
            this.inputLog.push({ t: now, type: "jump" });
          }
          this.jumpBuf = 0;
          this.coyote = 0;
        }
        if (!jumpHeld && p.vy < -120) p.vy += 1800 * dt; // variable jump height
        if (this.atkBuf > now) {
          this.atkBuf = 0;
          this.setPMode("attack");
          this.inputLog.push({ t: now, type: "attack" });
          p.play("Attack", undefined, true);
        } else if (this.dashBuf > now && now >= this.pDashReady) {
          this.startDash(ix as 1 | -1 | 0, now);
        } else {
          if (p.onGround) p.play(Math.abs(p.vx) > 12 ? "Run" : "Idle");
          else p.play(p.vy < 0 ? "Jump" : "Fall");
        }
        break;
      }
      case "attack": {
        p.vx *= p.onGround ? 0.82 : 0.98;
        const f = p.frame;
        const [a, b] = PLAYER.attackHit.frames;
        if (!this.pHit && f >= a && f <= b && this.bossHp > 0 && this.phase !== "bossDead") {
          if (overlap(p.boxInFront(PLAYER.attackHit.box), this.boss.rect)) {
            this.pHit = true;
            this.hurtBoss(PLAYER.attackDamage, now);
          }
        }
        if (f >= 4 && this.dashBuf > now && now >= this.pDashReady) this.startDash(ix as 1 | -1 | 0, now); // dash-cancel the recovery
        else if (p.animDone) this.setPMode("free");
        break;
      }
      case "dash": {
        p.vx = this.dashDir * PLAYER.dashSpeed;
        p.vy = 0;
        if (now - this.pModeSince > PLAYER.dashTime * 1000) {
          p.vx = this.dashDir * PLAYER.speed;
          this.setPMode("free");
        }
        break;
      }
      case "hurt":
        p.vx *= 0.94;
        if (now - this.pModeSince > 350) this.setPMode("free");
        break;
      case "dead":
        p.vx *= 0.9;
        break;
    }
    const grav = this.pMode === "dash" ? 0 : PLAYER.gravity;
    p.step(this.world, dt, grav, now < this.dropUntil);
    if (this.pMode === "hurt") p.play("TakeHit");
  }

  private onPlatform() {
    return this.player.y < FLOOR_Y - 2;
  }

  private startDash(ix: 1 | -1 | 0, now: number) {
    this.dashBuf = 0;
    this.dashDir = (ix || this.player.dir) as 1 | -1;
    this.player.dir = this.dashDir;
    this.pDashReady = now + PLAYER.dashCooldown * 1000;
    this.inputLog.push({ t: now, type: "dash" });
    this.setPMode("dash");
    this.player.play("Dash", undefined, true);
  }

  private invulnerable(now: number) {
    return this.pMode === "dash" || this.pMode === "dead" || now < this.pInvuln;
  }

  private hurtPlayer(amount: number, fromX: number): boolean {
    const now = this.time.now;
    if (this.invulnerable(now) || this.phase === "bossDead") return false;
    this.playerHp -= amount;
    this.hitsTaken++;
    this.dmgLog.push({ t: now, to: "player", amt: amount });
    this.hitstop = 70;
    this.cameras.main.shake(140, 0.006);
    this.popup(this.player.x, this.player.y - this.player.h, `-${amount}`, "#ff6b6b");
    if (this.playerHp <= 0) {
      this.playerHp = 0;
      this.deaths++;
      this.setPMode("dead");
      this.player.play("Death", undefined, true);
      this.setPhase("playerDead");
      this.banner.setText("YOU DIED").setAlpha(1);
      this.sub.setText("R to retry this boss  ·  1-4 jump to a boss");
      this.emitStatus();
      return true;
    }
    this.pInvuln = now + 900;
    this.setPMode("hurt");
    this.player.play("TakeHit", undefined, true);
    this.player.vx = (this.player.x < fromX ? -1 : 1) * 150;
    this.player.vy = -160;
    return true;
  }

  // ---------------------------------------------------------------- boss: damage
  private hurtBoss(amount: number, now: number) {
    this.bossHp -= amount;
    this.dmgLog.push({ t: now, to: "boss", amt: amount });
    this.hitstop = 55;
    this.popup(this.boss.x, this.boss.y - this.boss.h, `${amount}`, "#ffe08a");
    const sp = this.boss.sprite;
    sp.setTintFill(0xffffff);
    this.time.delayedCall(70, () => sp.clearTint());

    if (this.bossHp <= 0) return this.killBoss();
    if (this.run.phase === 1 && this.bossHp <= this.def.hp / 2) {
      this.run.phase = 2;
      this.cameras.main.flash(300, 255, 60, 60);
      this.popup(this.boss.x, this.boss.y - this.boss.h - 14, "ENRAGED", "#ff4d4d");
    }
    const r = this.run;
    if (!r.atk && !r.hopping && now >= r.staggerImmuneUntil) {
      r.staggerUntil = now + 300;
      r.staggerImmuneUntil = now + 1000;
      this.boss.vx = (this.boss.x > this.player.x ? 1 : -1) * 60;
      this.boss.play("Hurt", undefined, true);
    }
  }

  private killBoss() {
    this.bossHp = 0;
    this.run.atk = undefined;
    this.run.hopping = false;
    this.boss.vx = 0;
    this.boss.play("Death", undefined, true);
    this.setPhase("bossDead");
    this.banner.setText(`${this.def.name} DEFEATED`).setAlpha(1);
    this.sub.setText(this.bossIdx + 1 < BOSSES.length ? "+40 HP" : "");
    this.projs.forEach((p) => this.explode(p));
    this.pillars.forEach((p) => p.s?.destroy());
    this.pillars = [];
    this.timed = [];
    this.warnings = [];
    this.emitStatus();
  }

  // ---------------------------------------------------------------- boss: brain
  private mul() {
    return this.run.phase === 2 ? { speed: 1.25, cd: 0.7, fps: 1.15 } : { speed: 1, cd: 1, fps: 1 };
  }

  private availableStates(now: number): string[] {
    const wallBehind = this.wallBehind();
    return Object.entries(this.def.states)
      .filter(([name, st]) => {
        if (now < (this.run.cd[name] ?? 0)) return false;
        const mode = st.move?.mode;
        if ((mode === "away" || mode === "hop") && wallBehind < 40) return false;
        return !(st.attack && this.pMode === "dead");
      })
      .map(([name]) => name);
  }

  private wallBehind() {
    const away = this.boss.x >= this.player.x ? 1 : -1; // direction the boss would back off in
    return away > 0 ? VIEW_W - this.boss.x : this.boss.x;
  }

  private snapshot(now: number): BossSnapshot {
    const b = this.boss, p = this.player, r = this.run;
    const d = Math.abs(b.x - p.x);
    const recent = (t: number) => this.inputLog.filter((e) => now - e.t < t);
    const sumDmg = (to: "player" | "boss") => this.dmgLog.filter((x) => x.to === to && now - x.t < 6000).reduce((s, x) => s + x.amt, 0);
    const streakAction = r.history[r.history.length - 1];
    let streak = 0;
    for (let i = r.history.length - 1; i >= 0 && r.history[i] === streakAction; i--) streak++;
    const action: BossSnapshot["player"]["action"] =
      this.pMode === "attack" ? "attacking" : this.pMode === "dash" ? "dashing" : this.pMode === "hurt" ? "stunned"
        : !p.onGround ? "jumping" : Math.abs(p.vx) > 20 ? "running" : "idle";
    const inRange: Record<string, boolean> = {};
    for (const [n, st] of Object.entries(this.def.states)) if (st.attack) inRange[n] = d >= st.attack.range[0] && d <= st.attack.range[1];
    return {
      boss: {
        name: this.def.name,
        hpPct: Math.round((this.bossHp / this.def.hp) * 100),
        phase: r.phase,
        state: r.state,
        msInState: Math.round(now - r.since),
        lastActions: r.history.slice(-4),
        sameActionStreak: streak,
        justStaggered: now < r.staggerImmuneUntil && now - (r.staggerImmuneUntil - 1000) < 1500,
      },
      player: {
        hpPct: Math.round((this.playerHp / PLAYER.maxHp) * 100),
        action,
        airborne: !p.onGround,
        facingBoss: (b.x - p.x) * p.dir > 0,
        dashReady: now >= this.pDashReady,
        attacksInLast4s: recent(4000).filter((e) => e.type === "attack").length,
        dashesInLast4s: recent(4000).filter((e) => e.type === "dash").length,
        jumpsInLast4s: recent(4000).filter((e) => e.type === "jump").length,
        standingStillMs: Math.round(now - this.stillSince),
      },
      distancePx: Math.round(d),
      playerIsVerticallyAboveBoss: p.y < b.y - b.h,
      bossDistanceToWallBehindPx: Math.round(this.wallBehind()),
      inRange,
      damageDealtToPlayerLast6s: sumDmg("player"),
      damageTakenFromPlayerLast6s: sumDmg("boss"),
    };
  }

  private updateBossBrain(now: number) {
    const r = this.run;
    if (this.bossHp <= 0) return;
    if (r.pending && now >= r.staggerUntil && !r.atk && !r.hopping) {
      const d = r.pending;
      r.pending = undefined;
      this.enter(d.state, now);
    }
    if (r.atk || r.hopping || now < r.staggerUntil || r.inFlight) return;
    if (!r.needsDecision && now - r.lastAsk < DECISION_MS) return;
    r.needsDecision = false;
    r.lastAsk = now;

    const available = this.availableStates(now);
    const snap = this.snapshot(now);
    if (this.mode === "RULES") return this.applyDecision(rulesDecision(this.def, snap, available), now);

    r.inFlight = true;
    const id = this.runId;
    const t0 = performance.now();
    askJev(this.def, snap, available)
      .catch((err: Error) => ({ ...rulesDecision(this.def, snap, available, "fallback"), latencyMs: Math.round(performance.now() - t0), error: err.message }) as BossDecision)
      .then((d) => {
        if (id !== this.runId) return; // the fight changed while Jev was thinking
        r.inFlight = false;
        if (!available.includes(d.state)) d.state = "IDLE";
        this.applyDecision(d, this.time.now);
      });
  }

  private applyDecision(d: BossDecision, now: number) {
    const r = this.run;
    if (this.bossHp <= 0 || this.phase !== "fight") return;
    const isAttack = !!this.def.states[d.state].attack;
    if (d.state !== r.state || isAttack || d.error) this.hooks.onDecision({ ...d, boss: this.def.name, from: r.state });
    if (d.state === r.state && !isAttack) return; // keep doing what we're doing
    if (now < r.staggerUntil) r.pending = d;
    else this.enter(d.state, now);
  }

  // ---------------------------------------------------------------- boss: FSM runner
  private enter(name: string, now: number) {
    const r = this.run, b = this.boss, st = this.def.states[name];
    const m = this.mul();
    r.state = name;
    r.since = now;
    r.history.push(name);
    if (r.history.length > 12) r.history.shift();
    b.dir = this.player.x >= b.x ? 1 : -1;
    r.atk = undefined;
    if (st.attack) {
      r.atk = { def: st.attack, fired: new Set(), hitDone: false, loops: 0 };
      r.cd[name] = now + st.attack.cooldown * m.cd;
      b.vx = 0;
      b.play(st.attack.anim, st.attack.fps * m.fps, true);
    } else if (st.move?.mode === "hop") {
      r.hopping = true;
      r.cd[name] = now + (st.move.cooldown ?? 2000) * m.cd;
      b.vx = -b.dir * st.move.speed * m.speed;
      b.vy = -330;
      b.play("Jump", undefined, true);
    }
  }

  private finishAction(now: number) {
    const r = this.run;
    r.atk = undefined;
    r.hopping = false;
    r.state = "IDLE";
    r.since = now;
    r.needsDecision = true;
    this.boss.vx = 0;
  }

  private updateBoss(now: number, dt: number) {
    const b = this.boss, r = this.run, m = this.mul();
    if (this.bossHp <= 0) {
      b.vx *= 0.9;
      b.step(this.world, dt, 900);
      return;
    }
    const idleOnly = this.phase === "intro" || this.phase === "playerDead";
    const stag = now < r.staggerUntil;

    if (stag) {
      b.vx *= 0.9;
    } else if (idleOnly && !r.atk && !r.hopping) {
      b.vx = 0;
      b.dir = this.player.x >= b.x ? 1 : -1;
      b.play("Idle");
    } else if (r.atk) {
      this.updateAttack(now, m);
    } else if (r.hopping) {
      b.play(b.vy < 0 ? "Jump" : "Fall");
      if (b.onGround && now - r.since > 150) this.finishAction(now);
    } else {
      const mv = this.def.states[r.state].move!;
      const toward = this.player.x >= b.x ? 1 : -1;
      b.dir = toward;
      const gap = Math.abs(b.x - this.player.x) - (b.w + this.player.w) / 2;
      if (mv.mode === "toward") b.vx = gap > 6 ? toward * mv.speed * m.speed : 0;
      else if (mv.mode === "away") b.vx = this.wallBehind() > 24 ? -toward * mv.speed * m.speed : 0;
      else b.vx = 0;
      b.play(b.vx === 0 && mv.mode !== "hold" ? "Idle" : mv.anim);
      if (mv.mode !== "hold" && now - r.since > 2600) r.needsDecision = true; // don't wander forever
    }
    b.step(this.world, dt, 900);
  }

  private updateAttack(now: number, m: { speed: number }) {
    const b = this.boss, r = this.run, a = r.atk!;
    const f = b.frame;
    const def = a.def;

    def.events?.forEach((ev, i) => {
      const key = `${a.loops}-${i}`;
      if (!a.fired.has(key) && f >= ev.frame) {
        a.fired.add(key);
        this.fire(ev, now);
      }
    });

    if (def.hit && !a.hitDone && f >= def.hit.frames[0] && f <= def.hit.frames[1] && overlap(b.boxInFront(def.hit.box), this.player.rect)) {
      if (this.hurtPlayer(def.damage ?? 15, b.x)) a.hitDone = true;
    }
    b.vx = def.lunge && f >= def.lunge.frames[0] && f <= def.lunge.frames[1] ? b.dir * def.lunge.speed * m.speed : 0;

    if (b.animDone) {
      a.loops++;
      if (def.repeat && a.loops < def.repeat) {
        b.dir = this.player.x >= b.x ? 1 : -1;
        a.hitDone = false;
        b.play(def.anim, def.fps * this.mul().fps, true);
      } else this.finishAction(now);
    }
  }

  // ---------------------------------------------------------------- boss: attack effects
  private fire(ev: SpawnEvent, now: number) {
    const b = this.boss, p = this.player;
    if (ev.type === "projectile") {
      const x = b.x + b.dir * (b.w / 2 + 6), y = b.y - ev.dy * b.scale;
      const scale = ev.kind === "fireball" ? 1.5 : 1.3;
      let vx: number, vy: number, g = 0;
      if (ev.lob) {
        g = 520;
        const t = ev.lob;
        vx = (p.x - x) / t;
        vy = (p.y - 4 - y - 0.5 * g * t * t) / t;
      } else if (ev.kind === "bolt") {
        const ang = Math.atan2(p.y - p.h * 0.5 - y, p.x - x);
        vx = Math.cos(ang) * ev.speed;
        vy = Math.sin(ang) * ev.speed;
      } else {
        const rad = ((ev.angle ?? 0) * Math.PI) / 180;
        vx = b.dir * Math.cos(rad) * ev.speed;
        vy = -Math.sin(rad) * ev.speed;
      }
      this.spawnProj(ev.kind, x, y, vx, vy, g, ev.damage, scale, !!ev.lob);
    } else if (ev.type === "rain") {
      for (let i = 0; i < ev.count; i++) {
        const tx = Phaser.Math.Clamp(p.x + (i - (ev.count - 1) / 2) * ev.spread + Phaser.Math.Between(-8, 8), 12, VIEW_W - 12);
        const warnAt = now + i * ev.stagger, hitAt = warnAt + 520;
        this.warnings.push({ x: tx, from: warnAt, until: hitAt });
        this.timed.push({ at: hitAt, fn: () => this.spawnProj("bolt", tx, -16, 0, 420, 0, ev.damage, 1.3, false, true) });
      }
    } else if (ev.type === "pillar") {
      const offs = this.run.phase === 2 && ev.offsetsP2 ? ev.offsetsP2 : ev.offsets;
      for (const o of offs) {
        const x = Phaser.Math.Clamp(p.x + o, 20, VIEW_W - 20);
        this.warnings.push({ x, from: now, until: now + ev.delay });
        this.pillars.push({ x, at: now + ev.delay, dmg: ev.damage, hit: false });
      }
    }
  }

  private spawnProj(kind: "fireball" | "bolt", x: number, y: number, vx: number, vy: number, g: number, dmg: number, scale: number, splash: boolean, rain = false) {
    const s = this.add.sprite(x, y, `fx_${kind}`).setScale(scale).setDepth(7);
    s.anims.play(`fx_${kind}`);
    s.rotation = Math.atan2(vy, vx);
    this.projs.push({ s, x, y, vx, vy, g, dmg, r: (kind === "fireball" ? 8 : 6) * scale, hitAnim: `fx_${kind}_hit`, splash, dead: false });
    void rain;
  }

  private updateTimed(now: number) {
    for (const t of [...this.timed]) {
      if (now >= t.at) {
        this.timed.splice(this.timed.indexOf(t), 1);
        t.fn();
      }
    }
  }

  private explode(p: Proj) {
    if (p.dead) return;
    p.dead = true;
    const { x, y } = p;
    p.s.destroy();
    const fx = this.add.sprite(x, y, p.hitAnim).setScale(1.5).setDepth(7);
    fx.anims.play(p.hitAnim);
    fx.once("animationcomplete", () => fx.destroy());
    if (p.splash) {
      const box: Rect = { l: x - 26, r: x + 26, t: y - 34, b: y + 8 };
      if (overlap(box, this.player.rect)) this.hurtPlayer(p.dmg, x);
    }
  }

  private updateProjectiles(now: number, dt: number) {
    for (const p of this.projs) {
      if (p.dead) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += p.g * dt;
      p.s.setPosition(p.x, p.y);
      if (p.g) p.s.rotation = Math.atan2(p.vy, p.vx);
      const hurt: Rect = this.player.rect;
      const box: Rect = { l: p.x - p.r, r: p.x + p.r, t: p.y - p.r, b: p.y + p.r };
      if (overlap(box, hurt)) {
        if (this.hurtPlayer(p.dmg, p.x)) {
          p.splash = false;
          this.explode(p);
        }
      } else if (p.y >= FLOOR_Y - 2 || p.x < -20 || p.x > VIEW_W + 20 || p.y < -60) {
        this.explode(p);
      }
    }
    this.projs = this.projs.filter((p) => !p.dead);
    void now;
  }

  private updatePillars(now: number) {
    for (const pl of this.pillars) {
      if (!pl.s && now >= pl.at) {
        pl.s = this.add.sprite(pl.x, FLOOR_Y + 2, "fx_spell").setOrigin(0.5, 1).setScale(1.6).setDepth(4);
        pl.s.anims.play("fx_spell");
        pl.s.once("animationcomplete", () => pl.s?.destroy());
      }
      if (pl.s?.active && !pl.hit) {
        const f = (pl.s.anims.currentFrame?.index ?? 1) - 1;
        if (f >= 6 && f <= 10) {
          const box: Rect = { l: pl.x - 15, r: pl.x + 15, t: FLOOR_Y - 90, b: FLOOR_Y };
          if (overlap(box, this.player.rect) && this.hurtPlayer(pl.dmg, pl.x)) pl.hit = true;
        }
      }
    }
    this.pillars = this.pillars.filter((p) => !(p.s && !p.s.active));
  }

  // ---------------------------------------------------------------- ui
  private popup(x: number, y: number, text: string, color: string) {
    const t = this.add.text(x, y, text, { fontFamily: "monospace", fontSize: "12px", color, stroke: "#000", strokeThickness: 3 }).setOrigin(0.5).setDepth(25);
    this.tweens.add({ targets: t, y: y - 22, alpha: 0, duration: 700, onComplete: () => t.destroy() });
  }

  private drawHud(now: number) {
    const g = this.gfx;
    g.clear();
    // telegraphs
    for (const w of this.warnings) {
      if (now > w.until) continue;
      const pulse = 0.25 + 0.2 * Math.sin(now / 45);
      g.fillStyle(0xff3355, pulse).fillRect(w.x - 10, 0, 20, FLOOR_Y);
      g.fillStyle(0xff3355, 0.7).fillRect(w.x - 14, FLOOR_Y - 3, 28, 3);
    }
    this.warnings = this.warnings.filter((w) => now <= w.until + 50);

    // player bar
    const bar = (x: number, y: number, w: number, h: number, pct: number, col: number) => {
      g.fillStyle(0x000000, 0.7).fillRect(x - 1, y - 1, w + 2, h + 2);
      g.fillStyle(col).fillRect(x, y, Math.max(0, w * pct), h);
    };
    bar(8, 8, 120, 8, this.playerHp / PLAYER.maxHp, 0x4ade80);
    // boss bar
    const bw = 300;
    bar((VIEW_W - bw) / 2, 10, bw, 9, Math.max(0, this.bossHp) / this.def.hp, this.run.phase === 2 ? 0xff3b3b : 0xd946ef);
    this.nameText.setText(`${this.def.name} — ${this.def.title}${this.run.phase === 2 ? "  (ENRAGED)" : ""}`);
    this.hudText.setText(
      `${this.mode === "JEV" ? "BRAIN: JEV" : "BRAIN: RULES"}${this.run.inFlight ? " (thinking…)" : ""}   [T] toggle  [R] retry  [1-4] boss`,
    );
    this.hudText.setPosition(8, 34);

    if (this.showDebug && this.bossHp > 0) {
      this.stateText.setVisible(true).setText(`${this.run.state}${this.run.inFlight ? " …" : ""}`).setPosition(this.boss.x, this.boss.y - this.boss.h - 4);
    } else this.stateText.setVisible(false);

    // flicker while invulnerable
    this.player.sprite.setAlpha(now < this.pInvuln && this.pMode !== "dead" ? (Math.floor(now / 60) % 2 ? 0.4 : 1) : 1);
    if (this.phase === "fight" && this.banner.text) this.banner.setText("");
  }
}
