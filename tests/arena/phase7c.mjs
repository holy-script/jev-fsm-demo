// Stage 7c: fire skills (Ember Bolt, Inferno Ring), the projectile system, the skill bar. Needs `npm run dev`. Jev mocked off.
// Run: node tests/arena/phase7c.mjs
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
await p.route("**/api/jev/ask", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "off" }) }));
await p.goto("http://localhost:3000/arena?dev=1&nocard=1&qte=on", { waitUntil: "load" });
await p.waitForFunction(() => window.__arena?.player, null, { timeout: 40000 });
await p.waitForTimeout(700);
const results = [];
const check = (name, cond, info) => { results.push(cond); console.log((cond ? "PASS " : "FAIL ") + name + "  " + JSON.stringify(info)); };
const setup = (boss = "mb", gap = 300, spirit = 0, perks = []) => p.evaluate(({ id, g, sp, pk }) => {
  const d = window.__arena;
  d.run = { slot: 9, bossIndex: 0, cleared: [], deaths: 0, playMs: 0, finished: false, perks: pk, updated: 0 };
  if (d.boss.id !== id) d.loadBoss(id); else d.reset();
  d.e.auto = false; d.e.thinkAt = 1e12; d.player.x = 400; d.player.y = 400; d.enemy.x = 400 + g; d.enemy.y = 400; d.p.spirit = sp;
}, { id: boss, g: gap, sp: spirit, pk: perks });
const key = async (k, ms = 40) => { await p.keyboard.down(k); await p.waitForTimeout(ms); await p.keyboard.up(k); };
const log = () => p.evaluate(() => window.__arena.log.map((l) => ({ ...l })));
const st = () => p.evaluate(() => { const d = window.__arena; return { mode: d.p.mode, spirit: d.p.spirit, hp: d.p.hp, eposture: Math.round(d.e.posture), ehp: d.e.hp, projs: d.projs.list.length, spawned: d.projs.spawned }; });
const spawnEnemyProj = (o = {}) => p.evaluate((o) => { const d = window.__arena; return !!d.spawnProjectile({ id: "ORB", owner: "enemy", look: "orb", x: d.player.x + 260, y: d.player.y, vx: -300, vy: 0, dmg: 12, posture: 14, radius: 14, life: 3000, ...o }); }, o);
const padBtn = (i, v) => p.evaluate(({ i, v }) => { window.__pad.buttons[i] = { pressed: v, touched: v, value: v ? 1 : 0 }; }, { i, v });

// ---------------------------------------------------------------- Ember Bolt
await setup("mb", 300, 0); await key("q", 40); await p.waitForTimeout(400);
check("Ember Bolt needs spirit (nothing happens at 0)", (await st()).spawned === 0, await st());
await setup("mb", 300, 2); await key("q", 40); await p.waitForTimeout(80);
check("Ember Bolt costs 1 spirit and puts casting in motion", (await st()).spirit === 1 && (await st()).mode === "cast", await st());
await p.waitForTimeout(150);
check("the bolt is released after about 150 ms and is in flight", (await st()).projs === 1, await st());
const vx = await p.evaluate(() => window.__arena.projs.list[0]?.vx);
check("it flies toward the boss at 560 px/s", vx === 560, vx);
await p.waitForTimeout(900);
let L = await log(); const bh = L.find((l) => l.type === "playerHit" && l.id === "BOLT");
check("it hits the boss for 10 damage and 16 x0.4 posture, then is gone", bh && bh.dmg === 10 && (await st()).projs === 0, { bh, projs: (await st()).projs });
check("the hit earns the usual spirit (+0.25)", Math.abs((await st()).spirit - 1.25) < 0.01, (await st()).spirit);
await setup("mb", 300, 3); await key("q", 30); await p.waitForTimeout(60); await key("q", 30); await p.waitForTimeout(150);
check("Ember Bolt has a cooldown (a second press 90 ms later does nothing)", (await st()).spirit === 2, (await st()).spirit);
await setup("mb", 300, 2); await key("i", 30); await p.waitForTimeout(120); await key("q", 30); await p.waitForTimeout(100);
const air = await st();
check("thrown from the air: no wind-up, no lock (still in the air mode) and the bolt flies", air.mode === "air" && air.projs === 1, air);
await p.waitForTimeout(1000);
await p.evaluate(() => window.dispatchEvent(Object.assign(new Event("gamepadconnected"), { gamepad: window.__pad }))); await p.waitForTimeout(250);
await setup("mb", 300, 2); await padBtn(6, true); await p.waitForTimeout(80); await padBtn(6, false); await p.waitForTimeout(100);
check("pad LT throws an Ember Bolt", (await st()).spirit === 1, (await st()).spirit);

// ---------------------------------------------------------------- Inferno Ring
await setup("mb", 120, 2); await key("r", 40); await p.waitForTimeout(500);
check("Inferno Ring needs 3 spirit", (await log()).filter((l) => l.type === "nova").length === 0 && (await st()).spirit === 2, await st());
await setup("mb", 120, 3); await key("r", 40); await p.waitForTimeout(120);
const inv = await p.evaluate(() => ({ grace: window.__arena.p.invulnUntil > window.__arena.now, mode: window.__arena.p.mode, spirit: window.__arena.p.spirit }));
check("the ring spends 3 spirit and the knight is invulnerable during the cast", inv.grace && inv.mode === "cast" && inv.spirit === 0, inv);
await p.waitForTimeout(500); L = await log();
const nh = L.find((l) => l.type === "playerHit" && l.id === "NOVA"), nv = L.find((l) => l.type === "nova");
check("the blast hits a boss inside the ring for 22 damage", nh && nh.dmg === 22 && nv && nv.hit === true, { nh, nv });
check("the knight is free again after the cast", (await st()).mode === "free", (await st()).mode);
await setup("mb", 330, 3); await key("r", 40); await p.waitForTimeout(700);
check("a boss outside the ring (330 px) is not hit", (await log()).find((l) => l.type === "nova")?.hit === false, (await log()).find((l) => l.type === "nova"));
await setup("mb", 120, 3); await p.evaluate(() => { const d = window.__arena; d.__t0 = d.now; d.forceEnemyAttack("TWIN"); });
await p.waitForTimeout(250); await key("r", 40); await p.waitForTimeout(700);
check("the blast interrupts the boss's attack and the knight takes no damage", (await st()).hp === 100 && (await p.evaluate(() => window.__arena.e.atk)) === null, await st());
await setup("mb", 200, 3); await spawnEnemyProj({ x: 520, y: 400, vx: 0 }); await spawnEnemyProj({ x: 700, y: 400, vx: 0 });
await key("r", 40); await p.waitForTimeout(450);
check("the ring destroys enemy projectiles inside it (one near, one far survives)", (await log()).find((l) => l.type === "nova")?.cleared === 1 && (await st()).projs === 1, await st());
await p.waitForTimeout(300);
await setup("mb", 300, 3); await padBtn(8, true); await p.waitForTimeout(80); await padBtn(8, false); await p.waitForTimeout(150);
check("pad Back casts the Inferno Ring", (await st()).spirit === 0, (await st()).spirit);
await p.waitForTimeout(600);

// ---------------------------------------------------------------- kindled perk
await setup("mb", 300, 1, ["kindled"]); await key("e", 30); await p.waitForTimeout(200);
check("Kindled Blade: Flame Burst costs 1 (was 2)", (await log()).some((l) => l.type === "skill" && l.id === "FLAME") && (await st()).spirit === 0, await st());
await p.waitForTimeout(1200);
await setup("mb", 120, 2, ["kindled"]); await key("r", 40); await p.waitForTimeout(150);
check("Kindled Blade: Inferno Ring costs 2 (was 3)", (await log()).some((l) => l.type === "skill" && l.id === "NOVA") && (await st()).spirit === 0, await st());
await p.waitForTimeout(700);
check("the perk lowers the skill bar's displayed cost too", (await p.evaluate(() => window.__arena.slots.map((s) => s.cost.text).join())) === "1,1,2", await p.evaluate(() => window.__arena.slots.map((s) => s.cost.text).join()));

// ---------------------------------------------------------------- enemy projectiles (the system the boss moves will use)
await setup("mb", 400, 0); await spawnEnemyProj(); await p.waitForTimeout(1100);
check("an enemy projectile hits a standing player (12 damage)", (await st()).hp === 88, await st());
await setup("mb", 400, 0); await spawnEnemyProj(); await p.waitForTimeout(250); await p.keyboard.down("k"); await p.waitForTimeout(900); await p.keyboard.up("k");
L = await log();
check("held guard blocks it for chip damage", L.some((l) => l.type === "enemyHit" && l.id === "ORB" && l.outcome === "blocked") && (await st()).hp === 99 && (await st()).projs === 0, { hp: (await st()).hp });
await setup("mb", 400, 0); await p.evaluate(() => { const d = window.__arena; d.spawnProjectile({ id: "ORB", owner: "enemy", look: "orb", x: d.player.x + 190, y: d.player.y, vx: -300, vy: 0, dmg: 12, posture: 14, radius: 14, life: 3000 }); });
// the guard press is injected inside the simulation when the orb is 70 px away (a 127 ms lead: inside the 160 ms window), so there is no browser latency in the timing
await p.evaluate(() => { const d = window.__arena; let pressed = false; d.botFrame = () => { const pr = d.projs.list[0]; if (!pr) return pressed ? { guardHeld: true } : {}; if (!pressed && pr.x - d.player.x < 70) { pressed = true; return { guard: true, guardHeld: true }; } return { guardHeld: pressed }; }; });
await p.waitForTimeout(700); await p.evaluate(() => { window.__arena.botFrame = null; });
const refl = await p.evaluate(() => ({ owner: window.__arena.projs.list[0]?.owner, reflected: window.__arena.projs.list[0]?.reflected, vx: window.__arena.projs.list[0]?.vx }));
check("a perfect deflect REFLECTS an enemy projectile (it now belongs to the player and flies back faster)", refl.owner === "player" && refl.reflected && refl.vx > 300, refl);
await p.waitForTimeout(1500);
L = await log(); const rh = L.find((l) => l.type === "playerHit" && l.id === "REFLECT");
check("the reflected projectile hits the boss for more damage than it carried (12 x1.6 + 4 = 23)", rh && rh.dmg === 23, rh);
await setup("mb", 400, 0); await spawnEnemyProj({ x: 600 }); await p.waitForFunction(() => { const pr = window.__arena.projs.list[0]; return pr && pr.x - window.__arena.player.x < 90; }, null, { polling: "raf", timeout: 3000 }); await key("l", 30); await p.waitForTimeout(500);
check("a roll's i-frames let it pass through", (await st()).hp === 100, await st());
await setup("mb", 400, 0); await spawnEnemyProj({ x: 600 }); await p.waitForFunction(() => { const pr = window.__arena.projs.list[0]; return pr && pr.x - window.__arena.player.x < 125; }, null, { polling: "raf", timeout: 3000 }); await key("i", 30); await p.waitForTimeout(900);
check("a jump clears an enemy projectile (it flies under the knight)", (await st()).hp === 100, await st());
await setup("mb", 400, 0); await spawnEnemyProj({ x: 3000, vx: 0, life: 200 }); await p.waitForTimeout(500);
check("projectiles expire (no leak after their life ends)", (await st()).projs === 0, await st());

// ---------------------------------------------------------------- skill bar
const bar = await p.evaluate(() => window.__arena.slots.map((s) => ({ a: s.action, key: s.key.text, cost: s.cost.text })));
check("the skill bar shows three slots with their keys and costs", bar.length === 3 && bar.map((x) => x.key).join() === "E,Q,R" && bar.map((x) => x.cost).join() === "2,1,3", bar);
await setup("mb", 300, 0); await p.waitForTimeout(150);
const dim0 = await p.evaluate(() => window.__arena.slots.map((s) => s.icon.alpha));
await p.evaluate(() => { window.__arena.p.spirit = 5; }); await p.waitForTimeout(150);
const dim1 = await p.evaluate(() => window.__arena.slots.map((s) => s.icon.alpha));
check("slots are dimmed while the spirit cannot pay and lit when it can", dim0.every((a) => a < 0.5) && dim1.every((a) => a === 1), { dim0, dim1 });
await p.evaluate(() => { const d = window.__arena; d.settings.keymap.bolt = ["Y"]; d.inp.setKeymap(d.settings.keymap); }); await p.waitForTimeout(150);
check("the bar shows rebound keys", (await p.evaluate(() => window.__arena.slots[1].key.text)) === "Y", await p.evaluate(() => window.__arena.slots[1].key.text));
await p.evaluate(() => { const d = window.__arena; d.settings.keymap.bolt = ["Q"]; d.inp.setKeymap(d.settings.keymap); });

// ---------------------------------------------------------------- housekeeping
await setup("mb", 300, 3); await key("q", 30); await p.waitForTimeout(100);
const n0 = await p.evaluate(() => window.__arena.children.length);
await p.evaluate(() => window.__arena.reset()); await p.waitForTimeout(300);
check("a reset removes projectiles in flight", (await st()).projs === 0, await st());
check("no page or console errors", errs.length === 0, errs.slice(0, 3));
await b.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
