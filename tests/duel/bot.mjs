// Balance harness: a scripted player of three skill levels fights each boss (rules brain, classic or beat timing) and reports win rate, time and damage.
// Needs `npm run dev` running. Run: node tests/duel/bot.mjs [boss,boss] [trials] [timing=classic|beat]      e.g.  node tests/duel/bot.mjs captain,golem,bringer 2 beat
import { chromium } from "playwright";
const bosses = (process.argv[2] ?? "captain,golem,bringer").split(",");
const trials = +(process.argv[3] ?? 2);
const timing = process.argv[4] ?? "classic";
const LEVELS = { novice: { acc: 0.4, jit: 110, aggr: 0.5 }, competent: { acc: 0.72, jit: 55, aggr: 0.8 }, expert: { acc: 0.93, jit: 28, aggr: 1 } };
const MAX_GAME_S = +(process.env.MAX_S ?? 150);

async function fight(browser, boss, levelName) {
  const p = await browser.newPage({ viewport: { width: 1000, height: 560 } });
  await p.addInitScript((t) => localStorage.setItem("duel.settings", JSON.stringify({ beat: t, difficulty: "duelist", music: false, sfx: 0 })), timing);
  await p.goto("http://localhost:3000/duel?dev=1", { waitUntil: "load" });
  await p.waitForFunction(() => window.__duel?.player, null, { timeout: 40000 }); await p.waitForTimeout(600);
  const res = await p.evaluate(([boss, L, maxS, process_brain]) => new Promise((resolve) => {
    const d = window.__duel; d.hud.brain = process_brain; d.reset(d.idxOf(boss)); d.debugWake(); d.refill(); d.b.auto = true;
    const K = { w: 87, a: 65, s: 83, d: 68, space: 32, shift: 16, j: 74, k: 75, q: 81 }; const down = {};
    const key = (n, on) => { if (!!down[n] === on) return; down[n] = on; window.dispatchEvent(new KeyboardEvent(on ? "keydown" : "keyup", { keyCode: K[n], which: K[n] })); };
    const tap = (n, ms = 90) => { key(n, true); setTimeout(() => key(n, false), ms); };
    const plan = new Map(); // key -> scheduled
    const rnd = (a) => (Math.random() * 2 - 1) * a; const ok = () => Math.random() < L.acc;
    let lastSwing = 0, lastHeal = 0; let lastMode = "", modeSince = 0; const stuck = []; const t0 = d.time.now; let minHp = 100; const seen = new Set();
    const at = (when, fn) => setTimeout(fn, Math.max(0, when - d.time.now));
    const iv = setInterval(() => {
      const now = d.time.now, b = d.b, p = d.p, mv = b.move;
      minHp = Math.min(minHp, p.hp);
      if (b.mode !== lastMode || b.move !== mv) { lastMode = b.mode; modeSince = now; } else if (now - modeSince > 6500 && !stuck.length && !d.dlg && p.mode !== "dead")
        stuck.push({ mode: b.mode, move: mv?.id, held: b.held, holdIdx: b.holdIdx, asking: b.asking, decision: !!b.decision, until: Math.round(b.until - now), holdFor: Math.round(b.holdUntil - now), posture: Math.round(b.posture), awake: b.awake, last: d.hud.last, frame: d.boss.frame, done: d.boss.done, ts: d.boss.sprite.anims.timeScale, gates: b.gates.map((g) => [g.def.after, g.def.at, g.requested, g.asking, g.ans, g.applied]), endSince: b.endSince ? Math.round(now - b.endSince) : 0, anim: d.boss.sprite.anims.currentAnim?.key, playing: d.boss.sprite.anims.isPlaying, pmode: p.mode, dist: Math.round(dist) });
      if (p.mode === "dead" || b.mode === "dead" || (now - t0) / 1000 > maxS) {
        clearInterval(iv); ["w","a","s","d","space","shift","j","k","q"].forEach((n) => key(n, false));
        return resolve({ result: p.mode === "dead" ? "lost" : b.mode === "dead" ? "won" : "timeout", secs: Math.round((now - t0) / 1000), seg: b.seg + 1, bossHpLeft: Math.round(b.hp), minHp: Math.round(minHp), stuck });
      }
      const dx = d.boss.x - d.player.x, dy = d.boss.y - d.player.y, dist = Math.hypot(dx, dy);
      // ---- react to what the boss is doing
      if (b.mode === "attack" && mv) {
        const type = d.moveType(mv), tag = mv.id + ":" + b.holdIdx + ":" + b.moveToken;
        if (b.held && !seen.has(tag)) {
          seen.add(tag);
          const fdur = 1000 / (mv.fps * d.mul().fps);
          const hold = (mv.holds ?? [])[b.holdIdx - 1]; const act = hold ? d.actAfter(mv, hold.frame) : null;
          const impact = b.holdUntil + ((act ?? (hold?.frame ?? 0)) - (hold?.frame ?? 0)) * fdur;
          const right = ok(); const j = rnd(L.jit);
          if (mv.kind === "pillars") { if (right) at(impact - 450, () => { key("d", false); const a = Math.random() < 0.5 ? "w" : "s"; key(a, true); setTimeout(() => { key(a, false); tap("shift", 60); }, 380); }); }
          else if (mv.kind === "beam") { if (right) at(b.holdUntil - mv.beam.lockMs + 40, () => { const side = dy > 0 ? "w" : "s"; key(side, true); tap("shift", 60); setTimeout(() => key(side, false), 300); }); }
          else if (mv.kind === "projectile" || mv.kind === "buff" || mv.kind === "blink") { /* handled below / harmless */ }
          else if (type === "grab") { if (right) at(b.holdUntil - 250, () => { const away = dx > 0 ? "a" : "d"; key(away, true); setTimeout(() => key(away, false), 650); }); }
          else if (type === "sweep") { if (right) at(impact - 160 + j, () => { const to = dx > 0 ? "d" : "a"; key(to, true); tap("shift", 60); setTimeout(() => key(to, false), 200); }); }
          else if (type === "thrust") { if (right) at(impact - 110 + j, () => { const to = dx > 0 ? "d" : "a"; key(to, true); tap("shift", 60); setTimeout(() => key(to, false), 200); }); }
          else if (right) at(impact - 75 + j, () => tap("space", 70)); // normal / heavy: a deflect tap
          else if (Math.random() < 0.5) at(impact - 400, () => { key("space", true); setTimeout(() => key("space", false), 700); }); // otherwise just block
        }
      }
      for (const pr of d.projs) if (!pr.reflected && !seen.has("p" + pr.born)) {
        const dd = Math.hypot(pr.x - d.player.x, pr.y - d.player.y);
        if (dd < 70 + Math.hypot(pr.vx, pr.vy) * 0.08) { seen.add("p" + pr.born); if (ok()) setTimeout(() => tap("space", 70), Math.max(0, rnd(L.jit) + 20)); }
      }
      // ---- heal when safe
      if (p.hp < 42 && p.heals > 0 && now - lastHeal > 2500 && (b.mode === "recover" || b.mode === "broken" || dist > 150) && p.mode === "free") { lastHeal = now; tap("q", 60); return; }
      // ---- positioning and offence
      const open = b.mode === "recover" || b.mode === "broken" || b.mode === "guard";
      const want = open && Math.random() < L.aggr ? 52 : 95;
      const mx = Math.abs(dx) > 8 ? (dx > 0 ? "d" : "a") : null, my = Math.abs(dy) > 8 ? (dy > 0 ? "s" : "w") : null;
      const far = dist > want + 14, near = dist < want - 28;
      key("d", far ? mx === "d" : near ? mx === "a" : false); key("a", far ? mx === "a" : near ? mx === "d" : false);
      key("s", far ? my === "s" : near ? my === "w" : false); key("w", far ? my === "w" : near ? my === "s" : false);
      if ((b.mode === "broken" || (open && dist < 80)) && now - lastSwing > 260 && p.mode === "free") { lastSwing = now; tap(b.mode === "broken" || Math.random() < 0.8 ? "j" : "k", 50); }
    }, 33);
  }), [boss, LEVELS[levelName], MAX_GAME_S, process.env.BRAIN ?? "RULES"]);
  await p.close();
  return res;
}

const browser = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const jobs = [];
for (const boss of bosses) for (const lvl of Object.keys(LEVELS)) for (let i = 0; i < trials; i++) jobs.push({ boss, lvl });
const out = {}; const par = +(process.env.PAR ?? 3); let next = 0;
await Promise.all(Array.from({ length: par }, async () => { while (next < jobs.length) { const j = jobs[next++]; const r = await fight(browser, j.boss, j.lvl).catch((e) => ({ result: "error", err: String(e).slice(0, 80) })); (out[j.boss + "/" + j.lvl] ??= []).push(r); console.log(j.boss.padEnd(8), j.lvl.padEnd(10), JSON.stringify(r)); } }));
console.log(`\n== ${timing} timing: win rate (wins/trials), avg secs, avg lowest hp`);
for (const [k, rs] of Object.entries(out)) { const w = rs.filter((r) => r.result === "won").length; const ok = rs.filter((r) => r.secs); console.log(k.padEnd(20), `${w}/${rs.length} won`, `avg ${Math.round(ok.reduce((a, r) => a + r.secs, 0) / Math.max(1, ok.length))}s`, `lowest hp ${Math.round(ok.reduce((a, r) => a + r.minHp, 0) / Math.max(1, ok.length))}`, rs.map((r) => r.result[0] + (r.result === "lost" ? "@seg" + r.seg : "")).join(" ")); }
await browser.close();
