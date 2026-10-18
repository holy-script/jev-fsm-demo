// Stage 7i: camera effects (shake on hits/parries/deathblows). Needs `npm run dev`.
// Run: node tests/arena/phase7i.mjs
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

// ---- CameraEffects initialized
const camExists = await p.evaluate(() => window.__arena.camera !== undefined);
check("CameraEffects initialized", camExists, { exists: camExists });

// ---- Camera shake and punch methods exist
const camMethods = await p.evaluate(() => {
  const c = window.__arena.camera;
  return { shake: typeof c.shake === 'function', punch: typeof c.punch === 'function', hitShake: typeof c.hitShake === 'function', parryShake: typeof c.parryShake === 'function' };
});
check("Camera methods available", camMethods.shake && camMethods.punch && camMethods.hitShake && camMethods.parryShake, camMethods);

// ---- Shake added to queue
const shakeBefore = await p.evaluate(() => window.__arena.camera.shakes?.length ?? 0);
await p.evaluate(() => window.__arena.camera.shake({ durationMs: 100, intensity: 5 }));
const shakeAfter = await p.evaluate(() => window.__arena.camera.shakes?.length ?? 0);
check("Shake queued", shakeAfter > shakeBefore, { before: shakeBefore, after: shakeAfter });

// ---- Punch added to queue
const punchBefore = await p.evaluate(() => window.__arena.camera.punches?.length ?? 0);
await p.evaluate(() => window.__arena.camera.punch({ durationMs: 100, strength: 0.5, direction: { x: 1, y: 0 } }));
const punchAfter = await p.evaluate(() => window.__arena.camera.punches?.length ?? 0);
check("Punch queued", punchAfter > punchBefore, { before: punchBefore, after: punchAfter });

// ---- Parry shake triggers on deflect
await p.evaluate(() => { const d = window.__arena; d.reset(); d.camera.shakes = []; });
await p.evaluate(() => {
  const d = window.__arena;
  d.e.atk = d.boss.attacks.SLASH;
  d.e.mode = "attack";
  const outcome = { outcome: "deflected", riposte: false };
  d.resolveEnemyHit(d.e.atk, d.e.atk.hits[0], outcome, {});
});
const parryShook = await p.evaluate(() => window.__arena.camera.shakes.length > 0);
check("Parry triggers camera shake", parryShook, { shaked: parryShook });

// ---- No page or console errors
check("no page or console errors", errs.length === 0, errs.slice(0, 3));

await b.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
