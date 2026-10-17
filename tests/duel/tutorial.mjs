// Needs `npm run dev` running and the duel assets built. Plays the tutorial through: dialogue, every lesson, the Shade's demonstrations,
// skipping, mercy and Continue. Run: node tests/duel/tutorial.mjs
import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const errs = []; const results = [];
const check = (n, c, i) => { results.push(c); console.log((c ? "PASS " : "FAIL ") + n + "  " + JSON.stringify(i)); };
async function newGame(save) {
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  p.on("pageerror", (e) => errs.push((e.stack || e.message).split("\n").slice(0, 3).join(" | ")));
  await p.addInitScript((sv) => { localStorage.setItem("duel.settings", JSON.stringify({ beat: "classic", difficulty: "duelist", music: true, sfx: 0.8 })); if (sv) localStorage.setItem("duel.save", JSON.stringify(sv)); }, save ?? null);
  await p.goto("http://localhost:3000/duel", { waitUntil: "load" }); await p.waitForTimeout(4500);
  return p;
}
const hud = (p) => p.evaluate(() => ({ dlg: window.__duel.hud.dialog, obj: window.__duel.hud.objective, on: window.__duel.tutorialOn, done: JSON.parse(localStorage.getItem("duel.save") || "{}").tutorialDone }));

let p = await newGame(null);
await p.keyboard.press("Enter"); await p.waitForFunction(() => window.__duel?.player, null, { timeout: 20000 }); await p.waitForTimeout(800);
await p.waitForFunction(() => window.__duel.hud.dialog, null, { timeout: 8000 });
let h = await hud(p);
check("a new game opens with the Instructor's dialogue and the shade in the courtyard", h.dlg?.who === "INSTRUCTOR" && h.on === true, h);
const pos0 = await p.evaluate(() => ({ x: window.__duel.player.x, y: window.__duel.player.y }));
await p.keyboard.down("d"); await p.waitForTimeout(500); await p.keyboard.up("d");
const pos1 = await p.evaluate(() => ({ x: window.__duel.player.x, y: window.__duel.player.y }));
check("the world is frozen while the dialogue box is open", Math.abs(pos1.x - pos0.x) < 1 && Math.abs(pos1.y - pos0.y) < 1, { pos0, pos1 });
await p.waitForTimeout(1500); const before = (await hud(p)).dlg; const typed = before.text.length; await p.keyboard.press("Enter"); await p.waitForTimeout(200); const after = (await hud(p)).dlg;
check("the typewriter reveals text and Enter completes the line (or moves on if it had finished)", typed > 5 && (after.done === true || after.i > before.i), { typed, before: before.i, after: after.i, done: after.done });
const gateClosed = await p.evaluate(() => window.__duel.world.gateOpen === false); check("the gate north is sealed during the lessons", gateClosed, {});

// play every lesson: Enter through dialogue, satisfy each objective
const seen = []; let guard = 0; let deflectedForReal = 0;
const give = (ev, n) => p.evaluate(([ev, n]) => { for (let i = 0; i < n; i++) window.__duel.tutEvent(ev); }, [ev, n]);
while (guard++ < 400) {
  const s = await hud(p);
  if (!s.on) break;
  if (await p.evaluate(() => window.__game.scene.isActive("skills"))) { await p.keyboard.press("Escape"); await p.waitForTimeout(600); continue; }
  if (s.dlg) { await p.keyboard.press("Enter"); await p.waitForTimeout(120); continue; }
  if (!s.obj) { await p.waitForTimeout(150); continue; }
  const t = s.obj.title; if (seen[seen.length - 1] !== t) seen.push(t);
  switch (t) {
    case "MOVE": {
      // really walk with the keys: the lesson must complete from actual movement
      for (const k of ["d", "s", "a", "w", "d", "s"]) { await p.keyboard.down(k); await p.waitForTimeout(650); await p.keyboard.up(k); }
      const moved = await p.evaluate(() => Math.round(window.__duel.movedTotal - window.__duel.movedBase));
      check("MOVE lesson: walking with WASD counts toward the lesson", moved > 100 || !(await hud(p)).obj || (await hud(p)).obj.title !== "MOVE", { moved });
      break;
    }
    case "STRIKE": await give("hit", 5); await give("heavy", 1); break;
    case "BLOCK": {
      const attacked = await p.waitForFunction(() => window.__duel.b.mode === "attack" && window.__duel.b.move?.id === "SLASH2", null, { timeout: 15000 }).then(() => true, () => false);
      check("BLOCK lesson: the Shade telegraphs a slash on its own", attacked, {}); await give("block", 2); break;
    }
    case "DEFLECT": {
      const ring = await p.evaluate(() => window.__duel.ringAidOn); if (deflectedForReal === 0) check("DEFLECT lesson: the timing ring aid is on", ring === true, { ring });
      // really deflect once: tap SPACE just before the first strike lands
      if (deflectedForReal < 1) {
        await p.evaluate(() => { const d = window.__duel; d.player.x = d.boss.x - 55; d.player.y = d.boss.y; });
        await p.waitForFunction(() => { const d = window.__duel; return d.b.mode === "attack" && d.b.held && d.time.now >= d.b.holdUntil - 40; }, null, { timeout: 25000, polling: "raf" });
        await p.keyboard.down("Space"); await p.waitForTimeout(300); await p.keyboard.up("Space"); await p.waitForTimeout(400);
        deflectedForReal = await p.evaluate(() => window.__duel.cnt.deflect ?? 0);
        check("DEFLECT lesson: a real tap on the closing ring deflects the Shade", deflectedForReal >= 1, { deflects: deflectedForReal });
      }
      await give("deflect", 3); break;
    }
    case "RIPOSTE": await give("riposte", 1); break;
    case "SWEEP": await give("SWEEP:dodged", 2); break;
    case "SLIP": await give("THRUST:slipped", 2); break;
    case "GRAB": await give("GRAB:missed", 2); break;
    case "DEATHBLOW": await give("break", 1); await give("deathblow", 1); break;
    case "KICK": await give("kickbreak", 1); break;
    case "HEAL": await give("heal", 1); break;
    case "THE TEST": await give("deathblow", 1); break;
    default: await give("hit", 1);
  }
  await p.waitForTimeout(250);
}
check("all twelve lessons run in order", JSON.stringify(seen) === JSON.stringify(["MOVE", "STRIKE", "BLOCK", "DEFLECT", "RIPOSTE", "SWEEP", "SLIP", "GRAB", "DEATHBLOW", "KICK", "HEAL", "THE TEST"]), seen);
await p.waitForTimeout(2500);
const fin = await p.evaluate(() => ({ done: JSON.parse(localStorage.getItem("duel.save")).tutorialDone, gate: window.__duel.world.gateOpen, idx: window.__duel.bossIdx, def: window.__duel.def.id, on: window.__duel.tutorialOn, awake: window.__duel.b.awake }));
check("finishing opens the gate, saves it, and the first grunt waits asleep in the arena", fin.done === true && fin.gate === true && fin.def === "bone-soldier" && fin.awake === false && fin.on === false, fin);
await p.close();

// skipping from the pause menu + mercy
p = await newGame(null); await p.keyboard.press("Enter"); await p.waitForFunction(() => window.__duel?.player, null, { timeout: 20000 }); await p.waitForTimeout(800);
await p.evaluate(() => { const d = window.__duel; d.dlg = null; d.hud.dialog = null; d.p.hp = 3; d.shadeLoop = { moves: ["SLASH2"], gap: 0, i: 0, next: 0 }; });
await p.waitForTimeout(1500); const hp = await p.evaluate(() => window.__duel.p.hp);
check("tutorial mercy: HP never falls below 20", hp >= 20, { hp });
await p.keyboard.press("Escape"); await p.waitForTimeout(500); await p.keyboard.press("ArrowDown"); await p.waitForTimeout(150); await p.keyboard.press("Enter"); await p.waitForTimeout(2500);
h = await hud(p); check("Skip tutorial (pause menu) ends it and saves", h.on === false && h.done === true, h);
await p.close();

// Continue goes straight past the tutorial
p = await newGame({ cleared: [], deaths: 0, skills: [], points: 2, tutorialDone: true });
await p.keyboard.press("Enter"); await p.waitForFunction(() => window.__duel?.player, null, { timeout: 20000 }); await p.waitForTimeout(800);
const cont = await p.evaluate(() => ({ def: window.__duel.def.id, tut: window.__duel.tutorialOn, npc: !!window.__duel.npc }));
check("a saved game with the tutorial done starts at the first grunt, with no Instructor", cont.def === "bone-soldier" && !cont.tut && !cont.npc, cont);
await p.close();
console.log(errs.join("\n") || "no page errors"); console.log(`${results.filter(Boolean).length}/${results.length} passed`); await b.close();
