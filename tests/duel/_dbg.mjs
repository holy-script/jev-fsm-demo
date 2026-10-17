import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--use-gl=swiftshader","--enable-unsafe-swiftshader","--ignore-gpu-blocklist"] });
async function run(brain, boss) {
  const p = await b.newPage({ viewport: { width: 1000, height: 560 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => { if (m.type() === "error") errs.push("C:" + m.text().slice(0, 120)); });
  await p.addInitScript(() => localStorage.setItem("duel.settings", JSON.stringify({ beat: "beat", difficulty: "duelist", music: false, sfx: 0 })));
  await p.goto("http://localhost:3000/duel?dev=1"); await p.waitForFunction(() => window.__duel?.player); await p.waitForTimeout(600);
  await p.evaluate(([brain, boss]) => { const d = window.__duel; d.reset(d.idxOf(boss)); d.hud.brain = brain; d.debugWake(); d.refill(); d.b.auto = true; d.p.hp = 9999; window.__stuck = []; let lastMode = "", since = 0;
    setInterval(() => { const n = d.time.now; if (d.b.mode !== lastMode) { lastMode = d.b.mode; since = n; } else if (n - since > 7000 && !window.__stuck.length) window.__stuck.push({ mode: d.b.mode, held: d.b.held, asking: d.b.asking, decision: !!d.b.decision, move: d.b.move?.id, nextAsk: Math.round(d.b.nextAsk - n), until: Math.round(d.b.until - n), holdIdx: d.b.holdIdx, hud: d.hud.last }); }, 200); }, [brain, boss]);
  await p.waitForTimeout(45000);
  const r = await p.evaluate(() => ({ hist: window.__duel.b.history.slice(-40).join(" "), stuck: window.__stuck, mode: window.__duel.b.mode, hudlast: window.__duel.hud.last, all: window.__duel.tel.summary() }));
  await p.close();
  const counts = {}; for (const m of r.hist.split(" ")) counts[m] = (counts[m] ?? 0) + 1;
  console.log(brain, boss, "actions:", JSON.stringify(counts), "stuck:", JSON.stringify(r.stuck), "last:", r.hudlast, errs.slice(0,3));
}
await Promise.all([run("RULES", "bringer"), run("JEV", "bringer")]);
await b.close();
