# 04. v2 "boss rush": data-driven bosses, side view

A side-view hack and slash. Four bosses in a row (Slime "Gloop", Fire Worm "Ember", Evil Wizard "Morvane", Bringer of Death), each with its own FSM described as a table, fought on Tiled arenas, driven by Jev. Route `/boss-rush`.

Files: `game/boss/defs.ts` (boss tables and the player constants), `game/boss/BossScene.ts` (~840 lines: simulation), `game/boss/brain.ts` (snapshot, prompt builder, `askJev`, rules brain), `game/boss/engine.ts` (tile `World`, `Actor`), `game/boss/createBossGame.ts` (loader), `app/boss-rush/*` (React shell), `app/api/jev/boss/route.ts` (server). Assets: `tools/prep_assets.py`, `tools/make_maps.py` ([06](06-asset-pipeline.md)).

## What changed versus v1

| v1 | v2 |
|---|---|
| One hardcoded FSM with 6 states | Each boss is a **table** of states (`BossDef.states`): description, animation, move or attack definition |
| Fixed question and criteria in the route | **Question built per boss** from its table: only currently available states are offered, each with its range |
| Procedural circles | Real sprite sheets sliced into strips, per-frame hit boxes, Tiled tile maps, parallax backgrounds |
| Single enemy | Four bosses, 3 arenas, phase 2 enrage, practice mode |

## Boss tables (`defs.ts`)

```ts
interface BossDef { id, name, title, sheet, nativeDir, scale, hp, arena, tint, persona, states: Record<string, StateDef> }
interface StateDef { desc: string; attack?: AttackDef; move?: MoveDef }
interface AttackDef { anim, fps, cooldown, range:[min,max], damage?, hit?:{frames:[a,b], box}, lunge?, events?: SpawnEvent[], repeat? }
interface MoveDef  { mode: "hold"|"toward"|"away"|"hop", anim, speed, cooldown? }
type SpawnEvent = projectile (fireball/bolt, optional lob arc and fan angle) | rain (bolts from sky) | pillar (ground column with a warning, extra pillars in phase 2)
```

- `desc` is shown to Jev verbatim as the criterion text for that state, and `range` is appended ("best at 90-420px"). Writing a good `desc` is the "prompt engineering" for a state.
- `persona` is a paragraph about the boss's temperament and how a smart one would play, inserted into the instructions.
- Frame numbers are 0-based indices into the sliced animation strips. Hit boxes are in *unscaled* sprite pixels: `dx` is the gap between body centre and the near edge in the facing direction.

| Boss | HP | Arena | Character | Notable states |
|---|---|---|---|---|
| Gloop (slime) | 160 | 1 | Slow brute | CRAWL_TOWARD/AWAY, LUNGE (long wind-up) |
| Ember (worm) | 220 | 2 | Zoner | FIREBALL, LOB (lands where you stood), FAN (3 fireballs) |
| Morvane (wizard) | 260 | 3 | Cowardly caster | APPROACH, RETREAT, HOP_BACK, BOLT, BOLT_RAIN (warned sky bolts) |
| The Bringer | 360 | 2 | Patient duelist | STALK, BACKOFF, SCYTHE, SCYTHE_COMBO (2 sweeps, art faces left: `nativeDir -1`), SOUL_PILLAR (3 pillars when enraged) |

## Player (`PLAYER` in defs)

Knight: run 150, jump 440 with gravity 900 (platforms are one-way: jump up through, press S to drop), attack 18 damage with a 56x46 hit box on frames 3-4, **dash** (0.2 s with i-frames, 0.65 s cooldown). Input buffering: attack 140 ms, dash 140 ms, jump 120 ms. Keys: A/D move, W/Space/Up jump, J or click attack, K or Shift dash, R retry boss, T toggle brain, H debug overlay, Enter new run when finished, 1-4 practice a specific boss.

## Run flow (`BossScene`)

`Phase`: `intro` (banner, 1 s) -> `fight` -> `bossDead` (3.2 s) -> next boss -> ... -> `finished` (time, deaths, hits taken). `startBoss(idx, retry)` builds the arena (Tiled tile layers `ground` and `platforms`, tinted per boss; four parallax layers), spawns actors at the `spawns` object layer positions, resets HP (retry keeps at least half), and starts the run record. `emitStatus` feeds the React shell.

### Collision (`engine.ts`)
`World` reads two tile layers into boolean grids. `ground` is solid; `platforms` can be stood on only from above. `landing()` returns the floor top between the previous and new foot Y for a given horizontal span. `Actor` is a physics body with a sprite; its position is the point between the feet.

## The decision loop (`updateBossBrain`)

State record `run`: current `state`, `since`, per-state cooldowns `cd`, `needsDecision`, `lastAsk`, `inFlight`, `history` (recent actions), stagger timers, `phase`, pending decision.

Each frame while fighting:
1. If a decision is `pending` (arrived during a stagger) and the stagger is over, enter it.
2. Do nothing while an attack is running (`atk`), a hop is in progress, the boss is staggered, or a request is in flight.
3. Otherwise ask when `needsDecision` (right after an attack ends) or every `DECISION_MS` (default 500) for movement states.
4. `availableStates(now)`: filters out states on cooldown, retreat moves when a wall is closer than 40 px behind the boss, and attacks when the player is dead.
5. Build `BossSnapshot` (boss: hp %, phase, state, ms in state, last actions, same-action streak, just staggered; player: hp %, action, airborne, facing, dash ready, attack/dash/jump counts in last 4 s, standing-still time; distance, vertical relation, wall distance behind boss, which attacks are in range, damage dealt/taken over 6 s).
6. RULES mode: `rulesDecision` (use an attack in range, else close in or back away based on min/max reach). JEV mode: `askJev` -> `/api/jev/boss`. On error: rules decision as `fallback`. The answer is ignored if the fight changed (`runId`) or the state is no longer available (it becomes IDLE).
7. `applyDecision` logs attacks, changes and errors, then `enter(state)` runs it. An attack is **committed**: once started it plays to the end; Jev's job is spacing, timing and not being predictable.

`brain.ts: buildQuestion(def, available)` writes the instructions ("You control NAME, TITLE: a boss in a 2D side-view hack-and-slash duel against a human knight. The knight has a short-reach sword, a jump, and a dash with brief invulnerability. PERSONA ...") and one criterion per available state.

### Phase 2 (enrage)
`mul()` returns `{speed 1.25, cd 0.7, fps 1.15}` in phase 2 (boss HP under half); some spawn events have phase-2 variants (extra pillars).

### Attack execution (`updateAttack`, `fire`, `updateTimed`)
Per frame: lunge movement during `lunge.frames`; hit box resolved once per attack when the animation enters `hit.frames`; `events` fire at their frame (`fire()`): `projectile` (flat, angled fan, or lobbed arc via gravity), `rain` (staggered warned bolts around the player), `pillar` (warning marker then a column after `delay` ms). Projectiles and pillars are pooled arrays updated each frame; `explode` handles ground impact.

### Presentation
Hit-stop on strikes, popup damage numbers, boss HP bar and state label over its head, HUD text; the React shell shows the live decision log with probabilities, source badges and latency.

## Tools and tests
No automated tests for v2 (it predates the harness). Verify visually and via the decision log. Asset build: `npm run assets:download && npm run assets` ([06](06-asset-pipeline.md)); maps are regenerated by `tools/make_maps.py` into `public/maps/arena_N.json` and can be edited in Tiled.

## Lessons carried into v3
- Tables beat code for content, and `desc` strings are part of the content.
- Offering only available states and validating on return are non-negotiable.
- Committing to attacks keeps the game readable; the model should choose *what and when*, not micro-steer.
- Showing the model's probabilities in the UI is the best debugging tool and the best demo.
