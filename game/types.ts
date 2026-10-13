export const ENEMY_STATES = ["PATROL", "CHASE", "ATTACK", "STRAFE", "TAKE_COVER", "HEAL"] as const;
export type EnemyState = (typeof ENEMY_STATES)[number];

/** What the enemy "sees" — the only thing Jev gets to decide from. */
export interface Snapshot {
  currentState: EnemyState;
  msInCurrentState: number;
  enemy: { hp: number; maxHp: number; ammo: number; maxAmmo: number; reloading: boolean };
  player: { hp: number; maxHp: number };
  distanceToPlayer: number;
  hasLineOfSight: boolean;
  playerAimingAtEnemy: boolean;
  damageTakenLast2s: number;
  coverAvailable: boolean;
  distanceToCover: number | null;
  healthPackAvailable: boolean;
  distanceToHealthPack: number | null;
  attackRange: number;
}

export interface Decision {
  state: EnemyState;
  reason: string;
  source: "jev" | "rules" | "fallback";
  latencyMs: number;
  error?: string;
}
