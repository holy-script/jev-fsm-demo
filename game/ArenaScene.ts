import * as Phaser from "phaser";
import { ENEMY_STATES, type Decision, type EnemyState, type Snapshot } from "./types";
import { ruleBasedDecision } from "./rules";

export interface Hooks {
  onDecision: (d: Decision, from: EnemyState) => void;
  onScore: (s: { human: number; enemy: number }) => void;
  onMode: (m: "JEV" | "RULES") => void;
}

const W = 960, H = 600;
const R = 14; // body radius
const PLAYER_SPEED = 200, ENEMY_SPEED = 170;
const BULLET_SPEED_P = 640, BULLET_SPEED_E = 380;
const DMG_P = 15, DMG_E = 12;
const ENEMY_MAX_HP = 100, PLAYER_MAX_HP = 100;
const MAX_AMMO = 8, FIRE_MS = 330, RELOAD_MS = 1500, COVER_RELOAD_MS = 800;
const ATTACK_RANGE = 420;
const MIN_DWELL_MS = 250; // FSM refuses to flip-flop faster than this
const DECISION_MS = Number(process.env.NEXT_PUBLIC_JEV_DECISION_INTERVAL_MS ?? 600);

type Rect = { x: number; y: number; w: number; h: number };
type Bullet = { s: Phaser.GameObjects.Image; vx: number; vy: number; fromPlayer: boolean };

const WALLS: Rect[] = [
  { x: 200, y: 120, w: 60, h: 160 },
  { x: 700, y: 320, w: 60, h: 160 },
  { x: 440, y: 260, w: 80, h: 80 },
  { x: 220, y: 440, w: 160, h: 40 },
  { x: 580, y: 120, w: 160, h: 40 },
];

const inRect = (px: number, py: number, r: Rect, pad = 0) =>
  px > r.x - pad && px < r.x + r.w + pad && py > r.y - pad && py < r.y + r.h + pad;

export class ArenaScene extends Phaser.Scene {
  private hooks!: Hooks;
  private player!: Phaser.GameObjects.Image;
  private enemy!: Phaser.GameObjects.Image;
  private pHp = PLAYER_MAX_HP;
  private eHp = ENEMY_MAX_HP;
  private ammo = MAX_AMMO;
  private reloadingUntil = 0;
  private lastShot = 0;
  private lastPlayerShot = 0;
  private bullets: Bullet[] = [];
  private pack?: Phaser.GameObjects.Image;
  private nextPackAt = 0;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private hud!: Phaser.GameObjects.Text;
  private banner!: Phaser.GameObjects.Text;
  private gfx!: Phaser.GameObjects.Graphics;
  private score = { human: 0, enemy: 0 };
  private over = false;

  // FSM
  private state: EnemyState = "PATROL";
  private stateSince = 0;
  private waypoints = [new Phaser.Math.Vector2(120, 80), new Phaser.Math.Vector2(840, 80), new Phaser.Math.Vector2(840, 520), new Phaser.Math.Vector2(120, 520)];
  private wp = 0;
  private strafeDir = 1;
  private coverPoint?: Phaser.Math.Vector2;

  // Brain
  private mode: "JEV" | "RULES" = "JEV";
  private inFlight = false;
  private lastAsk = 0;
  private lastDecision?: Decision;
  private dmgLog: { t: number; d: number }[] = [];

  init(hooks: Hooks) {
    this.hooks = hooks;
  }

  create() {
    this.makeTextures();
    this.gfx = this.add.graphics();
    WALLS.forEach((w) => this.add.image(w.x + w.w / 2, w.y + w.h / 2, "wall").setDisplaySize(w.w, w.h));
    this.player = this.add.image(0, 0, "player").setDepth(5);
    this.enemy = this.add.image(0, 0, "enemy").setDepth(5);
    this.hud = this.add.text(8, 6, "", { fontFamily: "monospace", fontSize: "13px", color: "#e6edf3" }).setDepth(20);
    this.banner = this.add.text(W / 2, H / 2, "", { fontFamily: "monospace", fontSize: "32px", color: "#fff", align: "center" }).setOrigin(0.5).setDepth(30);
    this.keys = this.input.keyboard!.addKeys("W,A,S,D,R,T") as Record<string, Phaser.Input.Keyboard.Key>;
    this.keys.T.on("down", () => {
      this.mode = this.mode === "JEV" ? "RULES" : "JEV";
      this.hooks.onMode(this.mode);
    });
    this.keys.R.on("down", () => this.resetRound());
    this.input.mouse?.disableContextMenu();
    this.resetRound();
    this.hooks.onMode(this.mode);
    this.hooks.onScore(this.score);
  }

  // ---------- setup ----------
  private makeTextures() {
    const g = this.make.graphics({ x: 0, y: 0 }, false);
    const body = (key: string, color: number, trim: number) => {
      g.clear();
      g.fillStyle(0x222222).fillRect(R, R - 4, R + 12, 8); // gun barrel
      g.fillStyle(color).fillCircle(R + 2, R + 2, R);
      g.fillStyle(trim).fillCircle(R + 8, R - 2, 4).fillCircle(R + 8, R + 6, 4); // eyes
      g.generateTexture(key, R * 2 + 14, R * 2 + 4);
    };
    body("player", 0x3b82f6, 0xffffff);
    body("enemy", 0xef4444, 0xffee00);
    g.clear().fillStyle(0xffffff).fillCircle(4, 4, 4).generateTexture("bullet", 8, 8);
    g.clear().fillStyle(0x30363d).fillRect(0, 0, 32, 32).lineStyle(2, 0x6e7681).strokeRect(1, 1, 30, 30).generateTexture("wall", 32, 32);
    g.clear().fillStyle(0x22c55e).fillRect(8, 0, 8, 24).fillRect(0, 8, 24, 8).generateTexture("pack", 24, 24);
    g.destroy();
  }

  private resetRound() {
    this.over = false;
    this.banner.setText("");
    this.bullets.forEach((b) => b.s.destroy());
    this.bullets = [];
    this.pack?.destroy();
    this.pack = undefined;
    this.pHp = PLAYER_MAX_HP;
    this.eHp = ENEMY_MAX_HP;
    this.ammo = MAX_AMMO;
    this.reloadingUntil = 0;
    this.dmgLog = [];
    this.player.setPosition(100, 300);
    this.enemy.setPosition(860, 300);
    this.nextPackAt = this.time.now + 8000;
    this.inFlight = false;
    this.setState("PATROL", "round start");
  }

  // ---------- geometry ----------
  private blocked(x: number, y: number) {
    return x < R || y < R || x > W - R || y > H - R || WALLS.some((w) => inRect(x, y, w, R - 2));
  }
  private moveBody(o: Phaser.GameObjects.Image, dx: number, dy: number) {
    if (!this.blocked(o.x + dx, o.y)) o.x += dx;
    if (!this.blocked(o.x, o.y + dy)) o.y += dy;
  }
  private los(a: { x: number; y: number }, b: { x: number; y: number }) {
    const d = Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
    for (let t = 0; t <= d; t += 8) {
      const x = a.x + ((b.x - a.x) * t) / d, y = a.y + ((b.y - a.y) * t) / d;
      if (WALLS.some((w) => inRect(x, y, w))) return false;
    }
    return true;
  }
  private dist(a: { x: number; y: number }, b: { x: number; y: number }) {
    return Phaser.Math.Distance.Between(a.x, a.y, b.x, b.y);
  }

  /** Spots just behind each wall (from the player's viewpoint) that the player cannot see. */
  private findCover(): Phaser.Math.Vector2 | undefined {
    let best: Phaser.Math.Vector2 | undefined, bestD = Infinity;
    for (const w of WALLS) {
      const c = new Phaser.Math.Vector2(w.x + w.w / 2, w.y + w.h / 2);
      const dir = c.clone().subtract(this.player).normalize();
      const reach = Math.hypot(w.w, w.h) / 2 + 22;
      const p = c.clone().add(dir.scale(reach));
      if (this.blocked(p.x, p.y) || this.los(this.player, p)) continue;
      const d = this.dist(this.enemy, p);
      if (d < bestD) [best, bestD] = [p, d];
    }
    return best;
  }

  // ---------- FSM ----------
  private setState(next: EnemyState, _why: string) {
    this.state = next;
    this.stateSince = this.time.now;
    if (next === "STRAFE") this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    if (next === "TAKE_COVER") this.coverPoint = this.findCover();
  }

  /** Brains only *request* transitions; the FSM validates them. */
  private requestTransition(next: EnemyState, why: string): boolean {
    if (next === this.state) return false;
    if (this.time.now - this.stateSince < MIN_DWELL_MS) return false;
    if (next === "HEAL" && !this.pack) return false;
    this.setState(next, why);
    return true;
  }

  private steerTo(tx: number, ty: number, speed: number, dt: number) {
    const a = Math.atan2(ty - this.enemy.y, tx - this.enemy.x);
    const step = speed * dt;
    const tryDir = (ang: number) => {
      const dx = Math.cos(ang) * step, dy = Math.sin(ang) * step;
      if (this.blocked(this.enemy.x + dx, this.enemy.y + dy) && this.blocked(this.enemy.x + dx, this.enemy.y) && this.blocked(this.enemy.x, this.enemy.y + dy)) return false;
      this.moveBody(this.enemy, dx, dy);
      return true;
    };
    // try straight, then deflect either side to slide around walls
    for (const off of [0, 0.6, -0.6, 1.2, -1.2]) if (tryDir(a + off)) return;
  }

  private faceTowards(o: Phaser.GameObjects.Image, tx: number, ty: number) {
    o.rotation = Math.atan2(ty - o.y, tx - o.x);
  }

  private enemyShoot(now: number) {
    if (now < this.reloadingUntil || now - this.lastShot < FIRE_MS) return;
    if (this.ammo <= 0) {
      this.reloadingUntil = now + RELOAD_MS;
      this.ammo = MAX_AMMO;
      return;
    }
    if (!this.los(this.enemy, this.player)) return;
    this.ammo--;
    this.lastShot = now;
    const a = Math.atan2(this.player.y - this.enemy.y, this.player.x - this.enemy.x) + Phaser.Math.FloatBetween(-0.12, 0.12);
    this.spawnBullet(this.enemy.x, this.enemy.y, a, BULLET_SPEED_E, false);
  }

  private updateEnemy(now: number, dt: number) {
    const e = this.enemy, p = this.player;
    const d = this.dist(e, p);
    switch (this.state) {
      case "PATROL": {
        const t = this.waypoints[this.wp];
        if (this.dist(e, t) < 20) this.wp = (this.wp + 1) % this.waypoints.length;
        this.steerTo(t.x, t.y, ENEMY_SPEED * 0.6, dt);
        e.rotation = Phaser.Math.Angle.RotateTo(e.rotation, Math.atan2(t.y - e.y, t.x - e.x), 0.1);
        break;
      }
      case "CHASE":
        this.steerTo(p.x, p.y, ENEMY_SPEED, dt);
        this.faceTowards(e, p.x, p.y);
        break;
      case "ATTACK":
        this.faceTowards(e, p.x, p.y);
        this.enemyShoot(now);
        break;
      case "STRAFE": {
        const tang = Math.atan2(p.y - e.y, p.x - e.x) + (Math.PI / 2) * this.strafeDir;
        const radial = d > 220 ? 0.4 : d < 140 ? -0.4 : 0;
        const dx = Math.cos(tang) + Math.cos(tang - (Math.PI / 2) * this.strafeDir) * radial;
        const dy = Math.sin(tang) + Math.sin(tang - (Math.PI / 2) * this.strafeDir) * radial;
        const before = { x: e.x, y: e.y };
        this.moveBody(e, dx * ENEMY_SPEED * dt, dy * ENEMY_SPEED * dt);
        if (e.x === before.x && e.y === before.y) this.strafeDir *= -1; // hit a wall, reverse
        this.faceTowards(e, p.x, p.y);
        this.enemyShoot(now);
        break;
      }
      case "TAKE_COVER": {
        if (!this.coverPoint || now - this.stateSince > 1500) this.coverPoint = this.findCover() ?? this.coverPoint;
        const c = this.coverPoint;
        if (c && this.dist(e, c) > 10) {
          this.steerTo(c.x, c.y, ENEMY_SPEED * 1.1, dt);
          this.faceTowards(e, c.x, c.y);
        } else {
          this.faceTowards(e, p.x, p.y);
          if (this.ammo < MAX_AMMO && now > this.reloadingUntil) {
            this.reloadingUntil = now + COVER_RELOAD_MS;
            this.ammo = MAX_AMMO;
          }
        }
        break;
      }
      case "HEAL":
        if (this.pack) {
          this.steerTo(this.pack.x, this.pack.y, ENEMY_SPEED * 1.1, dt);
          this.faceTowards(e, this.pack.x, this.pack.y);
        }
        break;
    }
    // auto-reload when dry
    if (this.ammo <= 0 && now > this.reloadingUntil) {
      this.reloadingUntil = now + RELOAD_MS;
      this.ammo = MAX_AMMO;
    }
  }

  // ---------- brain ----------
  private snapshot(now: number): Snapshot {
    const cover = this.findCover();
    const aim = Math.atan2(this.enemy.y - this.player.y, this.enemy.x - this.player.x);
    const aimErr = Math.abs(Phaser.Math.Angle.Wrap(this.player.rotation - aim));
    const los = this.los(this.enemy, this.player);
    this.dmgLog = this.dmgLog.filter((x) => now - x.t < 2000);
    return {
      currentState: this.state,
      msInCurrentState: Math.round(now - this.stateSince),
      enemy: { hp: Math.round(this.eHp), maxHp: ENEMY_MAX_HP, ammo: this.ammo, maxAmmo: MAX_AMMO, reloading: now < this.reloadingUntil },
      player: { hp: Math.round(this.pHp), maxHp: PLAYER_MAX_HP },
      distanceToPlayer: Math.round(this.dist(this.enemy, this.player)),
      hasLineOfSight: los,
      playerAimingAtEnemy: los && aimErr < 0.25,
      damageTakenLast2s: this.dmgLog.reduce((s, x) => s + x.d, 0),
      coverAvailable: !!cover,
      distanceToCover: cover ? Math.round(this.dist(this.enemy, cover)) : null,
      healthPackAvailable: !!this.pack,
      distanceToHealthPack: this.pack ? Math.round(this.dist(this.enemy, this.pack)) : null,
      attackRange: ATTACK_RANGE,
    };
  }

  private think(now: number) {
    if (this.inFlight || now - this.lastAsk < DECISION_MS) return;
    this.lastAsk = now;
    const snap = this.snapshot(now);
    const from = this.state;

    if (this.mode === "RULES") {
      this.apply(ruleBasedDecision(snap), from);
      return;
    }
    this.inFlight = true;
    const t0 = performance.now();
    fetch("/api/jev", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(snap) })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        return { state: j.state as EnemyState, reason: j.reason as string, source: "jev", latencyMs: Math.round(performance.now() - t0) } as Decision;
      })
      .catch((err: Error) => {
        // Never leave the enemy brain-dead: fall back to the rule brain and surface the error.
        const fb = ruleBasedDecision(snap, "fallback");
        return { ...fb, latencyMs: Math.round(performance.now() - t0), error: err.message } as Decision;
      })
      .then((d) => {
        this.inFlight = false;
        if (this.over || !ENEMY_STATES.includes(d.state)) return;
        this.apply(d, from);
      });
  }

  private apply(d: Decision, from: EnemyState) {
    this.lastDecision = d;
    this.requestTransition(d.state, d.reason);
    // only log when something is interesting: state change or error
    if (d.state !== from || d.error) this.hooks.onDecision(d, from);
  }

  // ---------- combat ----------
  private spawnBullet(x: number, y: number, a: number, speed: number, fromPlayer: boolean) {
    const s = this.add.image(x + Math.cos(a) * 20, y + Math.sin(a) * 20, "bullet").setTint(fromPlayer ? 0x93c5fd : 0xfca5a5);
    this.bullets.push({ s, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, fromPlayer });
  }

  private updateBullets(dt: number) {
    for (const b of this.bullets) {
      b.s.x += b.vx * dt;
      b.s.y += b.vy * dt;
      const target = b.fromPlayer ? this.enemy : this.player;
      if (this.dist(b.s, target) < R) {
        if (b.fromPlayer) {
          this.eHp -= DMG_P;
          this.dmgLog.push({ t: this.time.now, d: DMG_P });
        } else this.pHp -= DMG_E;
        b.s.destroy();
        b.s.setData("dead", true);
      } else if (b.s.x < 0 || b.s.x > W || b.s.y < 0 || b.s.y > H || WALLS.some((w) => inRect(b.s.x, b.s.y, w))) {
        b.s.destroy();
        b.s.setData("dead", true);
      }
    }
    this.bullets = this.bullets.filter((b) => !b.s.getData("dead"));
  }

  private updatePack(now: number) {
    if (!this.pack && now > this.nextPackAt) {
      for (let i = 0; i < 30; i++) {
        const x = Phaser.Math.Between(60, W - 60), y = Phaser.Math.Between(60, H - 60);
        if (!this.blocked(x, y)) {
          this.pack = this.add.image(x, y, "pack");
          break;
        }
      }
    }
    if (!this.pack) return;
    const take = (who: Phaser.GameObjects.Image) => this.dist(who, this.pack!) < 24;
    if (take(this.enemy)) this.eHp = Math.min(ENEMY_MAX_HP, this.eHp + 40);
    else if (take(this.player)) this.pHp = Math.min(PLAYER_MAX_HP, this.pHp + 40);
    else return;
    this.pack.destroy();
    this.pack = undefined;
    this.nextPackAt = now + 12000;
  }

  private endRound(humanWon: boolean) {
    this.over = true;
    if (humanWon) this.score.human++;
    else this.score.enemy++;
    this.hooks.onScore({ ...this.score });
    this.banner.setText(humanWon ? "YOU WIN\npress R" : "ENEMY WINS\npress R");
  }

  // ---------- loop ----------
  update(now: number, deltaMs: number) {
    const dt = Math.min(deltaMs, 50) / 1000;
    this.gfx.clear();
    if (!this.over) {
      const k = this.keys;
      const dx = (k.D.isDown ? 1 : 0) - (k.A.isDown ? 1 : 0), dy = (k.S.isDown ? 1 : 0) - (k.W.isDown ? 1 : 0);
      const len = Math.hypot(dx, dy) || 1;
      this.moveBody(this.player, (dx / len) * PLAYER_SPEED * dt, (dy / len) * PLAYER_SPEED * dt);
      const ptr = this.input.activePointer;
      this.faceTowards(this.player, ptr.worldX, ptr.worldY);
      if (ptr.isDown && now - this.lastPlayerShot > 180) {
        this.lastPlayerShot = now;
        this.spawnBullet(this.player.x, this.player.y, this.player.rotation, BULLET_SPEED_P, true);
      }
      this.think(now);
      this.updateEnemy(now, dt);
      this.updateBullets(dt);
      this.updatePack(now);
      if (this.eHp <= 0) this.endRound(true);
      else if (this.pHp <= 0) this.endRound(false);
    }
    this.draw(now);
  }

  private draw(now: number) {
    const bar = (x: number, y: number, v: number, m: number, c: number) => {
      this.gfx.fillStyle(0x000000, 0.6).fillRect(x - 20, y, 40, 5);
      this.gfx.fillStyle(c).fillRect(x - 20, y, 40 * Math.max(0, v / m), 5);
    };
    bar(this.player.x, this.player.y - 26, this.pHp, PLAYER_MAX_HP, 0x3b82f6);
    bar(this.enemy.x, this.enemy.y - 26, this.eHp, ENEMY_MAX_HP, 0xef4444);
    if (this.mode === "JEV" && this.inFlight) this.gfx.lineStyle(2, 0x58a6ff).strokeCircle(this.enemy.x, this.enemy.y, R + 6);
    const d = this.lastDecision;
    this.hud.setText(
      [
        `Brain: ${this.mode}${this.inFlight ? " (thinking…)" : ""}   Enemy state: ${this.state}`,
        `Enemy ammo: ${this.reloadingUntil > now ? "reloading" : this.ammo + "/" + MAX_AMMO}   Last: ${d ? `${d.source} ${d.latencyMs}ms` : "-"}`,
        d?.reason ? `“${d.reason}”` : "",
      ].join("\n"),
    );
  }
}
