import { NextResponse } from "next/server";
import { JevError, jevChoice, topProbabilities } from "@/lib/jev";

export const runtime = "nodejs";

/** Boss Rush decision endpoint. The client sends the boss's situation plus the actions currently available. */
export async function POST(req: Request) {
  const { state, instructions, criteria } = await req.json();
  if (typeof instructions !== "string" || !criteria || typeof criteria !== "object" || Object.keys(criteria).length < 2) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  try {
    const r = await jevChoice(state, instructions.slice(0, 4000), criteria);
    return NextResponse.json({ state: r.choice, confidence: r.confidence, probabilities: r.probabilities, reason: topProbabilities(r.probabilities) });
  } catch (e) {
    const err = e instanceof JevError ? e : new JevError(String(e), 500);
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}
