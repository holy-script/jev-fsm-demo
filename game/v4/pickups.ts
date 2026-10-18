import type { PickupKind } from "./data";
import { PICKUPS, BURNING_GROUND } from "./data";

/** A pickup orb entity: heart (heal), gem (spirit), bomb (fire pot) */
export class Pickup {
  x: number;
  y: number;
  kind: PickupKind;
  sprite?: Phaser.Physics.Arcade.Sprite;
  createdAt: number;
  lifetime: number;
  heal?: number;
  spirit?: number;

  constructor(x: number, y: number, kind: PickupKind, createdAt: number) {
    this.x = x;
    this.y = y;
    this.kind = kind;
    this.createdAt = createdAt;
    this.lifetime = PICKUPS[kind].lifetime;
    if (kind === "heart") this.heal = PICKUPS[kind].heal;
    if (kind === "gem") this.spirit = PICKUPS[kind].spirit;
  }

  isExpired(now: number): boolean {
    return now - this.createdAt > this.lifetime;
  }
}

/** Burning ground hazard: damages player over time */
export class BurningGround {
  x: number;
  y: number;
  radius: number;
  createdAt: number;
  duration: number;

  constructor(x: number, y: number, createdAt: number) {
    this.x = x;
    this.y = y;
    this.radius = BURNING_GROUND.radius;
    this.createdAt = createdAt;
    this.duration = BURNING_GROUND.duration;
  }

  isExpired(now: number): boolean {
    return now - this.createdAt > this.duration;
  }

  damagePlayerThisFrame(playerX: number, playerY: number, dt: number): number {
    const dist = Math.hypot(playerX - this.x, playerY - this.y);
    if (dist < this.radius) {
      return (BURNING_GROUND.dmgPerSec * dt) / 1000;
    }
    return 0;
  }
}

/** Pickup and hazard manager */
export class PickupSystem {
  pickups: Pickup[] = [];
  hazards: BurningGround[] = [];

  spawnPickup(x: number, y: number, kind: PickupKind, now: number): Pickup {
    const p = new Pickup(x, y, kind, now);
    this.pickups.push(p);
    return p;
  }

  spawnBurningGround(x: number, y: number, now: number): BurningGround {
    const h = new BurningGround(x, y, now);
    this.hazards.push(h);
    return h;
  }

  /** Spawn pickup orb(s) at location. Used for phase transitions, perfect parries, etc. */
  spawnReward(x: number, y: number, kind: PickupKind, now: number, count: number = 1): Pickup[] {
    const pickups: Pickup[] = [];
    for (let i = 0; i < count; i++) {
      const offsetX = (Math.random() - 0.5) * 40; // scatter around spawn point
      const offsetY = (Math.random() - 0.5) * 40;
      pickups.push(this.spawnPickup(x + offsetX, y + offsetY, kind, now));
    }
    return pickups;
  }

  update(now: number) {
    this.pickups = this.pickups.filter((p) => !p.isExpired(now));
    this.hazards = this.hazards.filter((h) => !h.isExpired(now));
  }

  clear() {
    this.pickups = [];
    this.hazards = [];
  }
}
