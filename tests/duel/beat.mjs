// Needs `npm run dev` running and the duel assets built. Checks the beat-grid choreography: in "beat" mode every boss impact should land on the
// beat grid (or half-beat for syncopated moves); in "classic" mode it should not. Run: node tests/duel/beat.mjs
import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const errs = [];
async function trial(mode, boss, moves, reps) {
  const p = await b.newPage({ viewport: { width: 1200, height: 700 } });
  p.on("pageerror", (e) => errs.push((e.stack || e.message).split("\n").slice(0, 3).join(" | ")));
  await p.addInitScript((m) => localStorage.setItem("duel.settings", JSON.stringify({ beat: m, difficulty: "duelist", music: true, sfx: 0.8 })), mode);
  await p.goto("http://localhost:3000/duel?dev=1", { waitUntil: "load" });
  await p.waitForFunction(() => window.__duel?.player, null, { timeout: 30000 }); await p.waitForTimeout(800);
  const rows = [];
  for (const id of moves) for (let i = 0; i < reps; i++) {
    const r = await p.evaluate(([id, boss]) => new Promise((resolve) => {
      const d = window.__duel; d.reset(boss); d.debugWake(); d.b.auto = false; d.refill(); d.boss.x = d.world.spawns.boss.x; d.boss.y = d.world.spawns.boss.y;
      d.player.x = d.boss.x - 70; d.player.y = d.boss.y; d.b.mode = "idle"; d.b.cd = {}; d.p.invulnUntil = 1e12; d.p.mode = "free";
      const seen = new Set(); const o = d.resolveBossHit.bind(d);
      d.resolveBossHit = (mv, h, idx, now) => { if (!seen.has(idx)) { seen.add(idx); window.__imp.push({ idx, beat: d.sfx.beatPos(), bpm: d.sfx.bpm }); } return o(mv, h, idx, now); };
      window.__imp = []; d.forceMove(id);
      const t0 = performance.now(); const tick = () => { if (d.b.mode !== "attack" || performance.now() - t0 > 6000) { d.resolveBossHit = o; resolve(window.__imp); } else requestAnimationFrame(tick); }; tick();
    }), [id, boss]);
    for (const imp of r) { const f = imp.beat - Math.floor(imp.beat); rows.push({ id, idx: imp.idx, frac: f > 0.5 ? f - 1 : f, bpm: imp.bpm }); }
    await p.waitForTimeout(150);
  }
  await p.close(); return rows;
}
const check = (name, ok, info) => { console.log((ok ? "PASS " : "FAIL ") + name + "  " + JSON.stringify(info)); return ok; };
const stat = (rows) => { const abs = rows.map((r) => Math.min(Math.abs(r.frac), Math.abs(Math.abs(r.frac) - 0.5))); return { n: rows.length, maxOffGrid: Math.max(...abs).toFixed(3), mean: (abs.reduce((a, c) => a + c, 0) / abs.length).toFixed(3) }; };
let ok = true;
const cap = await trial("beat", 0, ["SLASH2", "THRUST", "SWEEP"], 4);
const whole = cap.filter((r) => r.id === "SLASH2" || r.id === "THRUST" || r.id === "SWEEP").map((r) => ({ ...r, frac: Math.abs(r.frac) }));
const sOn = whole.map((r) => Math.min(r.frac, 1 - r.frac)); const maxOn = Math.max(...sOn);
ok = check("beat mode: Captain impacts (slash x2, thrust, sweep) land within 0.12 beat of a whole beat", maxOn < 0.12, { n: whole.length, maxOffBeat: maxOn.toFixed(3), bpm: cap[0].bpm }) && ok;
const ov = await trial("beat", 0, ["OVERHEAD"], 5);
const ovOff = ov.map((r) => Math.min(Math.abs(Math.abs(r.frac) - 0.5), Math.abs(r.frac) < 0.5 ? 9 : 9)); // distance to a half beat
const ovHalf = ov.map((r) => { const f = Math.abs(r.frac); return Math.min(Math.abs(f - 0.5), 1 - Math.abs(f - 0.5) > 0.5 ? 9 : 9); });
const ovGrid = ov.map((r) => { const f = ((r.frac % 0.5) + 0.5) % 0.5; return Math.min(f, 0.5 - f); }); // distance to the 0.5-beat grid
ok = check("beat mode: Overhead snaps to the half-beat grid", Math.max(...ovGrid) < 0.12, { n: ov.length, maxOffGrid: Math.max(...ovGrid).toFixed(3) }) && ok;
const gol = await trial("beat", 1, ["STONE_FIST"], 4);
const gOn = gol.map((r) => { const f = Math.abs(r.frac); return Math.min(f, 1 - f); });
ok = check("beat mode: Golem stone fist lands on the beat (80 BPM)", Math.max(...gOn) < 0.12 && gol[0].bpm === 80, { n: gol.length, max: Math.max(...gOn).toFixed(3), bpm: gol[0].bpm }) && ok;
const cl = await trial("classic", 0, ["SLASH2", "THRUST", "SWEEP"], 4);
const clOn = cl.map((r) => { const f = Math.abs(r.frac); return Math.min(f, 1 - f); });
ok = check("classic mode: impacts are NOT beat-aligned (spread across the beat)", Math.max(...clOn) > 0.2, { n: cl.length, max: Math.max(...clOn).toFixed(3) }) && ok;
console.log(errs.join("\n") || "no page errors"); await b.close(); process.exit(ok ? 0 : 1);
