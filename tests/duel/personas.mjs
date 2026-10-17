// Needs `npm run dev` running and the duel assets built (see tools/README.md). Run: node tests/duel/personas.mjs
import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1300, height: 700 } });
const errs = []; p.on("pageerror", e => errs.push("PAGEERR: " + (e.stack || e.message).split("\n").slice(0, 3).join(" | ")));
await p.goto("http://localhost:3000/duel?dev=1", { waitUntil: "load" });
await p.waitForFunction(() => window.__duel?.player, null, { timeout: 30000 }); await p.waitForTimeout(800);
const DUR = Number(process.argv[2] ?? 45000);
const BOSS = Number(process.argv[3] ?? 0); // 0 = Skeleton Captain, 1 = Golem
async function run(name, driver) {
  await p.evaluate((BOSS_IDX) => { const d = window.__duel; d.hud.brain = "JEV"; d.reset(BOSS_IDX); d.debugWake(); d.b.auto = true; d.refill();
    d.boss.x = d.world.spawns.boss.x; d.boss.y = d.world.spawns.boss.y; d.player.x = d.boss.x - 70; d.player.y = d.boss.y;
    window.__dec = []; if (!window.__hooked) { window.__hooked = true; const o = d.hooks.onDecision; d.hooks.onDecision = (x) => { window.__dec.push(x); o(x); }; }
    d.tel.reset(); }, BOSS);
  const t0 = Date.now(); const held = new Set();
  const down = async k => { if (!held.has(k)) { held.add(k); await p.keyboard.down(k); } }; const up = async k => { if (held.has(k)) { held.delete(k); await p.keyboard.up(k); } };
  const tap = async (k, ms = 30) => { await p.keyboard.down(k); await p.waitForTimeout(ms); await p.keyboard.up(k); };
  while (Date.now() - t0 < DUR) {
    const s = await p.evaluate(() => { const d = window.__duel; if (d.p.hp < 55 && d.p.mode !== "dead") d.p.hp = 80; if (d.p.mode === "dead") d.reset();
      d.b.hp = Math.max(d.b.hp, 120); d.b.posture = Math.min(d.b.posture, 55); d.b.seg = 0; if (d.p.mode === "dead") d.reset(d.bossIdx); return { bm: d.b.mode, held: d.b.held, hu: d.b.holdUntil, now: d.time.now, dist: Math.hypot(d.boss.x - d.player.x, d.boss.y - d.player.y), pm: d.p.mode }; });
    await driver({ s, down, up, tap });
    await p.waitForTimeout(25);
  }
  for (const k of [...held]) await up(k);
  const r = await p.evaluate(() => ({ dec: window.__dec, tel: JSON.stringify(window.__duel.tel.summary()), rec: window.__duel.tel.recent(window.__duel.time.now, 8000) }));
  const idle = r.dec.filter(x => x.kind === "idle"), gate = r.dec.filter(x => x.kind === "gate");
  const hist = (arr) => Object.entries(arr.reduce((m, x) => (m[x.choice] = (m[x.choice] ?? 0) + 1, m), {})).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  ");
  const rd = idle.filter(x => x.reads); const avg = k => rd.length ? (rd.slice(-8).reduce((s, x) => s + x.reads[k], 0) / Math.min(8, rd.length)).toFixed(2) : "n/a";
  const lat = r.dec.filter(x => x.source === "jev").map(x => x.latencyMs); const fb = r.dec.filter(x => x.source !== "jev").length;
  console.log(`\n=== ${name}  (${DUR / 1000}s)\n idle choices (${idle.length}): ${hist(idle)}\n gate choices (${gate.length}): ${hist(gate)}\n reads (last 8 avg): turtling ${avg("turtling")}  rollReliant ${avg("rollReliant")}  tradeHungry ${avg("tradeHungry")}  panicking ${avg("panicking")}  predictability ${avg("predictability")}\n latency avg ${Math.round(lat.reduce((a, b) => a + b, 0) / Math.max(1, lat.length))}ms  max ${Math.max(0, ...lat)}ms  fallbacks ${fb}`);
}
// turtle: guard held permanently, step toward the boss when far
await run("TURTLE (holds guard, never attacks)", async ({ s, down, up }) => { await down("Space"); if (s.dist > 70) await down("d"); else await up("d"); });
// roller: rolls out of every boss attack at the end of its telegraph; pokes between attacks
await run("ROLLER (rolls each attack, pokes when safe)", async ({ s, down, up, tap }) => {
  await up("Space"); if (s.dist > 62) await down("d"); else await up("d");
  if (s.bm === "attack" && s.held && s.now >= s.hu - 110) await tap("Shift");
  else if ((s.bm === "recover" || s.bm === "idle") && s.dist < 64) await tap("j");
});
// kiter: hangs back at ~220px, never attacks
await run("KITER (stays at range, never attacks)", async ({ s, down, up }) => { await up("Space"); if (s.dist < 190) { await up("d"); await down("a"); } else if (s.dist > 250) { await up("a"); await down("d"); } else { await up("a"); await up("d"); } });
// greedy: spams attacks, never defends
await run("GREEDY (spams light attacks, never defends)", async ({ s, down, up, tap }) => { await up("Space"); if (s.dist > 58) await down("d"); else await up("d"); if (s.dist < 66) await tap("j", 25); });
console.log(errs.join("\n") || "\nno page errors");
await b.close();
