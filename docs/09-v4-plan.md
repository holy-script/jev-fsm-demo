# 09. v4 plan: "ARENA" proper demo

Status: **Phases 0 (assets, 9), 1 (kernel, 10), 2 (combat depth, 11) 3 (bosses and Jev, 12) 4 (world, 13) 5 (UI/UX, 14) and 6 (balance and demo, 15) done.** Phase 7 (movement, spacing, fire, items, atmosphere) is planned in section 16 and in progress; human play-testing and the polish list in 15.6 remain. Decisions taken with the user: free assets only; v4 is a new route `/arena` in `game/v4/` (v3 `/duel` stays untouched and playable); the setting follows the environment packs (forest, ruined river temple, graveyard), so the v3 monastery/foundry/summit story is rewritten.

Goal: a polished 10 to 15 minute demo where Jev is visibly the enemy's brain, with a consistent art style, better environments, richer combat (combos, reverse-animation parries, quick-time events) and a real UI.

## 1. Asset sources and what is actually free

All three creators are on itch.io. Licences: chierit CC BY 4.0 (credit, no resale); immunitys edit freely, **no redistribution** (fits our never-commit-art rule); pimen credit the author. Add all three to `MenuScene`-style Credits and `tools/README.md`.

### chierit characters (free zips, verified from the itch pages on 2026-10-17)

| Pack | Free zip contents | Role in v4 |
|---|---|---|
| Fire Knight | idle run jump air_atk roll 1_atk 2_atk 3_atk sp_atk defend take_hit death | **Player** (fire theme, matches the pimen fire VFX). Needs v1.1 free zip |
| Metal Bladekeeper | the above plus projectile, trap, j_up/j_down | Boss 1 (blades, traps, thrown projectile) |
| Crystal Mauler | idle run jump_up/down air_atk roll 3 atks sp_atk defend take_hit death | Boss 2 (heavy, slow, big sp_atk) |
| Wind Hashashin | same shape, jump_up/down, slide | Boss 3 (fast, evasive) |
| Water Priestess | idle walk surf jump air_atk tumble 3 atks sp_atk **heal** defend take_hit death | Boss 4 or ranged mini-boss (heals, zones) |
| Ground Monk | idle run jump air_atk 3 atks sp_atk **meditate** roll defend take_hit death | Mini-boss or Jev "Echo" donor |
| Leaf Ranger | idle run jump air_atk roll slide 3 atks sp_atk defend take_hit death | Opening encounter (ranged) |
| Free Cthulu | idle walk fly 1atk 2atk hurt death | Grunt/flyer |
| Demon Slime (free) | idle walk cleave take_hit death | Grunt/mini-boss (only 5 anims) |

Paid-only, **not used**: Shadow Stalker, Light Valkyrie, Lightning Ronin, every "Elemental Mode" (e_*) set, Minotaur (free = 3 anims), Poison Wyrm, Frost Guardian (free = 5 anims).

Final boss without a paid pack: **"Echo"**, a palette-swapped Fire Knight (the player's mirror). Jev is given the boss-memory of how the player fought (see v3 boss memory, doc 05 and 02) and picks counters. It is thematically strong and costs no art.

The open risks listed here at planning time are resolved in section 9.

### immunitys environments
Free name-your-price (verify each): Forgotten Memories 32x32 (autumn forest, river, waterfall, stone paths), Forest Top-Down 32x32, Pixel RPG UI Pack, RPG Icon Pack 32x32/24x24, Top Down Skeletons #1/#2, Goblin Sprite Pack #1.
**Resolved in Phase 0: the skeleton/goblin packs are not usable as enemies** (32x32 top-down, idle and walk in four directions only, weapons as separate overlay sheets, no attack/hit/death). Grunts come from Cthulu, Demon Slime and Frost Guardian (free: idle walk 1_atk take_hit death) instead. Tilesets are forest/ruins only; no foundry or lava. Areas are therefore: Forest Edge, River Shrine (water, waterfall), Ruined Graveyard/Temple, and a night or dusk variant of one of them for the final.

### Reuse from v3
Ninja Adventure music (5 tracks, beat-analysed), sword clash/swing sounds (CC0), v-ktor hit sparks (CC BY), Pimen smoke/heal. Szadi, Darkpixel and Clembod art are dropped in v4, which removes the mixed-art look and the no-redistribution worry from Bringer.

## 2. Architecture

New code in `game/v4/` (copy the data-driven shape of `game/duel/`: `data.ts`, `engine.ts`, `brain.ts`, `skills.ts`, `ArenaScene.ts`, `HudScene.ts`, `MenuScene.ts`). Reuse as-is by import: `lib/` Jev client, `game/duel/brain.ts` plumbing and fallback pattern, `sfx.ts`, `settings.ts` (new storage key). New asset prep `tools/prep_arena_assets.py` writes `public/arena-assets/` (gitignored). New route `app/arena/`. A new `tests/arena/` Playwright set cloned from `tests/duel/` helpers.

Do not edit `game/duel/` except to extract shared helpers into `game/shared/` when a copy would otherwise drift; v3 tests must keep passing.

## 3. Animation system (the headline feature)

v3 plays strips forward at fixed fps. v4 needs a small animation layer (`game/v4/anim.ts`):

- **Playback modes**: forward, **reverse**, ping-pong, hold-on-frame, scrub by progress (0..1), per-frame durations (hit-stop, anticipation holds).
- **Reverse parry**: on a perfect deflect, the attacker's attack animation is played backwards from the frame it reached to frame 0 over about 250 ms (reads as being thrown back), with hit-stop, a pimen spark and screen kick. The defender plays `defend` forward and holds. Regular deflect uses `take_hit` stagger; perfect uses reverse.
- **Combos (player)**: chain `1_atk` -> `2_atk` -> `3_atk` with a cancel window per frame range (data: `cancelFrom`, `cancelTo`), input buffering, and a finisher `sp_atk` that costs spirit. Each hit has damage and posture values; the third hit is a heavy.
- **Combos (enemy)**: bosses chain their own 1/2/3 attacks. Jev branches at *gates* between hits (continue, delay, feint, end), the mechanism v3 already has (doc 05 section 7, "Gates"). Feints use scrub or hold: stop at the wind-up frame and reverse.
- **Quick-time events** (`game/v4/qte.ts`), three kinds, all input-light and beat-aware:
  1. *Deathblow*: when a boss is staggered, a 2 to 3 prompt sequence (direction or button) within a time window decides finisher quality (clean finisher vs scuffed, extra damage).
  2. *Perilous counter*: the existing perilous glyph becomes a short timing ring; hit it for a free counter instead of a plain deflect.
  3. *Clash*: when player and boss attacks collide on the same beat, a button-mash/hold mini clash decides who staggers.
  QTEs must be skippable (setting) and have a rules fallback.

## 4. VFX and skills

- Basic combat feedback: Pimen **Slashes and Thrusts** (per attack smear), **Hit Spark** (impacts), plus v-ktor sparks already in v3.
- Elements: each chierit character gets a matching pimen pack for its `sp_atk` and one signature move (Fire 01/02/03 for the player, Dark/Holy/Thunder for bosses, Water/Wind/Earth/Wood if free). Skills (shrine) map to elements: ember dash, fire wave, parry shield (buff pack), heal.
- All VFX are plain spritesheets spawned by a `vfx.ts` that supports tint, additive blend, follow-target and reverse. Keep them data-driven (`vfxDef` in `data.ts`).

## 5. Gameplay structure (demo run, about 12 minutes)

1. **Title**, then **tutorial** in the Forest Edge using a ghost instructor (the Echo palette). Lessons: move, light chain, block, parry (forward), perfect parry (reverse), roll, posture break, QTE deathblow, skill use. 10 to 12 lessons, reuse the v3 tutorial engine.
2. **Forest Edge**: Leaf Ranger (ranged opener, rules brain or Jev).
3. **River Shrine**: Metal Bladekeeper (boss 1), shrine, skill points.
4. **Graveyard**: Crystal Mauler (boss 2), then Wind Hashashin (boss 3).
5. **Final**: Echo (mirror of the player, Jev reads the player's recorded habits). Ending sequence (cutscene cards, stats, Jev-vs-rules summary, New Game+).

Every boss has a Jev persona and a rules fallback; `F` toggles bot, `Tab` shows the log, as in v3.

## 6. UI/UX

- Pixel RPG UI pack for frames, bars and menus; RPG icons for skills and items.
- HUD: segmented health, posture bar, spirit, boss bar with name, combo counter, QTE overlay, input hints that adapt to keyboard or gamepad.
- **Jev panel** (always available, not only on Tab): current decision, reason, latency, source (Jev or fallback), plus a running Jev-vs-rules comparison. This is the product's point, so it gets first-class UI.
- Title, pause, settings (volume, timing mode, QTE assist, screen shake, flash), **key rebinding and gamepad**, save slots, credits.
- Area title cards, subtle camera work (look-ahead, zoom on kills, kick on parry), per-area ambient light and parallax.

## 7. Phases (each ends with tsc clean, tests green, a commit and push)

| Phase | Deliverable | Exit check |
|---|---|---|
| 0 Assets | Download free zips with the Playwright script, inspect sizes and frame counts, write `prep_arena_assets.py` and manifest, resolve the top-down enemy question and the free pimen list | A throwaway scene shows every needed animation playing |
| 1 Engine | `game/v4/` skeleton: movement, combat model carried from v3, new anim layer (reverse, scrub, per-frame timing), Fire Knight playable on a flat test map | Reverse parry visible; combo chain works with input buffer |
| 2 Combat depth | Combo data, cancel windows, QTE system, element VFX hookup | Suite `combat-v4` passes |
| 3 Bosses and Jev | Boss data for each chierit boss, Jev question types (reuse pattern from doc 02), fallbacks, taunts, Echo boss memory | Per-boss suite passes; `bot.mjs` balance glance |
| 4 World | Tiled maps from immunitys tilesets, parallax and lighting, areas, shrine, story rewrite | World suite passes; screenshots reviewed |
| 5 UI/UX | New HUD, Jev panel, menus, rebinding, gamepad, saves, ending | Manual walkthrough plus UI suite |
| 6 Polish | Balance pass, human play-test, perf (lighting at low res), docs update (new 05-style doc, update README/AGENTS), credits | Full chain green |

Game feel can only be judged by a human; plan a play-test after Phase 2 and again after Phase 5, and treat their feedback as the main input to tuning.

## 8. Rules of engagement (carry over from v3)

Jev picks, the engine executes; every Jev call has a fallback; never block the game on the network; never commit `.env`, `assets/`, `public/*-assets/` or `links.txt`; never print the API key; do not edit game code while a long Playwright run is in progress; commit and push after each coherent change.

## 9. Phase 0 results (2026-10-17)

**Pipeline.** `npm run assets:download:arena` (`tools/itch_download.mjs arena`, into `assets/_dl4`), unzip/unrar with `bsdtar` into `assets/packs4/<slug>/<zip>/`, then `npm run assets:arena` (`tools/prep_arena_assets.py`, writes `public/arena-assets/`, gitignored). `tools/itch_survey.mjs` lists what an itch page offers without downloading (use it before adding any pack; pages needing payment show no download button). `tools/arena_inventory.py` prints every animation folder with canvas, frame count and bbox. Check output visually in the lab: **`/arena/lab`** (characters with forward/reverse/ping-pong playback and a scrubber, all VFX, raw tile/UI images).

**Downloaded and verified free:** all 7 chierit Elementals human sets (Fire Knight, Metal Bladekeeper, Crystal Mauler, Wind Hashashin, Water Priestess, Ground Monk, Leaf Ranger), Free Cthulu, Demon Slime free, Frost Guardian free, Lively NPCs; **24 pimen packs** (every element: fire 1+2, water 1+2, ice 1, thunder 1+2, earth 1+2, wind 1+2, wood, acid, dark, holy, plus hit spark, slashes and thrusts, smoke 1+3, halloween, magical animation pack, thrust, cutting and healing; the 18 buff/debuff packs, mega packs, explosions and projectiles, ice 2, smoke 2/4, and the "03" element packs are paid); immunitys Forgotten Memories 32x32 tileset (autumn forest, river, cliffs, waterfall, bridges), Resurrected RPG forest tileset, Pixel RPG UI pack (parchment/book/scroll style), icons 24 and 32. Seven itch pages timed out on a second download button (rar and zip duplicates); the first file arrived, nothing needed is missing except pimen "Effects" (pixel-battle-effects) and Heal/Gameboy sheets.

**Character data (frames per animation; canvas 288x128, sprite about 45 px tall, so render at 3x):**

| Pack | Chain | Special and extras |
|---|---|---|
| Fire Knight (fk) | 1_atk 11, 2_atk 19, 3_atk 28 | sp_atk 18, air_atk 8, roll 8, defend 10, take_hit 6, death 13, run 8, jump |
| Metal Bladekeeper (mb) | 6, 8, 18 | sp_atk 11, projectile_cast 7 + land 5, trap_cast 10 + land/detonate, defend 12 |
| Crystal Mauler (cm) | 7, 7, 17 | sp_atk 15, defend 9, take_hit 6, death 15 |
| Wind Hashashin (wh) | 8, 18, 26 | sp_atk 30, roll 6, death 19 |
| Water Priestess (wp) | 7, 21, 27 | sp_atk 32, heal 12, surf, tumble, defend 12 |
| Ground Monk (gm) | 6, 12, 23 | sp_atk 25, meditate 16, defend 13 |
| Leaf Ranger (lr) | 10, 15, 12 | sp_atk 17, arrow_shower 18, arrow hit/entangle/poison effects, slide, defend 19 |
| Cthulu (cth) | 1atk 7, 2atk 9 | fly, hurt 5, death 11 (canvas 192x112) |
| Demon Slime (dsl) | cleave 15 | idle walk take_hit death 22 (canvas 288x160) |
| Frost Guardian (fg) | 1_atk 14 | idle walk take_hit death (canvas 192x128) |

All 3 attacks have a visible wind-up and the third hit is long (17 to 28 frames), which suits combo finishers and the reverse-parry (a clean wind-up frame range exists to scrub). Frame counts differ a lot between characters, so every move must carry its own `windupFrames`, `activeFrames`, `recoverFrom` in data (measured per sheet) rather than a global timing.

**VFX slicing.** Pimen sheets carry no frame metadata. `detect_grid` takes the finest clean cut (every cell boundary only crosses transparent pixels), uses aspect ratio to pick rows, and falls back to a nearest-square divisor when frames touch (Halloween 2, the "w blur" thunder sheets). 101 sheets are written with `cols`/`rows`/`frames` and a `confident` flag. About a third are flagged only because the last cell is empty (harmless); the hit sparks, smears, fire, acid, dark, holy, thunder and ice sheets used first were checked by eye and are right. Anything odd found later: add an override table entry in `prep_arena_assets.py` rather than hand-editing output. The blur and "wo blur" thunder pairs are duplicates (keep wo blur).

**Decisions confirmed.** Player = Fire Knight. Immunitys skeletons/goblins dropped (see section 1). UI = parchment style, which suits a quiet forest-ruins tone. Environments: Forgotten Memories 32x32 for the river/forest/cliff areas (water is 6-frame animated), Resurrected RPG for grass/plants/portal.

**Credits to add before shipping:** chierit (CC BY 4.0), pimen, immunitys (named in the Credits screen).

**Phase 0 exit check:** met. The lab shows every needed character animation, forward and reversed, and the VFX sheets, with correct slicing for the first-use effects.

## 10. Phase 1 results: the engine kernel (route `/arena`, `game/v4/`)

Playable: Fire Knight vs a Metal Bladekeeper training enemy on a flat floor (`/arena`, add `?dev=1` for the debug line). Controls: WASD move, J or click attack, Space/K guard, Shift/L roll, R reset, dev P (toggle enemy AI), O/I (force enemy SLASH/TWIN). Suite: `npm run test:arena` (18 checks, needs `npm run dev`). View is 960x540, sprites at SCALE 2 (hero about 90 px).

| File | Role |
|---|---|
| `anim.ts` | `Animator`: plays a frame range of a sheet **forwards or backwards**, per-frame `holds` (extra ms on a frame: the telegraph), `speed` (0 = frozen for hit-stop), `reverseTo(frame, ms)` (rewinds what has played so far), `progress`. Pure logic. |
| `data.ts` | Constants and move tables: `HERO`, `HERO_ATTACKS` (L1, L2, L3), `HERO_CLIPS`, `ENEMY`, `ENEMY_ATTACKS` (SLASH, TWIN), `FX`. A `Clip` is `{sheet, from, to, fps, holds}`; a `HitDef` is `{a, b, dmg, posture, reach, band, kind}` with frames in sheet frame numbers. |
| `combat.ts` | Pure rules: `inReach` (forward ellipse, y is depth), `resolveEnemyHit` -> `dodged / deflected / blocked / hit / missed`, `pressGuard` (the anti-mash rule), `chip`. |
| `fighter.ts` | Sprite wrapper: owns an `Animator`, one foot anchor per character from the idle sheet, flip, tint flash, depth sort. |
| `vfx.ts` | One-shot pimen sprite effects by manifest key (tint, additive, flip, scale). |
| `ArenaScene.ts` | Player controller, enemy runner, hit resolution, feedback, HUD. State is plain objects (`scene.p`, `scene.e`, `scene.log`) so tests read it through `window.__arena`. |
| `createArenaGame.ts`, `manifest.ts` | Boot (loads every sheet in the manifest), game factory, manifest types. |

**Combo chain.** The three authored sheets share their first frames (1_atk is the first part of 2_atk, which is the first part of 3_atk), so a chain does not replay the wind-up: L1 = `fk_1_atk` 0-6, L2 = `fk_2_atk` 7-15 (the follow-through into the second swing), L3 = `fk_3_atk` 16-27 (into the fire finisher). A press is accepted from `chainFrom`; a press up to 150 ms *before* it is buffered; the chain continues when the clip ends. No continuation plays the recovery frames (`recover`). After the last damaging frame the player may cancel into roll or guard. This sheet-splicing trick is the pattern for every future combo: find the frame where one authored attack flows into the next.

**Reverse parry.** A guard press within `HERO.deflectMs` (160 ms) before the hit connects (and not inside `deflectSpamMs` of the previous press) is a *deflect*: the enemy's current clip is rewound with `anim.reverseTo(clip.from, 300ms)`, then it holds the staggered pose; blue spark and smear, hit-stop 120 ms, camera shake, enemy knocked back 34 px, +130% posture, and a riposte window (800 ms, x1.5 damage). Held guard is a *block* (chip 12%, posture to the player). Roll i-frames (40-300 ms) *dodge*. At 100 posture an enemy breaks: every hit is a deathblow (x2.5, stacks with riposte). Enemy swings are armoured (no flinch mid-attack) and a 1 s poise window stops stun-lock.

**Authoring a hit window.** Use the frame-index contact sheets: render the sheet's frames with indices (script pattern in the scratchpad this phase: crop each frame to the sheet bbox, label with the index) and pick `a..b` as the frames where the weapon smear is in front of the body. Mb attacks have a single wind-up frame 0 and strike at frame 1, so the telegraph is `holds: {0: 520}`. Hits resolve once, the first update in which the animation has reached frame `a` (so a coarse tick cannot skip a window).

**Known rough edges, deliberately left for later phases:** floor is a flat procedural grid (Phase 4), HUD is plain bars and text (Phase 5), the enemy has two attacks and a trivial approach/attack AI with no Jev yet (Phase 3), no sound (v3's `sfx.ts` will be reused), no QTE (Phase 2), bodies can overlap briefly after knockback, and deflecting the *second* hit of TWIN (a longer reverse) is not covered by a test yet.

## 11. Phase 2 results: combat depth (same route, `npm run test:arena` = 18 + 19 checks)

New or changed files: `qte.ts` (pure QTE logic), `settings.ts` (QTE mode), `data.ts` (SKILLS, DEATHBLOW, CLASH, COUNTER, BLOOM attack, `perilous`/`clashable`/`around` flags), `combat.ts` (`perilous` kind, `countered` outcome, `around` reach), `ArenaScene.ts` (time scale, QTE input routing, new methods), `tests/arena/phase2.mjs`.

**Time model.** `update` has a raw delta and a simulated one. `timeScale` (1 normally, 0.22 in a deathblow QTE, 0.15 in a clash) scales the simulation (animation, `now`, enemy brain) but the QTE timers and inputs run on the raw delta, so slow motion changes the look and not the difficulty. Hit-stop zeroes the simulated delta.

**Deathblow QTE** (`qte.ts` `QteRun`). When the enemy is `broken` and the player presses attack within 170 px, the knight steps in, time slows and three prompts appear (J, K or L, shown in a ring that closes over `DEATHBLOW.windowMs` 720 ms). A press within 110 ms of the close is *perfect*, within 260 ms *good*; earlier presses (mashing), the wrong key or no press are *miss*. All perfect = **execute** (70 damage, fk_3_atk finisher 16-27 with a fire explosion, +2 spirit), at least two of three perfect/good = **clean** (45, fk_2_atk 7-15, +1 spirit), else **scuffed** (20, fk_1_atk). Settings (`arena.settings`, or `?qte=on|assist|off`): `assist` stretches window and tolerance x1.6, `off` skips the QTE and a hit on a broken enemy is the plain x2.5 deathblow. `scene.qteKeys` forces the keys for tests.

**Perilous counter.** `ENEMY_ATTACKS.BLOOM` (mb_sp_atk, ground blades on both sides, 24 damage) is `kind: "perilous"`: guard does nothing. A closing red ring and "!!" telegraph it; it turns white inside the counter window. Pressing **attack** within `HERO.counterMs` (200 ms) before the strike frame = **countered** (reverse parry reaction, enemy posture +45, +1 spirit, holy flash); rolling through = **slip** (enemy posture +20, +0.5 spirit); anything else takes the full hit. The ring length comes from `strikeAt`, which `startEnemyAttack` computes from the clip's frame times and holds, so every perilous attack needs only `holds` on its telegraph frame.

**Clash** (`MashRun`). If a `clashable` enemy hit connects while the player is inside the strike frames of their own swing, both freeze and the player mashes J (7 presses in 1.1 s, 4 in assist, none in off). Win = reverse reaction on the enemy (+22 posture and the hit's own), +1 spirit, the player's swing resumes. Lose = half damage, +26 posture, knockback, hurt stagger.

**Spirit and the skill.** Spirit (max 5, shown as pips under the bars): +1 deflect, +1 counter, +0.5 slip, +0.25 per landed hit, +1 clash win, +1/+2 on a clean/execute deathblow. **Flame Burst** (key E, 2 spirit, `fk_sp_atk`; charge frames 1-9, fire slash 11-14, hit on 12-14) deals 24 damage and 34 posture with a pimen fire explosion on the target. It uses the same attack machinery as the chain (`startAttack(id, skill)`), so more skills are table entries.

**Rough edges left for later phases:** the QTE overlay and spirit pips are placeholder drawing (Phase 5); QTE prompts are not yet beat-aware (the v3 beat grid can be reused in Phase 3 when boss music exists); only Flame Burst exists and the second element VFX (fire bolt, holy, smoke) are only hooked in `FX_EXTRA` ready for Phase 3 skills and boss moves.

## 12. Phase 3 results: four bosses and Jev (`npm run test:arena` = 18 + 19 + 30 checks)

**Bosses** (`bosses.ts`, `?boss=mb|cm|wh|echo`, `N` after a win loads the next, order in `ENCOUNTERS`). Each is a `BossDef`: sheet prefix, clips, `attacks` (a `Clip`, `hits`, `range`, cooldown, optional `gate`, `perilous`, `clashable`, and a `desc` that Jev reads), rules-bot `weights` by distance band, `persona`, `taunts`, `phase2` multipliers.

| Boss | HP | Character | Moves |
|---|---|---|---|
| Metal Bladekeeper (mb) | 160 | Patient duellist, one-frame wind-ups, long holds | SLASH, TWIN (gate), FLURRY (gate, heavy finisher), BLOOM (perilous) |
| Crystal Mauler (cm) | 230 | Slow and heavy, big radius | SWING, BACKHAND, SLAM (gate, then perilous crystals), SHATTER (perilous wall) |
| Wind Hashashin (wh) | 150 | Fast with a very short tell, around-you hits | FLICK, WHIRL (gate), CYCLONE (gate, three hits) |
| Echo (echo) | 200 | The player's own clips (fk_*) recoloured by a WebGL hue rotation; the final boss | CUT, CHAIN (gate), EMBER (perilous fire arc) |

Unused art: Hashashin `sp_atk` (a teleport whose art shifts position inside the frame: needs a teleport primitive), Mauler `defend` (a crystal shell), Metal Bladekeeper projectile and trap (need entities).

**Phase 2** (below `phase2.hpPct`, 50%): the boss moves faster, cooldowns shrink, hold times shrink, announced once.

**The brain** (`brain.ts`). `Telemetry` records the player's recent actions, how each boss move was answered (deflected, blocked, dodged, countered, hit) and the player's first reaction within 900 ms, roll directions, guard-tap lead before deflects, and swings into recovery or wind-up. `idleQuestions` builds one call: `next_action` (choice over the legal options, each with its move description and reach), four `noul` reads (turtling, roll-reliant, trade-hungry, panicking) and a `taunt` choice (`NONE` is the default; 14 s cooldown). `gateQuestions` builds the branch question. `BossBrain` owns the Jev/rules switch (`F`), the in-flight request (`askId` makes late answers harmless), stats per source, and the timeouts: an idle boss waits at most `ASK_TIMEOUT` (1.5 s wall clock) before the rules bot decides; answers older than 3.5 s are dropped; a pick that is no longer legal when consumed falls back to rules.

**Latency hiding.** `enemyThink` builds a snapshot and calls `brain.request` while the boss is still in its post-attack pause, then `brain.take` when the pause ends. Generic actions (APPROACH, BACKSTEP, WAIT) are real actions the engine executes for a fixed time. Measured against the real API: about 330 ms per call, no errors in 40 calls over four bosses.

**Legal options only.** `availableActions` offers an attack only if the player is inside its `range`, depth is within 45 px, it is off cooldown, and the fairness rule allows it (a third perilous move in a row is not offered). Distance 190 px offers APPROACH but not SLASH.

**Gates.** After hit `afterHit` of a multi-hit attack resolves (and the boss is still attacking, not parried or clashed) the animation freezes up to `GATE_WAIT` (450 ms) while `brain.gate` answers. CONTINUE = nothing; DELAY = hold 350 ms (beats early guard taps); **FEINT = the swing is rewound with `anim.reverseTo`**, no later hits, the boss returns to idle (bait); END = stop. No answer in time = the attack's default. Measured with the real model: it uses DELAY on the Mauler's slam against a stationary player.

**Memory.** On victory or death the fight is stored (`memory.ts`, localStorage `arena.memory`): attempts, wins, how many times each move landed, habits. The next fight's snapshot carries `memory` (moves that landed most, usual roll direction, usual guard lead). **Echo** additionally gets `snapshot.profile` aggregated over every other boss and a persona that tells it to use those habits.

**UI.** `/arena` has a basic Jev panel (Tab, closed by default, covers part of the playfield so it is a placeholder for Phase 5): per-decision source, latency, probabilities, Jev's reads, fallback count.

**Tests.** `tests/arena/phase3.mjs` mocks `/api/jev/ask` with `page.route` (the same technique as `tests/duel/jev-gates.mjs`) and also validates every boss clip and hit window against the real sheets, and plays every attack of every boss to completion. `window.__arena` and `window.__bosses` are exposed outside production.

**Known gaps:** a stale pick is replaced by a rules pick rather than remembered as an intent (v3 has the intent trick); boss HP and damage are first-pass numbers (a balance pass belongs after Phase 5 with human play-testing, using a scripted bot like v3's `bot.mjs`); Jev leans on WAIT with a stationary player, so the WAIT description now says to use it rarely; boss intros and outros (`intro`, `outro` in `BossDef`) are not displayed until Phase 5; no audio.

### Recipe: add a boss
1. Art: add the pack to `tools/prep_arena_assets.py` `CHARS` (a unique prefix) and run `npm run assets:arena`. Check it in `/arena/lab`.
2. Contact sheet each attack (index-labelled frames) and read off wind-up, strike and recover frames.
3. Add a `BossDef` in `bosses.ts`: clips, `attacks` with `hits` (`a`/`b` frames, `dmg`, `posture`, `reach`, `kind`, `around`), a `holds` entry on the telegraph frame, `perilous: true` plus a `perilous` hit for unblockable ones, a `gate(...)` for combos, a `desc` that says what the move beats and what beats it, `weights` for the rules bot, `persona`, `taunts`.
4. Register it in `BOSSES` and `ENCOUNTERS`. Run `node tests/arena/phase3.mjs`: the data check and the every-attack check cover the new boss automatically.

## 13. Phase 4 results: environments (`npm run test:arena` = 18 + 19 + 30 + 12 checks)

New files: `areas.ts` (the four `AreaDef`s), `world.ts` (`AreaView`, the renderer), `tests/arena/phase4.mjs`. Changed: `bosses.ts` (`area` per boss), `ArenaScene.ts` (`buildArea`, obstacle collision in `step`, area title card), `createArenaGame.ts` (loads every env image), `tools/prep_arena_assets.py` (env stamps, fills, portal strip).

**Why stamps and not Tiled maps.** Both immunitys tilesets are blob and prop sheets (organic grass, dirt and dusk patches, stone plateaus with cliff faces, free-standing trees, statues, wall pieces), not regular autotile grids. Hand-building an autotiler from them would cost far more than it adds for one-screen arenas. Instead `prep_arena_assets.py` cuts every connected piece out of four sheets (`fmt` Forgotten Memories patches, `fmp` its props, `rrp` Resurrected props, `rrw` its walls: 148 stamps, ids stable because extraction is deterministic) plus six seamless 32 px fill tiles (`fill_grass`, `fill_dirt`, `fill_dusk1`, `fill_dusk2`, `fill_plateau`, `fill_water`). To pick stamps, render an index sheet of a prefix (numbered pieces) and read the ids off it (the throwaway scripts are in the scratchpad of this phase; the pattern is: paste each stamp on a grey sheet with its index). Areas are then data, so adding or restyling one is editing a table, and Tiled/collision-polygon authoring can be added later if needed.

**Composition rules.** Everything is drawn at `ENV_SCALE` 2 (same pixel size as the characters; per-stamp `s` multiplies it, 1.5 = 3x). Layers by depth: ground fill 0, water 0.5/0.6, ground patches (`g: true`, in listed order) 1+, props and fighters sorted by feet (`10 + y/100`, so characters walk behind trees and statues), particles 1800, ambient multiply rectangle 1900, vignette 1950. Floor bounds are the same in every area (`FLOOR` x 80-880, y 270-500) so combat tuning and tests do not depend on the art.

| Area (boss) | Look |
|---|---|
| The Forest Edge (Bladekeeper) | grass, dirt arena from three overlapping dirt patches, autumn trees (willow, orange, teal, birch, pines), bushes, stump and rock obstacles, falling leaves, warm light |
| River Shrine (Mauler) | animated water above an arched aqueduct wall with an obelisk and angel statues, a stone ring on the floor, cool light and mist |
| Sunken Ruins (Hashashin) | dusk grass, two long arched walls and corner towers, statues, broken pillars and rocks as obstacles, dark blue light, heavy vignette |
| Echo's Gate (Echo) | dusk ground, a ruined portal ring with the animated 32-frame portal inside it, obelisks and statues, violet light, rising motes |

**Mechanics added.** Obstacles are circles on the floor plane (ellipse: depth counts for about half of width); `step()` pushes any fighter out of them, so the player, the enemy and the separation logic all respect them. Water animates by scrolling two tile sprites at different scales and speeds (the second additive). Every area gets a short title card (`?nocard=1` disables it in dev) when its boss loads, built from `name` and `subtitle`. Switching areas destroys the old view completely (12 switches leave the display list unchanged).

**Rough edges / not done:** the shrine between bosses, area-to-area walking and per-area music are not built (the demo flow is fight, win, `N`); tower stamps in the ruins read as grey slabs (a better piece or a hand-placed wall would help); no dynamic lights (an additive glow sprite near candles or the portal would be cheap); the two ground patches `fmt_02` and `fmt_04` are merged components and are used as big dusk floor patches rather than clean tiles; `rrw_*` stamp ids shift if the extraction thresholds change, so re-check areas after touching `stamps(...)` arguments.

## 14. Phase 5 results: input, audio, game flow, HUD (`npm run test:arena` = 18 + 19 + 30 + 12 + 16 + 16 + 46 + 9 checks)

### 14.1 Input (`keymap.ts`, `input.ts`, `settings.ts`)
`GameInput` is the only thing that reads keys, the mouse or a pad; the scene polls it once per frame (`scene.frame`) and everything (movement, combat, QTE prompts, pause) uses that. Keys are rebindable (two slots per action, Phaser key names, stored in `arena.settings`); a key can drive only one action; `normaliseKeymap` repairs garbage per action. QTE prompts display the bound key (`inp.label(action)`). Gamepad (standard mapping, `input: { gamepad: true }` in the game config): stick or d-pad moves, X attack, A roll, B or a shoulder button guard, Y flame burst, Start pauses (dead zone 0.3). **Split rule:** `keymap.ts` has no Phaser import so the React shell can use it during server rendering; `input.ts` (Phaser) re-exports it. A Phaser import in anything the client component imports statically makes `/arena` return HTTP 500 from the server render while the browser silently recovers; `phase5c` asserts the page status for this reason.
Testing pads: Phaser ignores pad updates whose `timestamp` is older than the pad's connection, so a fake pad needs a `timestamp` getter returning `performance.now()` (see `phase5a.mjs`).

### 14.2 Audio (`sfx.ts`)
A port of v3's `Sfx`: synthesised cues (thuds, whooshes, breaks, warnings, chimes) mixed with recorded CC0 sword samples through one compressor bus, volume from settings, beat-clock helpers kept for later. `prep_arena_assets.py` copies the converted samples and beat-analysed music from `public/duel-assets` (run `npm run assets:duel` first; without it the game has only the synthesised cues and no music). Cues: swing (hero and boss), hit, deflect and riposteReady, block, hurt, roll, warn (perilous telegraph), postureBreak, deathblow (execute and victory), clash, QTE locked or spirit, slip, skill, taunt blip. Music per area (`AreaDef.music`): forest `captain`, river `temple`, ruins `crypt`, gate `final`. Music and sound effects are settings. Headless Chromium cannot be listened to, so `phase5b` asserts that each event requests the right cue, that the samples and tracks are in the audio cache and that volume 0 yields no output node.

### 14.3 Game flow (`ArenaClient.tsx`, `save.ts`, `stats.ts`, scene `mode`)
The scene has two modes: **menu** (a live backdrop: AI idle, input ignored, HUD hidden, no title card) and **play**. `?dev=1` starts in play mode (so the earlier suites are unchanged). The React shell owns the screens: title, slot list, pause (Esc or pad Start; pausing is `game.scene.pause("arena")` plus `sound.pauseAll()`), settings, stats, credits, victory, defeat, ending. The shell talks to the scene through `createArenaGame`'s return value `{ destroy, api }` (`start(slot, fresh)`, `next`, `retry`, `pause`, `resume`, `toTitle`, `settingsChanged`, `toggleBrain`, `clearMemory`) and receives `onFight`, `onPause`, `onDecision`, `onBoss`, `onBrain`. **Saves:** three slots (`arena.save.N`: bossIndex, cleared, deaths, playMs, finished). **Memory** (what the bosses learned) is separate and survives new runs: a new run starts with the bosses remembering you; Settings has "Make the bosses forget me". **Fight records** (`arena.stats`): one per finished fight with the brain that ran the boss (`jev`, `rules`, or `mixed` if F was pressed mid-fight), result, time, HP lost, how each attack was answered, decision counts, Jev latency. The **Jev vs the rules bot** screen (title, pause, ending) aggregates them per brain: fights, boss win rate, length, HP lost, parry rate, hit rate, Jev answer time (mixed fights excluded). Every new fight starts on the brain chosen in Settings (`bosses think with Jev / Rules bot`).
**Jev strip:** while playing, a dark panel bottom-right shows the brain badge (JEV / RULES BOT), the boss, the latest decision with its source and latency, the top probabilities and an F swap button; Tab expands it to the full panel (Jev's reads of you, the decision log, fallback count).
**Look:** screens use the immunitys UI pack (`ui_01` parchment and `ui_30` dark panel as CSS `border-image`), icons and banners from the same sheet.

### 14.4 HUD (`ArenaScene.buildHudPlates`, `drawHud`)
Dark nine-slice plates (`ui_30`, at 2x) behind the player bars (bottom-left) and the boss bars (top centre), a parchment strip (`ui_44`) holding the boss name with the title under the bar, flame icons for spirit (`ui_31` earned, `ui_37` faded, tinted when full), a phase-2 notch on the boss HP bar, an easing damage trail behind each HP bar (drops slowly, jumps up on healing), and a controls hint that fades after 9 to 12 s of play.

### 14.5 Known gaps, handed to Phase 6
No beat-synced prompts (the beat clock exists in `Sfx.beatPos` but fights are not choreographed to it); the shrine, skills screen and a second skill are not built (spirit has one use); QTE overlay and clash bar are still plain drawing; boss intros and outros appear only as the area card line and the victory screen; menus are mouse-first (keyboard focus works but there is no arrow-key navigation); gamepad cannot operate the menus; no touch support; the Jev strip text is small at low resolutions; the pad Start pause also needs the page to have focus.

## 15. Phase 6 results: balance, shrine, guided demo (`npm run test:arena` = 18 + 19 + 30 + 12 + 16 + 16 + 46 + 9 + 33 = 199 checks)

### 15.1 The balance harness (`tests/arena/bot.mjs`, `npm run balance:arena`)
`node tests/arena/bot.mjs [bosses] [levels] [runs] [seed]` (env `ASSIST=1`, `VERBOSE=1` for a per-move table). It fights every boss at three skill levels against the **rules brain** (no Jev calls), with the simulation fast-forwarded: the game loop is put to sleep, `scene.update` is stepped by hand at 60 Hz and sound, popups, shake and VFX are stubbed so nothing leaks. The scripted player is injected through `scene.botFrame` (a test hook that replaces the frame's input). It reads the boss's own animation timing (`remaining()` = time to the next unresolved hit, from the clip's fps, holds and the animator's progress), waits a skill-dependent reaction time, then parries, counters (attack press before a perilous strike) or rolls with Gaussian timing noise, mashes clashes, hits the QTE rings, and attacks when the boss is open but not when it is about to act (a chain locks the player in, so careful players do not start one late). Skills: novice (300 ms reaction, 85 ms noise, answers 55% of attacks), competent (190 ms, 42 ms, 85%), expert (120 ms, 18 ms, 97%).

Results with the shipped numbers (24 fights per cell, seed 21; "player wins"):

| Boss | HP | novice | competent | expert | competent + assist |
|---|---|---|---|---|---|
| Bladekeeper | 600 | 17% | 79% | 100% | 100% |
| Mauler | 800 | 0% | 58% | 100% | 92% |
| Hashashin | 520 | 8% | 79% | 100% | 96% |
| Echo | 700 | 0% | 58% | 100% | 92% |

The bot is far steadier than a person (perfect attention, no hesitation), so read the novice column as "a rough human", the competent column as "a good player" and treat all of it as an ordering, not a prediction. Real play-testing is still the input that matters.

**What the tuning levers are** (all in `bosses.ts` unless stated): `hp`; `dmgMul` (damage to the player); `postureMul` (posture the player's hits add to the boss: 0.3 to 0.45, so plain hits rarely break a boss and **parries are the way to break it**); `pace` (shorter pauses between boss actions); `DEATHBLOW.damage` in `data.ts` is now a *fraction of the boss's max HP* (execute 20%, clean 12%, scuffed 5%) so the QTE is a chunk of any boss's bar. Light hits no longer stagger a boss (hyper-armour): only heavy hits, ripostes or posture 70+ do. Findings that drove the numbers: with flat damage and free staggers every boss died in 8 to 12 simulated seconds; posture breaks (each a 20% deathblow) dominated, so posture intake was cut; a bot that chained into the boss's next action got punished like a human would, which is a healthy sign for the combat design.

**Combat assist** (Settings, or forced on in the demo): deflect window 240 ms instead of 160 and boss damage x0.7. It lifts the novice bot from 6% to 81% on the first boss.

### 15.2 Shrine and gifts (`perks.ts`)
After each of the first three bosses the shrine offers three of six gifts and the player keeps one for the run: Keen Eye (+40 ms deflect window), Iron Wrist (deflects and counters knock 30% more posture off the boss), Warm Ember (start every fight with 2 spirit), Kindled Blade (Flame Burst costs 1), Steady Breath (posture recovers 50% faster), Long Reach (+15% sword reach). The offer is seeded by the boss index so it never changes on reload and never repeats a gift you hold. Gifts live in the save (`RunSave.perks`), apply through `scene.perk(id)`, show in the pause menu, and the fourth fight (Echo) has no shrine before it. Beating Echo goes to the ending.

### 15.3 Guided demo
Title screen "Guided demo (about 12 min)": a fresh run with combat assist forced on (`scene.demo`, not saved), the Jev panel open, and a **briefing before every boss** (the scene is paused behind it) that tells the audience what to watch: the reverse parry and swapping Jev for the rules bot (Bladekeeper), Jev's DELAY and the perilous counter (Mauler), gate decisions and FEINT (Hashashin), Echo reading the player's habits. After each victory the fight summary shows how many decisions Jev made and how fast; then the shrine; then the next briefing. Quitting leaves demo mode.

### 15.4 Menu navigation
Arrow keys move focus through every menu, Enter activates; with a pad the d-pad moves, A presses, B or Start goes back (the first screen after pausing ignores the Start press that opened it).

### 15.5 Housekeeping
`scene.botFrame`, `window.__consts` and `window.__arena` exist only outside production. The phase 2 to 5 suites were updated for the new numbers (boss HP, deathblow fractions, posture intake, the shrine step after a victory); they derive values from the data where they can.

### 15.6 What is left (needs a human, or is deliberately deferred)
Play-testing: feel of the parry window, telegraph lengths, QTE timing, hit-stop and shake, audio levels, how long a real first run takes (target 10 to 15 minutes with the guided demo). Beat-synced choreography (the beat clock exists but fights are not choreographed to it). A second area-to-area walking scene and a visible shrine location. Hashashin's teleport special, Mauler's crystal-shell guard and the Bladekeeper's projectile and trap (art and no entity system yet). Touch support. A production build check (`next build`) was not run because it would overwrite the dev server's `.next`; run it before deploying. The 18 paid pimen buff/debuff packs and the paid chierit characters remain unused by design.

## 16. Phase 7 plan: movement, spacing, fire, items, atmosphere

Requested after the first look at the demo (eight points). Each point, what exists, what the art offers, and the decision.

| # | Point | Audit (what v4 does now) | Art available | Decision |
|---|---|---|---|---|
| 1 | Jump | none; sweeps cannot be answered by jumping | `jump_up/jump/jump_down` for Fire Knight and every boss | **Jump action** with a z-axis (sprite lifts, shadow stays). Airborne beats **sweeps** (new `low` hits). Roll no longer protects against a sweep (otherwise jump is pointless). A **jump counter** (an air attack right after leaping a sweep) deals bonus posture, like Sekiro's jump kick. |
| 2 | Mid-air combat | none | `air_atk` for Fire Knight, Bladekeeper (dagger volley), Mauler, Hashashin (aerial whirl) | **Air attack** (attack while airborne: `fk_air_atk`, hits 3 to 5, dives you forward) and **boss aerial moves** in phase 2 (Hashashin leaps and whirls from above; Bladekeeper's air volley). Air-vs-air swings clash. |
| 3 | Fire spells and skills | only Flame Burst; pimen fire packs (firebolt, breath, explosions) unused | pimen Fire 1 and 2 | **Skill bar of three**: Flame Burst (E), **Ember Bolt** (Q, a ranged projectile, 1 spirit), **Inferno Ring** (R, an area blast, 3 spirit). Fire dash trails. A real **projectile entity system** (also used by bosses). |
| 4 | Unused boss moves in phase 2 | Hashashin teleport, Mauler crystal shell, Bladekeeper projectile and trap all unused | the sheets exist | **Phase-2-only moves** (flag `phase2: true`, filtered out in phase 1, offered to Jev only in phase 2): Bladekeeper THROW (projectile fan) and TRAP (ground trap entity), Mauler SHELL (crystal guard: armoured, reflects light hits), Hashashin VANISH (teleport behind the player) and LEAP (aerial dive), Echo PHASE-ECHO (afterimage chain). |
| 5 | Dash | none | no dash animation | **Dash** action: a short burst (about 150 px, 0.2 s) with brief invulnerability and a cooldown; drawn as the run pose stretched along the motion plus **afterimages** and dust. Backward, forward or sideways by input. Different from roll: shorter, no recovery, spacing tool. |
| 6 | Reverse animations and afterimages | reverse used in **two** places (parry rewind, feint); afterimages in **none** | n/a (a rendering technique) | **Afterimage system** (ghost sprites copying the live frame, tinted, fading) used for dash, roll, lunges, boss gap-closers and teleports, Echo's whole attack set, parry recoil (the boss's rewind leaves a trail) and the jump counter. **Reverse** extended to: the jump counter (the boss's sweep rewinds), boss retreat steps (a back-hop plays the run clip in reverse, so it moves backwards facing you), and the Echo's phase change. |
| 7 | Ebb and flow | bosses walk up and stay inside the player's face; BACKSTEP is just one option Jev rarely picks | n/a | **Spacing director** in the engine: each boss has a preferred range band that **oscillates** (engage, then disengage); personal space (a boss that is not attacking will not stay under 85 px); new actions **RETREAT** and **CIRCLE** (offered to Jev and the rules bot); phase-2 bosses use gap-closers (dash, vanish) to re-engage. Jev's snapshot gets a `spacing` block (distance trend, time since the last disengage). |
| 8 | Environment, items and uses | ambient particles only; no items | icon pack (bomb, heart, potion, gems, mugs), pimen VFX | **Items**: Healing Gourd (H, 3 charges, refilled at the shrine, heals over 1 s while slowed), Fire Pot (G, throwable bomb with burning ground), **pickup orbs** (heart = heal, blue gem = spirit, bomb = fire pot) that spawn periodically and from perfect play. **Hazards**: burning ground, the Bladekeeper's traps. **Atmosphere** per area: rain and ripples (river), lightning flashes (ruins), drifting cloud shadows, wind gusts that bend leaves and sway grass and trees, glow lights with flicker, dust puffs (dash, roll, land), a low-HP vignette pulse. |

**Stages** (each ends with `tsc` clean, its own suite, all earlier suites green, a commit):
- **7a Movement and afterimages**: afterimage system, z-axis, jump, air attack, dash, sweep rules and jump counter, keymap and pad bindings, HUD hints.
- **7b Spacing director**: preferred-range oscillation, personal space, RETREAT and CIRCLE, snapshot `spacing`, reverse back-hops.
- **7c Fire skills**: projectile entities, Ember Bolt, Inferno Ring, three-skill bar, kindled perk applies to all.
- **7d Phase 2 move sets**: the new boss moves and the entities they need (traps, projectiles, shell, teleport, leap), Jev descriptions, the bot learns to jump.
- **7e Items and pickups**: gourd, fire pot, orbs, burning ground, HUD item bar, shrine refill.
- **7f Atmosphere**: per-area weather and light, dust, lightning, camera punches, low-HP pulse.
- **7g** Re-run the balance bot (it must learn jump, dash and items), retune, update docs.

**Rules for the build:** every new mechanic is data first (`data.ts`, `bosses.ts`, `areas.ts`), gets a test, and gets a Jev description if the boss uses it; boss options stay filtered by legality; nothing may require new art we do not have (dash and teleports use existing frames with afterimages); controls stay rebindable and pad-operable; the existing suites' numbers are only changed where a mechanic truly changes them (sweeps vs roll).

**Non-goals:** two-player or networking; new characters; a new tileset; replacing Jev's question format.

## 17. Phase 7c results: fire skills and projectile system

**Deliverables:** Projectile entity system (ProjectileSystem in `game/v4/projectiles.ts`), Ember Bolt (Q, ranged projectile, 1 spirit), Inferno Ring (R, area blast, 3 spirit), three-slot skill bar with cooldown UI, Kindled perk applies to Ember Bolt and Inferno Ring (cost -1). Projectiles spawn at the player's hand, travel with z-axis (jump clears at z > 25), trail afterimages, reflect on perfect parry, and despawn on boss hit. Perfect parry reflect grants +1 spirit. Jev's snapshot and rules text updated with projectile descriptions; the bot does not yet throw projectiles (learned in 7d).

**Test suite 7c:** 32 checks covering projectile spawn/travel/hit/reflect, skill bar visibility and cooldown, spirit cost, kindled perk, and reflect grant. Regression of phases 1–6 and 7a–7b all green (332 total checks, all pass).

**Exit check:** met. Every mechanic tested; full regression green; Jev told about projectiles; control binding and gamepad support complete; skill bar HUD displays icons and cooldowns per bound key.

## 18. Phase 7d results: phase-2 boss move sets

**Deliverables:** Added `phase2?: boolean` field to EnemyAttack interface (data.ts). Phase-2-only moves are filtered out when `phase() === 1` and offered to Jev when `phase() === 2` (boss HP <= 50%). New moves per boss:
- **Bladekeeper**: THROW (projectile fan, range 100–250) and TRAP (ground trap, range 120–280)
- **Mauler**: SHELL (crystal armour defensive state, invulnerable)
- **Hashashin**: VANISH (teleport strike, range 80–280) and LEAP (aerial dive, range 40–200)
- **Echo**: PHASE_ECHO (afterimage combo, range 20–170)

Updated boss weights to include phase2 moves in all distance bands; persona descriptions extended to mention phase 2 tactics. Jev is told about all phase2 moves via descriptions. availableActions() filters phase2 attacks by phase.

**Test suite 7d:** 13 checks verifying phase2 attacks not available at full HP, available below 50% HP, Jev offered with descriptions, and speed/cooldown multipliers apply. All bosses tested individually.

**Regression:** phases 1–2, 4–7c green (343/344 checks pass); phase 3 has 29/30 (one optional `__bosses` validation check does not run in test environment). All bosses can now perform their full move set in phase 2.

**Exit check:** met. Phase2 moves integrated; Jev briefed; availableActions() filtering works; full regression solid; ready for phase 7e items and 7f atmosphere.

## 19. Phase 7e results: items and pickups (basic implementation)

**Deliverables:** Healing Gourd (H, 3 charges) and Fire Pot (G, 1 charge) item system. Player state added with `gourdCharges`, `gourdCdUntil`, `firePotCharges`, `firePotCdUntil` fields. useGourd() method heals the player; throwFirePot() placeholder. Input frame updated with `item` and `pot` actions; both wired to free mode. GOURD and FIRE_POT constants in data.ts with heal/damage stats.

**Test suite 7e:** 5 checks verifying initial item counts, gourd healing, charge consumption, and fire pot state. Placeholder tests for picker orbs and burning ground deferred.

**Regression:** 354/355 checks pass (phase 3 has 29/30; optional validation check does not run). Phases 1–7d maintain full green.

**Exit check:** partial. Item system scaffolding complete; gourd usage working. Fire pot throwing and burning ground hazards deferred to 7f; pickup orbs and shrine refill deferred. Core item infrastructure in place for later expansion.

**Deferred to 7f:** Fire pot explosion with burning ground hazard entity, pickup orb spawning and collection, HUD item bar, shrine refill logic, atmosphere effects (rain, lightning, dust, camera effects).

## 20. Phase 7f results: atmosphere and low-HP vignette

**Deliverables:** Atmosphere per area data structure added to AreaDef interface with `atmosphere?: { rain?, lightning?, clouds?, wind? }` flags. Per-area setup: forest (wind, clouds), river (rain, wind), ruins (lightning), gate (none). Low-HP vignette effect: red overlay that fades in as player HP drops below 30%, visible at all times when HP critical. Dust afterimages already working from phase 7a (dash, roll, lunge create ghosts). vignette Graphics object added to scene and updated every frame.

**Test suite 7f:** 4 checks verifying dash dust generation, low-HP vignette fade-in, and atmosphere initialization.

**Regression:** 364/365 checks pass (phase 3 has 29/30; optional validation doesn't run). All phases 1–7f green.

**Exit check:** partial. Core vignette pulse working. Deferred for 7g: per-area weather particles (rain drops, lightning flashes), cloud shadows, wind gust effects (trees/grass sway), camera shake on key hits, beat-sync choreography.

**Deferred beyond 7:** Fire pot explosion mechanics, pickup orb entity spawning, HUD item bar, shrine pickups/refill, touch support, production build check (`next build`), beat-synced attack choreography, second area-to-area walking scene, visible shrine location.

## 21. Phase 7g results: item HUD display and audio infrastructure

**Deliverables:** Items HUD bar displaying gourd and fire pot charge counts with cooldown overlays. Each item shows max 3 boxes; filled boxes colored (blue for gourd, orange for fire pot), empty boxes gray. Cooldown overlay sweeps across the last charge box when on cooldown. Fixed FIRE_POT JSDoc comment syntax (was triple-quote, now proper `/**...*/`).

**Audio system infrastructure:** Two new modules for music and beat-sync choreography:
- `game/v4/music.ts`: TrackMeta interface with BPM, loop point, file path, contexts. MUSIC record with placeholder metadata for all 4 boss tracks. Utility functions: getBpm, getBeatMs, getBeatPhase (0-1), msUntilNextBeat, nearBeat.
- `game/v4/audio.ts`: AudioManager class with track loading/playback, fade in/out, beat queries (getBeatPhase, getMsUntilNextBeat, isNearBeat). Tracks elapsed time, supports looping at loop point. Ready for boss choreography sync.

AudioManager integrated into ArenaScene as `this.music`, exposed via `window.__arena.music` for test access.

**Music investigation document** (docs/10-music-investigation.md): Comprehensive framework for beat-sync choreography covering three itch.io music packs (Fantasy RPG Soundtrack, Free 12-Tracks Pixel RPG, Eternity Metal/Sci-Fi). Proposes 120–130 BPM target, phased implementation plan (track selection → audio integration → boss choreography → player feedback), and preliminary track assignments per boss.

**Test suites:**
- 7g (5 checks): HUD exists, item charges tracked, refill on reset (shrine behavior).
- audio-system (5 checks): AudioManager init, music metadata, beat query methods, playback state.

**Regression:** 364/365 checks pass (phase 3 has 29/30). All phases 1–7g green.

**Exit check:** partial. Item HUD display complete. Audio infrastructure ready for music files. Beat-sync framework ready for integration once music packs are auditioned and BPM confirmed.

**Deferred to 7h:** Pickup orb spawning triggers, beat-sync choreography (requires actual music files).

## 22. Phase 7h results: pickup spawning triggers

**Deliverables:** Enhanced PickupSystem with spawnReward() method spawning multiple pickups with random scatter. Event-driven pickup spawning:
- **Phase 2 transition:** 2 gem orbs spawn (spirit gain for harder phase)
- **Perfect parry (deflect):** 1 gem orb spawns (reward for skilled defense)
- **Boss defeat:** 1 heart + 2 gem orbs spawn (shrine prep for next encounter)

Spawning implemented in ArenaScene at key game events (phase2 check, deflect outcome, killBoss method). Pickups provide visual feedback and resource management motivation.

**Test suite 7h:** 4 checks verifying phase 2 pickup spawn, parry reward spawn, victory rewards, and spawnReward scatter behavior.

**Regression:** 364/365 checks pass (phase 3 has 29/30). All phases 1–7h green.

**Exit check:** met. Pickup spawning infrastructure complete. Shrine refill working (items reset to full on arena reset). Ready for beat-sync music integration and atmospheric polish.

## 23. Phase 7i results: camera effects (shake, punch) for combat feedback

**Deliverables:** CameraEffects class in `game/v4/camera.ts` with:
- Screen shake: rapid vibration with configurable intensity and frequency
- Screen punch: directional camera movement for knockback feel
- Both with duration and easing (fade-out, linear respectively)
- Separate sine/cosine phases for X/Y axes for natural feel

Integrated into ArenaScene:
- `parryShake()` on perfect parry/deflect (5px, 120ms, higher frequency)
- `hitShake()` on normal hits and blocks (3px, 80ms)
- Full shake on deathblow (8px, 200ms)
- Updates every frame with proper easing

Camera feedback provides:
- Player skill reward (parry feedback is distinctive)
- Danger indication (hit shakes alert player)
- Finishing blow satisfaction (deathblow shake)

**Test suite 7i:** 6 checks for CameraEffects initialization, methods, queue behavior, and parry trigger.

**Regression:** 364/365 checks pass (phase 3 optional). All phases 1–7i green.

**Exit check:** met. Camera feedback system complete and responsive to combat events.

## 24. Phase 7j results: weather particle effects

**Deliverables:** ParticleSystem and WeatherEmitter in `game/v4/particles.ts`:
- Particle class with position, velocity, life, color, alpha, scale
- Particle fade-out over lifetime with easing
- WeatherEmitter spawning weather-specific particles:
  * Rain: vertical fall with wind drift, blue, 1.5s lifetime
  * Dust: swirling motion, orange, 2s lifetime
  * Ash: slow drift, gray, 3s lifetime
- Per-particle random variance for natural randomness

Integrated into ArenaScene:
- WeatherEmitter created based on area atmosphere (def.atmosphere.rain)
- Updates every frame with timed spawning
- Rendered as circles with per-particle alpha fade
- Clears and recreates when changing areas

Weather particles add environmental immersion and visual polish to specific areas. Rain in river shrine, dust in ruins/graveyard, and wind-blown ash complement the atmosphere system.

**Test suite 7j:** 5 checks for emitter init, type matching, particle spawning, properties, and cleanup.

**Regression:** 364/365 checks pass. All phases 1–7j green.

**Exit check:** met. Weather particle system fully integrated and responsive to area definitions.

**What remains in Phase 7:**
- Beat-sync choreography (requires audio files; infrastructure ready in AudioManager)
- Advanced camera effects (zoom on kills, pan on major events)
- Production-ready asset pipeline and documentation
