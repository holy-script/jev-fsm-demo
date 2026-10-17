# 01. Setup, layout and conventions

## Stack

- **Next.js 15** (App Router) + **React 19** + **TypeScript** (strict). Next provides pages and the server-side API routes that hold the Jev key.
- **Phaser 3.80** for the games, mounted from a client component into a div. `pixelArt: true`, `roundPixels: true`, `Scale.FIT` so the fixed-resolution canvas scales to the window.
- **Playwright** (devDependency) for two jobs: downloading itch.io assets (`tools/itch_download.mjs`) and the browser-driven test suites.
- **Python 3** with Pillow and numpy for the asset pipeline and the beat/tempo detector. **ffmpeg** (loudnorm, decoding) is also required by the asset script.
- No state library, no CSS framework, no test framework. Inline styles in the thin React shells.

## Getting running

```bash
cp env.sample .env            # fill in TYPESAFE_API_KEY (never commit .env, never print it)
npm i
npx playwright install chromium
npm run dev                   # http://localhost:3000
```

Art is not in git. For `/boss-rush` and `/duel` you must build the assets first; see [06](06-asset-pipeline.md). `/basic` needs no assets (procedural textures).

### Environment variables (`env.sample`)

| Var | Side | Meaning |
|---|---|---|
| `TYPESAFE_API_KEY` | server only | Bearer token for the Jev API |
| `TYPESAFE_BASE_URL` | server only | `https://api.typesafe.ai`; the route calls `${base}/v1/systemone` |
| `JEV_MODEL` | server only | Model name or alias (e.g. `jev-latest`) |
| `JEV_TIMEOUT_MS` | server only | Server-side request timeout, default 2500 |
| `NEXT_PUBLIC_JEV_DECISION_INTERVAL_MS` | client | v1/v2 pacing between decisions (v3 does not use it) |

Only `NEXT_PUBLIC_*` reaches the browser. The key stays on the server because the browser talks to `/api/jev/*`, never to TypeSafe.

### npm scripts

| Script | Does |
|---|---|
| `dev`, `build`, `start` | Next.js |
| `assets:download`, `assets` | v2 art: download zips with Playwright, slice strips, write `public/game-assets`, Tiled maps |
| `assets:download:duel`, `assets:duel` | v3 art: same idea for `public/duel-assets` and the duel maps |
| `test:duel` | All v3 suites in sequence (needs the dev server running; takes roughly 20 minutes under software rendering) |

## Routes

| Route | File | Notes |
|---|---|---|
| `/` | `app/page.tsx` | Landing page with three cards |
| `/basic` | `app/basic/page.tsx`, `GameClient.tsx` | v1 |
| `/boss-rush` | `app/boss-rush/page.tsx`, `BossRushClient.tsx` | v2 |
| `/duel` | `app/duel/page.tsx`, `DuelClient.tsx` | v3. Full-window canvas; **Tab** toggles a side overlay with the Jev decision log, probabilities and "reads" of the player |
| `/duel?dev=1` | | Skips the title screen, uses only the three-boss `BOSSES` list in the Monastery map, hides darkness. Used by tests and handy for debugging |
| `/duel?dev=1&light=1` | | Dev mode with the darkness/lighting layer on |
| `/api/jev` | `app/api/jev/route.ts` | v1: fixed question, fixed 6 criteria |
| `/api/jev/boss` | `app/api/jev/boss/route.ts` | v2: client sends `{state, instructions, criteria}` |
| `/api/jev/ask` | `app/api/jev/ask/route.ts` | v3: client sends `{state, questions}` (1 to 12 questions in one call) |

## Directory layout

```
app/                    Next pages + API routes (thin; all real logic is under game/ and lib/)
lib/jev.ts              Server-only Jev client (jevAsk, jevChoice, JevError)
game/
  ArenaScene.ts, rules.ts, types.ts, createGame.ts      v1
  boss/                                                  v2: BossScene, defs (4 bosses), brain, engine, createBossGame
  duel/                                                  v3
    DuelScene.ts   ~2400 lines: the whole simulation (player, boss runner, world, tutorial host, dialogue)
    data.ts        all content tables: HERO, moves, bosses, areas, glyphs
    brain.ts       Telemetry, prompts, askIdle/askGate, rules brain, snapshot types
    engine.ts      World (tile collision + objects), Fighter (sprite wrapper), geometry helpers
    sfx.ts         audio engine: samples + synthesised cues + music + beat clock
    vfx.ts         tinted VFX bursts, afterimages, squash
    skills.ts      the skill tree and purchase logic
    tutorial.ts    the scripted 12-lesson tutorial
    settings.ts    Settings + SaveData + localStorage persistence
    HudScene.ts, MenuScene.ts, SkillScene.ts, createDuelGame.ts
tools/                  asset pipeline + map generators + bpm detector (Python/Node/shell). README documents the packs and licences
tests/duel/             Playwright suites and tools (bot balance harness, personas)
public/                 maps/ (committed), game-assets/ and duel-assets/ (gitignored, generated)
assets/                 raw downloaded packs (gitignored)
docs/                   you are here
```

## Conventions that matter

- **Code style:** match the surrounding file. Comments are sparse and explain *why*, not *what*. No lint config beyond `tsc --noEmit` (run it; it must be clean).
- **Distances** are world pixels on the ground plane, **times** are milliseconds unless a name says `Sec`. Animation timing is in frames of a named strip at a given fps.
- **Content in tables, behaviour in the scene.** If a feature can be expressed as a field on `MoveDef`/`BossDef`/`AreaDef`, add the field and interpret it once in `DuelScene.ts`.
- **Nothing persists except** `localStorage` keys `duel.settings` and `duel.save` (both wrapped in try/catch; storage can be unavailable). Do not add other persistence without discussing it.
- **Never commit** `.env`, anything under `assets/`, `public/duel-assets/`, `public/game-assets/`, or `links.txt` (the user's personal link list; it is intentionally untracked).
- **Commit workflow the user asked for:** commit and push after every coherent update, with a descriptive message. Commit messages end with the co-author trailer the session specifies.

## Gotchas that have already cost time

- **Editing source while a browser test runs** triggers Next's hot reload, which reloads the page and breaks the run. Wait for tests to finish before editing game code (editing docs is fine).
- **Software rendering** (Playwright with swiftshader) makes game time slower than wall time. Waits need generous headroom, and tests that poll narrow windows must lead them.
- **`sleep` as a foreground command is blocked** in the agent shell; use a background `until` loop. Long suites exceed a 10-minute foreground limit; run them in the background.
- **Phaser `Scene.events` is reserved**: do not name a field `events`.
- **`git push` can take minutes** here; run it in the background and check the result.
- **The `.next` cache can go stale** after a `next build` while `next dev` runs. Delete `.next` and restart dev if pages 404 or misbehave.
