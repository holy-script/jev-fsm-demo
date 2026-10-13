import { NextResponse } from "next/server";
import { ENEMY_STATES, type EnemyState, type Snapshot } from "@/game/types";

export const runtime = "nodejs";

const QUESTION = {
  type: "choice",
  instructions:
    "You are the decision-making brain of an enemy AI in a 2D top-down shooter duel against a human player. " +
    "The content is the enemy's current situation. Choose the best NEXT behavior state for the enemy. " +
    "Consider health, ammo, distance, line of sight, whether the player is aiming at the enemy, and recent damage.",
  criteria: {
    PATROL: "Wander between waypoints. The player is far away and not visible.",
    CHASE: "Move toward the player to close distance or regain line of sight.",
    ATTACK: "Hold position and shoot. Needs line of sight, ammo, and the player within attack range.",
    STRAFE: "Circle the player while shooting. Good at close or mid range, or when the player is aiming at the enemy.",
    TAKE_COVER: "Run to a spot hidden from the player and reload faster. Use when hurt, out of ammo, or outgunned and cover is available.",
    HEAL: "Run to the health pack to restore HP. Only valid when a health pack is available.",
  },
};

export async function POST(req: Request) {
  const apiKey = process.env.TYPESAFE_API_KEY;
  const baseUrl = process.env.TYPESAFE_BASE_URL;
  const model = process.env.JEV_MODEL;
  if (!apiKey || !baseUrl || !model) {
    return NextResponse.json(
      { error: "Jev is not configured. Set TYPESAFE_API_KEY, TYPESAFE_BASE_URL and JEV_MODEL in .env" },
      { status: 503 },
    );
  }

  const snapshot = (await req.json()) as Snapshot;
  const url = baseUrl.replace(/\/+$/, "") + "/v1/systemone";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Number(process.env.JEV_TIMEOUT_MS ?? 2500));

  try {
    const res = await fetch(url, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, state: snapshot, questions: { next_state: QUESTION } }),
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Jev HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` }, { status: 502 });
    }
    const data = await res.json();
    const ans = data?.answers?.next_state;
    const state = ans?.choice as EnemyState | undefined;
    if (!state || !ENEMY_STATES.includes(state)) {
      return NextResponse.json({ error: `Unexpected Jev reply: ${JSON.stringify(data).slice(0, 160)}` }, { status: 502 });
    }
    // Jev returns probabilities rather than prose, so build the "reason" from the top candidates.
    const top = Object.entries((ans.probabilities ?? {}) as Record<string, number>)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, v]) => `${k} ${Math.round(v * 100)}%`)
      .join(" · ");
    return NextResponse.json({ state, reason: top, confidence: ans.confidence });
  } catch (e) {
    const msg = e instanceof Error && e.name === "AbortError" ? "Jev timed out" : String(e);
    return NextResponse.json({ error: msg }, { status: 504 });
  } finally {
    clearTimeout(timer);
  }
}
