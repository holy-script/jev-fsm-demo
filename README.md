# Jev vs Human

Jev (TypeSafe's decision model) picks the next state of an enemy finite state machine; you try to beat it. Next.js + Phaser.

- `/boss-rush` - side-view hack & slash, four bosses (Slime, Fire Worm, Evil Wizard, Bringer of Death), Tiled arenas. Needs assets: see [tools/README.md](tools/README.md).
- `/duel` - Sekiro-style posture duel on a large top-down map (deflect, posture bars, deathblows, perilous attacks). Two bosses (Skeleton Captain, Mecha-Stone Golem), both driven by Jev. Assets: see [tools/README.md](tools/README.md).
- `/basic` - v1, a top-down shooter duel with procedural art. Also kept on the `v1-basic` branch.

```bash
cp env.sample .env      # TYPESAFE_API_KEY, TYPESAFE_BASE_URL, JEV_MODEL
npm i && npm run dev
```

## How Jev plugs into the FSM

Each boss is a table of states in `game/boss/defs.ts` (animation, hit frames, projectiles, cooldowns). Jev never moves the boss. Whenever the boss is free to act it POSTs a snapshot to `/api/jev/boss`, which calls `POST /v1/systemone` with one `choice` question whose options are the states **currently available** (off cooldown, not cornered). Jev returns the best choice plus probabilities (shown live in the sidebar). The engine then runs that state to completion. Attacks are committed once started, so Jev's job is spacing, timing and not being predictable.

If Jev is unreachable or slow, the boss falls back to a fixed-priority rules bot (the same bot you get with **T**), and the error shows in the log.

## Posture Duel: how Jev is used

Two kinds of decision, both through `/api/jev/ask` (one `/v1/systemone` call with several questions about the same state):

- **Idle gate** - the next action (walk, backstep, circle, wait, guard, or one of five attacks). Asked *while the boss is still recovering*, so the answer is usually ready when it is needed. The same call asks four yes/no questions about the player (turtling, roll-reliant, trade-hungry, panicking) and one 0-3 score (predictability); the reads show in the side panel.
- **Combo gates** - once the first hit of a combo has resolved (deflected, blocked, dodged, hit), Jev decides how it continues: follow through, delay, feint, stop, or chain into another move.

The snapshot Jev sees includes your last 8 seconds of actions and, per boss move, how you have answered it so far (first reaction and outcome). Prompts spell out the real mechanics (what is unblockable, what a roll beats), because Jev only knows what it is told. Per-move cooldowns force it to rotate its counters.

If Jev errors, is slow (>1.5s) or answers with an unavailable action, the boss falls back to a fixed-priority rules bot for that decision and the log marks it. **F** switches the whole fight to the rules bot for comparison.

`npm run test:duel` runs the scripted checks (mechanics, and the Jev gate logic against a mocked API). `node tests/duel/personas.mjs` runs three play-style bots against the real Jev and prints how its choices and reads change.

### The two bosses

- **Skeleton Captain** - shield duelist. Double slash with branch points, delayed overhead, perilous thrust, sweep, grab; a guard stance a kick can break.
- **Mecha-Stone Golem** - slow, huge, cannot be flinched. Crushing stone fist, a thrown fist you can deflect back at it, a laser whose aim locks 0.3s before firing, a stone guard that only a heavy attack breaks, and an armor buff (half damage for 7s). Phase 2 throws two fists.

`node tests/duel/golem.mjs` checks the Golem's mechanics; `node tests/duel/personas.mjs 40000 1` runs the play-style bots against it (the last argument picks the boss: 0 Captain, 1 Golem).

### Choreography, sound and effects

- **Combat timing** (Settings): *Choreographed* snaps every boss impact to the beat of the fight's music (measured with `tools/bpm.py`: Captain 90 BPM, Golem 80, final boss 70). Some moves land half a beat *off* the beat on purpose (the Captain's overhead, grab, and the delay branch), and recoveries and the post-string recoil step are measured in beats. *Classic* keeps the original timing. `node tests/duel/beat.mjs` checks impacts land within ~0.04 beat of the grid.
- **Difficulty** (Settings): Assist / Duelist / Shadow change the deflect window (220 / 160 / 130 ms) and damage dealt and taken.
- **Sound**: recorded CC0 sword clashes and swings plus a synthesised library on one compressed bus, with a distinct warning cue for each unblockable move (thrust, sweep, grab, laser). `node tests/duel/audio.mjs` renders every cue offline and prints peak and loudness so levels can be balanced without listening.
- **Effects**: where an animation is missing, tinted bursts, afterimages and squash stand in: red body flash and blood for hurt, green pulse and sparkle for heal, a starburst for deflect, shards for stone.

### Skills

Core moves are always available (light chain, heavy, guard/deflect, roll, kick, heal) and a **riposte**: a deflect or a slip opens a short window in which your next attack (J) becomes a free lunging counter that deals heavy posture damage. Deflects and slips also earn **spirit**, which funds the unlockable skills. You start with 2 skill points and earn 1 per boss, spent at the shrine (opens after each boss, and from the pause menu), so you cannot buy everything:

| Path | Skills |
|---|---|
| Deflection | Keen Eye (+40 ms window) -> Echo (+1 spirit, longer riposte), Iron Wrist (+30% deflect posture damage) |
| Flow | Roll Cut (attack during a roll), Whirl Cut (L, 2 spirit: spin, breaks a raised guard), Riposte Reach (+50% window) |
| Tools | Throwing Blades (I, 1 spirit: ranged posture chip), Spirit Well (+2 max spirit), Quick Gourd (30% faster heal) |

Jev sees your spirit, riposte readiness, unlocked skills and how often you use arts and tools. `node tests/duel/skills.mjs` covers all of it.

### The tutorial

A new game starts in the monastery courtyard with an **Instructor** (a pale spirit) who teaches in RPG-style dialogue boxes: move, strike, block, deflect, riposte, sweep (yellow, low rumble), perilous thrust (red, chime) with the slip, grab (purple, whisper), posture and deathblow, kick, heal, the shrine, any skill you pick, and a final test against the **Sparring Shade**. The Shade is the Captain's moveset telegraphed 1.9x slower and hitting lightly; it cannot die. A timing ring closes on it at the moment of impact (also available as the Assist difficulty's aid). An objective panel shows progress and gives hints when you are stuck; HP never falls below 20 during lessons; Esc > Skip tutorial ends it. The gate north stays sealed until you finish. `node tests/duel/tutorial.mjs` plays it through.
