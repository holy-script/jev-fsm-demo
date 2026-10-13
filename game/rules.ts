import type { Snapshot, Decision } from "./types";

/** Hand-written baseline brain. Used as the "RULES" opponent and as Jev's fallback. */
export function ruleBasedDecision(s: Snapshot, source: Decision["source"] = "rules"): Decision {
  const hpPct = s.enemy.hp / s.enemy.maxHp;
  let state: Decision["state"];
  let reason: string;

  if (hpPct < 0.35 && s.healthPackAvailable) [state, reason] = ["HEAL", "low hp, pack available"];
  else if (hpPct < 0.35 && s.coverAvailable) [state, reason] = ["TAKE_COVER", "low hp"];
  else if ((s.enemy.ammo === 0 || s.enemy.reloading) && s.coverAvailable)
    [state, reason] = ["TAKE_COVER", "out of ammo"];
  else if (!s.hasLineOfSight && s.distanceToPlayer > 480) [state, reason] = ["PATROL", "player far away"];
  else if (!s.hasLineOfSight) [state, reason] = ["CHASE", "no line of sight"];
  else if (s.distanceToPlayer < 200) [state, reason] = ["STRAFE", "player close"];
  else [state, reason] = ["ATTACK", "clear shot"];

  return { state, reason, source, latencyMs: 0 };
}
