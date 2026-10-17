# Jev FSM Demo: engineering docs

These docs describe how the whole project was built, why it was built that way, and how to extend it. They are written for a coding agent (or a new engineer) picking the repo up cold. Read them in order the first time; afterwards use them as a reference.

## What the project is

A showcase for **Jev**, TypeSafe's decision model. In every demo a game enemy runs on a conventional finite state machine (FSM) or action table, but the *choice of the next state* is made by Jev through an HTTP API instead of hand-written rules. A human plays against it. Three demos exist, each a layer more ambitious than the last, and they share one Jev client.

| Version | Route | Genre | Where it lives | Doc |
|---|---|---|---|---|
| v1 "basic" | `/basic` | Top-down shooter duel, 6-state enemy, procedural art | `game/ArenaScene.ts`, `game/rules.ts`, `game/types.ts`, `app/basic/`; also frozen on branch `v1-basic` | [03](03-v1-basic.md) |
| v2 "boss rush" | `/boss-rush` | Side-view hack and slash, 4 bosses, Tiled arenas | `game/boss/`, `app/boss-rush/` | [04](04-v2-boss-rush.md) |
| v3 "Posture Duel" (title: REAPER'S DANCE) | `/duel` | Sekiro-style top-down duel, full game with tutorial, skills, 3 areas, 5 encounters, final boss | `game/duel/`, `app/duel/` | [05](05-v3-posture-duel.md) |

v3 is the real product. v1 and v2 are kept because they show the integration pattern at smaller scale and still run.

## Document map

| File | Read it when |
|---|---|
| [01-setup-and-layout.md](01-setup-and-layout.md) | You need to run, build, or find your way around the repo. Env vars, routes, commands, conventions, gotchas. |
| [02-jev-integration.md](02-jev-integration.md) | You touch anything that calls Jev. The API, the server helper, question types, prompt design, fallbacks, latency strategy. |
| [03-v1-basic.md](03-v1-basic.md) | You want the minimal reference implementation of "LLM-style model picks FSM state". |
| [04-v2-boss-rush.md](04-v2-boss-rush.md) | You want data-driven bosses (state tables) driven by Jev, side view, platform physics. |
| [05-v3-posture-duel.md](05-v3-posture-duel.md) | You change the duel game. Architecture, combat model, boss runner, brain, world, tutorial, skills, story, persistence. The longest doc. |
| [06-asset-pipeline.md](06-asset-pipeline.md) | You add or replace art, audio, music or maps. |
| [07-testing.md](07-testing.md) | You change behaviour and need to verify it. Test harness design, per-suite coverage, pitfalls that cost hours. |
| [08-extending.md](08-extending.md) | You are about to add something: a boss, a move type, an area, a skill, a taunt. Step-by-step recipes, plus the known backlog and lessons learned. |
| [09-v4-plan.md](09-v4-plan.md) | You are building or reviewing v4 ("ARENA"): asset sources, animation and QTE systems, phases. |

## Five things to know before changing anything

1. **Jev only chooses; the engine executes.** Jev never moves a sprite. It picks one of a set of *currently available* options. Everything the model is allowed to pick is listed in the question's `criteria`, each with a plain-English description of when it applies. If you add a move and do not describe it well, Jev will not use it well.
2. **Every Jev call has a rules fallback.** On error, timeout (client 1.5 s in v3), or an unavailable answer, a hand-written bot decides instead. The game must never stall waiting for Jev. See [02](02-jev-integration.md).
3. **Third-party art is not in git.** `assets/`, `public/game-assets/` and `public/duel-assets/` are gitignored (Bringer of Death's licence forbids redistribution). A fresh clone has no art until you run the asset pipeline ([06](06-asset-pipeline.md)). Without it `/boss-rush` and `/duel` show a "missing assets" message.
4. **v3 is data-driven.** Bosses, moves, areas, skills and tutorial lessons are tables (`game/duel/data.ts`, `skills.ts`, `tutorial.ts`) interpreted by `DuelScene.ts`. Most content changes are table edits. New *behaviour* (a new move kind) needs a small engine addition; [08](08-extending.md) shows the exact places.
5. **Tests drive the real game in a browser.** There is no unit-test framework. Playwright scripts in `tests/duel/` load `/duel?dev=1`, reach into `window.__duel` (the live Phaser scene) and assert on state. They need `npm run dev` running. Read [07](07-testing.md) before writing one: several non-obvious traps are listed there.

## Repo status at the time of writing

- Branches: `main` (everything), `v1-basic` (v1 frozen as first delivered).
- Last verified full regression: all suites in `npm run test:duel` passed (mechanics 20, jev-gates 13, golem 16, beat, skills 16, tutorial 13, grunts 9, world 15, bringer 10, jev2 14).
- Not verified by hand: game feel, balance with a real human, audio levels by ear. These were checked by measurement, scripted bots and screenshots only. Feedback from human play is the main outstanding input.
