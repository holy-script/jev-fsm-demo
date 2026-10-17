# 02. Jev integration

Everything that talks to the model goes through one server helper and three thin API routes. This document explains the API, how the project uses it, and the design rules that make a model a good FSM brain.

## The API

`POST {TYPESAFE_BASE_URL}/v1/systemone` with a Bearer token.

```jsonc
{
  "model": "jev-latest",
  "state": { /* any JSON: the situation */ },
  "questions": {
    "next_action": { "type": "choice", "instructions": "...", "criteria": { "OPTION_A": "when to pick A", "OPTION_B": "..." } },
    "turtling":    { "type": "noul",   "instructions": "Is the player playing defensively?" },
    "predictability": { "type": "score", "instructions": "...", "criteria": ["erratic", "slight", "clear pattern", "highly predictable"] }
  }
}
```

Reply: `{ "answers": { "<questionName>": ... } }` where

| Question type | Answer shape | Use |
|---|---|---|
| `choice` | `{type:"choice", choice, confidence, probabilities:{option:p}}` | Pick exactly one of the named options. `probabilities` sums to about 1 across options and is great for debugging and UI. |
| `noul` | `{type:"noul", noul: 0..1}` | A graded yes/no ("how true is this?"). Used for reading the player. |
| `score` | `{type:"score", score, confidence, probabilities, legend?}` | A rating on a short ordered scale (criteria array = the scale legend). |

Many questions about the **same state** can go in one call (the v3 route allows up to 12). That is the main efficiency trick: one round trip returns the action, several reads of the player, a beat-rhythm choice and an optional taunt. Typical latency is about **350 ms**.

The model has no memory between calls and no knowledge of the game. It knows only `state` and the text in `instructions` and `criteria`. All game knowledge must be supplied in those strings.

## Server helper: `lib/jev.ts`

Server-only (reads env, holds the key).

- `jevAsk(state, questions)` : one call, returns the `answers` map. Handles config check (503 if env is missing), abort timeout (`JEV_TIMEOUT_MS`, default 2500; becomes a 504 "Jev timed out"), non-200 (502), and a malformed reply (502).
- `jevChoice(state, instructions, criteria)` : convenience for a single `choice` question named `decision`; validates the returned option is one of `criteria`.
- `JevError(message, status)` : carries an HTTP status through to the route response.
- `topProbabilities(p, n)` : formats `"ATTACK 62% · STRAFE 20% · ..."` for log lines.
- Types `JevQuestion`, `JevAnswer`, `JevChoice`.

## The three routes

| Route | Body in | Out | Used by |
|---|---|---|---|
| `POST /api/jev` | a v1 `Snapshot` | `{state, reason, confidence}` | v1. The instructions and 6 criteria live in the route. |
| `POST /api/jev/boss` | `{state, instructions, criteria}` | `{state, confidence, probabilities, reason}` | v2. The client builds the question per boss from its state table. |
| `POST /api/jev/ask` | `{state, questions}` | `{answers}` | v3. Fully generic; client composes the questions. Rejects empty or >12 questions. |

Errors become `{error}` with the status from `JevError`. The client treats any non-200 as "fall back".

## Patterns used in every version

### 1. Snapshot, not game dump
Build a compact, human-readable snapshot (percentages, booleans, small counts, named enums), not raw coordinates or internals. Examples of fields that earn their place: distance, whether the target is in range of each move (`reachable`), hp/posture percentages, the boss's last five actions and the same-action streak, the player's recent action counts, and how the player answered each boss move so far.

### 2. Offer only legal options
The `criteria` object lists only actions that are **currently available** (off cooldown, in reach, not forbidden by the fairness rules). Jev cannot pick what is not offered. This removes a whole class of bugs. Still validate on return: the state can change while the request is in flight.

### 3. Describe options as "when to use", with the real mechanics
Each criterion is a sentence of strategy: what it does, what it beats, what beats it, its range. Prompts include a block of the game's actual rules (see `RULES_TEXT` in `game/duel/brain.ts`): what is unblockable, what a roll beats, how deflects work. A model plays only as well as its rules text.

### 4. Always keep a rules brain
A hand-written bot with fixed priorities (v1 `rules.ts`, v2 `rulesDecision`, v3 `rulesIdle`/`rulesGate`, weighted tables per boss). Uses:
- **Fallback** when Jev errors, is slow, or returns an unavailable option.
- **Comparison opponent**: key `F` (v3) or `T` (v2) swaps the brain live; v3 also records per-brain fight stats for the "Jev vs Rules" screen.
- **Grunts and the tutorial Shade** use the rules brain by design (no need to spend model calls).

### 5. Hide latency
The model takes about a third of a second. Do not make the enemy wait on it.
- **v1/v2:** decisions are requested on a timer or right after an action finishes; the enemy keeps executing its current state meanwhile.
- **v3 prefetch:** the idle decision is requested *while the boss is still recovering* from its last move, so the answer is usually waiting when the recovery ends. `ensureRequest(now)` runs each frame during recover/walk/guard modes; `takeDecision(now)` consumes the answer when the boss becomes idle.
- **Staleness:** an answer older than 3.5 s is dropped and re-asked.
- **Timeout:** if the boss is idle and a request has been in flight for more than `ASK_TIMEOUT` (1500 ms), the rules bot decides now and the late answer is ignored (`askId` increments so the old promise cannot apply).
- **Combo gates** ask mid-combo (after the first hit resolves) and the combo *holds on a frame* up to `GATE_WAIT` (450 ms) for the answer before proceeding with the default branch.

### 6. Make the model's reasoning visible
The UI shows the chosen action, its probability, the source (`JEV`/`RULES`/`FALLBACK`), latency, errors, and (v3) the "reads" (turtling, roll-reliant, trade-hungry, panicking, predictability). This is the point of the demo: users can see the model adapt.

## v3 specifics (`game/duel/brain.ts`)

### Idle question set (`idleQuestions`)
One call, up to 8 questions:

| Name | Type | Purpose |
|---|---|---|
| `next_action` | choice | The boss's next action. Criteria = available moves (with their `desc` and reach) plus generic actions: APPROACH, BACKSTEP, CIRCLE, WAIT, GUARD (per-boss overrides in `actionDesc`). |
| `turtling`, `roll_reliant`, `trade_hungry`, `panicking` | noul | Reads of the player. Displayed in the overlay; the model's own later answers see the snapshot, not these reads. |
| `predictability` | score (0..3) | How patterned the player is. |
| `rhythm` | choice | Beat mode only matters: ON_BEAT / OFF_BEAT (half a beat late) / QUICK / SLOW. Applied by `planHolds` when the move starts. |
| `taunt` | choice | Only if the boss has `taunts`. Options are `NONE` plus authored lines, each with a "use when" note. Silence is the stated default; the scene also enforces a 14 s cooldown. |

### Gate questions (`gateQuestions`)
`gate_choice`: how a combo continues after its first hit resolves: `CONTINUE`, `DELAY` (half a beat longer: beats early deflect), `FEINT` (cancel into guard), `END`, or chain into another move id. Options marked `phase2` are hidden in phase 1. Options for moves on cooldown are filtered out in the scene before asking.

### Snapshot (`DuelSnapshot`)
`boss` (segment, phase, hp/posture %, armored, mode, lastActions, sameActionStreak), `player` (hp/posture %, heals, state, distance, distance trend, standing-still ms, guard held, spirit, riposte ready, unlocked skills), `recent` (counts of attacks, guard taps, deflects, rolls, kicks, heals, hits taken, arts, tools, ripostes in the last 8 s), `vsMove` (per boss move: thrown, deflected, blocked, dodged, slipped, hit, and the player's *first reaction* histogram), `lastOutcome`, `reachable` (per move), `timing` (beat or classic + beat length), `habits` (roll direction counts, average guard-tap lead before impact, risky vs safe heals, punish vs greedy swings), `memory` (what this boss learned in earlier attempts), `fairness` (unblockable streak and whether they are capped), and for gates `gate: {move, step}`.

### Telemetry (`Telemetry` class)
Fed by hooks in `DuelScene` (guard press, attack start, roll start with direction relative to the boss, heal, deflect with lead time, hurt, plus per-move outcomes and the player's first reaction within 700 ms of each boss attack). `habits()` and `summary()` produce the compact JSON above.

### Fairness governor
`availableActions` removes unblockable moves (thrust, sweep, grab, beam, pillars) once the boss's last two *moves* were unblockable (walks and waits do not break the streak). Rules brain and Jev both respect it because both choose from `availableActions`.

### Memory across attempts
`remember(won)` (called when the player dies or the boss falls) writes per-boss `BossMemory` into the save: attempts, wins, which moves landed, which way the player rolls, average guard-tap lead. `memoryForJev()` summarises it into the snapshot so the model can open the next attempt with what worked last time.

### Out-of-reach picks
If Jev picks a melee move that is no longer in reach when its answer arrives (the player moved while it was in flight), the scene does not discard it for a random rules move. It records an `intent`, runs APPROACH, and then executes the intended move on the next decision if it is available within 3.5 s.

### Failure handling summary

| Situation | Result |
|---|---|
| HTTP error / timeout / missing env | `rulesIdle(..., "fallback", error)`; error text goes to the log |
| Answer not in `available` | thrown inside `askIdle`; fallback as above |
| Answer valid but stale or no longer available when consumed | intent (range) or fallback rules pick |
| Player toggles brain with F mid-request | `askId++` so the old answer is ignored |
| Boss state held absurdly long | `watchdog` frees it (see 05) |

## Writing good criteria and prompts

- Name each option by its game id and describe its *counter-play*. Jev is good at "pick the move that beats what this player does", and only if the description says what each move beats.
- State what the player can do and what they are weak to. A model told "unblockable moves cannot be blocked; rolling gives invulnerability" will correctly pick sweeps against turtles.
- Add rate-limiting information in the *state*, not in hope: `sameActionStreak`, per-move cooldowns (enforced by the engine), and the fairness block.
- Keep instructions short per question; put shared rules in one shared text block and prepend it.
- Do not ask Jev for things the engine can compute deterministically.
- Use `choice` for decisions, `noul` for "how true is this", `score` for gradations. Do not use free text.

## Testing Jev-dependent code without the API

`tests/duel/jev-gates.mjs` and `jev2.mjs` intercept `**/api/jev/ask` with `page.route`, inspect the posted `questions`, and return a fabricated `answers` map with chosen options and probabilities. That makes gate logic, taunts, rhythm and fallback paths deterministic. `tests/duel/personas.mjs` is the opposite: it uses the **real** API with three scripted play styles to show how choices and reads shift (run manually; it costs calls).
