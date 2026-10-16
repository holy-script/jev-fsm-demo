# Jev vs Human

Jev (TypeSafe's decision model) picks the next state of an enemy finite state machine; you try to beat it. Next.js + Phaser.

- `/boss-rush` - side-view hack & slash, four bosses (Slime, Fire Worm, Evil Wizard, Bringer of Death), Tiled arenas. Needs assets: see [tools/README.md](tools/README.md).
- `/basic` - v1, a top-down shooter duel with procedural art. Also kept on the `v1-basic` branch.

```bash
cp env.sample .env      # TYPESAFE_API_KEY, TYPESAFE_BASE_URL, JEV_MODEL
npm i && npm run dev
```

## How Jev plugs into the FSM

Each boss is a table of states in `game/boss/defs.ts` (animation, hit frames, projectiles, cooldowns). Jev never moves the boss. Whenever the boss is free to act it POSTs a snapshot to `/api/jev/boss`, which calls `POST /v1/systemone` with one `choice` question whose options are the states **currently available** (off cooldown, not cornered). Jev returns the best choice plus probabilities (shown live in the sidebar). The engine then runs that state to completion. Attacks are committed once started, so Jev's job is spacing, timing and not being predictable.

If Jev is unreachable or slow, the boss falls back to a fixed-priority rules bot (the same bot you get with **T**), and the error shows in the log.
