import { NextResponse } from "next/server";
import { JevError, jevAsk, type JevQuestion } from "@/lib/jev";

export const runtime = "nodejs";

/** Generic multi-question endpoint used by the Posture Duel: { state, questions } -> { answers }. */
export async function POST(req: Request) {
  const { state, questions } = (await req.json()) as { state: unknown; questions: Record<string, JevQuestion> };
  if (!questions || typeof questions !== "object" || Object.keys(questions).length === 0 || Object.keys(questions).length > 12) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  try {
    return NextResponse.json({ answers: await jevAsk(state, questions) });
  } catch (e) {
    const err = e instanceof JevError ? e : new JevError(String(e), 500);
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}
