import { NextResponse } from "next/server";
import { ENEMY_STATES, type Snapshot } from "@/game/types";
import { JevError, jevChoice, topProbabilities } from "@/lib/jev";

export const runtime = "nodejs";

const INSTRUCTIONS =
  "You are the decision-making brain of an enemy AI in a 2D top-down shooter duel against a human player. " +
  "The content is the enemy's current situation. Choose the best NEXT behavior state for the enemy. " +
  "Consider health, ammo, distance, line of sight, whether the player is aiming at the enemy, and recent damage.";

const CRITERIA = {
  PATROL: "Wander between waypoints. The player is far away and not visible.",
  CHASE: "Move toward the player to close distance or regain line of sight.",
  ATTACK: "Hold position and shoot. Needs line of sight, ammo, and the player within attack range.",
  STRAFE: "Circle the player while shooting. Good at close or mid range, or when the player is aiming at the enemy.",
  TAKE_COVER: "Run to a spot hidden from the player and reload faster. Use when hurt, out of ammo, or outgunned and cover is available.",
  HEAL: "Run to the health pack to restore HP. Only valid when a health pack is available.",
} satisfies Record<(typeof ENEMY_STATES)[number], string>;

export async function POST(req: Request) {
  const snapshot = (await req.json()) as Snapshot;
  try {
    const r = await jevChoice(snapshot, INSTRUCTIONS, CRITERIA);
    return NextResponse.json({ state: r.choice, reason: topProbabilities(r.probabilities), confidence: r.confidence });
  } catch (e) {
    const err = e instanceof JevError ? e : new JevError(String(e), 500);
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}
