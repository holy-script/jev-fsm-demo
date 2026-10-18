// Stage 7b: the spacing director (ebb and flow). Needs `npm run dev`. Jev is mocked off; time is fast-forwarded by stepping scene.update.
// Run: node tests/arena/phase7b.mjs
import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1100, height: 640 } });
const errs = [];
p.on("pageerror", (e) => errs.push("PAGEERR: " + (e.stack || e.message).split("\n").slice(0, 3).join(" | ")));
p.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errs.push("CONSOLE: " + m.text()));
const asked = [];
await p.route("**/api/jev/ask", (r) => {
  const body = JSON.parse(r.request().postData()); asked.push(body);
  const q = body.questions, answers = {};
  if (q.next_action) { const o = Object.keys(q.next_action.criteria); answers.next_action = { type: "choice", choice: o.includes("CIRCLE") ? "CIRCLE" : o[0], confidence: 0.9, probabilities: Object.fromEntries(o.map((k) => [k, 1 / o.length])) }; }
  r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ answers }) });
});
await p.goto("http://localhost:3000/arena?dev=1&nocard=1", { waitUntil: "load" });
await p.waitForFunction(() => window.__arena?.player, null, { timeout: 40000 });
await p.waitForTimeout(600);
const results = [];
const check = (name, cond, info) => { results.push(cond); console.log((cond ? "PASS " : "FAIL ") + name + "  " + JSON.stringify(info)); };

/** Fast-forward `secs` of a boss against a passive, invulnerable player (rules brain) and describe the movement. */
const dance = (boss, secs = 45) => p.evaluate(async ({ boss, secs }) => {
  const d = window.__arena;
  d.popup = () => {}; d.shake = () => {}; d.vfx.play = () => null; d.sfx = new Proxy({}, { get: () => () => {}, has: () => true });
  // a seeded generator (mulberry32) for the length of the run, so the stance timings are the same every time
  const realRandom = Math.random; let seed = 12345;
  Math.random = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  d.loadBoss(boss); d.reset(); d.brain.mode = "rules"; d.e.auto = true; d.e.thinkAt = 600; d.player.x = 330; d.enemy.x = 620;
  d.p.hp = 1e9; d.p.invulnUntil = 1e12; d.botFrame = () => ({});
  let frames = 0, stances = 0, last = d.e.stance, crowd = 0, idle = 0, rev = 0, peaks = 0, inFar = false, minD = 1e9, maxD = 0;
  const sp = { ...{ disengage: 240 }, ...(d.boss.spacing ?? {}) };
  const seen = new Set();
  while (frames < 60 * secs) {
    d.update(0, 1000 / 60); frames++;
    const dist = Math.abs(d.enemy.x - d.player.x);
    if (d.e.stance !== last) { stances++; last = d.e.stance; }
    seen.add(d.e.stance);
    if (d.e.mode === "idle") { idle++; if (dist < 70) crowd++; }
    if (d.enemy.anim.reversed) rev++;
    if (dist >= sp.disengage - 45 && !inFar) { peaks++; inFar = true; }
    if (dist < sp.disengage - 90) inFar = false;
    minD = Math.min(minD, dist); maxD = Math.max(maxD, dist);
    if (frames % 6 === 0) await Promise.resolve();
  }
  d.botFrame = null;
  Math.random = realRandom;
  const acts = {}; for (const l of d.log) if (l.type === "decision" && l.kind === "idle") acts[l.choice] = (acts[l.choice] ?? 0) + 1;
  return { stances, stanceKinds: [...seen].sort().join("+"), peaks, crowdPct: Math.round((100 * crowd) / Math.max(1, idle)), revSecs: rev / 60, minD: Math.round(minD), maxD: Math.round(maxD), acts };
}, { boss, secs });

const res = {};
for (const boss of ["mb", "cm", "wh", "echo"]) res[boss] = await dance(boss);
for (const boss of ["mb", "cm", "wh", "echo"]) {
  const r = res[boss];
  check(`${boss}: it switches between engage and disengage (at least 6 changes in 45 s)`, r.stances >= 6 && r.stanceKinds === "disengage+engage", { stances: r.stances, kinds: r.stanceKinds });
  check(`${boss}: it opens the gap at least 3 times (ebb and flow, not glued to the player)`, r.peaks >= 3 && r.maxD >= 170, { peaks: r.peaks, maxD: r.maxD });
  check(`${boss}: it crowds the player (under 70 px) less than 12% of its idle time`, r.crowdPct < 12, { crowdPct: r.crowdPct, minD: r.minD });
  check(`${boss}: it backs away facing the player (run cycle played in reverse for 2+ s)`, r.revSecs >= 2, r.revSecs.toFixed(1));
}
check("the Hashashin dances faster than the Mauler (more stance changes in the same time)", res.wh.stances > res.cm.stances, { wh: res.wh.stances, cm: res.cm.stances });
check("RETREAT and CIRCLE are chosen by the rules bot as real actions", ["mb", "wh"].every((k) => (res[k].acts.RETREAT ?? 0) + (res[k].acts.CIRCLE ?? 0) >= 3), { mb: res.mb.acts, wh: res.wh.acts });

// ---- what is on offer in each stance
await p.evaluate(() => { const d = window.__arena; d.botFrame = null; d.loadBoss("mb"); d.reset(); d.e.auto = false; d.e.thinkAt = 1e12; d.player.x = 400; d.enemy.x = 650; });
const offer = (stance, gap) => p.evaluate(({ stance, gap }) => { const d = window.__arena; d.e.stance = stance; d.enemy.x = d.player.x + gap; d.e.cd = {}; return d.availableActions(); }, { stance, gap });
let o = await offer("engage", 260);
check("engaged and far: APPROACH is offered", o.includes("APPROACH"), o);
o = await offer("disengage", 260);
check("disengaged: no APPROACH (the boss stays out until the stance ends), CIRCLE and WAIT offered", !o.includes("APPROACH") && o.includes("CIRCLE") && o.includes("WAIT"), o);
o = await offer("disengage", 120);
check("disengaged and crowded: RETREAT is offered", o.includes("RETREAT"), o);
o = await offer("engage", 130);
check("engaged and fairly close: RETREAT is offered as a deliberate choice too", o.includes("RETREAT"), o);

// ---- decisions change the stance
const sw = await p.evaluate(() => {
  const d = window.__arena; const mk = (c) => ({ kind: "idle", label: c, choice: c, latencyMs: 0, source: "rules" });
  d.e.stance = "engage"; d.applyDecision(mk("RETREAT")); const a = d.e.stance; d.e.action = null;
  d.applyDecision(mk("APPROACH")); const b2 = d.e.stance;
  return { afterRetreat: a, afterApproach: b2 };
});
check("choosing RETREAT starts a disengage; choosing APPROACH while disengaged re-engages", sw.afterRetreat === "disengage" && sw.afterApproach === "engage", sw);

// ---- a boss that is chased turns away (personal space while disengaged)
const chase = await p.evaluate(async () => {
  const d = window.__arena; d.e.action = null; d.e.mode = "idle"; d.e.auto = true; d.e.thinkAt = 1e12; d.e.stance = "disengage"; d.e.stanceUntil = d.now + 1e9;
  d.player.x = 500; d.enemy.x = 560; d.player.y = d.enemy.y = 400; d.botFrame = () => ({});
  const d0 = Math.abs(d.enemy.x - d.player.x);
  for (let i = 0; i < 90; i++) { d.update(0, 1000 / 60); if (i % 6 === 0) await Promise.resolve(); }
  d.botFrame = null; return { d0, d1: Math.round(Math.abs(d.enemy.x - d.player.x)) };
});
check("disengaged with the player 60 px away: the boss opens the gap to about 220 px in 1.5 s", chase.d1 >= 200, chase);

// ---- Jev is told about the rhythm
await p.evaluate(() => { const d = window.__arena; d.loadBoss("mb"); d.reset(); d.brain.mode = "jev"; d.brain.reset(); d.e.auto = true; d.e.thinkAt = 0; d.player.x = 400; d.enemy.x = 580; });
await p.waitForFunction(() => window.__arena.brain.waiting || window.__arena.log.some((l) => l.type === "decision"), null, { timeout: 6000 }); await p.waitForTimeout(300);
const q = [...asked].reverse().find((a) => a.questions.next_action);
check("the snapshot has a spacing block (stance, seconds, preferred distance, trend)", q && q.state.spacing && ["engage", "disengage"].includes(q.state.spacing.stance) && typeof q.state.spacing.preferredPx === "number" && ["closing", "holding", "opening"].includes(q.state.spacing.trend), q && q.state.spacing);
check("Jev's rules text explains the rhythm; CIRCLE and RETREAT have descriptions", q && /RHYTHM/.test(q.questions.next_action.instructions) && /Strafe around/.test(q.questions.next_action.criteria.CIRCLE ?? "x") , Object.keys(q?.questions.next_action.criteria ?? {}));

check("no page or console errors", errs.length === 0, errs.slice(0, 3));
await b.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
