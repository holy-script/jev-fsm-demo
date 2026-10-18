// Quick items smoke test: fire pot creates burning ground, gourd heals
import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1100, height: 640 } });
await p.route("**/api/jev/ask", (r) => r.fulfill({ status: 500, body: "{}" }));
await p.goto("http://localhost:3000/arena?dev=1&nocard=1", { waitUntil: "load" });
await p.waitForFunction(() => window.__arena?.player, null, { timeout: 40000 });
await p.waitForTimeout(700);

const check = (name, cond) => console.log((cond ? "✓" : "✗") + " " + name);

// Fire pot spawns burning ground
await p.evaluate(() => { const d = window.__arena; d.reset(); d.p.firePotCharges = 1; });
await p.keyboard.press("g");
await p.waitForTimeout(100);
const hazards = await p.evaluate(() => window.__arena.pickups.hazards.length);
check("Fire pot creates burning ground hazard", hazards > 0);

// Gourd heals
await p.evaluate(() => { const d = window.__arena; d.reset(); d.p.hp = 50; d.p.gourdCharges = 1; });
await p.keyboard.press("h");
await p.waitForTimeout(200);
const hpAfter = await p.evaluate(() => window.__arena.p.hp);
check("Gourd heals player", hpAfter > 50);

await b.close();
