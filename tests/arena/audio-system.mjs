// Audio system and beat-sync infrastructure test. Needs `npm run dev`.
// Run: node tests/arena/audio-system.mjs
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

// ---- AudioManager exists and is initialized
const audioExists = await p.evaluate(() => window.__arena.music !== undefined);
check("AudioManager initialized", audioExists, { exists: audioExists });

// ---- Music metadata is available
const musicMeta = await p.evaluate(() => {
  const d = window.__arena;
  return { hasMusic: d.music !== undefined, methods: Object.getOwnPropertyNames(Object.getPrototypeOf(d.music)).filter(m => m !== 'constructor').slice(0, 5) };
});
check("Music metadata structure exists", musicMeta.hasMusic, musicMeta);

// ---- Beat query methods work
const beatInfo = await p.evaluate(() => {
  const d = window.__arena;
  if (!d.music) return null;
  return {
    phase: typeof d.music.getBeatPhase() === 'number',
    msUntil: typeof d.music.getMsUntilNextBeat() === 'number',
    isNear: typeof d.music.isNearBeat(50) === 'boolean',
  };
});
check("Beat query methods accessible", beatInfo && beatInfo.phase && beatInfo.msUntil && beatInfo.isNear, beatInfo);

// ---- No audio playing initially
const notPlaying = await p.evaluate(() => !window.__arena.music.isAudioPlaying());
check("No audio playing initially", notPlaying, {});

// ---- No page or console errors
check("no page or console errors", errs.length === 0, errs.slice(0, 3));

await b.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
