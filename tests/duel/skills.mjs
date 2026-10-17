// Needs `npm run dev` running and the duel assets built. Checks spirit, riposte, arts, tools, passives and the shrine UI. Run: node tests/duel/skills.mjs
import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const errs = []; const results = [];
const check = (n, c, i) => { results.push(c); console.log((c ? "PASS " : "FAIL ") + n + "  " + JSON.stringify(i)); };
async function page(skills, { dev = true, points = 0 } = {}) {
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  p.on("pageerror", (e) => errs.push((e.stack || e.message).split("\n").slice(0, 3).join(" | ")));
  await p.addInitScript(([sk, pts]) => { localStorage.setItem("duel.settings", JSON.stringify({ beat: "classic", difficulty: "duelist", music: true, sfx: 0.8 })); localStorage.setItem("duel.save", JSON.stringify({ cleared: [], deaths: 0, skills: sk, points: pts, tutorialDone: true, seen: ["intro:bone-soldier","outro:bone-soldier","intro:spear-bearer","outro:spear-bearer","intro:captain","outro:captain","intro:golem","outro:golem","brief:golem"] })); }, [skills, points]);
  await p.goto("http://localhost:3000/duel" + (dev ? "?dev=1" : ""), { waitUntil: "load" });
  if (dev) { await p.waitForFunction(() => window.__duel?.player, null, { timeout: 30000 }); await p.waitForTimeout(700); }
  return p;
}
const ALL = ["keen", "echo", "wrist", "rollcut", "whirl", "reach", "blades", "well", "gourd"];
const setup = (p, dx = 60, boss = 0) => p.evaluate(([dx, boss]) => { const d = window.__duel; d.reset(boss); d.debugWake(); d.b.auto = false; d.refill(); d.boss.x = d.world.spawns.boss.x; d.boss.y = d.world.spawns.boss.y;
  d.player.x = d.boss.x - dx; d.player.y = d.boss.y; d.b.mode = "idle"; d.b.nextThink = 1e12; d.p.mode = "free"; d.p.invulnUntil = 0; d.b.cd = {}; d.p.hp = 100; d.p.posture = 0; d.b.posture = 0; d.b.hp = d.def.segmentHp; d.b.seg = 0; d.p.spirit = 0; d.p.riposteUntil = 0; d.blades = []; }, [dx, boss]);
const key = async (p, k, ms = 40) => { await p.keyboard.down(k); await p.waitForTimeout(ms); await p.keyboard.up(k); };
const st = (p) => p.evaluate(() => { const d = window.__duel; return { spirit: d.p.spirit, rip: d.time.now < d.p.riposteUntil, bhp: d.b.hp, bpost: Math.round(d.b.posture * 10) / 10, bmode: d.b.mode, pmode: d.p.mode, php: Math.round(d.p.hp), move: d.p.move?.id, max: d.maxSpirit() }; });
const holdEnd = (p, lead) => p.waitForFunction((l) => { const d = window.__duel; return d.b.held && d.time.now >= d.b.holdUntil - l; }, lead, { timeout: 4000, polling: "raf" });

// --- everything unlocked
let p = await page(ALL);
await setup(p); await key(p, "z", 30); await holdEnd(p, 70); await p.keyboard.down("Space"); await p.waitForTimeout(250); await p.keyboard.up("Space"); await p.waitForTimeout(80);
let s = await st(p);
check("a deflect grants spirit (+1 +1 with Echo) and opens a riposte window", s.spirit === 2 && s.rip === true, s);
const before = s.bpost; await key(p, "j", 30); await p.waitForTimeout(500); s = await st(p);
check("riposte: a free heavy counter (posture +25 or more) that closes the window", s.bpost - before >= 25 && s.rip === false, { gained: s.bpost - before, ...s });
await setup(p, 60); await key(p, "c", 30); await holdEnd(p, 100); await key(p, "Shift", 30); await p.waitForTimeout(700); s = await st(p);
check("a slip on the red thrust grants spirit and a riposte window", s.spirit >= 1 && s.bpost >= 25, s);

await setup(p, 50); await p.evaluate(() => { window.__duel.p.spirit = 3; }); await key(p, "g", 30); await p.waitForTimeout(300); const w0 = (await st(p)).bpost; await key(p, "l", 30); await p.waitForTimeout(700); s = await st(p);
check("Whirl Cut costs 2 spirit and breaks a raised guard", s.spirit === 1 && s.bpost - w0 >= 25, { ...s, gained: s.bpost - w0 });
await setup(p, 150); await p.evaluate(() => { window.__duel.p.spirit = 2; }); const h0 = (await st(p)).bhp; await key(p, "i", 30); await p.waitForTimeout(900); s = await st(p);
check("a thrown blade costs 1 spirit and chips the boss from range", s.spirit === 1 && h0 - s.bhp >= 5, { ...s, dmg: h0 - s.bhp });
await setup(p, 150, 1); await p.evaluate(() => { window.__duel.p.spirit = 2; }); await key(p, "g", 30); await p.waitForTimeout(300); const g0 = (await st(p)).bhp; await key(p, "i", 30); await p.waitForTimeout(900); s = await st(p);
check("blades do nothing to the Golem's stone guard", s.bhp === g0 && s.bmode === "guard", s);
await setup(p, 70); await p.keyboard.down("a"); await key(p, "Shift", 30); await p.waitForTimeout(120); await p.keyboard.up("a"); const r0 = (await st(p)).bhp; await key(p, "j", 30); await p.waitForTimeout(150); s = await st(p);
check("Roll Cut: attack during a roll becomes a cut out of it", s.move === "ROLLCUT", s);
await setup(p, 60); await p.evaluate(() => { const d = window.__duel; d.p.hp = 40; }); const t0 = await p.evaluate(() => window.__duel.time.now); await key(p, "q", 30);
await p.waitForFunction(() => window.__duel.p.hp > 40 || window.__duel.p.heals < 3, null, { timeout: 3000, polling: "raf" }); const heal = (await p.evaluate(() => window.__duel.time.now)) - t0;
check("Quick Gourd: healing takes under ~800 ms", heal < 800, { ms: Math.round(heal) });
check("Spirit Well: maximum spirit 5", (await st(p)).max === 5, { max: (await st(p)).max });
const wr = async (pg) => { await setup(pg, 55); await key(pg, "z", 30); await holdEnd(pg, 40); await pg.evaluate(() => { const d = window.__duel; d.p.mode = "guard"; d.p.guardSince = d.b.holdUntil + 70 - 180; d.p.noDeflect = false; d.p.guardPrev = true; });
  await pg.keyboard.down("Space"); await pg.waitForTimeout(500); await pg.keyboard.up("Space"); return st(pg); };
s = await wr(p); check("Keen Eye: a tap 180 ms before impact still deflects", s.bpost >= 10, s);
await p.close();

// --- nothing unlocked
p = await page([]);
await setup(p, 50); await p.evaluate(() => { window.__duel.p.spirit = 3; }); await key(p, "l", 30); await key(p, "i", 30); await p.waitForTimeout(300); s = await st(p);
check("locked skills refuse (no spirit spent, no move)", s.spirit === 3 && s.move !== "WHIRL" && s.move !== "THROW", s);
await p.evaluate(() => { window.__duel.reset(0); window.__duel.debugWake(); }); const maxNo = (await st(p)).max;
check("base maximum spirit is 3", maxNo === 3, { maxNo });
await setup(p, 55); const wr2 = await wr(p); check("without Keen Eye the same tap only blocks", wr2.bpost < 5, wr2);
await p.close();

// --- shrine UI (title -> game -> pause -> skills -> buy) with 2 starting points
p = await page([], { dev: false, points: 2 }); await p.waitForTimeout(4500);
await p.keyboard.press("Enter"); await p.waitForFunction(() => window.__duel?.player, null, { timeout: 15000 }); await p.waitForTimeout(600);
await p.keyboard.press("Escape"); await p.waitForTimeout(400); await p.keyboard.press("ArrowDown"); await p.waitForTimeout(150); await p.keyboard.press("Enter"); await p.waitForFunction(() => window.__game.scene.isActive("skills"), null, { timeout: 8000 }); await p.waitForTimeout(500);
await p.keyboard.press("Enter"); await p.waitForTimeout(400); await p.keyboard.press("ArrowDown"); await p.waitForTimeout(150); await p.keyboard.press("Enter"); await p.waitForTimeout(400); // Keen Eye, then Echo
let saved = await p.evaluate(() => JSON.parse(localStorage.getItem("duel.save")));
check("shrine UI: buying with the keyboard unlocks skills and spends points (Echo needs Keen Eye)", saved.skills.includes("keen") && saved.skills.includes("echo") && saved.points === 0, saved);
await p.keyboard.press("Escape"); await p.waitForTimeout(300); await p.keyboard.press("Escape"); await p.waitForTimeout(300);
// --- boss falls -> shrine -> next boss
await p.evaluate(() => { const d = window.__duel; d.reset(d.idxOf("captain")); d.debugWake(); d.b.auto = false; d.boss.x = d.world.spawns.boss.x; d.boss.y = d.world.spawns.boss.y; d.player.x = d.boss.x - 55; d.player.y = d.boss.y; d.b.seg = 1; d.b.hp = 4; d.b.mode = "idle"; d.b.nextThink = 1e12; });
await key(p, "j", 30);
const shrine = await p.waitForFunction(() => window.__game.scene.isActive("skills"), null, { timeout: 40000 }).then(() => true, () => false);
const pts = await p.evaluate(() => JSON.parse(localStorage.getItem("duel.save")).points);
check("after a boss falls the shrine opens (and awards a point)", shrine && pts >= 1, { shrine, pts, scenes: await p.evaluate(() => window.__game.scene.getScenes(true).map((x) => x.scene.key).join(",")), dbg: await p.evaluate(() => ({ pending: window.__duel.pendingNext, paused: window.__game.scene.isPaused("duel"), clockPaused: window.__duel.time.paused, t: Math.round(window.__duel.time.now), dev: window.__game.registry.get("dev") })), boss: await p.evaluate(() => ({ mode: window.__duel.b.mode, hp: window.__duel.b.hp, seg: window.__duel.b.seg, pmode: window.__duel.p.mode })) });
await p.keyboard.press("Escape"); const next = await p.waitForFunction(() => window.__duel.def.id === "golem" && !window.__duel.travelling, null, { timeout: 20000 }).then(() => true, () => false);
check("closing the shrine brings the next guardian (in its own area)", next, {});
await p.close();
console.log(errs.join("\n") || "no page errors"); console.log(`${results.filter(Boolean).length}/${results.length} passed`); await b.close();
