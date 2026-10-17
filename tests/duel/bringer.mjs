// Needs `npm run dev` running and the duel assets built. Checks the final boss's moves. Run: node tests/duel/bringer.mjs
import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1300, height: 700 } });
const errs = []; p.on("pageerror", (e) => errs.push("PAGEERR: " + (e.stack || e.message).split("\n").slice(0, 3).join(" | ")));
await p.addInitScript(() => localStorage.setItem("duel.settings", JSON.stringify({ beat: "classic", difficulty: "duelist", music: true, sfx: 0.8 })));
await p.goto("http://localhost:3000/duel?dev=1", { waitUntil: "load" });
await p.waitForFunction(() => window.__duel?.player, null, { timeout: 30000 }); await p.waitForTimeout(800);
const results = []; const check = (n, c, i) => { results.push(c); console.log((c ? "PASS " : "FAIL ") + n + "  " + JSON.stringify(i)); };
const st = () => p.evaluate(() => { const d = window.__duel; return { php: Math.round(d.p.hp * 10) / 10, ppost: Math.round(d.p.posture * 10) / 10, bmode: d.b.mode, projs: d.projs.length, pillars: d.pillars.length, bx: Math.round(d.boss.x), px: Math.round(d.player.x), gap: Math.round(Math.hypot(d.boss.x - d.player.x, d.boss.y - d.player.y)), seg: d.b.seg, def: d.def.id }; });
const setup = (dx = 70, seg = 0) => p.evaluate(([dx, seg]) => { const d = window.__duel; d.reset(d.idxOf("bringer")); d.debugWake(); d.b.auto = false; d.refill(); d.boss.x = d.world.spawns.boss.x; d.boss.y = d.world.spawns.boss.y;
  d.player.x = d.boss.x - dx; d.player.y = d.boss.y; d.b.mode = "idle"; d.b.nextThink = 1e12; d.p.mode = "free"; d.p.invulnUntil = 0; d.b.cd = {}; d.p.hp = 100; d.p.posture = 0; d.b.posture = 0; d.b.hp = d.def.segmentHp; d.b.seg = seg; d.boss.sprite.alpha = 1;
  window.__maxProj = 0; window.__maxPil = 0; if (!window.__poll) window.__poll = setInterval(() => { const d = window.__duel; window.__maxProj = Math.max(window.__maxProj, d.projs.length); window.__maxPil = Math.max(window.__maxPil, d.pillars.length); }, 30); }, [dx, seg]);
const key = async (k, ms = 40) => { await p.keyboard.down(k); await p.waitForTimeout(ms); await p.keyboard.up(k); };

await setup(70); let s = await st();
check("the final boss is the Bringer of Death with three lives", s.def === "bringer" && await p.evaluate(() => window.__duel.def.segments) === 3, s);
await p.waitForTimeout(500); await p.screenshot({ path: "/tmp/bringer_idle.png" });

await setup(70); await key("z", 30); await p.waitForTimeout(3200); s = await st();
check("scythe cut hits an unguarded player", s.php <= 84, s);
await setup(70); await p.keyboard.down("Space"); await p.waitForTimeout(250); await key("x", 30); await p.waitForTimeout(3200); await p.keyboard.up("Space"); s = await st();
check("reaping sweep cannot be blocked", s.php <= 80, s);
await setup(70); await key("x", 30); await p.waitForFunction(() => { const d = window.__duel; return d.b.holdIdx > 0 && !d.b.held; }, null, { timeout: 6000, polling: "raf" }); await p.keyboard.down("d"); await key("Shift", 30); await p.keyboard.up("d"); await p.waitForTimeout(2200); s = await st();
check("reaping sweep is avoided by rolling through it", s.php >= 96, s);

await setup(200, 0); await key("c", 30); await p.waitForTimeout(3200); s = await st(); let mp = await p.evaluate(() => window.__maxProj);
check("soul bolt: one bolt in the first life", mp === 1, { mp });
await setup(200, 1); await key("c", 30); await p.waitForTimeout(3200); mp = await p.evaluate(() => window.__maxProj);
check("soul bolt: two bolts in the later lives", mp === 2, { mp });

await setup(200, 0); await key("v", 30); await p.waitForTimeout(3000); s = await st(); let pil = await p.evaluate(() => window.__maxPil);
check("pillars: two in the first life, and a standing player is struck", pil === 2 && s.php <= 82, { pil, ...s });
await setup(200, 2); await key("v", 30); await p.waitForTimeout(3000); pil = await p.evaluate(() => window.__maxPil);
check("pillars: four in the last life", pil === 4, { pil });
await setup(200, 0); await key("v", 30);
await p.waitForFunction(() => window.__duel.pillars.length > 0, null, { timeout: 5000, polling: "raf" });
await p.waitForTimeout(700); await p.screenshot({ path: "/tmp/bringer_pillars.png" });
await p.waitForFunction(() => { const d = window.__duel; const pl = d.pillars[0]; return pl && d.time.now >= pl.hitAt - 260; }, null, { timeout: 5000, polling: "raf" });
await p.evaluate(() => { const d = window.__duel; d.player.x += 140; }); await p.waitForTimeout(1800); s = await st();
check("pillars: stepping away from the marked ground avoids them", s.php === 100, s);

await setup(160); await key("b", 30); await p.waitForTimeout(1800); s = await st();
check("blink: the Bringer reappears behind the player, close", s.bx < s.px && s.gap < 90, s);

console.log(errs.join("\n") || "no page errors"); console.log(`${results.filter(Boolean).length}/${results.length} passed`); await b.close();
