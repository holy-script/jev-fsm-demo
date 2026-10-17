// Needs `npm run dev` running and the duel assets built (see tools/README.md). Run: node tests/duel/jev-gates.mjs
import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1300, height: 700 } });
const errs = []; p.on("pageerror", e => errs.push("PAGEERR: " + (e.stack || e.message).split("\n").slice(0, 3).join(" | ")));
const cfg = { idle: "WAIT", g1: "CONTINUE", g2: "END", mode: "ok", delayMs: 0, calls: 0 };
await p.route("**/api/jev/ask", async (route) => {
  cfg.calls++;
  const body = JSON.parse(route.request().postData());
  if (cfg.delayMs) await new Promise(r => setTimeout(r, cfg.delayMs));
  if (cfg.mode === "error") return route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "mock failure" }) });
  const q = body.questions;
  const probs = (c, keys) => Object.fromEntries(keys.map(k => [k, k === c ? 0.8 : 0.2 / Math.max(1, keys.length - 1)]));
  let answers;
  if (q.next_action) {
    const keys = Object.keys(q.next_action.criteria);
    answers = { next_action: { type: "choice", choice: cfg.idle, confidence: 0.8, probabilities: probs(cfg.idle, keys) },
      turtling: { type: "noul", noul: 0.71 }, roll_reliant: { type: "noul", noul: 0.12 }, trade_hungry: { type: "noul", noul: 0.4 }, panicking: { type: "noul", noul: 0.05 }, predictability: { type: "score", score: 1.5 } };
  } else {
    const step = body.state.gate.step; const c = step === 1 ? cfg.g1 : cfg.g2; const keys = Object.keys(q.gate_choice.criteria);
    answers = { gate_choice: { type: "choice", choice: c, confidence: 0.8, probabilities: probs(c, keys) } };
  }
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ answers }) });
});
await p.goto("http://localhost:3000/duel?dev=1", { waitUntil: "load" });
await p.waitForFunction(() => window.__duel?.player, null, { timeout: 30000 }); await p.waitForTimeout(800);
const results = []; const check = (n, c, i) => { results.push(c); console.log((c ? "PASS " : "FAIL ") + n + "  " + JSON.stringify(i)); };
const setup = async (dx = 55) => { cfg.calls = 0; await p.evaluate((dx) => { const d = window.__duel; d.hud.brain = "JEV"; d.reset(); d.debugWake(); d.b.auto = true; d.refill();
  d.boss.x = d.world.spawns.boss.x; d.boss.y = d.world.spawns.boss.y; d.player.x = d.boss.x - dx; d.player.y = d.boss.y; d.b.mode = "recover"; d.b.until = d.time.now + 200; d.b.nextAsk = 0;
  d.player.sprite.anims.timeScale = 1; d.p.invulnUntil = 0; d.b.cd = {};
  window.__hits = []; window.__seq = [];
  if (!window.__wrapped) { window.__wrapped = true; const o = d.resolveBossHit.bind(d); d.resolveBossHit = (mv, h, i, now) => { const before = d.b.hit[i]; o(mv, h, i, now); if (!before && d.b.hit[i]) window.__hits.push({ mv: mv.id, i, t: Math.round(now) }); };
    const ob = d.setB.bind(d); d.setB = (m, u) => { window.__seq.push({ m, t: Math.round(d.time.now), mv: d.b.move?.id }); return ob(m, u); }; } }, dx); };
const wait = (fn, ms = 6000) => p.waitForFunction(fn, null, { timeout: ms, polling: 100 }).then(() => true, () => false);
const st = () => p.evaluate(() => ({ mode: window.__duel.b.mode, move: window.__duel.b.move?.id, php: Math.round(window.__duel.p.hp), hits: window.__hits, seq: window.__seq.map(s => s.m + ":" + (s.mv ?? "")).join(",") }));

// idle gate -> action
cfg.idle = "SLASH2"; cfg.g1 = "CONTINUE"; cfg.g2 = "END"; await setup();
check("idle decision SLASH2 starts the slash combo", await wait(() => window.__duel.b.move?.id === "SLASH2" && window.__duel.b.mode === "attack"), await st());
await p.waitForTimeout(3500); let s = await st();
check("default path: both slashes resolve", s.hits.length >= 2, s);

// feint
cfg.g1 = "FEINT"; await setup(); await wait(() => window.__duel.b.mode === "guard" && window.__duel.b.move?.id === "SLASH2"); await p.waitForTimeout(1500); s = await st();
check("gate FEINT: boss cancels into guard, second slash never lands", !s.hits.some(h => h.mv === "SLASH2" && h.i === 1) && s.seq.includes("guard:SLASH2"), s);

// end
cfg.g1 = "END"; await setup(); await p.waitForTimeout(3500); s = await st();
check("gate END: combo stops after the first slash", s.hits.some(h => h.mv === "SLASH2" && h.i === 0) && !s.hits.some(h => h.mv === "SLASH2" && h.i === 1), s);

// delay vs continue duration
const dur = async (g1) => { cfg.g1 = g1; cfg.g2 = "END"; await setup(); await wait(() => window.__duel.b.mode === "attack"); const t0 = await p.evaluate(() => window.__duel.time.now);
  await wait(() => window.__duel.b.mode !== "attack" || window.__duel.b.move?.id !== "SLASH2", 8000); return (await p.evaluate(() => window.__duel.time.now)) - t0; };
const dCont = await dur("CONTINUE"); const dDelay = await dur("DELAY");
check("gate DELAY makes the combo take ~360ms longer", dDelay - dCont > 200, { dCont: Math.round(dCont), dDelay: Math.round(dDelay) });

// chain at end
cfg.g1 = "CONTINUE"; cfg.g2 = "THRUST"; await setup();
check("end gate THRUST chains into the perilous thrust", await wait(() => window.__duel.b.move?.id === "THRUST", 8000), await st());
cfg.g1 = "GRAB"; await setup();
check("mid gate GRAB switches into a grab", await wait(() => window.__duel.b.move?.id === "GRAB", 6000), await st());

// failures
cfg.mode = "error"; cfg.idle = "SLASH2"; await setup();
check("Jev error: fallback acts (boss still attacks)", await wait(() => window.__duel.b.mode === "attack" || window.__duel.b.mode === "move", 4000), await st());
const fb = await p.evaluate(() => window.__duel.hud.last); check("fallback is labelled in the HUD", /FALLBACK/.test(fb), { fb });
cfg.mode = "ok"; cfg.delayMs = 3200; await setup();
check("slow Jev (3.2s): boss does not freeze, times out to rules", await wait(() => window.__duel.b.mode !== "idle" && window.__duel.b.mode !== "recover", 4500), await st());
cfg.delayMs = 0;
cfg.idle = "GRAB"; await setup(130);
const fb2 = await wait(() => /FALLBACK/.test(window.__duel.hud.last), 4000);
check("unavailable action from Jev (GRAB out of reach) falls back", fb2, { last: await p.evaluate(() => window.__duel.hud.last) });

// brain toggle
cfg.idle = "WAIT"; await setup(); await p.waitForTimeout(600); await p.keyboard.press("f"); const c0 = cfg.calls; await p.waitForTimeout(2500);
check("F switches to RULES: no more Jev calls", cfg.calls === c0 && (await p.evaluate(() => window.__duel.hud.brain)) === "RULES", { c0, calls: cfg.calls });
await p.keyboard.press("f");

// sidebar shows reads
await setup(); await p.waitForTimeout(1500);
await p.keyboard.press("Tab"); await p.waitForTimeout(300); const txt = await p.locator("body").innerText();
check("sidebar shows Jev's reads and decision log", /turtling/.test(txt) && /71%/.test(txt), {});
console.log(errs.join("\n") || "no page errors"); console.log(`${results.filter(Boolean).length}/${results.length} passed`);
await b.close();
