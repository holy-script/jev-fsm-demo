# Agent guide

Start with [docs/README.md](docs/README.md). It indexes the engineering docs for this repo (setup, Jev integration, how v1/v2/v3 were built, asset pipeline, testing, extension recipes).

Essentials:
- Jev (TypeSafe's decision model) picks the enemy's next action through `POST /v1/systemone`; the engine validates and executes it. Every Jev call has a rules fallback. See docs/02.
- **v4 "ARENA" at `/arena` (`game/v4/`) is the next-generation demo** being built in phases: see docs/09-v4-plan.md (assets, animation and QTE systems, four bosses with Jev, stamp-built areas, UI, audio). `npm run test:arena` runs its eight suites (Jev is mocked, so no API calls).
- The v3 game is at `/duel` (`game/duel/`). Content is data-driven (`game/duel/data.ts`); behaviour lives in `game/duel/DuelScene.ts`. See docs/05 and the recipes in docs/08.
- Third-party art is not in git (`assets/`, `public/game-assets/`, `public/duel-assets/` are ignored). Build it with `npm run assets` / `npm run assets:duel` (docs/06).
- Verify with `npx tsc --noEmit` and the Playwright suites in `tests/duel/` (`npm run dev` must be running; the full chain takes about 20 minutes, run it in the background; never edit game code while it runs). See docs/07.
- Never commit `.env`, `assets/`, generated asset folders, or `links.txt`. Never print the API key. Commit and push after each coherent change.
