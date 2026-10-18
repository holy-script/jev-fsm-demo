// Stage 7d: phase-2 boss moves (THROW, TRAP, SHELL, VANISH, LEAP, PHASE_ECHO). Needs `npm run dev`.
// Run: node tests/arena/phase7d.mjs
import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1100, height: 640 } });
const errs = [];
p.on("pageerror", (e) => errs.push("PAGEERR: " + (e.stack || e.message).split("\n").slice(0, 3).join(" | ")));
p.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errs.push("CONSOLE: " + m.text()));
await p.route("**/api/jev/ask", (r) => r.fulfill({ status: 500, contentType: "application/json", body: "{}" }));
await p.goto("http://localhost:3000/arena?dev=1&nocard=1", { waitUntil: "load" });
await p.waitForFunction(() => window.__arena?.player, null, { timeout: 40000 });
await p.waitForTimeout(700);

const results = [];
const check = (name, cond, info) => { results.push(cond); console.log((cond ? "PASS " : "FAIL ") + name + "  " + JSON.stringify(info)); };

// ---- phase 2 moves only when HP is low
for (const boss of ["mb", "cm", "wh"]) {
  const avail1 = await p.evaluate(({ id }) => {
    const d = window.__arena;
    d.loadBoss(id); d.reset();
    d.player.x = 500; d.player.y = 400; d.enemy.x = 650; d.enemy.y = 400;
    d.e.hp = d.boss.hp; d.e.cd = {};
    return d.availableActions();
  }, { id: boss });
  const phase2Attack = { mb: "THROW", cm: "SHELL", wh: "VANISH" }[boss];
  check(`${boss}: phase 2 attacks not available at full HP (${phase2Attack} not in phase 1)`, !avail1.includes(phase2Attack), avail1);

  const avail2 = await p.evaluate(({ id }) => {
    const d = window.__arena;
    d.loadBoss(id); d.reset();
    d.player.x = 500; d.player.y = 400; d.enemy.x = 650; d.enemy.y = 400;
    d.e.hp = Math.ceil(d.boss.hp * 0.45); d.e.cd = {};
    return d.availableActions();
  }, { id: boss });
  check(`${boss}: phase 2 attacks available below 50% HP (${phase2Attack} in phase 2)`, avail2.includes(phase2Attack), avail2);
}

// ---- Bladekeeper phase 2 moves
await p.evaluate(() => {
  const d = window.__arena;
  d.loadBoss("mb"); d.reset();
  d.player.x = 500; d.player.y = 400; d.enemy.x = 650; d.enemy.y = 400;
  d.e.hp = Math.ceil(d.boss.hp * 0.45); d.e.cd = {};
});
const mbActs = await p.evaluate(() => window.__arena.availableActions());
check("Bladekeeper phase 2: THROW and TRAP both available at low HP", mbActs.includes("THROW") && mbActs.includes("TRAP"), mbActs);

// ---- Mauler phase 2 move
await p.evaluate(() => {
  const d = window.__arena;
  d.loadBoss("cm"); d.reset();
  d.player.x = 500; d.player.y = 400; d.enemy.x = 650; d.enemy.y = 400;
  d.e.hp = Math.ceil(d.boss.hp * 0.45); d.e.cd = {};
});
const cmActs = await p.evaluate(() => window.__arena.availableActions());
check("Mauler phase 2: SHELL available at low HP", cmActs.includes("SHELL"), cmActs);

// ---- Hashashin phase 2 moves
await p.evaluate(() => {
  const d = window.__arena;
  d.loadBoss("wh"); d.reset();
  d.player.x = 500; d.player.y = 400; d.enemy.x = 650; d.enemy.y = 400;
  d.e.hp = Math.ceil(d.boss.hp * 0.45); d.e.cd = {};
});
const whActs = await p.evaluate(() => window.__arena.availableActions());
check("Hashashin phase 2: VANISH and LEAP both available at low HP", whActs.includes("VANISH") && whActs.includes("LEAP"), whActs);

// ---- Echo phase 2 move
await p.evaluate(() => {
  const d = window.__arena;
  d.loadBoss("echo"); d.reset();
  d.player.x = 500; d.player.y = 400; d.enemy.x = 650; d.enemy.y = 400;
  d.e.hp = Math.ceil(d.boss.hp * 0.45); d.e.cd = {};
});
const echoActs = await p.evaluate(() => window.__arena.availableActions());
check("Echo phase 2: PHASE_ECHO available at low HP", echoActs.includes("PHASE_ECHO"), echoActs);

// ---- Jev knows about phase 2 moves
const asked = [];
await p.route("**/api/jev/ask", (r) => { asked.push(JSON.parse(r.request().postData())); r.fulfill({ status: 500, contentType: "application/json", body: "{}" }); });
await p.evaluate(() => {
  const d = window.__arena;
  d.loadBoss("mb"); d.reset();
  d.player.x = 500; d.player.y = 400; d.enemy.x = 650; d.enemy.y = 400;
  d.e.hp = Math.ceil(d.boss.hp * 0.45);
  d.e.auto = true; d.e.thinkAt = 0;
  d.brain.mode = "jev";
  d.brain.reset();
});
await p.waitForFunction(() => window.__arena.brain.waiting || window.__arena.log.some((l) => l.type === "decision"), null, { timeout: 6000 }); await p.waitForTimeout(250);
const q = [...asked].reverse().find((a) => a.questions.next_action);
check("Jev is offered phase 2 moves at low HP; THROW has a description", q && q.questions.next_action.criteria.THROW && /projectile|fan|range|distance|close/i.test(q.questions.next_action.criteria.THROW), (q?.questions.next_action.criteria.THROW || "").slice(0, 80));

// ---- speed and cooldown multipliers apply in phase 2
const speedInfo = await p.evaluate(() => {
  const d = window.__arena;
  d.loadBoss("mb"); d.reset();
  const p1Speed = d.boss.speed;
  const p2Speed = d.boss.speed * d.boss.phase2.speed;
  return { phase1: p1Speed, phase2: p2Speed };
});
check("phase 2 increases boss speed", speedInfo.phase2 > speedInfo.phase1, speedInfo);

check("no page or console errors", errs.length === 0, errs.slice(0, 3));
await b.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
