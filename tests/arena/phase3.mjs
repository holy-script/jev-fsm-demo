// Needs `npm run dev` running and the arena assets built. Jev is mocked at /api/jev/ask so every path is deterministic.
// Run: node tests/arena/phase3.mjs
import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await b.newContext({ viewport: { width: 1100, height: 640 } });
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push("PAGEERR: " + (e.stack || e.message).split("\n").slice(0, 3).join(" | ")));
p.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errs.push("CONSOLE: " + m.text()));

// ---- the mock
const calls = [];
const mock = { idle: () => ({ choice: "SLASH" }), gate: () => "CONTINUE", delay: 0, status: 200 };
await p.route("**/api/jev/ask", async (route) => {
  const body = JSON.parse(route.request().postData());
  calls.push(body);
  if (mock.delay) await new Promise((r) => setTimeout(r, mock.delay));
  if (mock.status !== 200) return route.fulfill({ status: mock.status, contentType: "application/json", body: JSON.stringify({ error: "boom" }) });
  const q = body.questions, answers = {};
  const choice = (name, pick) => {
    const opts = Object.keys(q[name].criteria);
    answers[name] = { type: "choice", choice: pick, confidence: 0.9, probabilities: Object.fromEntries(opts.map((o) => [o, o === pick ? 0.7 : 0.3 / Math.max(1, opts.length - 1)])) };
  };
  if (q.next_action) { const pick = mock.idle(body); choice("next_action", pick.choice); if (q.taunt) choice("taunt", pick.taunt ?? "NONE"); for (const n of ["turtling", "roll_reliant", "trade_hungry", "panicking"]) if (q[n]) answers[n] = { type: "noul", noul: 0.4 }; }
  if (q.gate_choice) choice("gate_choice", mock.gate(body));
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ answers }) });
});

await p.goto("http://localhost:3000/arena?dev=1&qte=on", { waitUntil: "load" });
await p.waitForFunction(() => window.__arena?.player, null, { timeout: 40000 });
await p.waitForTimeout(600);
const results = [];
const check = (name, cond, info) => { results.push(cond); console.log((cond ? "PASS " : "FAIL ") + name + "  " + JSON.stringify(info)); };
const setup = (boss = "mb", gap = 100, auto = false) => p.evaluate(({ id, g, a }) => {
  const d = window.__arena;
  if (d.boss.id !== id) d.loadBoss(id); else d.reset();
  d.brain.mode = "jev"; d.e.auto = a; if (!a) d.e.thinkAt = 1e12; else d.e.thinkAt = 0;
  d.player.x = 500; d.player.y = 400; d.enemy.x = 500 + g; d.enemy.y = 400;
}, { id: boss, g: gap, a: auto });
const log = () => p.evaluate(() => window.__arena.log.map((l) => ({ ...l })));
const key = async (k, ms = 40) => { await p.keyboard.down(k); await p.waitForTimeout(ms); await p.keyboard.up(k); };
const enemyAttack = (id) => p.evaluate((i) => { const d = window.__arena; d.__t0 = d.now; d.forceEnemyAttack(i); }, id);
const waitSim = (ms) => p.waitForFunction((m) => window.__arena.now - window.__arena.__t0 >= m, ms, { timeout: 8000, polling: "raf" });
const reset = () => { calls.length = 0; mock.idle = () => ({ choice: "SLASH" }); mock.gate = () => "CONTINUE"; mock.delay = 0; mock.status = 200; };

// ---- 1: data validation: every boss move's frame ranges exist in the real sheets
const bad = await p.evaluate(() => {
  const d = window.__arena, sheets = d.manifest.sheets, out = [];
  const bosses = window.__bosses;
  for (const b of Object.values(bosses)) {
    for (const [k, c] of Object.entries(b.clips)) if (!sheets[c.sheet] || c.to >= sheets[c.sheet].frames || c.from >= sheets[c.sheet].frames) out.push(`${b.id}.clips.${k}`);
    for (const a of Object.values(b.attacks)) {
      const s = sheets[a.clip.sheet];
      if (!s || a.clip.to >= s.frames) out.push(`${b.id}.${a.id} clip`);
      for (const h of a.hits) if (h.a > a.clip.to || h.b > s.frames + 5) out.push(`${b.id}.${a.id} hit ${h.a}-${h.b}`);
      if (a.gate && a.gate.afterHit >= a.hits.length) out.push(`${b.id}.${a.id} gate`);
      if (a.perilous && !a.hits.some((h) => h.kind === "perilous")) out.push(`${b.id}.${a.id} perilous flag without a perilous hit`);
    }
  }
  return out;
}).catch(() => ["__bosses not exposed"]);
check("every boss clip and hit window fits its real sheet", bad.length === 0, bad);

// ---- 2: Jev idle decision is executed
reset(); mock.idle = () => ({ choice: "SLASH" });
await setup("mb", 90, true); await p.waitForFunction(() => window.__arena.log.some((l) => l.type === "enemyAttack"), null, { timeout: 8000 });
let L = await log(); const dec = L.find((l) => l.type === "decision" && l.kind === "idle");
check("Jev's pick is executed (decision source jev, SLASH thrown)", dec && dec.source === "jev" && dec.choice === "SLASH" && L.some((l) => l.type === "enemyAttack" && l.id === "SLASH"), { dec });
const q0 = calls.find((c) => c.questions.next_action);
check("question lists only legal options with descriptions, snapshot has the boss and fairness", q0 && "SLASH" in q0.questions.next_action.criteria && "WAIT" in q0.questions.next_action.criteria && /dagger/.test(q0.questions.next_action.criteria.SLASH) && q0.state.boss.name === "Metal Bladekeeper" && q0.state.fairness, { keys: Object.keys(q0?.questions.next_action.criteria ?? {}) });
check("taunt question present for a boss with taunts, reads asked, <= 12 questions", !!q0.questions.taunt && !!q0.questions.turtling && Object.keys(q0.questions).length <= 12, Object.keys(q0.questions));

// ---- 3: out-of-range moves are not offered
reset(); await setup("mb", 190, true); await p.waitForFunction(() => window.__arena.brain.waiting || window.__arena.log.some((l) => l.type === "decision"), null, { timeout: 5000 });
await p.waitForTimeout(300); const far = calls.find((c) => c.questions.next_action);
check("at 190 px SLASH (reach 120) is not offered, APPROACH is", far && !("SLASH" in far.questions.next_action.criteria) && "APPROACH" in far.questions.next_action.criteria, { keys: Object.keys(far?.questions.next_action.criteria ?? {}) });

// ---- 4: Jev picks something not on offer -> fallback
reset(); mock.idle = () => ({ choice: "SHATTER" });
await setup("mb", 90, true); await p.waitForFunction(() => window.__arena.log.some((l) => l.type === "decision"), null, { timeout: 6000 }); L = await log();
check("an unavailable pick falls back to rules (source fallback, error recorded)", L.find((l) => l.type === "decision")?.source === "fallback" && /unavailable/.test(L.find((l) => l.type === "decision")?.error ?? ""), L.find((l) => l.type === "decision"));

// ---- 5: HTTP 500 -> fallback, the boss still fights
reset(); mock.status = 500;
await setup("mb", 90, true); await p.waitForFunction(() => window.__arena.log.some((l) => l.type === "enemyAttack"), null, { timeout: 8000 }); L = await log();
check("Jev error: fallback decision and the boss still attacks", L.find((l) => l.type === "decision")?.source === "fallback" && L.some((l) => l.type === "enemyAttack"), L.find((l) => l.type === "decision"));

// ---- 6: slow Jev -> rules decide after the timeout and the late answer is ignored
reset(); mock.delay = 3200;
await setup("mb", 90, true); await p.waitForFunction(() => window.__arena.log.some((l) => l.type === "decision"), null, { timeout: 7000 }); L = await log(); const to = L.find((l) => l.type === "decision");
await p.waitForTimeout(2500); const L2 = await log();
check("slow Jev: timeout fallback after 1.5 s; the late answer is ignored", to?.source === "fallback" && to.error === "timeout" && L2.filter((l) => l.type === "decision" && l.source === "jev").length === 0, to);

// ---- 7: F toggles to the rules brain and stops calling Jev
reset(); await setup("mb", 90, false); await p.evaluate(() => { window.__arena.e.auto = true; window.__arena.e.thinkAt = 1e12; }); await key("f", 40);
const modeAfter = await p.evaluate(() => window.__arena.brain.mode); calls.length = 0;
await p.evaluate(() => { window.__arena.e.thinkAt = 0; }); await p.waitForFunction(() => window.__arena.log.some((l) => l.type === "decision"), null, { timeout: 5000 }); L = await log();
check("F: rules brain, decision source rules, no Jev call", modeAfter === "rules" && L.find((l) => l.type === "decision")?.source === "rules" && calls.length === 0, { modeAfter, calls: calls.length });

// ---- 8: gates (TWIN: first hit at frame 1, second at frame 4)
const hitTimes = (L) => L.filter((l) => l.type === "enemyHit").map((l) => l.t);
async function gateRun(answer, delay = 0) {
  reset(); mock.gate = () => answer; mock.delay = delay;
  await setup("mb", 100, false); await p.evaluate(() => { window.__arena.p.def.guarding = false; }); await enemyAttack("TWIN"); await p.waitForTimeout(2600); return log();
}
let g = await gateRun("CONTINUE"); const base = hitTimes(g); const baseGap = base[1] - base[0];
check("gate CONTINUE: both hits land", base.length === 2 && g.some((l) => l.type === "gate" && l.choice === "CONTINUE"), { base });
g = await gateRun("DELAY"); const dl = hitTimes(g);
check("gate DELAY: second hit lands >= 300 ms later than the baseline", dl.length === 2 && dl[1] - dl[0] >= baseGap + 300, { baseGap, gap: dl[1] - dl[0] });
g = await gateRun("FEINT"); const fe = await p.evaluate(() => ({ mode: window.__arena.e.mode, feint: window.__arena.e.feinting }));
check("gate FEINT: no second hit, the swing is rewound, boss returns to idle", hitTimes(g).length === 1 && fe.mode === "idle" && !fe.feint, { hits: hitTimes(g), fe });
g = await gateRun("END"); check("gate END: no second hit", hitTimes(g).length === 1, hitTimes(g));
g = await gateRun("CONTINUE", 1200); const gt = g.find((l) => l.type === "gate");
check("slow gate answer: default after 450 ms (timedOut) and the combo continues", gt && gt.timedOut && hitTimes(g).length === 2, gt);
reset(); mock.status = 500; await setup("mb", 100, false); await enemyAttack("TWIN"); await p.waitForTimeout(2200); g = await log();
check("gate error: fallback decision, combo still resolves", g.some((l) => l.type === "decision" && l.kind === "gate" && l.source === "fallback") && hitTimes(g).length >= 1, g.filter((l) => l.type === "decision"));

// ---- 9: the gate question carries the lastOutcome so Jev can react to the first hit
reset(); await setup("mb", 100, false); await p.evaluate(() => { window.__arena.e.thinkAt = 1e12; }); await enemyAttack("TWIN"); await p.waitForTimeout(1500);
const gq = calls.find((c) => c.questions.gate_choice);
check("gate question has the options and lastOutcome", gq && Object.keys(gq.questions.gate_choice.criteria).sort().join() === "CONTINUE,DELAY,END,FEINT" && gq.state.lastOutcome && gq.state.gate.afterHit === 0, { opts: Object.keys(gq?.questions.gate_choice.criteria ?? {}), lo: gq?.state.lastOutcome });

// ---- 10: fairness: never a third perilous in a row
reset(); await setup("mb", 90, false);
const cap = await p.evaluate(() => { const d = window.__arena; d.e.lastActions = ["BLOOM", "BLOOM"]; d.e.cd = {}; return d.availableActions(); });
check("two perilous moves in a row: a third is not offered", !cap.includes("BLOOM") && cap.includes("SLASH"), cap);

// ---- 11: phase 2 announcement
reset(); await setup("mb", 100, false); await p.evaluate(() => { window.__arena.e.hp = 70; }); await p.waitForTimeout(400); L = await log();
check("phase 2 below 50% HP, announced once", L.filter((l) => l.type === "phase2").length === 1, L.filter((l) => l.type === "phase2").length);

// ---- 12: taunts: spoken once, cooldown holds
reset(); mock.idle = () => ({ choice: "WAIT", taunt: "SLOW" });
await setup("mb", 90, true); await p.waitForFunction(() => window.__arena.log.filter((l) => l.type === "decision").length >= 3, null, { timeout: 9000 }); L = await log();
check("taunt chosen by Jev is spoken, then held back by the cooldown", L.filter((l) => l.type === "taunt").length === 1, L.filter((l) => l.type === "taunt"));

// ---- 13: telemetry: the boss sees how the player answered
reset(); await setup("mb", 100, false); await enemyAttack("SLASH"); await waitSim(470); await key("Space", 400); await p.waitForTimeout(500);
const tel = await p.evaluate(() => { const d = window.__arena; return { s: d.telemetry.summary(), h: d.telemetry.habits() }; });
check("telemetry records the deflect, first reaction guard and the guard-tap lead", tel.s.SLASH && tel.s.SLASH.deflected === 1 && tel.s.SLASH.firstReaction.guard === 1 && typeof tel.h.guardTapLeadMs === "number", tel);
await p.evaluate(() => { const d = window.__arena; d.e.auto = true; d.e.thinkAt = 0; d.e.mode = "idle"; d.e.cd = {}; }); calls.length = 0;
await p.waitForFunction(() => window.__arena.brain.waiting || window.__arena.log.some((l) => l.type === "decision"), null, { timeout: 5000 }); await p.waitForTimeout(300);
const sq = calls.find((c) => c.questions.next_action);
check("the snapshot Jev receives includes vsMove and habits", sq && sq.state.vsMove.SLASH?.deflected === 1 && typeof sq.state.habits.guardTapLeadMs === "number", { vs: sq?.state.vsMove, h: sq?.state.habits });

// ---- 14: memory across attempts
reset(); await p.evaluate(() => localStorage.removeItem("arena.memory")); await p.evaluate(() => { window.__arena.memory = {}; });
await setup("mb", 100, false); await p.evaluate(() => (window.__arena.p.hp = 5)); await enemyAttack("SLASH"); await waitSim(900); await p.waitForTimeout(200);
const mem1 = await p.evaluate(() => JSON.parse(localStorage.getItem("arena.memory") || "{}"));
check("dying is remembered (attempts 1, wins 0, SLASH landed once)", mem1.mb && mem1.mb.attempts === 1 && mem1.mb.wins === 0 && mem1.mb.landed.SLASH === 1, mem1);
await setup("mb", 100, true); await p.waitForFunction(() => window.__arena.brain.waiting || window.__arena.log.some((l) => l.type === "decision"), null, { timeout: 6000 }); await p.waitForTimeout(200);
const mq = [...calls].reverse().find((c) => c.questions.next_action);
check("the next fight's snapshot carries the memory", mq && mq.state.memory && mq.state.memory.attempts === 1 && mq.state.memory.movesThatLandedMost.includes("SLASH"), mq?.state.memory);

// ---- 15: Echo reads the profile aggregated over other bosses
reset(); await p.evaluate(() => { window.__arena.memory = { mb: { attempts: 2, wins: 1, landed: { SLASH: 2 }, habits: { rollDirections: { toward: 1, away: 6, sideways: 1 }, guardTapLeadMs: 140, attacksIntoRecovery: 3, attacksIntoWindup: 5 } } }; });
await setup("echo", 90, true); await p.waitForFunction(() => window.__arena.brain.waiting || window.__arena.log.some((l) => l.type === "decision"), null, { timeout: 6000 }); await p.waitForTimeout(200);
const eq = [...calls].reverse().find((c) => c.questions.next_action);
check("Echo is sent snapshot.profile (usual roll away, guard lead 140) and a persona about habits", eq && eq.state.profile && eq.state.profile.usualRoll === "away" && eq.state.profile.averageGuardTapLeadMs === 140 && /mirror/.test(eq.questions.next_action.instructions), eq?.state.profile);

// ---- 16: all four bosses load, move and attack
for (const id of ["cm", "wh", "echo", "mb"]) {
  reset(); mock.idle = () => ({ choice: "WAIT" });
  await setup(id, 90, false);
  const atks = await p.evaluate(() => Object.keys(window.__arena.boss.attacks));
  let ok = true; const seen = [];
  for (const a of atks) {
    await p.evaluate(() => { const d = window.__arena; d.reset(); d.e.auto = false; d.e.thinkAt = 1e12; d.p.hp = 100; d.player.x = 500; d.enemy.x = 590; d.e.cd = {}; });
    await enemyAttack(a); await p.waitForTimeout(2800); const s = await p.evaluate(() => ({ mode: window.__arena.e.mode, hp: window.__arena.p.hp, hits: window.__arena.log.filter((l) => l.type === "enemyHit").length }));
    seen.push(`${a}:${s.mode}/${s.hits}`); if (s.mode !== "idle" || s.hits < 1) ok = false;
  }
  check(`${id}: every attack resolves its hits and returns to idle`, ok, seen);
}

// ---- 17: progression
reset(); await setup("mb", 100, false); await p.evaluate(() => (window.__arena.e.hp = 3)); await key("j", 30); await p.waitForTimeout(800); await key("n", 40); await p.waitForTimeout(400);
const nb = await p.evaluate(() => ({ id: window.__arena.boss.id, hp: window.__arena.e.hp, prefix: window.__arena.enemy.prefix }));
check("victory then N loads the next boss (Crystal Mauler, 800 hp)", nb.id === "cm" && nb.hp === 800 && nb.prefix === "cm", nb);

await p.screenshot({ path: process.env.SHOT || "/tmp/arena_phase3.png" });
check("no page or console errors", errs.length === 0, errs.slice(0, 3));
await b.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
