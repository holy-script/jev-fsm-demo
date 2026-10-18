import { HERO, type HitDef } from "./data";

/** Pure combat rules (no Phaser) so the suites can exercise them directly through window.__arena. */
export type Outcome = "dodged" | "deflected" | "blocked" | "hit" | "missed" | "countered";

export interface Defender {
  guarding: boolean;
  /** scene clock (ms) of the last guard press */
  guardPressedAt: number;
  /** the last press came too soon after the one before it: no deflect window (anti guard-mash) */
  noDeflect: boolean;
  /** invulnerable right now (roll i-frames, post-hit grace) */
  invulnerable: boolean;
}

/** Is the target inside the attacker's reach? Forward ellipse: `reach` ahead of the attacker, a little behind, `band` of depth tolerance. */
export function inReach(ax: number, ay: number, face: 1 | -1, tx: number, ty: number, reach: number, band: number, pad: number, around = false): boolean {
  const fx = (tx - ax) * face;
  if (around) return Math.abs(tx - ax) <= reach + pad && Math.abs(ty - ay) <= band + pad * 0.5;
  return fx >= -pad && fx <= reach + pad && Math.abs(ty - ay) <= band + pad * 0.5;
}

/** What happens when an enemy hit connects with a defender at scene time `now`. */
export function resolveEnemyHit(d: Defender, now: number, hit: HitDef, inRangeNow: boolean, countered = false, deflectMs = HERO.deflectMs): Outcome {
  if (!inRangeNow) return "missed";
  if (d.invulnerable) return "dodged";
  const kind = hit.kind ?? "normal";
  if (kind === "perilous") return countered ? "countered" : "hit"; // guard does nothing against a perilous attack
  if (d.guarding && kind !== "sweep") {
    const fresh = now - d.guardPressedAt <= deflectMs;
    return fresh && !d.noDeflect ? "deflected" : "blocked";
  }
  return "hit";
}

/** Guard-press bookkeeping: pressing again inside the spam window of the previous press earns no deflect. */
export function pressGuard(d: Defender, now: number) {
  d.noDeflect = now - d.guardPressedAt < HERO.deflectSpamMs;
  d.guardPressedAt = now;
  d.guarding = true;
}

export const chip = (dmg: number) => Math.max(1, Math.round(dmg * HERO.chipFraction));
