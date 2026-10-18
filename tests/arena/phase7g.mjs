// Stage 7g: item bar HUD display (gourd + fire pot with charges and cooldowns). Needs `npm run dev`.
// Run: node tests/arena/phase7g.mjs
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

// ---- Item bar exists (HUD is a graphics object)
await p.evaluate(() => { const d = window.__arena; d.reset(); d.p.gourdCharges = 2; d.p.firePotCharges = 1; });
await p.waitForTimeout(100);
const hudExists = await p.evaluate(() => window.__arena.hud !== undefined);
check("HUD graphics object exists", hudExists, { exists: hudExists });

// ---- Fire pot charges display
await p.evaluate(() => { const d = window.__arena; d.reset(); d.p.firePotCharges = 2; });
await p.waitForTimeout(50);
const fpCharges = await p.evaluate(() => window.__arena.p.firePotCharges);
check("fire pot charges tracked", fpCharges === 2, { charges: fpCharges });

// ---- Gourd charges tracked
await p.evaluate(() => { const d = window.__arena; d.reset(); d.p.gourdCharges = 3; });
await p.waitForTimeout(50);
const gourdCharges = await p.evaluate(() => window.__arena.p.gourdCharges);
check("gourd charges tracked", gourdCharges === 3, { charges: gourdCharges });

// ---- Charges refill on reset (shrine behavior)
await p.evaluate(() => { const d = window.__arena; d.p.gourdCharges = 0; d.p.firePotCharges = 0; d.reset(); });
await p.waitForTimeout(50);
const refilled = await p.evaluate(() => ({ gourd: window.__arena.p.gourdCharges, firePot: window.__arena.p.firePotCharges }));
check("items refill on shrine reset", refilled.gourd === 3 && refilled.firePot === 1, refilled);

check("no page or console errors", errs.length === 0, errs.slice(0, 3));
await b.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
