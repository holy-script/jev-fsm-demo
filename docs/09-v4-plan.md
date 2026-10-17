# 09. v4 plan: "ARENA" proper demo

Status: **plan, nothing built yet.** Decisions taken with the user: free assets only; v4 is a new route `/arena` in `game/v4/` (v3 `/duel` stays untouched and playable); the setting follows the environment packs (forest, ruined river temple, graveyard), so the v3 monastery/foundry/summit story is rewritten.

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

Open risks to resolve in Phase 0 (the pages do not state them): sprite pixel sizes and frame counts per animation, whether each free zip has separate frames or sheets, which pimen packs are free (only Slashes and Thrusts, Hit Spark are confirmed pay $0; Dark, Holy, Fire 01, Ice 01, Thunder 01, Earth 01, Wind 01, Water 01, Wood, Acid show no price and must be checked). Pimen packs already in `assets/packs3`: dark-spell-effect, holy-spell-effect, thunder-spell-effect-01, smoke-vfx-1, cutting-and-healing.

### immunitys environments
Free name-your-price (verify each): Forgotten Memories 32x32 (autumn forest, river, waterfall, stone paths), Forest Top-Down 32x32, Pixel RPG UI Pack, RPG Icon Pack 32x32/24x24, Top Down Skeletons #1/#2, Goblin Sprite Pack #1.
Risk: **skeleton/goblin sprites are top-down, the chierit heroes are side-view.** v3 already mixes top-down movement with side-view sprites, but top-down enemy art may clash. Decide at Phase 0 after seeing them; fall back to Cthulu/Demon Slime as grunts. Tilesets are forest/ruins only; no foundry or lava. Areas are therefore: Forest Edge, River Shrine (water, waterfall), Ruined Graveyard/Temple, and a night or dusk variant of one of them for the final.

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
