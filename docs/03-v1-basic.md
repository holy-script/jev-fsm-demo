# 03. v1 "basic": the minimal pattern

The first demo. A top-down shooter duel: you (blue) against a Jev-driven enemy (red). It exists to prove the integration end to end with the least possible machinery, and it is the cleanest reference for the pattern "a model chooses the next FSM state; the engine validates and executes it".

Route `/basic`. Also frozen on git branch `v1-basic` exactly as first delivered. Files: `game/ArenaScene.ts` (the scene), `game/types.ts` (state names and snapshot), `game/rules.ts` (rules brain), `game/createGame.ts` (Phaser bootstrap), `app/basic/page.tsx` + `GameClient.tsx` (React shell with the decision log), `app/api/jev/route.ts` (server).

## Game

- Arena 960x600 with five static walls. Player moves with WASD and shoots by mouse (aim at pointer). No art files: textures are generated at runtime in `makeTextures()` with Phaser Graphics (circles with a gun barrel, wall, bullet, health pack).
- Both fighters have 100 HP. The enemy has 8 rounds of ammo, a 330 ms fire interval, a 1.5 s reload (0.8 s when reloading in cover). Player bullets are faster (640 px/s) than enemy bullets (380 px/s) but hit for 15 against 12.
- A health pack spawns periodically (first after 8 s). Round ends at 0 HP; a score (human vs enemy) is kept across rounds. `R` restarts the round, `T` toggles the brain between Jev and the rules bot.

## The FSM

Six states (`ENEMY_STATES` in `types.ts`):

| State | Behaviour in `updateEnemy` |
|---|---|
| PATROL | Walk waypoint loop |
| CHASE | Steer toward the player |
| ATTACK | Hold and shoot (needs line of sight and ammo) |
| STRAFE | Circle the player while shooting |
| TAKE_COVER | Run to a spot hidden from the player (`findCover()` computes points behind walls with no line of sight) and reload faster |
| HEAL | Run to the health pack |

Movement uses `steerTo`, which tries the straight direction then deflects either side to slide around walls. Line of sight is a stepped ray test against the wall rectangles.

### Brains only request; the FSM validates
`requestTransition(next)` refuses a transition when:
- it is the current state,
- the enemy has been in its state for less than `MIN_DWELL_MS` (250 ms; stops flip-flopping),
- `HEAL` is requested with no health pack on the field.

This is the key architectural idea reused in v2 and v3: the model proposes, the engine disposes. A bad or stale answer can never put the enemy into an impossible state.

## Decision loop (`think`)

Every `DECISION_MS` (default 600, from `NEXT_PUBLIC_JEV_DECISION_INTERVAL_MS`) and only if no request is in flight:

1. Build a `Snapshot` (see `types.ts`): current state and time in it, enemy hp/ammo/reloading, player hp, distance, line of sight, whether the player is aiming at the enemy, damage taken in the last 2 s, cover availability and distance, health pack availability and distance, attack range.
2. If mode is RULES: `ruleBasedDecision(snapshot)` (priority list: low hp + pack = HEAL, low hp + cover = TAKE_COVER, out of ammo = TAKE_COVER, no LOS and far = PATROL, no LOS = CHASE, close = STRAFE, else ATTACK).
3. If JEV: `POST /api/jev` with the snapshot. On any failure the **fallback** is the rules decision with `source: "fallback"` and the error attached, so the enemy never freezes.
4. `apply()` calls `requestTransition` and reports to the React shell only when the state changed or an error occurred (keeps the log readable).

## Server route

`app/api/jev/route.ts` holds a fixed instruction string ("you are the decision-making brain of an enemy AI in a 2D top-down shooter duel...") and the six `CRITERIA` descriptions, each phrased as when to pick it ("Run to a spot hidden from the player and reload faster. Use when hurt, out of ammo, or outgunned and cover is available."). It calls `jevChoice` and returns `{state, reason: "TOP 3 probabilities", confidence}`. `satisfies Record<EnemyState, string>` guarantees every state has a description at compile time.

## React shell

`GameClient.tsx` creates the Phaser game in an effect, passes `Hooks` (`onDecision`, `onScore`, `onMode`) and renders: the canvas, a mode badge (JEV/RULES), the score, and a scrolling decision log with source, latency, reason and errors.

## Why it is worth keeping

- Smallest complete example of: snapshot design, `choice` question with descriptive criteria, server proxy, timeout and fallback, engine-side validation, live decision log.
- If you need a new, simple Jev-driven enemy, copy this pattern first, then graduate to the state-table approach in [04](04-v2-boss-rush.md).
