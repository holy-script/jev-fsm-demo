// Needs `npm run dev` running and the duel assets built. Checks the Jev v2 additions: habits, memory, fairness cap, taunts. Run: node tests/duel/jev2.mjs
import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1300, height: 700 } });
const errs = []; p.on("pageerror", (e) => errs.push("PAGEERR: " + (e.stack || e.message).split("\n").slice(0, 3).join(" | ")));
const reqs = []; let tauntId = "T_ROLL";
await p.route("**/api/jev/ask", async (route) => {
  const body = JSON.parse(route.request().postData()); reqs.push(body); const q = body.questions;
  const pr = (c, ks) => Object.fromEntries(ks.map((k) => [k, k === c ? 0.8 : 0.2 / Math.max(1, ks.length - 1)]));
  const answers = {};
  if (q.next_action) { const ks = Object.keys(q.next_action.criteria); const c = ks.includes("SCYTHE") ? "SCYTHE" : ks[0]; answers.next_action = { type: "choice", choice: c, confidence: 0.8, probabilities: pr(c, ks) }; }
  if (q.taunt) answers.taunt = { type: "choice", choice: tauntId, confidence: 0.9, probabilities: pr(tauntId, Object.keys(q.taunt.criteria)) };
  if (q.gate_choice) { const ks = Object.keys(q.gate_choice.criteria); answers.gate_choice = { type: "choice", choice: ks[0], confidence: 0.8, probabilities: pr(ks[0], ks) }; }
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ answers }) });
});
await p.addInitScript(() => { localStorage.setItem("duel.settings", JSON.stringify({ beat: "classic", difficulty: "duelist", music: true, sfx: 0.8 })); localStorage.setItem("duel.save", JSON.stringify({ cleared: [], deaths: 0, skills: [], points: 0, tutorialDone: true, seen: [], memory: {} })); });
await p.goto("http://localhost:3000/duel?dev=1", { waitUntil: "load" });
await p.waitForFunction(() => window.__duel?.player, null, { timeout: 30000 }); await p.waitForTimeout(800);
const results = []; const check = (n, c, i) => { results.push(c); console.log((c ? "PASS " : "FAIL ") + n + "  " + JSON.stringify(i)); };
const setup = (boss, dx = 70) => p.evaluate(([boss, dx]) => { const d = window.__duel; d.hud.brain = "JEV"; d.reset(d.idxOf(boss)); d.debugWake(); d.b.auto = false; d.refill(); d.boss.x = d.world.spawns.boss.x; d.boss.y = d.world.spawns.boss.y;
  d.player.x = d.boss.x - dx; d.player.y = d.boss.y; d.b.mode = "idle"; d.b.nextThink = 1e12; d.b.cd = {}; d.p.mode = "free"; d.p.hp = 100; }, [boss, dx]);

// --- fairness governor
await setup("bringer", 70);
const gov = await p.evaluate(() => { const d = window.__duel; const out = {}; d.b.history = ["SCYTHE"]; out.none = d.availableActions(d.time.now).includes("REAP"); d.b.history = ["REAP", "APPROACH", "DARK_PILLARS"]; out.capped = !d.availableActions(d.time.now).includes("REAP") && !d.availableActions(d.time.now).includes("DARK_PILLARS"); out.stillBlockable = d.availableActions(d.time.now).includes("SCYTHE"); d.b.history = ["REAP", "SCYTHE", "REAP"]; out.reset = d.availableActions(d.time.now).includes("REAP"); return out; });
check("fairness: two unblockables in a row remove the unblockable moves from the menu, a blockable one resets it", gov.none && gov.capped && gov.stillBlockable && gov.reset, gov);

// --- habits
await p.evaluate(() => { const d = window.__duel; d.tel.reset(); d.b.mode = "attack"; d.p.mode = "free"; d.startRoll(d.time.now, 1, 0, true); d.p.mode = "free"; d.startRoll(d.time.now, -1, 0, true); d.p.mode = "free"; d.b.mode = "recover"; d.startMove(d.time.now, "A", "attack"); d.p.mode = "free"; d.p.lastGuardPress = d.time.now - 120; d.b.mode = "attack"; d.startHeal(d.time.now); d.p.mode = "free"; d.hurtPlayer({ frames: [0, 0], type: "normal", damage: 10, posture: 10, deflectPosture: 5, shape: { kind: "circle", range: 0 } }, "deflect", d.time.now); });
const hab = await p.evaluate(() => window.__duel.snapshot(window.__duel.time.now).habits);
check("habits: roll directions, guard-tap lead, risky heals and punishing swings are measured", hab.rollDirections?.toward === 1 && hab.rollDirections?.away === 1 && hab.guardTapLeadMs >= 100 && hab.healsDuringBossAttack === 1 && hab.attacksIntoRecovery === 1, hab);

// --- memory
await p.evaluate(() => { const d = window.__duel; d.tel.reset(); d.tel.outcome("SCYTHE", "hit"); d.tel.outcome("SCYTHE", "hit"); d.tel.outcome("REAP", "hit"); d.tel.rollDir(1); d.tel.rollDir(1); d.tel.rollDir(1); d.tel.rollDir(1); d.tel.deflectLead(150); d.tel.deflectLead(150); d.tel.deflectLead(150); d.remember(false); });
const mem = await p.evaluate(() => ({ snap: window.__duel.snapshot(window.__duel.time.now).memory, saved: JSON.parse(localStorage.getItem("duel.save")).memory.bringer }));
check("memory: a lost attempt is saved and fed to Jev (top moves, usual roll, guard-tap lead)", mem.snap?.attempts === 1 && mem.snap.movesThatLandedMost[0] === "SCYTHE" && mem.snap.usualRoll === "toward" && mem.snap.usualGuardTapLeadMs === 150 && mem.saved.hitBy.SCYTHE === 2, mem);
await p.evaluate(() => { window.__duel.reset(window.__duel.idxOf("bringer")); });
const mem2 = await p.evaluate(() => window.__duel.snapshot(window.__duel.time.now).memory?.attempts);
check("memory survives a restart of the fight", mem2 === 1, { mem2 });

// --- taunts
await setup("bringer", 70); reqs.length = 0;
await p.evaluate(() => { const d = window.__duel; d.b.auto = true; d.b.nextThink = 0; d.b.nextAsk = 0; d.b.mode = "idle"; });
await p.waitForFunction(() => window.__duel.tauntText, null, { timeout: 15000, polling: 100 }).catch(() => {});
const shown = await p.evaluate(() => window.__duel.tauntText?.text ?? null);
const idleReq = reqs.find((r) => r.questions.next_action);
check("taunts: Jev is offered the authored lines and silence, and its pick is spoken", !!idleReq?.questions.taunt && "NONE" in idleReq.questions.taunt.criteria && shown === "You roll like a leaf. I am the wind.", { shown, offered: Object.keys(idleReq?.questions.taunt?.criteria ?? {}) });
check("the request carries habits and fairness state", idleReq?.state?.habits !== undefined && idleReq?.state?.fairness !== undefined, Object.keys(idleReq?.state ?? {}));
const cd = await p.evaluate(() => { const d = window.__duel; d.speak("T_GUARD", d.time.now); return d.tauntText?.text; });
check("a taunt cooldown keeps the boss from speaking again straight away", cd === "You roll like a leaf. I am the wind.", { cd });

// --- rhythm
const rh = await p.evaluate(() => { const d = window.__duel; d.reset(d.idxOf("bringer")); d.beatMode = () => true; d.sfx.beatPos = () => 0.3; const mv = d.def.moves.SCYTHE; const bm = d.beatMs();
  const f = (r) => d.planHolds(mv, d.time.now, r)[0];
  return { bm, on: f("ON_BEAT"), off: f("OFF_BEAT"), quick: f("QUICK"), slow: f("SLOW") }; });
const dOff = ((rh.off - rh.on) % rh.bm + rh.bm) % rh.bm;
check("rhythm: OFF_BEAT lands half a beat after ON_BEAT, SLOW a beat later, QUICK no later", Math.abs(dOff - rh.bm / 2) < 8 && Math.abs(rh.slow - rh.on - rh.bm) < 8 && rh.quick <= rh.on + 1, rh);
check("the idle request offers the rhythm question with all four timings", JSON.stringify(Object.keys(reqs.find((r) => r.questions.next_action)?.questions.rhythm?.criteria ?? {})) === JSON.stringify(["ON_BEAT", "OFF_BEAT", "QUICK", "SLOW"]), {});

// --- run records for the stats screen
const runs = await p.evaluate(() => { const d = window.__duel; d.reset(d.idxOf("bringer")); d.tel.attackStart("SCYTHE", 0, 50); d.tel.outcome("SCYTHE", "hit"); d.tel.attackStart("SCYTHE", 0, 50); d.tel.outcome("SCYTHE", "deflected"); d.hud.brain = "RULES"; d.remember(true); return JSON.parse(localStorage.getItem("duel.save")).runs.slice(-1)[0]; });
check("a finished boss fight is recorded with its brain and how the player fared", runs.brain === "RULES" && runs.won === true && runs.thrown === 2 && runs.hit === 1 && runs.deflected === 1, runs);

// --- fixes from play-testing
// an out-of-reach pick: close in first, then strike
await setup("bringer", 260);
const intent = await p.evaluate(() => { const d = window.__duel; d.b.auto = true; d.b.cd = {}; const now = d.time.now; d.b.decision = { kind: "idle", label: "", choice: "SCYTHE", latencyMs: 0, source: "jev", at: now }; d.takeDecision(now);
  const first = { mode: d.b.mode, kind: d.b.moveKind, intent: d.b.intent?.id }; d.player.x = d.boss.x - 70; d.player.y = d.boss.y; d.setB("idle"); d.takeDecision(d.time.now); return { first, after: d.b.move?.id, mode: d.b.mode }; });
check("a move Jev picked but that is out of reach: the boss closes in and then uses that move", intent.first.mode === "move" && intent.first.intent === "SCYTHE" && intent.after === "SCYTHE" && intent.mode === "attack", intent);
// a break by any route fills the bar and holds it full
await setup("captain", 70);
const brk = await p.evaluate(async () => { const d = window.__duel; d.b.auto = false; d.b.posture = 96; d.b.hp = 50; d.b.mode = "idle"; d.b.nextThink = 1e12; d.b.posture = 100; await new Promise((r) => setTimeout(r, 400)); const full = d.hud.bossPosture;
  d.reset(d.idxOf("captain")); d.debugWake(); d.b.auto = false; d.boss.x = d.world.spawns.boss.x; d.b.hp = 0; d.b.mode = "idle"; d.b.posture = 40; d.breakBoss(d.time.now, 5000); await new Promise((r) => setTimeout(r, 300)); return { fullAfterPosture: full, hpBreakBar: d.hud.bossPosture, post: d.b.posture, mode: d.b.mode }; });
check("posture that reaches full breaks the boss at once, and an HP break also shows a full bar", brk.fullAfterPosture === 1 && brk.hpBreakBar === 1 && brk.post === 100 && brk.mode === "broken", brk);
// watchdog
await setup("captain", 70);
const wd = await p.evaluate(async () => { const d = window.__duel; d.b.auto = true; d.hud.brain = "RULES"; d.setB("recover", 1e9); d.b.since = d.time.now - 7000; await new Promise((r) => setTimeout(r, 500)); return { mode: d.b.mode, until: Math.round(d.b.until - d.time.now) }; });
check("watchdog: a boss stuck in a state for too long is freed", wd.until < 5000 && wd.until > -5000, wd);
// rules brain via the real F key
await setup("captain", 90);
const rb = await p.evaluate(() => { const d = window.__duel; d.b.auto = true; d.hud.brain = "JEV"; d.b.cd = {}; d.b.mode = "idle"; d.b.nextAsk = 0; d.b.decision = null; d.b.asking = false; d.b.last = ""; return true; });
await p.keyboard.press("f"); await p.waitForTimeout(100);
const brainAfter = await p.evaluate(() => window.__duel.hud.brain);
await p.waitForFunction(() => window.__duel.b.mode === "attack" || window.__duel.b.mode === "move", null, { timeout: 8000 }).catch(() => {});
const acted = await p.evaluate(() => ({ mode: window.__duel.b.mode, last: window.__duel.hud.last, brain: window.__duel.hud.brain }));
check("the F key switches to the rules brain and the boss acts on it", brainAfter === "RULES" && (acted.mode === "attack" || acted.mode === "move") && acted.last.startsWith("RULES"), { brainAfter, ...acted });

console.log(errs.join("\n") || "no page errors"); console.log(`${results.filter(Boolean).length}/${results.length} passed`); await b.close();
