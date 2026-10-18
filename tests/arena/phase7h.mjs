// Stage 7h: pickup spawning triggers (phase transition, perfect parry, victory). Needs `npm run dev`.
// Run: node tests/arena/phase7h.mjs
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

// ---- Phase 2 spawns gem pickups
await p.evaluate(() => { const d = window.__arena; d.reset(); d.e.hp = d.boss.phase2.hpPct * d.boss.hp + 1; });
const pickupsBefore = await p.evaluate(() => window.__arena.pickups.pickups.length);
await p.evaluate(() => {
  const d = window.__arena;
  d.e.hp = Math.floor(d.boss.phase2.hpPct * d.boss.hp * 0.5); // drop below 50%
  d.updateEnemy(); // trigger phase 2 check
});
await p.waitForTimeout(50);
const pickupsAfter = await p.evaluate(() => window.__arena.pickups.pickups.length);
check("Phase 2 transition spawns pickups", pickupsAfter > pickupsBefore, { before: pickupsBefore, after: pickupsAfter });

// ---- Perfect parry spawns gem pickup
await p.evaluate(() => { const d = window.__arena; d.reset(); });
const parryPickupsBefore = await p.evaluate(() => window.__arena.pickups.pickups.length);
await p.evaluate(() => {
  const d = window.__arena;
  d.e.atk = d.boss.attacks.SLASH;
  d.e.mode = "attack";
  const outcome = { outcome: "deflected", riposte: false };
  d.resolveEnemyHit(d.e.atk, d.e.atk.hits[0], outcome, {});
});
await p.waitForTimeout(50);
const parryPickupsAfter = await p.evaluate(() => window.__arena.pickups.pickups.length);
check("Perfect parry spawns pickup", parryPickupsAfter > parryPickupsBefore, { before: parryPickupsBefore, after: parryPickupsAfter });

// ---- Victory spawns health + spirit pickups
await p.evaluate(() => { const d = window.__arena; d.reset(); d.e.hp = 1; });
const victoryPickupsBefore = await p.evaluate(() => window.__arena.pickups.pickups.length);
await p.evaluate(() => {
  const d = window.__arena;
  d.e.hp = 0;
  d.e.mode = "dead";
  d.killBoss();
});
await p.waitForTimeout(50);
const victoryPickupsAfter = await p.evaluate(() => window.__arena.pickups.pickups.length);
check("Boss defeat spawns victory pickups", victoryPickupsAfter > victoryPickupsBefore, { before: victoryPickupsBefore, after: victoryPickupsAfter });

// ---- Verify spawnReward method works (multiple pickups with scatter)
const spawnTest = await p.evaluate(() => {
  const d = window.__arena;
  d.reset();
  const before = d.pickups.pickups.length;
  const spawned = d.pickups.spawnReward(500, 400, "gem", d.now, 3);
  const after = d.pickups.pickups.length;
  return { before, spawned: spawned.length, after, allUnique: spawned.every((s, i) => spawned.slice(0, i).every(other => other.x !== s.x || other.y !== s.y)) };
});
check("spawnReward spawns multiple scattered pickups", spawnTest.after === spawnTest.before + 3 && spawnTest.allUnique, spawnTest);

check("no page or console errors", errs.length === 0, errs.slice(0, 3));
await b.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
