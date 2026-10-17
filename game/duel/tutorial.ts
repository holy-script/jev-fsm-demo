import { has } from "./skills";

export interface Objective {
  title: string;
  text: string;
}

export interface UntilOpts {
  progress?: () => string; // e.g. "2 / 3"
  hints?: { afterMs: number; text: string }[];
  timeoutMs?: number;
}

/** What the tutorial needs from the game. The scene implements this. */
export interface TutorialHost {
  say(who: string, lines: string[]): Promise<void>;
  objective(o: Objective | null): void;
  count(key: string): number;
  resetCounts(): void;
  until(cond: () => boolean, opts?: UntilOpts): Promise<boolean>;
  shade: {
    loop(moves: string[], gapMs: number): void; // repeatedly telegraphs these moves, one after another
    stop(): void;
    guardLoop(everyMs: number): void; // raises its guard now and then
    speed(mul: number): void; // 1 = slowest teaching speed; smaller = faster
  };
  ringAid(on: boolean): void;
  player: { setHp(frac: number): void; giveHeals(n: number): void; fill(): void; giveSpirit(n: number): void};
  openShrine(): Promise<void>;
  finish(): Promise<void>;
  moved(): number;
}

const I = "INSTRUCTOR";

/**
 * The lessons. Each step introduces one thing, sets an objective, runs the Shade's demonstration and waits for the player to do it.
 * Hints appear on the objective panel when the player is stuck.
 */
export async function runTutorial(h: TutorialHost) {
  const lesson = async (o: { title: string; text: string }, setup: () => void, done: () => boolean, opts: UntilOpts = {}) => {
    h.resetCounts();
    h.objective(o);
    setup();
    await h.until(done, opts);
    h.shade.stop();
    h.objective(null);
  };

  await h.say(I, [
    "Hm. Another one wakes in the dust of the Hollow Monastery.",
    "I am what remains of its sword master. Not much. Enough to teach.",
    "Beyond that gate waits the Reaper who ended us all. Three guardians stand before him, and none will hold back.",
    "Learn the dance, or become another bone in this courtyard.",
  ]);

  // 1. move
  await h.say(I, ["First, walk. WASD. You will always face your foe: keep your eyes on the blade, not on your feet."]);
  h.player.fill();
  await lesson({ title: "MOVE", text: "Walk around the Shade (WASD)." }, () => {}, () => h.moved() > 260, { progress: () => `${Math.min(100, Math.round((h.moved() / 260) * 100))}%` });

  // 2. strike
  await h.say(I, ["My Shade will stand still. Cut it. J chains three strikes: slash, slash, thrust. K is a slow heavy blow."]);
  await lesson({ title: "STRIKE", text: "Land 5 hits, one of them a heavy (K)." }, () => {}, () => h.count("hit") >= 5 && h.count("heavy") >= 1, {
    progress: () => `${h.count("hit")} / 5 hits, heavy ${Math.min(1, h.count("heavy"))} / 1`,
    hints: [{ afterMs: 15000, text: "Stand close to it. J to slash, K for the heavy." }],
  });

  // 3. block
  await h.say(I, [
    "Now it strikes back, slowly. Step close to it, and hold SPACE to guard.",
    "Blocking saves your life, but every blow fills your POSTURE bar, the one at the bottom of the screen. When it is full, you are broken.",
  ]);
  await lesson({ title: "BLOCK", text: "Hold SPACE and block 2 strikes." }, () => h.shade.loop(["SLASH2"], 2400), () => h.count("block") >= 2, {
    progress: () => `${h.count("block")} / 2`,
    hints: [{ afterMs: 14000, text: "Hold SPACE before the blow lands, and keep holding it." }],
  });

  // 4. deflect
  await h.say(I, [
    "Better: tap SPACE just BEFORE the blade lands. That is a deflect. It costs you nothing, and it fills THEIR posture.",
    "Watch the ring close in on the Shade. It closes at the moment of impact: tap just before it ends.",
  ]);
  h.ringAid(true);
  await lesson({ title: "DEFLECT", text: "Stay close. Tap SPACE just before the ring closes. Deflect 3 strikes." }, () => h.shade.loop(["SLASH2"], 2200), () => h.count("deflect") >= 3, {
    progress: () => `${h.count("deflect")} / 3`,
    hints: [
      { afterMs: 16000, text: "TAP, do not hold. Hold it down and you only block." },
      { afterMs: 34000, text: "Tap a little later: the deflect window is only a fraction of a second." },
    ],
  });

  // 5. riposte
  await h.say(I, ["A clean deflect opens a gap. See the golden ring at your feet? Strike while it glows (J). That is a riposte, and it hits hard."]);
  await lesson({ title: "RIPOSTE", text: "Deflect, then press J while the ring glows." }, () => h.shade.loop(["SLASH2"], 2400), () => h.count("riposte") >= 1, {
    hints: [{ afterMs: 18000, text: "Deflect first (tap SPACE as the ring closes), then press J right away." }],
  });

  // 6. sweep
  h.ringAid(true);
  await h.say(I, ["Some strikes cannot be blocked. A YELLOW mark and a low rumble: a sweep. Roll through it with SHIFT, or step out of its reach."]);
  await lesson({ title: "SWEEP", text: "Dodge 2 sweeps (SHIFT, or move out of range)." }, () => h.shade.loop(["SWEEP"], 2600), () => h.count("SWEEP:dodged") + h.count("SWEEP:missed") >= 2, {
    progress: () => `${h.count("SWEEP:dodged") + h.count("SWEEP:missed")} / 2`,
    hints: [{ afterMs: 16000, text: "Press SHIFT as the yellow mark pulses to roll through it." }],
  });

  // 7. thrust
  await h.say(I, [
    "RED, and a chime like a needle: the perilous thrust. No block will save you.",
    "Roll INTO it at the last moment and you slip past. The Shade will stumble, and you earn a riposte.",
  ]);
  await lesson({ title: "SLIP", text: "Roll into 2 thrusts at the last instant (SHIFT)." }, () => h.shade.loop(["THRUST"], 2800), () => h.count("THRUST:slipped") >= 2, {
    progress: () => `${h.count("THRUST:slipped")} / 2`,
    hints: [
      { afterMs: 16000, text: "Wait for the lunge, then roll TOWARD the Shade, late rather than early." },
      { afterMs: 36000, text: "Hold W, A, S or D toward it as you press SHIFT." },
    ],
  });

  // 8. grab
  await h.say(I, ["PURPLE, and a whisper. The grab. Nothing blocks it, and rolling does not save you. Only distance does. Get out of its reach."]);
  await lesson({ title: "GRAB", text: "Back away from 2 grabs." }, () => h.shade.loop(["GRAB"], 3000), () => h.count("GRAB:missed") >= 2, {
    progress: () => `${h.count("GRAB:missed")} / 2`,
    hints: [{ afterMs: 15000, text: "Walk away from the Shade as the purple mark pulses. About 120 pixels is safe." }],
  });

  // 9. posture + deathblow
  h.ringAid(true);
  await h.say(I, ["Posture is the real fight. Deflects and heavy blows fill THEIR posture bar. Break it, then finish them with a strike: a deathblow."]);
  await lesson({ title: "DEATHBLOW", text: "Break the Shade's posture, then land the deathblow." }, () => h.shade.loop(["SLASH2", "OVERHEAD"], 2300), () => h.count("deathblow") >= 1, {
    progress: () => (h.count("break") ? "broken: strike it now!" : "fill its posture bar"),
    hints: [
      { afterMs: 22000, text: "Deflect its strikes and riposte: both fill the bar fast." },
      { afterMs: 45000, text: "Heavy blows (K) fill the bar too. When it staggers, hit it." },
    ],
  });

  // 10. kick
  h.ringAid(false);
  await h.say(I, ["A raised shield will turn your sword. Kick it open with E."]);
  await lesson({ title: "KICK", text: "Break the Shade's raised guard with E." }, () => h.shade.guardLoop(3600), () => h.count("kickbreak") >= 1, {
    hints: [{ afterMs: 16000, text: "Stand close while it holds its shield up, then press E." }],
  });

  // 11. heal
  await h.say(I, ["You are hurt. Drink from your gourd with Q. It takes a breath, so find a gap first."]);
  h.player.setHp(0.4);
  h.player.giveHeals(1);
  await lesson({ title: "HEAL", text: "Press Q to heal." }, () => {}, () => h.count("heal") >= 1, { hints: [{ afterMs: 12000, text: "Press Q and stand still until it finishes." }] });
  h.player.fill();

  // 12. shrine and skills
  await h.say(I, ["Take what the dead can give: skill points. Spend them wisely. You will not afford everything."]);
  await h.openShrine();
  if (has("rollcut")) {
    await h.say(I, ["Roll Cut: attack late in a roll to cut out of it."]);
    await lesson({ title: "ROLL CUT", text: "Roll (SHIFT), then press J." }, () => h.shade.loop(["SLASH2"], 2600), () => h.count("rollcut") >= 1, {
      hints: [{ afterMs: 15000, text: "Press SHIFT, then J a moment later while still rolling." }],
    });
  }
  if (has("whirl")) {
    h.player.giveSpirit(3);
    await h.say(I, ["Whirl Cut, L: a spin that hits all around you and breaks a raised guard. It costs 2 spirit. Deflects earn spirit."]);
    await lesson({ title: "WHIRL CUT", text: "Press L next to the Shade." }, () => {}, () => h.count("whirl") >= 1);
  }
  if (has("blades")) {
    h.player.giveSpirit(3);
    await h.say(I, ["Throwing blades, I: a blade from range. It chips posture and nudges a raised guard. It costs 1 spirit."]);
    await lesson({ title: "BLADES", text: "Press I to throw a blade." }, () => {}, () => h.count("blade") >= 1);
  }

  // 13. the test
  await h.say(I, ["Now show me. The Shade will fight in earnest: everything I taught you, one after another. Break it and finish it."]);
  h.ringAid(false);
  h.shade.speed(0.62);
  h.player.fill();
  await lesson({ title: "THE TEST", text: "Defeat the Shade: break its posture and land a deathblow." }, () => h.shade.loop(["SLASH2", "THRUST", "SWEEP", "GRAB", "OVERHEAD", "SLASH2"], 1500), () => h.count("deathblow") >= 1, {
    progress: () => (h.count("break") ? "broken: strike it now!" : "fill its posture bar"),
    hints: [{ afterMs: 60000, text: "Deflect and riposte to fill its posture. Roll the yellow and red marks, step away from the purple." }],
  });

  await h.say(I, [
    "Well danced. The gate stands open.",
    "Go. Past the Hall of Spears, then the Captain, the Stone, and last the Reaper.",
    "And remember: they will learn how YOU dance too.",
  ]);
  await h.finish();
}
