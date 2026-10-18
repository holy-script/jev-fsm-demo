// Scripted-player balance harness (like tests/duel/bot.mjs). Fights every boss at several skill levels against the RULES brain (no Jev
// calls) with the simulation fast-forwarded (the game loop is put to sleep and scene.update is stepped directly), then prints win rates,
// fight length and damage. Use it to tune boss HP/damage in game/v4/bosses.ts and HERO in game/v4/data.ts.
//   node tests/arena/bot.mjs [bosses=mb,cm,wh,echo] [levels=novice,competent,expert] [runs=8] [seed=1]
import { chromium } from "playwright";

const bosses = (process.argv[2] ?? "mb,cm,wh,echo").split(",");
const levels = (process.argv[3] ?? "novice,competent,expert").split(",");
const runs = Number(process.argv[4] ?? 8);
const seed = Number(process.argv[5] ?? 1);

const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 960, height: 540 } });
await p.route("**/api/jev/ask", (r) => r.fulfill({ status: 500, contentType: "application/json", body: "{}" })); // the bot only ever uses the rules brain
await p.goto("http://localhost:3000/arena?dev=1&nocard=1&qte=on", { waitUntil: "load" });
await p.waitForFunction(() => window.__arena?.player, null, { timeout: 40000 });
await p.waitForTimeout(600);

const rows = [];
for (const boss of bosses) {
  for (const level of levels) {
    const res = await p.evaluate(async ({ boss, level, runs, seed, assist }) => {
      const d = window.__arena, C = window.__consts;
      // ---- skill model: reaction delay (ms), timing noise sigma (ms), chance to answer an attack at all, chance to attack into a wind-up
      const LEVELS = {
        novice: { react: 300, sigma: 85, answer: 0.55, greed: 0.35, counter: 0.3, roll: 0.35, safe: 0 },
        competent: { react: 190, sigma: 42, answer: 0.85, greed: 0.12, counter: 0.6, roll: 0.3, safe: 450 },
        expert: { react: 120, sigma: 18, answer: 0.97, greed: 0.04, counter: 0.9, roll: 0.15, safe: 700 },
      };
      const L = LEVELS[level];
      let s = seed >>> 0;
      const rnd = () => ((s = (s + 0x6d2b79f5) >>> 0), ((((s ^ (s >>> 15)) * (1 | s)) ^ (((s ^ (s >>> 15)) * (1 | s)) + (((s ^ (s >>> 7)) * (61 | s)) ^ s))) >>> 0) / 4294967296);
      const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
      // ---- silence everything that would leak objects when time is stepped by hand
      d.popup = () => {}; d.shake = () => {}; d.vfx.play = () => null; d.sfx = new Proxy({}, { get: () => () => {}, has: () => true });
      d.settings.qte = "on"; d.settings.brain = "rules"; d.settings.assist = !!assist;
      const out = [];
      for (let r = 0; r < runs; r++) {
        d.loadBoss(boss); d.reset(); d.brain.mode = "rules"; d.e.auto = true; d.e.thinkAt = 800;
        d.player.x = 330; d.enemy.x = 620;
        let plan = null, seen = null, guardUntil = 0, lastGuard = -1e9, lastAtk = -1e9, lastRoll = -1e9, mashT = 0, qteN = -1, thrown = 0;
        const dur = (a, fr, hm) => 1000 / (a.clip.fps ?? 12) + (a.clip.holds?.[fr] ?? 0) * hm;
        const remaining = (a, h) => {
          const hm = d.phase() === 2 ? d.boss.phase2.hold : 1, an = d.enemy.anim;
          if (an.frame >= h.a) return 0;
          let t = dur(a, an.frame, hm) - an.t;
          for (let k = an.frame + 1; k < h.a; k++) t += dur(a, k, hm);
          return t + (d.e.resumeAt > d.now ? d.e.resumeAt - d.now : 0);
        };
        d.botFrame = () => {
          const f = {}, p = d.p, e = d.e, pl = d.player, en = d.enemy, now = d.now;
          const dx = en.x - pl.x, dy = en.y - pl.y, dist = Math.abs(dx);
          // QTE and clash first: they own the input
          if (d.qteKind === "deathblow" && d.qte && d.qte.current) {
            const q = d.qte, c = q.current;
            if (q.i !== qteN) { qteN = q.i; q.__target = c.windowMs + gauss() * L.sigma * 1.2; }
            if (q.t >= q.__target) { const act = { J: "attack", K: "guard", L: "roll" }[c.key]; f[act] = true; q.__target = 1e9; }
            return f;
          }
          if (d.qteKind === "clash") { mashT -= 16.7; if (mashT <= 0) { f.attack = true; mashT = 1000 / (level === "novice" ? 6 : level === "competent" ? 8 : 10); } return f; }
          if (p.mode === "dead" || e.mode === "dead") return f;
          f.guardHeld = now < guardUntil;
          // use items: gourd when low, fire pot when boss is open
          if (p.hp < 40 && p.gourdCharges > 0) { f.item = true; }
          else if (e.mode === "idle" && p.firePotCharges > 0 && dist < 200) { f.pot = true; }
          // face the right depth and distance
          const want = e.mode === "attack" || e.mode === "recoil" ? 100 : 95;
          f.dir = { x: dist > want + 8 ? Math.sign(dx) : dist < want - 25 ? -Math.sign(dx) : 0, y: Math.abs(dy) > 14 ? Math.sign(dy) : 0, any: false };
          if (p.mode === "roll" || p.mode === "hurt" || p.mode === "qte") f.dir = { x: 0, y: 0, any: false };
          f.dir.any = f.dir.x !== 0 || f.dir.y !== 0;
          // a new boss attack: decide how to answer once the reaction time has passed
          if (e.mode === "attack" && e.atk && !e.feinting) {
            const key = e.atk.id + "#" + d.log.filter((l) => l.type === "enemyAttack").length;
            if (!seen || seen.key !== key) { seen = { key, t0: now, decided: false, react: L.react * (0.8 + 0.4 * rnd()) }; thrown++; plan = null; }
            if (!seen.decided && now - seen.t0 >= seen.react) {
              seen.decided = true;
              const hits = e.atk.hits, per = hits.some((h) => h.kind === "perilous");
              const isSweep = hits.some((h) => h.kind === "sweep");
              if (rnd() > L.answer) plan = { kind: "none" };
              else if (isSweep) plan = { kind: "jump" }; // sweeps are only avoided by jumping
              else if (per) plan = { kind: rnd() < L.counter ? "counter" : "roll" };
              else plan = { kind: rnd() < L.roll ? "roll" : "guard" };
              if (rnd() < L.greed && plan.kind !== "none" && !per) plan = { kind: "greedy" };
            }
            // act on the next unresolved hit (re-evaluated every frame, so gates and delays are handled)
            if (plan && !e.gate) {
              const i = e.atk.hits.findIndex((h, k) => !e.hitDone[k]);
              if (i >= 0) {
                const h = e.atk.hits[i], rem = remaining(e.atk, h) + gauss() * L.sigma;
                const perHit = h.kind === "perilous";
                const isSweep = h.kind === "sweep";
                const kind = perHit && plan.kind === "guard" ? "roll" : plan.kind;
                if (kind === "jump" && rem <= 140 && p.mode === "free") { f.jump = true; }
                else if (kind === "guard" && rem <= 70 && now - lastGuard > 280) { f.guard = true; guardUntil = now + 380; lastGuard = now; }
                else if (kind === "counter" && perHit && rem <= 100) { f.attack = true; }
                else if (kind === "counter" && !perHit && rem <= 70 && now - lastGuard > 280) { f.guard = true; guardUntil = now + 380; lastGuard = now; }
                else if (kind === "roll" && rem <= 120 && now - lastRoll > 450) { f.roll = true; lastRoll = now; }
                else if (kind === "greedy" && p.mode === "free" && now - lastAtk > 180 && dist < 120) { f.attack = true; lastAtk = now; }
              }
            }
            return f;
          }
          seen = seen && e.mode !== "attack" ? null : seen;
          // the boss is open: hit it
          const open = ["idle", "recoil", "flinch", "broken"].includes(e.mode);
          // a careful player does not start a chain when the boss is about to act again (a chain locks you in until its last frame)
          const safe = e.mode !== "idle" || !e.auto || e.action || e.thinkAt - now > L.safe || p.mode === "attack" && p.chain > 0 && e.thinkAt - now > L.safe * 0.5;
          // dash when boss is coming in and player is crowded (repositioning tool)
          if (dist < 80 && e.mode === "attack" && p.mode === "free" && now - lastAtk > 600) { f.dash = true; f.dir = { x: -Math.sign(dx) || 1, y: 0, any: true }; lastAtk = now; }
          else if (open && safe && Math.abs(dy) < 32 && dist < 125 && p.mode !== "hurt" && p.mode !== "roll") {
            if (p.spirit >= 2 && dist < 170 && e.mode !== "broken" && now - lastAtk > 400) { f.skill = true; lastAtk = now; }
            else if (now - lastAtk > 160) { f.attack = true; lastAtk = now; }
          }
          return f;
        };
        // ---- fast-forward
        d.hitstop = 0; let frames = 0, hpMin = 100;
        const t0 = d.now;
        while (frames < 60 * 150) {
          d.update(0, 1000 / 60); frames++;
          if (d.e.mode === "dead" || d.p.mode === "dead") break;
          if (frames % 6 === 0) await Promise.resolve(); // let gate promises settle
        }
        const v = Object.values(d.telemetry.vsMove);
        const sum = (fn) => v.reduce((a, m) => a + fn(m), 0);
        out.push({ won: d.e.mode === "dead", timeout: d.e.mode !== "dead" && d.p.mode !== "dead", secs: (d.now - t0) / 1000, hpLost: 100 - d.p.hp, bossHpLeft: d.e.hp, thrown: sum((m) => m.thrown), parried: sum((m) => m.deflected + m.countered), hit: sum((m) => m.hit), moves: JSON.parse(JSON.stringify(d.telemetry.vsMove)) });
      }
      d.botFrame = null;
      return out;
    }, { boss, level, runs, seed, assist: !!process.env.ASSIST });
    const n = res.length, avg = (f) => res.reduce((a, r) => a + f(r), 0) / n;
    rows.push({ boss, level, win: Math.round((100 * res.filter((r) => r.won).length) / n), timeouts: res.filter((r) => r.timeout).length, secs: avg((r) => r.secs).toFixed(0), hpLost: avg((r) => r.hpLost).toFixed(0), bossHpLeft: avg((r) => r.bossHpLeft).toFixed(0), parry: Math.round((100 * avg((r) => r.parried)) / Math.max(1, avg((r) => r.thrown))), hitPct: Math.round((100 * avg((r) => r.hit)) / Math.max(1, avg((r) => r.thrown))) });
    console.log(JSON.stringify(rows[rows.length - 1]));
    if (process.env.VERBOSE) {
      const agg = {};
      for (const r of res) for (const [m, v] of Object.entries(r.moves)) { const a = (agg[m] ??= { thrown: 0, hit: 0, deflected: 0, countered: 0, dodged: 0, blocked: 0 }); for (const k of Object.keys(a)) a[k] += v[k] ?? 0; }
      for (const [m, v] of Object.entries(agg)) console.log(`   ${m.padEnd(9)} thrown ${String(v.thrown).padStart(3)}  hit ${String(v.hit).padStart(3)}  parried ${String(v.deflected).padStart(3)}  countered ${String(v.countered).padStart(3)}  dodged ${String(v.dodged).padStart(3)}  blocked ${String(v.blocked).padStart(3)}`);
    }
  }
}
console.log("\nboss   level       player wins  timeouts  fight s  hp lost  boss hp left  parried%  landed%");
for (const r of rows) console.log(`${r.boss.padEnd(6)} ${r.level.padEnd(11)} ${String(r.win + "%").padStart(10)}  ${String(r.timeouts).padStart(8)}  ${String(r.secs).padStart(7)}  ${String(r.hpLost).padStart(7)}  ${String(r.bossHpLeft).padStart(12)}  ${String(r.parry).padStart(8)}  ${String(r.hitPct).padStart(7)}`);
await b.close();
