// Stage 7j: weather particle effects (rain, dust based on area atmosphere). Needs `npm run dev`.
// Run: node tests/arena/phase7j.mjs
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

// ---- WeatherEmitter exists and is wired
const weatherExists = await p.evaluate(() => window.__arena.weather !== undefined);
check("Weather emitter initialized", weatherExists, { exists: weatherExists });

// ---- Weather type matches area atmosphere
const weatherType = await p.evaluate(() => {
  const d = window.__arena;
  const areaAtmos = window.__areas[d.boss.area]?.atmosphere;
  return {
    kind: d.weather?.kind,
    hasRain: d.weather?.kind === "rain",
    areaHasRain: areaAtmos?.rain ?? false
  };
});
check("Weather type matches area", weatherType.hasRain === weatherType.areaHasRain, weatherType);

// ---- Particles spawn and update
await p.evaluate(() => { const d = window.__arena; d.weather?.update(d.now); });
await p.waitForTimeout(100);
const particleCount = await p.evaluate(() => window.__arena.weather?.getParticles?.()?.length ?? 0);
check("Particles spawning", particleCount > 0, { count: particleCount });

// ---- Particle properties (position, velocity, life)
const particleProps = await p.evaluate(() => {
  const particles = window.__arena.weather?.getParticles?.() ?? [];
  if (particles.length === 0) return null;
  const p = particles[0];
  return {
    hasX: typeof p.x === 'number',
    hasY: typeof p.y === 'number',
    hasVx: typeof p.vx === 'number',
    hasVy: typeof p.vy === 'number',
    hasLife: typeof p.life === 'number',
    hasAlpha: typeof p.getAlpha === 'function'
  };
});
check("Particles have correct properties", particleProps && Object.values(particleProps).every(v => v), particleProps);

// ---- Weather clears on area change
const particlesBefore = await p.evaluate(() => window.__arena.weather?.getParticles?.()?.length ?? 0);
await p.evaluate(() => window.__arena.loadBoss(["mb", "cm", "wh", "echo"].find(id => id !== window.__arena.boss.id)));
await p.waitForTimeout(50);
const particlesAfter = await p.evaluate(() => window.__arena.weather?.getParticles?.()?.length ?? 0);
check("Weather particles clear on area change", particlesAfter === 0 || particlesAfter < particlesBefore, { before: particlesBefore, after: particlesAfter });

check("no page or console errors", errs.length === 0, errs.slice(0, 3));
await b.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
