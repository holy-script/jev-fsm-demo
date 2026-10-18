// Stage 7a: jump, air attack, dash, sweeps, jump counter, afterimages, new bindings. Needs `npm run dev`. Jev is mocked off.
// Run: node tests/arena/phase7a.mjs
import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await b.newContext({ viewport: { width: 1100, height: 640 } });
await ctx.addInitScript(() => {
  window.__pad = { id: "fake pad", index: 0, connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  Object.defineProperty(window.__pad, "timestamp", { get: () => performance.now() });
  navigator.getGamepads = () => [window.__pad, null, null, null];
});
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push("PAGEERR: " + (e.stack || e.message).split("\n").slice(0, 3).join(" | ")));
p.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errs.push("CONSOLE: " + m.text()));
const asked = [];
await p.route("**/api/jev/ask", (r) => { asked.push(JSON.parse(r.request().postData())); r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "off" }) }); });
await p.goto("http://localhost:3000/arena?dev=1&nocard=1&qte=on", { waitUntil: "load" });
await p.waitForFunction(() => window.__arena?.player, null, { timeout: 40000 });
await p.waitForTimeout(700);

const results = [];
const check = (name, cond, info) => { results.push(cond); console.log((cond ? "PASS " : "FAIL ") + name + "  " + JSON.stringify(info)); };
const setup = (boss = "mb", gap = 100) => p.evaluate(({ id, g }) => {
  const d = window.__arena;
  if (d.boss.id !== id) d.loadBoss(id); else d.reset();
  d.e.auto = false; d.e.thinkAt = 1e12; d.player.x = 500; d.player.y = 400; d.enemy.x = 500 + g; d.enemy.y = 400;
}, { id: boss, g: gap });
const key = async (k, ms = 40) => { await p.keyboard.down(k); await p.waitForTimeout(ms); await p.keyboard.up(k); };
const log = () => p.evaluate(() => window.__arena.log.map((l) => ({ ...l })));
const enemyAttack = (id) => p.evaluate((i) => { const d = window.__arena; d.__t0 = d.now; d.forceEnemyAttack(i); }, id);
const waitStrike = (lead) => p.waitForFunction((l) => window.__arena.e.strikeAt - window.__arena.now <= l, lead, { timeout: 8000, polling: "raf" });
const waitSim = (ms) => p.waitForFunction((m) => window.__arena.now - window.__arena.__t0 >= m, ms, { timeout: 8000, polling: "raf" });
const st = () => p.evaluate(() => { const d = window.__arena; return { mode: d.p.mode, z: Math.round(d.player.z), x: Math.round(d.player.x), hp: d.p.hp, spirit: d.p.spirit, eposture: Math.round(d.e.posture), ehp: d.e.hp, ghosts: d.player.ghosts }; });
const outcome = (L, i = 0) => L.filter((l) => l.type === "enemyHit")[i]?.outcome;
const padBtn = (i, v) => p.evaluate(({ i, v }) => { window.__pad.buttons[i] = { pressed: v, touched: v, value: v ? 1 : 0 }; }, { i, v });

// ---------------------------------------------------------------- bindings
const km = await p.evaluate(() => window.__arena.inp.keymap);
check("new actions have default keys (jump I, dash U, bolt Q, nova R, item H, pot G)", km.jump[0] === "I" && km.dash[0] === "U" && km.bolt[0] === "Q" && km.nova[0] === "R" && km.item[0] === "H" && km.pot[0] === "G", { jump: km.jump, dash: km.dash });

// ---------------------------------------------------------------- jump
await setup("mb", 300); await key("i", 30); await p.waitForTimeout(220);
let s = await st();
const lifted = await p.evaluate(() => window.__arena.player.sprite.y < window.__arena.player.y - 30);
check("jump: the knight rises (air mode, z > 40) and the sprite lifts above its ground point", s.mode === "air" && s.z > 40 && lifted, s);
await p.waitForTimeout(900); s = await st();
check("jump: lands back at z 0 and returns to free", s.z === 0 && (s.mode === "free" || s.mode === "land"), s);
await p.waitForTimeout(250);
await setup("mb", 300); await key("i", 30); await p.waitForTimeout(40); await key("i", 30); await p.waitForTimeout(100);
check("no double jump in the air", (await log()).filter((l) => l.type === "jump").length === 1, "");

// ---------------------------------------------------------------- air attack
await setup("mb", 100); await key("i", 30); await p.waitForTimeout(60); await key("j", 30); await p.waitForTimeout(600);
let L = await log();
const ah = L.find((l) => l.type === "playerHit" && l.id === "AIR");
check("air attack: J while airborne dives forward and hits for 12", L.some((l) => l.type === "attack" && l.id === "AIR") && ah && ah.dmg === 12, ah);
await p.waitForTimeout(700); s = await st();
check("after an air attack the knight lands and is free again (no stuck state)", s.mode === "free" && s.z === 0, s);

// ---------------------------------------------------------------- sweeps (Mauler SHATTER, range 60 to 330)
const sweepRun = async (how) => {
  await setup("cm", 150); await enemyAttack("SHATTER");
  if (how === "stand") await waitSim(1600);
  if (how === "roll") { await waitStrike(110); await key("Shift", 40); await p.waitForTimeout(800); }
  if (how === "guard") { await p.keyboard.down("Space"); await waitSim(1700); await p.keyboard.up("Space"); }
  if (how === "jump") { await waitStrike(260); await key("i", 30); await p.waitForTimeout(900); }
  return { L: await log(), s: await st() };
};
let r = await sweepRun("stand");
check("sweep: standing still takes the hit (28 x0.62 = 17)", outcome(r.L) === "hit" && r.s.hp === 83, { out: outcome(r.L), hp: r.s.hp });
r = await sweepRun("roll");
check("sweep: rolling does NOT protect (roll i-frames do not cover a sweep)", outcome(r.L) === "hit", { out: outcome(r.L), hp: r.s.hp });
r = await sweepRun("guard");
check("sweep: guarding does not block it", outcome(r.L) === "hit", { out: outcome(r.L) });
r = await sweepRun("jump");
check("sweep: a jump clears it (LEAP): no damage, +1 spirit", outcome(r.L) === "leapt" && r.s.hp === 100 && r.s.spirit >= 1, { out: outcome(r.L), hp: r.s.hp, spirit: r.s.spirit });

// jump counter: leap, then strike from the air straight away
await setup("cm", 150); await enemyAttack("SHATTER"); await waitStrike(260); await key("i", 30);
await p.waitForFunction(() => window.__arena.log.some((l) => l.outcome === "leapt"), null, { timeout: 3000, polling: "raf" });
await key("j", 30); await p.waitForTimeout(700); L = await log();
const jc = L.find((l) => l.type === "playerHit" && l.id === "AIR");
s = await st();
check("jump counter: an air attack right after the leap deals 12 x1.6 = 19 and 35 posture", jc && jc.dmg === 19 && s.eposture >= 34, { jc, eposture: s.eposture });
check("jump counter rewinds the boss's swing (it is thrown into recoil)", L.some((l) => l.type === "playerHit" && l.id === "AIR") && (await p.evaluate(() => window.__arena.e.reversedAttack)) === "SHATTER", await p.evaluate(() => window.__arena.e.reversedAttack));
await setup("cm", 150); await enemyAttack("SHATTER"); await waitStrike(260); await key("i", 30); await p.waitForTimeout(1500); await key("i", 30); await p.waitForTimeout(150); await key("j", 30); await p.waitForTimeout(500);
const late = (await log()).find((l) => l.type === "playerHit" && l.id === "AIR");
check("an air attack long after the leap gets no jump-counter bonus", !late || late.dmg === 12, late);

// ---------------------------------------------------------------- the sweep in Bladekeeper's FLURRY (third hit)
await setup("mb", 100); await p.evaluate(() => { const d = window.__arena; window.__gate = d.brain.gate; d.brain.gate = (b, atk, g) => Promise.resolve({ kind: "gate", label: "test", choice: g.default, latencyMs: 0, source: "rules" }); }); // the combo always continues
await enemyAttack("FLURRY"); await waitSim(3500); await p.evaluate(() => { window.__arena.brain.gate = window.__gate; }); L = await log();
const fh = L.filter((l) => l.type === "enemyHit").map((l) => l.outcome);
check("FLURRY ends in a sweep that cannot be blocked: the finisher lands on a standing player", fh.length === 3 && fh[2] === "hit", fh);

// ---------------------------------------------------------------- dash
await setup("mb", 300); await p.keyboard.down("d"); await key("u", 30); await p.waitForTimeout(320); await p.keyboard.up("d"); s = await st();
check("dash with a direction held: about 150 px that way in under 0.3 s", s.x >= 500 + 120 && s.x <= 500 + 175, s);
await p.waitForTimeout(300);
await setup("mb", 300); await key("u", 30); await p.waitForTimeout(350); s = await st();
const dd = (await log()).find((l) => l.type === "dash");
check("dash with no direction backs away from the enemy, playing the run cycle in reverse", s.x <= 500 - 110 && dd && dd.back === true, { x: s.x, dd });
await setup("mb", 300); await key("u", 30); await p.waitForTimeout(260); await key("u", 30); await p.waitForTimeout(100);
check("dash has a cooldown (a second press 260 ms later does nothing)", (await log()).filter((l) => l.type === "dash").length === 1, "");
await setup("mb", 300); await key("u", 30); await p.waitForTimeout(40);
const iOn = await p.evaluate(() => window.__arena.p.def.rolling); await p.waitForTimeout(200);
const iOff = await p.evaluate(() => window.__arena.p.def.rolling);
check("dash i-frames: invulnerable for the first 90 ms only", iOn === true && iOff === false, { iOn, iOff });
await setup("mb", 100); await enemyAttack("SLASH"); await waitStrike(70); await key("u", 30); await p.waitForTimeout(500);
check("dashing at the strike avoids a normal hit (dodged inside the i-frames or out of reach)", ["dodged", "missed"].includes(outcome(await log())) && (await st()).hp === 100, outcome(await log()));

// ---------------------------------------------------------------- afterimages
await setup("mb", 300); const g0 = (await st()).ghosts; const n0 = await p.evaluate(() => window.__arena.children.length);
await key("u", 30); await p.waitForTimeout(280); const g1 = (await st()).ghosts;
check("dash leaves afterimages (at least 4 ghost frames)", g1 - g0 >= 4, { g0, g1 });
await p.waitForTimeout(900); const n1 = await p.evaluate(() => window.__arena.children.length);
check("afterimages clean themselves up (display list back to its size)", Math.abs(n1 - n0) <= 3, { n0, n1 });
await setup("mb", 300); const r0 = (await st()).ghosts; await key("l", 30); await p.waitForTimeout(300);
check("a roll leaves afterimages too", (await st()).ghosts - r0 >= 3, (await st()).ghosts - r0);
await setup("mb", 100); const a0 = (await st()).ghosts; await key("j", 30); await p.waitForTimeout(250);
check("an attack's lunge leaves a short afterimage trail", (await st()).ghosts - a0 >= 1, (await st()).ghosts - a0);

// ---------------------------------------------------------------- gamepad and rebinding
await p.evaluate(() => window.dispatchEvent(Object.assign(new Event("gamepadconnected"), { gamepad: window.__pad }))); await p.waitForTimeout(300);
await setup("mb", 300); await padBtn(5, true); await p.waitForTimeout(80); await padBtn(5, false); await p.waitForTimeout(150);
check("pad RB jumps", (await st()).mode === "air", (await st()).mode);
await p.waitForTimeout(900);
await setup("mb", 300); await padBtn(7, true); await p.waitForTimeout(80); await padBtn(7, false); await p.waitForTimeout(150);
check("pad RT dashes", (await log()).some((l) => l.type === "dash"), "");
await p.waitForTimeout(400);
await p.evaluate(() => { const d = window.__arena; d.settings.keymap.jump = ["Y"]; d.inp.setKeymap(d.settings.keymap); });
await setup("mb", 300); await key("i", 30); await p.waitForTimeout(100);
check("rebinding jump: the old key stops working", !(await log()).some((l) => l.type === "jump"), "");
await key("y", 30); await p.waitForTimeout(100);
check("rebinding jump: the new key jumps", (await log()).some((l) => l.type === "jump"), "");
await p.waitForTimeout(900);
await p.evaluate(() => { const d = window.__arena; d.settings.keymap.jump = ["I"]; d.inp.setKeymap(d.settings.keymap); });

// ---------------------------------------------------------------- dev keys moved to the F row
await setup("mb", 100); await key("F2", 40); await p.waitForTimeout(150);
check("dev key F2 forces the boss's SLASH (the dev keys moved to the F row)", (await log()).some((l) => l.type === "enemyAttack" && l.id === "SLASH"), "");

// ---------------------------------------------------------------- Jev is told about sweeps and jumping
await setup("mb", 100); await p.evaluate(() => { const d = window.__arena; d.e.auto = true; d.e.thinkAt = 0; d.brain.mode = "jev"; d.brain.reset(); });
await p.waitForFunction(() => window.__arena.brain.waiting || window.__arena.log.some((l) => l.type === "decision"), null, { timeout: 6000 }); await p.waitForTimeout(250);
const q = [...asked].reverse().find((a) => a.questions.next_action);
check("Jev's rules text explains sweeps and jumping; the snapshot says whether the player is airborne", q && /SWEEP/.test(q.questions.next_action.instructions) && /JUMP/.test(q.questions.next_action.instructions) && typeof q.state.player.airborne === "boolean", q && q.state.player);
check("the FLURRY option tells Jev it ends in a jumpable sweep", q && /SWEEP/.test(q.questions.next_action.criteria.FLURRY ?? ""), (q?.questions.next_action.criteria.FLURRY ?? "").slice(0, 60));

check("no page or console errors", errs.length === 0, errs.slice(0, 3));
await b.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
