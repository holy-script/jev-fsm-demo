# 08. Extending the project: recipes, decisions, backlog

Practical, step-by-step guides for the changes an agent is most likely to be asked to make, followed by the reasoning behind the main design decisions, a debugging toolkit, and the known backlog. Everything refers to v3 (`game/duel/`) unless stated.

## Recipes

### A. Add a move to an existing boss

1. In `data.ts`, add a `MoveDef` under the boss's `moves`. Required: `id`, `label`, `desc` (this is what Jev reads: say what it does, what it beats, what beats it), `anim` (sheet suffix) and `fps`, `hits` (empty for non-melee kinds). Set `reach` (rough distance at which it can connect, including lunge) and `cooldown`.
2. Telegraph: add `holds: [{frame, ms}]` on the wind-up frame. For choreography add `leadBeats` (beats from move start to first impact, usually 1.5 to 3) and `grid` (1 = on the beat, 0.5 = syncopated), and `gapBeats` for multi-hit moves.
3. Choose an `AtkType` in the hit (`normal`, `heavy`, `thrust`, `sweep`, `grab`; `beam` comes from `kind: "beam"`, `pillars` maps to `sweep`). Unblockable types automatically get a glyph and warning sound, and count toward the fairness cap.
4. Add it to `weights` (close, mid, far bands) so the rules bot uses it, and to `dummyKeys` if you want a dev key (the first five map to Z X C V B).
5. If it is a combo, add `gates` (see the Captain's SLASH2 in `data.ts` for a template) and make sure option ids are either the generic ones (`CONTINUE DELAY FEINT END`) or other move ids.
6. Verify `npx tsc --noEmit`, then add assertions to the boss's suite (damage taken unguarded, deflect result, etc.). Use the dummy key (`key("z")`) with `d.b.auto = false`.
7. Re-run `node tests/duel/bot.mjs <boss> 2 beat` for a balance glance.

### B. Add a new boss

1. **Art**: follow [06](06-asset-pipeline.md): new `strip(...)` calls with a unique prefix producing `<prefix>_idle`, `_walk`, `_hit`, `_block`, `_dead` and attack strips; set `nativeDir` and `anchorX` if needed; add fps and loop info in the `FPS`/`LOOP` tables in `DuelScene.ts`.
2. **Data**: copy the closest existing `BossDef` in `data.ts` and edit: `id`, `name`, `title`, `prefix`, `area`, `scale`, `headY` (head height above feet in world px, for glyph/popup placement), `segments`, `segmentHp`, `speed`, `radius`, `anims`, `music`, `persona` (the temperament paragraph Jev is told), `actionDesc` overrides, `dummyKeys`, `moves`, `weights`, `taunts`, `speaker/intro/outro/briefing`.
3. **Sequence**: add to `ENCOUNTERS` (game order) and, if tests should reach it, to `BOSSES` (dev order). `idxOf(id)` is how tests find it.
4. **Area and music**: reuse an existing area or add one (recipe D). Music keys come from the manifest (`prep_duel_assets.py` TRACKS).
5. **Save/story**: `cleared` is keyed by boss id. Story keys derive from the id.
6. **Tests**: copy `bringer.mjs` as a template.

### C. Add a new move *kind* (new behaviour)

Existing precedent: `pillars` and `blink` were added this way. The touch points:

1. `data.ts`: extend `MoveDef.kind` union and add an optional payload field (e.g. `pillars?: {...}`), documented with a comment.
2. `DuelScene.ts`:
   - `moveType(mv)` if its attack type for warnings/fairness is not the default (pillars -> `"sweep"`).
   - `runMoveEffects(mv, fr, now)`: spawn the effect once at the right frame (use `b.spawned[n]` as a once-flag; indices 97, 98, 99 are taken by blink, pillars, beam).
   - A per-frame `updateX(now)` called from the main `update` normal branch, and cleanup in `clearEntities()`.
   - `runBossMove`: if the kind should not play the generic swing sound, add it to the exclusion in the `sounded` block.
   - End-of-move recovery in the `ended` block if it needs a non-default recover.
   - Outcome reporting: call `this.outcome(moveId, "hit" | "dodged" | "missed")` once per move (not per pillar) so Jev's `vsMove` stats stay meaningful.
   - Damage must go through `hurtPlayer(h, "hit", now)` with a synthetic `HitDef` so difficulty, armour, hit-stop, posture and death handling stay in one place.
3. If Jev should know about a new concept, add it to `RULES_TEXT` and the move `desc`.
4. Tests: spawn count, damage when standing, no damage when dodging, cleanup on reset.

### D. Add an area / map

1. In `tools/make_duel_map.py`, call `build(...)` with the dais rectangles, divider walls, pillar blocks, spawns (`player`, `boss`, optional `shade`, `npc`), `gate`, `arena` rect, `lights`, `shrines`, `lore`. Run `npm run assets:duel`.
2. In `createDuelGame.ts`'s BootScene, `load.tilemapTiledJSON("<key>", "/maps/<file>.json")`.
3. In `data.ts`, add an `AreaDef` to `AREAS` (map key, tints, bg, ambient darkness, music, zones, stars) and set `area: "<id>"` on the boss that lives there.
4. `DuelScene.areaFor` / `loadArea` handle the rest; `travel()` triggers when the next encounter is in a different area and `nextBoss` runs after a shrine.
5. Add expectations to `world.mjs` (lights count, shrine, spawns, card text).

### E. Add a skill

1. `skills.ts`: append to `SKILLS` (id, name, path, cost, optional `needs`, blurb).
2. Implement its effect where the mechanic lives and gate it with `has("<id>")` (examples: `deflectMs()` for Keen Eye, `hurtPlayer` deflect branch for Echo/Wrist, `startHeal` for Gourd). For a new *action*, add a `HERO_MOVES` entry plus a key and buffer in `updatePlayer`, a spirit cost in `startMove`, and a hint in `HudScene`.
3. Add it to `DuelSnapshot.player.skills` automatically (it uses `SKILL_IDS`).
4. Optionally add a tutorial follow-up lesson in `tutorial.ts` guarded by `has(id)`.
5. `skills.mjs` has the pattern for buying and checking effects.

### F. Add a tutorial lesson

In `tutorial.ts`'s `runTutorial`, add: Instructor `h.say(I, [...])`, then `await lesson({title, text}, setup, done, {progress, hints})`. `done` reads `h.count("<event>")`. Events come from `tutEvent(name)` calls in the scene (add one at the point the player does the thing) and from `outcome()` (which emits `<MOVE>:<result>`). Use `h.shade.loop([moveIds], gapMs)` to make the Shade demonstrate. Add the lesson title to the expected order in `tutorial.mjs` and give it an injected or real driver in the `switch`.

### G. Add a sound or visual effect

- **SFX**: add a method on `Sfx` in `sfx.ts` using the existing helpers (`thud`, `whoosh`, oscillator/noise primitives) with a dB trim; add it to the cue list in `tests/duel/audio.mjs` and compare peak/loudness with its neighbours. Call it from the scene at the semantic moment.
- **VFX**: add a `vfx_strip(...)` in the asset script, then a helper in `vfx.ts` that spawns a tinted sprite; use `burst`, `ring`, `popup` in the scene for cheap particles and text.
- **Missing animation**: do not skip it; stand in with `hitFlash` (red hurt, green heal), `squash`, `afterimage`, shards.

### H. Add story, taunts, lore

- Boss lines: `intro`, `outro`, `briefing` (arrays of strings) and `speaker` on the `BossDef`. They are keyed into `save.seen` automatically.
- Taunts: add `{id, text, when}` entries to `BossDef.taunts`; `when` is the guidance Jev uses, so write it as the player-behaviour trigger.
- Lore slab: add a `lore` object (property `text`) in the map generator.
- Ending: `killBoss` currently shows a "THE DANCE ENDS" card after the final outro; extend there for credits or an epilogue.

### I. Add a question to Jev

1. `brain.ts: idleQuestions` (or `gateQuestions`): add the question (choice/noul/score) with instructions and criteria. Keep the total under 12.
2. Read the answer in `askIdle`/`askGate` and add the field to `Decision`.
3. Consume it in the scene (`setDecision`/`takeDecision`), always tolerating `undefined` (tests, fallbacks and older mocks do not return it).
4. Mention the new concept in `RULES_TEXT`.
5. Extend `jev2.mjs` (inspect the posted question, return a mocked answer, assert the effect).

### J. Add a setting

Add the field and default in `settings.ts`, a row in `MenuScene.ts` (`label`, `act`, `hint`), and read it where used. Tests pin `duel.settings` in `localStorage` by `addInitScript`, so new settings must have safe defaults (`read` merges stored values over defaults).

### K. A balance pass

1. `node tests/duel/bot.mjs captain,golem,bringer 3 classic` and `beat` (set `BRAIN=JEV` occasionally; it costs API calls). Compare novice/competent/expert results; adjust `segmentHp`, hit `damage`, `cooldown`, `leadBeats`, hold `ms`, `weights`.
2. Re-run the boss's own suite: tests assert numeric thresholds (e.g. HP after an unguarded hit); update them in the same commit as the balance change.
3. The bot is crude. Treat 2 to 3 trial results as a rough signal. Real human feel is the real test.

## Why it is built this way (decisions worth knowing)

- **Top-down movement with side-view sprites.** The user wanted large explorable maps and camera focus, but the better-supplied art packs are side view. Footprint collision on the ground plane plus a vertical sprite anchored at the feet gives the look cheaply. The player always faces the boss, which suits a duel.
- **Posture combat, not a hit-point race.** Sekiro-style depth: the interesting decisions are deflect timing, which attacks are unblockable, and when to punish. Boss HP is split into segments that need deathblows, so a fight has beats.
- **Warnings for everything unblockable.** A coloured glyph and a distinct sound for each type, because silent or unwarned attacks feel unfair.
- **Beat-grid choreography as a toggle.** Impacts snap to the measured music beat so combat feels like a dance, but some players find it too rigid, so *Classic* timing remains. Off-beat delays are the boss's "tricks".
- **Jev chooses *what and when*, never micro-motion.** Moves are committed; the model picks actions, combo branches, rhythm and optional taunts. Latency is hidden by prefetching during recovery.
- **Everything has a rules fallback and validation.** The game is always playable offline and a model hiccup never freezes a fight.
- **Data tables over code.** Bosses, areas, skills, lessons are tables so content is cheap and safe to add.
- **Assets measured, not eyeballed.** Sprite bounding boxes, music tempo/phase, SFX loudness are all computed by scripts, because the author could not listen or see in real time.
- **Fairness governor and memory.** Cap on consecutive unblockables; per-move cooldowns; a boss that remembers what worked against you across attempts. This is the "Jev learns you" story of the demo.

## Debugging toolkit

- Add `?dev=1` to `/duel`. Dev keys: `Z X C V B` force the boss's move list in order, `G` guard, `N` toggle auto, `T` refill, `Y` wake, `1`/`2` jump to the Captain/Golem (the Bringer is reached with `__duel.reset(__duel.idxOf("bringer"))` from the console), `F` brain.
- In the browser console: `__duel` (the scene), e.g. `__duel.b` (boss runtime state), `__duel.p` (player), `__duel.tel.summary()`, `__duel.snapshot(__duel.time.now)` (exactly what Jev sees), `__duel.availableActions(__duel.time.now)`, `__duel.hud`. `__game.scene.getScenes(true)` lists active scenes.
- `Tab` in the game: decision log with source, probability, latency, errors, the reads.
- The log line `watchdog: ...` means a boss state was force-ended: investigate why a state exceeded its natural length.
- Beat debugging: `__duel.sfx.beatPos()` and `__duel.beatMs()`; `beat.mjs` prints per-move offsets from the grid.
- Visual checks without a human: Playwright `page.screenshot` (the repo's tests and tools save screenshots to `/tmp` or the scratchpad); read the PNG.

## Known limitations and backlog

Not done or only partly done:
- **Human feel is untested.** Parry timing, beat feel, difficulty curve and audio levels were verified by measurement and bots, not by hand. Expect tuning after real play. The Captain and Golem fall quickly to competent bots (20 to 40 s); consider more HP/posture if humans find them easy.
- **Jev taunts and rhythm are exercised only against mocks** in tests; behaviour with the real model (how often it speaks, which rhythm it picks) has not been reviewed at scale. Consider logging them in `personas.mjs`.
- **No gamepad, no key rebinding, no save slots.**
- **Bone Soldier's native facing** was uncertain when the art was integrated; verify visually.
- **Ending is minimal** (a title card). Room for an epilogue, credits roll, New Game+ (the boss memory system makes this natural).
- **v1 and v2 have no tests** and v2 uses the older pattern (no prefetch, per-boss prompt only).
- **`links.txt`** (in the working tree, untracked) lists itch.io creators the user liked; candidates for more content (extra music, tiles, VFX) include Pimen, Elthen, 0x72 tileset (skipped), more boss packs in `assets/_dl2`.
- **Possible features**: a Jev-vs-Rules aggregate dashboard beyond the current stats screen, more bosses/areas, difficulty modifiers fed to Jev, an optional beat-pulse training aid, ranged-vs-melee player builds, parry-timing practice mode.
- **Performance**: software rendering is slow for the lighting render texture (hence `?dev=1` hides it). On real GPUs it is fine; if mobile or low-end support matters, reduce the lighting resolution.

## Contribution checklist for an agent

1. `npx tsc --noEmit` clean.
2. Add or update the matching suite in `tests/duel/` (and its `package.json` chain entry).
3. Run the affected suites; for broad changes run the full chain in the background and read all pass counts.
4. Update these docs if you changed architecture, content tables or workflows.
5. Commit with a descriptive message and push (the user wants frequent commits). Do not commit `.env`, `assets/`, generated `public/*-assets/`, or `links.txt`.
