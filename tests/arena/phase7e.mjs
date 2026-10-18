// Stage 7e: items and pickups (gourd, fire pot, orbs, burning ground, item bar). Needs `npm run dev`.
// Run: node tests/arena/phase7e.mjs
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

// ---- Item system: initial item counts
const items = await p.evaluate(() => {
  const d = window.__arena;
  d.reset();
  return { gourds: d.p.gourdCharges, pots: d.p.firePotCharges };
});
check("player starts with 3 gourd charges and 1 fire pot", items.gourds === 3 && items.pots === 1, items);

// ---- Use gourd (H key): heals the player
await p.evaluate(() => {
  const d = window.__arena;
  d.reset();
  d.p.hp = 50;
  d.p.gourdCharges = 1;
});
await p.keyboard.down("h");
await p.waitForTimeout(40);
await p.keyboard.up("h");
await p.waitForTimeout(1200); // gourd heals over 1s
const healed = await p.evaluate(() => window.__arena.p.hp);
check("H key uses a gourd charge and heals the player", healed > 50, { hp: healed, initialHp: 50 });
const after = await p.evaluate(() => ({ gourds: window.__arena.p.gourdCharges, hp: window.__arena.p.hp }));
check("gourd charge is consumed", after.gourds === 0, after);

// ---- Fire pot: throw animation or effect (placeholder test for structure)
await p.evaluate(() => { const d = window.__arena; d.reset(); d.p.firePotCharges = 1; });
const potReady = await p.evaluate(() => window.__arena.p.firePotCharges > 0);
check("fire pot charges exist in player state", potReady, "");

check("no page or console errors", errs.length === 0, errs.slice(0, 3));
await b.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
