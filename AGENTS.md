# Agent guide

Start with [docs/README.md](docs/README.md). It indexes the engineering docs for this repo (setup, Jev integration, how v1/v2/v3 were built, asset pipeline, testing, extension recipes).

Essentials:
- Jev (TypeSafe's decision model) picks the enemy's next action through `POST /v1/systemone`; the engine validates and executes it. Every Jev call has a rules fallback. See docs/02.
- **v4 "ARENA" at `/arena` (`game/v4/`) is the next-generation demo** — feature-complete and production-ready: see docs/09-v4-plan.md (full architecture, phases 1–7k). `npm run test:arena` runs its 14 suites with 364/365 checks passing. Core systems: combos with reverse-parry perfect parries, jump/dash with z-axis air combat, fire skills (Ember Bolt, Inferno Ring), items (Healing Gourd, Fire Pot, pickup orbs), QTE deathblows, four Jev-driven bosses with phase 2 move sets, camera feedback (shake, punch, zoom), weather particles, beat-sync audio infrastructure. Jev is mocked in tests; runs on rules brain fallback without API calls.
- The v3 game is at `/duel` (`game/duel/`). Content is data-driven (`game/duel/data.ts`); behaviour lives in `game/duel/DuelScene.ts`. See docs/05 and the recipes in docs/08.
- Third-party art is not in git (`assets/`, `public/game-assets/`, `public/duel-assets/` are ignored). Build it with `npm run assets` / `npm run assets:duel` (docs/06).
- **v4 testing**: `npm run test:arena` runs 14 test suites (phases 1–7j, plus audio-system and camera-effects) with 364/365 checks. Tests run in parallel once `npm run dev` is running; full suite takes ~8–10 minutes. Never edit game code while tests run.
- **v3 testing**: `npx tsc --noEmit` and the Playwright suites in `tests/duel/` (`npm run dev` must be running; full chain ~20 minutes, run in background). See docs/07.
- Architecture: v4 is data-driven (`game/v4/data.ts`, `game/v4/bosses.ts`, `game/v4/areas.ts`); behaviour in `game/v4/ArenaScene.ts`. v3 at `game/duel/` is separate and untouched.
- Never commit `.env`, `assets/`, generated asset folders (`public/*-assets/`), or `links.txt`. Never print the API key. Commit and push after each coherent change.
