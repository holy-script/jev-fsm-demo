# 07. Testing

There is no unit-test framework. Verification is done by **Playwright scripts that drive the real game in Chromium** and assert on live scene state, plus a few tools that measure things a human would otherwise judge by ear or eye. All files are plain Node ES modules in `tests/duel/` (v3 only; v1 and v2 have no automated tests).

## Running

```bash
npm run dev                   # terminal 1 (tests talk to http://localhost:3000)
node tests/duel/mechanics.mjs # one suite
npm run test:duel             # all suites chained with && in sequence
```

A full `npm run test:duel` takes roughly **20 minutes** with software rendering. Run it in the background (agent shells cap foreground commands at 10 minutes) and read the output when it finishes:

```bash
(npm run test:duel > /tmp/duel_all.txt 2>&1; echo done >> /tmp/duel_all.txt) &
# later:  grep -E "passed|FAIL|errors" /tmp/duel_all.txt
```

Each suite prints `PASS`/`FAIL name {json info}` lines, then `no page errors` (or the stack of any `pageerror`) and `N/M passed`. Scan for `FAIL` and for a missing "no page errors". Note: the scripts print results but do not set a failing exit code, so the `&&` chain keeps going after a failing suite; the printed pass counts are the truth. Read them.

**Do not edit game source while a suite is running**: Next's hot reload reloads the page mid-test and produces bogus failures.

## How the harness works

Every suite follows the same shape:

1. Launch Chromium with `--use-gl=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist` (software GL; no GPU needed).
2. `page.addInitScript` seeds `localStorage` **before** the app loads: `duel.settings` pinned to `{beat:"classic", difficulty:"duelist", ...}` so timing is deterministic, and (for non-dev flows) a `duel.save`.
3. `goto("/duel?dev=1")` (dev skips the title and uses the three-boss `BOSSES` list in the Monastery with no darkness) or `/duel` plus Enter for real flows (tutorial, grunts, world, memory).
4. Wait for `window.__duel?.player`.
5. A `setup()` helper resets a boss and puts both fighters in a known state using the scene's methods and fields directly (`d.reset(d.idxOf("captain")); d.debugWake(); d.b.auto = false; d.refill(); d.player.x = d.boss.x - 70; d.b.nextThink = 1e12; d.b.cd = {}; ...`). `auto = false` stops Jev/rules from acting so a forced move (`key("z")` fires the first dummy key) is the only thing that happens.
6. Real key presses via `page.keyboard` for player actions (`Space` guard, `Shift` roll, `j` attack...), or direct calls for things that need exact timing.
7. Wait on **game state**, not wall time, where possible: `page.waitForFunction(() => window.__duel.b.held && window.__duel.time.now >= window.__duel.b.holdUntil - 40, null, {polling: "raf"})`.
8. Assert with `check(name, condition, info)` where `info` is dumped on failure.

`window.__duel` is the DuelScene instance and `window.__game` the Phaser game, set only when `NODE_ENV !== "production"`. Private TypeScript members are accessible at runtime, which is what the tests rely on.

### Mocking Jev
`page.route("**/api/jev/ask", ...)` reads the posted `questions`, then fulfils with `{answers}` that you construct (choose a specific option, set `probabilities`). Used by `jev-gates.mjs` (all gate branches), `golem.mjs` (fixed idle/gate picks) and `jev2.mjs` (taunt/rhythm/habits requests inspected). This makes AI-dependent logic deterministic and free.

## Suites

| Suite | Tests | Covers |
|---|---|---|
| `mechanics.mjs` | 20 | Captain: deflect window, spam gives no window, block chip and posture, roll i-frames, thrust slip (+riposte), sweep/grab unblockable, riposte, posture break -> deathblow, segments, stone/shield guard and kick, phase 2, projectiles, glyph warnings, difficulty windows |
| `jev-gates.mjs` | 13 | With a mocked API: the combo gate logic: every branch (CONTINUE, DELAY, FEINT, END, chain), default on no answer, late answers ignored, cooldown filtering, fallback paths, the brain toggle |
| `golem.mjs` | 16 | Golem: thrown fist (deflect reverses it, block chips, roll avoids), laser (lock timing, unblockable, rolling through), stone guard (light attacks do nothing, heavy breaks), armor buff (half damage), noFlinch, phase 2 double fist |
| `beat.mjs` | 4 | In beat mode every boss impact lands within about 0.04 beat of the grid (half-beat for syncopated moves), in classic mode it does not |
| `skills.mjs` | 16 | All 9 skills and the shrine: costs, prerequisites, deflect window with Keen Eye, Echo, Whirl, blades, Roll Cut, shrine UI by keyboard, points awarded, flow after a boss falls |
| `tutorial.mjs` | 13 | The tutorial runs all 12 lessons in order from a fresh save, with injected events for most lessons but **real keyboard movement** for MOVE and a real deflect for DEFLECT; typewriter and Enter behaviour; finishing opens the gate, saves, leaves the boss in auto mode |
| `grunts.mjs` | 9 | Bone Soldier and Spear Bearer: rules brain fights, defeat saved, no skill point and no shrine, next grunt rises |
| `world.mjs` | 15 | Areas, travel with fade, zone title cards, Foundry lights/shrine/lore, lore reading, interaction prompt suppression in fights and tutorial, story intros (speak once, remembered), tutorial-skip regression (story still plays and the boss fights) |
| `bringer.mjs` | 10 | The final boss: 3 lives, scythe, unblockable reap (and the roll that beats it), soul bolts (1 vs 2), pillars (2/3/4, strike a standing player, dodge by stepping away), blink behind the player |
| `jev2.mjs` | 14 | Fairness governor, player habits, memory (saved, fed to Jev, survives restart), taunts and cooldown, rhythm timing plans, run records for the stats screen, out-of-reach intent, posture-bar and break rules, watchdog, F key |

Tools (not pass/fail suites):
- `audio.mjs`: renders every synthesised cue in an `OfflineAudioContext` and prints peak, RMS dB, length and spectral centroid so loudness can be balanced without listening.
- `personas.mjs [durMs] [bossIdx]`: three/four scripted play styles (turtle, roller, kiter, greedy) against the **real** Jev, then prints idle/gate choice histograms, average reads and latency. Costs API calls.
- `bot.mjs [bosses] [trials] [classic|beat]` (env `BRAIN=RULES|JEV`, `MAX_S`, `PAR`): balance harness. An in-page scripted player at three skill levels dispatches synthetic keyboard events (`window.dispatchEvent(new KeyboardEvent("keydown", {keyCode}))`), deflects/rolls by reading the boss's telegraph timing, attacks in openings, heals when safe. Reports win rate, time, lowest HP and any **stuck** boss state (same mode more than 6.5 s). It is a rough proxy for a human: use it for *relative* signals (Bringer beat mode: novice dies in life 2, competent reaches life 3, expert wins).

## Writing a new test: rules of thumb

- Pin settings to classic timing unless you are testing beat mode. Beat mode makes hold durations depend on the music phase.
- Disable the brain on the boss (`d.b.auto = false`) and force its move, so only your scenario happens. Set `d.b.nextThink = 1e12` and clear `d.b.cd = {}` between cases.
- Poll with `{polling: "raf"}` for narrow windows. **Lead** timing-critical presses by 30 to 40 ms: software rendering has uneven frame times and a window of 160 ms can be missed.
- Wait with state conditions and generous timeouts. Game time runs slower than wall time under swiftshader (often 0.6x).
- Wrap instrumentation (e.g. counting `spawnProjectile`) once per page, not once per setup, or counts double.
- For real-flow tests (tutorial, world, grunts) seed a complete `duel.save` including `seen: [...]` for any story keys you do not want to wait through; otherwise dialogue boxes block the boss until Enter is pressed.
- A kill needs the **last segment** (`d.b.seg = d.def.segments - 1`). Captain and Golem have 2 segments, Bringer 3.
- Prefer real inputs for anything a player would do (movement, guard, roll). Two bugs reached the user because tests injected state instead of playing (the MOVE lesson counter and a boss left in non-auto mode after the tutorial); both now have real-flow assertions.
- Keep new suites in `npm run test:duel`.

## Traps already hit (each cost time)

1. Hot reload during a run (see above).
2. Destroyed arrays reused after a scene restart: `SkillScene` and `MenuScene` must reset their row/ember arrays in `init()`, because Phaser reuses the scene instance.
3. A key missing from the scene's key set (ENTER in the tutorial) throws only when pressed.
4. Test and game both handling Enter: the interaction handler must be registered **before** the dialogue-advance handler, or the press that closes a dialogue immediately reopens a lore inscription.
5. Typewriter text: the first line may already be complete when you press Enter, so Enter advances instead of completing.
6. Timing rings that close at hold end instead of at impact (include the projectile travel or animation lead).
7. Scene `Scene.events` name clash; use another field name.
8. `async` story/dialogue that rejects when the tutorial is cancelled can leave a boss frozen: story lines now bypass cancellation (`say(..., true)`).
9. Mode state that survives scene transitions (`b.auto`) must be reinitialised in `spawnBoss`.
