// Server-only helper for TypeSafe's Jev API (POST /v1/systemone).
export interface JevChoice {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export class JevError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export type JevQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string; criteria?: { true?: string; false?: string } }
  | { type: "score"; instructions: string; criteria: string[] };

export type JevAnswer =
  | { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }
  | { type: "noul"; noul: number }
  | { type: "score"; score: number; confidence: number; probabilities: Record<string, number> };

/** One /v1/systemone call with any mix of questions about the same `state`. */
export async function jevAsk(state: unknown, questions: Record<string, JevQuestion>): Promise<Record<string, JevAnswer>> {
  const apiKey = process.env.TYPESAFE_API_KEY;
  const baseUrl = process.env.TYPESAFE_BASE_URL;
  const model = process.env.JEV_MODEL;
  if (!apiKey || !baseUrl || !model) {
    throw new JevError("Jev is not configured. Set TYPESAFE_API_KEY, TYPESAFE_BASE_URL and JEV_MODEL in .env", 503);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Number(process.env.JEV_TIMEOUT_MS ?? 2500));
  try {
    const res = await fetch(baseUrl.replace(/\/+$/, "") + "/v1/systemone", {
      method: "POST",
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, state, questions }),
    });
    if (!res.ok) throw new JevError(`Jev HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, 502);
    const answers = (await res.json())?.answers;
    if (!answers) throw new JevError("Unexpected Jev reply: no answers", 502);
    return answers;
  } catch (e) {
    if (e instanceof JevError) throw e;
    throw new JevError(e instanceof Error && e.name === "AbortError" ? "Jev timed out" : String(e), 504);
  } finally {
    clearTimeout(timer);
  }
}

/** Ask Jev to pick one of `criteria` (name -> when it applies) given arbitrary JSON `state`. */
export async function jevChoice(state: unknown, instructions: string, criteria: Record<string, string>): Promise<JevChoice> {
  const ans = (await jevAsk(state, { decision: { type: "choice", instructions, criteria } })).decision;
  if (ans?.type !== "choice" || !(ans.choice in criteria)) {
    throw new JevError(`Unexpected Jev reply: ${JSON.stringify(ans).slice(0, 160)}`, 502);
  }
  return { choice: ans.choice, confidence: ans.confidence ?? 0, probabilities: ans.probabilities ?? {} };
}

export const topProbabilities = (p: Record<string, number>, n = 3) =>
  Object.entries(p)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k, v]) => `${k} ${Math.round(v * 100)}%`)
    .join(" · ");
