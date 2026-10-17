import { save, saveGame } from "./settings";

export type Path = "deflection" | "flow" | "tools";

export interface Skill {
  id: string;
  name: string;
  path: Path;
  cost: number;
  needs?: string; // prerequisite skill id
  blurb: string;
}

/**
 * Core moves (always available): light chain, heavy, guard/deflect, roll, kick, heal, and the riposte that a deflect or a slip opens.
 * Everything here is unlocked at a shrine with skill points: you start with 2 and earn 1 per boss, so you cannot buy it all.
 */
export const SKILLS: Skill[] = [
  { id: "keen", name: "Keen Eye", path: "deflection", cost: 1, blurb: "Deflect window +40 ms." },
  { id: "echo", name: "Echo", path: "deflection", cost: 1, needs: "keen", blurb: "A deflect grants +1 extra spirit and a longer riposte window." },
  { id: "wrist", name: "Iron Wrist", path: "deflection", cost: 1, blurb: "Deflects deal 30% more posture damage." },
  { id: "rollcut", name: "Roll Cut", path: "flow", cost: 1, blurb: "Press attack late in a roll to cut out of it (J)." },
  { id: "whirl", name: "Whirl Cut", path: "flow", cost: 2, blurb: "Combat art (L, 2 spirit): a spin that hits all around you and breaks a raised guard." },
  { id: "reach", name: "Riposte Reach", path: "flow", cost: 1, blurb: "Your riposte window lasts 50% longer." },
  { id: "blades", name: "Throwing Blades", path: "tools", cost: 1, blurb: "Tool (I, 1 spirit): a thrown blade that chips posture and nudges a raised guard." },
  { id: "well", name: "Spirit Well", path: "tools", cost: 1, blurb: "+2 maximum spirit." },
  { id: "gourd", name: "Quick Gourd", path: "tools", cost: 1, blurb: "Healing takes 30% less time." },
];

export const PATH_LABEL: Record<Path, string> = { deflection: "DEFLECTION", flow: "FLOW", tools: "TOOLS" };

export const has = (id: string) => save.skills.includes(id);
export const canBuy = (s: Skill) => !has(s.id) && save.points >= s.cost && (!s.needs || has(s.needs));
export function buy(id: string): boolean {
  const s = SKILLS.find((x) => x.id === id);
  if (!s || !canBuy(s)) return false;
  save.skills.push(id);
  save.points -= s.cost;
  saveGame();
  return true;
}
export function awardPoint(n = 1) {
  save.points += n;
  saveGame();
}
