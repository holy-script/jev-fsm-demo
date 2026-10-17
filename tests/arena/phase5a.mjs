// Input layer: rebinding and gamepad. Needs `npm run dev`. Run: node tests/arena/phase5a.mjs
import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await b.newContext({ viewport: { width: 1100, height: 640 } });
await ctx.addInitScript(() => {
  window.__pad = { id: "fake pad", index: 0, connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  Object.defineProperty(window.__pad, "timestamp", { get: () => performance.now() }); // a real pad's timestamp advances; Phaser ignores stale ones
  navigator.getGamepads = () => [window.__pad, null, null, null];
});
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push("PAGEERR: " + (e.stack || e.message).split("\n").slice(0, 3).join(" | ")));
p.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errs.push("CONSOLE: " + m.text()));
await p.route("**/api/jev/ask", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "off" }) }));
const results = [];
const check = (name, cond, info) => { results.push(cond); console.log((cond ? "PASS " : "FAIL ") + name + "  " + JSON.stringify(info)); };
const boot = async (settings) => {
  await p.goto("http://localhost:3000/arena?dev=1&nocard=1", { waitUntil: "load" });
  if (settings) { await p.evaluate((s) => localStorage.setItem("arena.settings", JSON.stringify(s)), settings); await p.reload({ waitUntil: "load" }); }
  await p.waitForFunction(() => window.__arena?.player, null, { timeout: 40000 });
  await p.waitForTimeout(500);
  await p.evaluate(() => { const d = window.__arena; d.reset(); d.e.auto = false; d.e.thinkAt = 1e12; d.player.x = 400; d.player.y = 400; d.enemy.x = 700; d.enemy.y = 400; });
};
const key = async (k, ms = 40) => { await p.keyboard.down(k); await p.waitForTimeout(ms); await p.keyboard.up(k); };
const log = () => p.evaluate(() => window.__arena.log.map((l) => ({ ...l })));
const pad = (patch) => p.evaluate((pt) => { const g = window.__pad; if (pt.axes) g.axes = pt.axes; for (const [i, v] of Object.entries(pt.buttons ?? {})) g.buttons[i] = { pressed: v, touched: v, value: v ? 1 : 0 }; }, patch);

// ---- defaults
await boot(null);
await key("j", 30); await p.waitForTimeout(150);
check("default J attacks", (await log()).some((l) => l.type === "attack"), "");

// ---- rebinding: attack on H, roll on G, guard on U; the old keys stop working
await boot({ qte: "on", keymap: { up: ["W"], down: ["S"], left: ["A"], right: ["D"], attack: ["H"], guard: ["U"], roll: ["G"], skill: ["E"] } });
await key("j", 30); await p.waitForTimeout(150); let L = await log();
check("after rebinding, the old attack key J does nothing", !L.some((l) => l.type === "attack"), L.length);
await key("h", 30); await p.waitForTimeout(150); L = await log();
check("the new attack key H attacks", L.some((l) => l.type === "attack"), "");
await p.waitForTimeout(900);
await key("u", 60); L = await log();
check("rebound guard key U guards", L.some((l) => l.type === "guard"), "");
await p.waitForTimeout(400);
await key("g", 40); L = await log();
check("rebound roll key G rolls", L.some((l) => l.type === "roll"), "");
const lbl = await p.evaluate(() => window.__arena.inp.label("attack") + window.__arena.inp.label("guard"));
check("prompts read the bound keys (H and U)", lbl === "HU", lbl);

// ---- live settings change (the React settings screen does this): back to defaults without a reload
await p.evaluate(() => { localStorage.setItem("arena.settings", JSON.stringify({ qte: "on" })); window.__game.events.emit("arena:settings"); });
await p.waitForTimeout(200);
await p.evaluate(() => { const d = window.__arena; d.reset(); d.e.auto = false; d.e.thinkAt = 1e12; d.player.x = 400; d.enemy.x = 700; });
await key("j", 30); await p.waitForTimeout(150); L = await log();
check("settings event re-applies the keymap live (J works again)", L.some((l) => l.type === "attack"), "");

// ---- an invalid keymap in storage falls back to defaults per action
await boot({ qte: "on", keymap: { attack: ["NOT_A_KEY"], guard: [] } });
const km = await p.evaluate(() => window.__arena.inp.keymap);
check("garbage keymap entries fall back to the defaults", km.attack[0] === "J" && km.guard[0] === "SPACE" && km.up[0] === "W", km);

// ---- gamepad
await boot(null);
await p.evaluate(() => window.dispatchEvent(Object.assign(new Event("gamepadconnected"), { gamepad: window.__pad })));
await p.waitForTimeout(300);
await pad({ axes: [1, 0, 0, 0] }); await p.waitForTimeout(400); const x1 = await p.evaluate(() => window.__arena.player.x); await pad({ axes: [0, 0, 0, 0] });
check("pad left stick moves the player right", x1 > 410, x1);
await p.waitForTimeout(250); const xs = await p.evaluate(() => window.__arena.player.x);
await pad({ axes: [0.2, 0, 0, 0] }); await p.waitForTimeout(300); const x2 = await p.evaluate(() => window.__arena.player.x); await pad({ axes: [0, 0, 0, 0] });
check("a stick inside the dead zone does not move the player", Math.abs(x2 - xs) < 2, { xs, x2 });
await pad({ buttons: { 14: true } }); await p.waitForTimeout(300); const x3 = await p.evaluate(() => window.__arena.player.x); await pad({ buttons: { 14: false } });
check("pad d-pad left moves the player left", x3 < x1 - 8, { x1, x3 });
await p.evaluate(() => { const d = window.__arena; d.reset(); d.e.auto = false; d.e.thinkAt = 1e12; d.player.x = 400; d.enemy.x = 700; });
await pad({ buttons: { 2: true } }); await p.waitForTimeout(80); await pad({ buttons: { 2: false } }); await p.waitForTimeout(200); L = await log();
check("pad X (button 2) attacks, once per press", L.filter((l) => l.type === "attack").length === 1, L.filter((l) => l.type === "attack").length);
await p.waitForTimeout(900);
await pad({ buttons: { 1: true } }); await p.waitForTimeout(120); const g = await p.evaluate(() => ({ mode: window.__arena.p.mode, guarding: window.__arena.p.def.guarding })); await pad({ buttons: { 1: false } });
check("pad B (button 1) guards while held", g.mode === "guard" && g.guarding, g);
await p.waitForTimeout(300);
await pad({ buttons: { 0: true } }); await p.waitForTimeout(80); await pad({ buttons: { 0: false } }); await p.waitForTimeout(150); L = await log();
check("pad A (button 0) rolls", L.some((l) => l.type === "roll"), "");
await p.waitForTimeout(600);
await p.evaluate(() => { window.__pauseHits = 0; });
await pad({ buttons: { 3: true } }); await p.waitForTimeout(80); await pad({ buttons: { 3: false } });
check("pad Y does nothing without spirit (skill needs 2)", !(await log()).some((l) => l.type === "skill"), "");

check("no page or console errors", errs.length === 0, errs.slice(0, 3));
await b.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
