/** Shrine perks: after each of the first three bosses the shrine offers three of these and the player keeps one. Pure data and a seeded offer. */
export interface Perk {
  id: string;
  name: string;
  desc: string;
}
export const PERKS: Perk[] = [
  { id: "keen", name: "Keen Eye", desc: "Your deflect window is 40 ms wider." },
  { id: "wrist", name: "Iron Wrist", desc: "Deflects and counters knock 30% more posture off the boss." },
  { id: "ember", name: "Warm Ember", desc: "Every fight starts with 2 spirit." },
  { id: "kindled", name: "Kindled Blade", desc: "Flame Burst costs 1 spirit instead of 2." },
  { id: "breath", name: "Steady Breath", desc: "Your posture recovers 50% faster." },
  { id: "reach", name: "Long Reach", desc: "Your sword reaches 15% farther." },
];
export const MAX_PERKS = 3;

/** Three perks the player does not have yet, chosen from a seed (the boss index) so reloading the shrine shows the same offer. */
export function offer(taken: string[], seed: number): Perk[] {
  const pool = PERKS.filter((p) => !taken.includes(p.id));
  let s = (seed * 2654435761 + 12345) >>> 0;
  const out: Perk[] = [];
  while (out.length < 3 && pool.length) {
    s = (s * 1664525 + 1013904223) >>> 0;
    out.push(pool.splice(s % pool.length, 1)[0]);
  }
  return out;
}
