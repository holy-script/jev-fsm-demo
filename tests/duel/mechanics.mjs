// Needs `npm run dev` running and the duel assets built (see tools/README.md). Run: node tests/duel/mechanics.mjs
import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const p = await b.newPage({ viewport: { width: 1300, height: 700 } });
const errs = [];
p.on("pageerror", e => errs.push("PAGEERR: " + (e.stack || e.message).split("\n").slice(0, 3).join(" | ")));
await p.addInitScript(() => localStorage.setItem("duel.settings", JSON.stringify({ beat: "classic", difficulty: "duelist", music: true, sfx: 0.8 }))); // legacy timing keeps these checks deterministic
await p.goto("http://localhost:3000/duel?dev=1", { waitUntil: "load" });
await p.waitForFunction(() => window.__duel?.player, null, { timeout: 30000 });
await p.waitForTimeout(800);
const results = [];
const st = () => p.evaluate(() => { const d = window.__duel; return { php: Math.round(d.p.hp * 10) / 10, ppost: Math.round(d.p.posture * 10) / 10, pmode: d.p.mode, bmode: d.b.mode, bpost: Math.round(d.b.posture * 10) / 10, bhp: d.b.hp, seg: d.b.seg, chain: d.p.chain }; });
const setup = (opts = {}) => p.evaluate((o) => {
  const d = window.__duel; d.reset(); d.debugWake(); d.b.auto = false;
  d.refill(); d.boss.x = d.world.spawns.boss.x; d.boss.y = d.world.spawns.boss.y;
  d.player.x = d.boss.x - (o.dx ?? 55); d.player.y = d.boss.y; d.b.mode = "idle"; d.b.nextThink = 1e12; d.player.sprite.anims.timeScale = 1;
  d.p.mode = "free"; d.p.invulnUntil = 0; d.b.cd = {};
  d.b.posture = 0; d.p.posture = 0; d.p.hp = 100; d.b.hp = 150; d.b.seg = 0;
}, opts);
const key = async (k, ms = 40) => { await p.keyboard.down(k); await p.waitForTimeout(ms); await p.keyboard.up(k); };
const waitHoldEnd = (lead) => p.waitForFunction((l) => { const d = window.__duel; return d.b.held && d.time.now >= d.b.holdUntil - l; }, lead, { timeout: 4000, polling: "raf" });
const check = (name, cond, info) => { results.push([name, cond]); console.log((cond ? "PASS " : "FAIL ") + name + "  " + JSON.stringify(info)); };

// A: deflect (tap guard just before the first slash lands)
await setup(); await key("z", 30); await waitHoldEnd(70); await p.keyboard.down("Space"); await p.waitForTimeout(450); await p.keyboard.up("Space");
await p.waitForFunction(() => { const d = window.__duel; return d.b.held && d.b.holdIdx === 2; }, null, { timeout: 4000, polling: "raf" });
await waitHoldEnd(70); await p.keyboard.down("Space"); await p.waitForTimeout(450); await p.keyboard.up("Space");
await p.waitForTimeout(900); let s = await st();
check("deflect both slashes: no damage, boss posture +22", s.php === 100 && s.bpost >= 20, s);

// A2: tapping guard twice within the spam window gives no deflect on the second tap
await setup(); await key("z", 30); await waitHoldEnd(200); await p.keyboard.down("Space"); await p.waitForTimeout(50); await p.keyboard.up("Space"); await p.waitForTimeout(40);
await waitHoldEnd(60); await p.keyboard.down("Space"); await p.waitForTimeout(300); await p.keyboard.up("Space"); await p.waitForTimeout(700); s = await st();
check("re-tapping guard too soon = no deflect (boss posture stays ~0)", s.bpost < 5, s);

// B: block (guard held long before impact -> chip damage + posture, no deflect)
await setup(); await p.keyboard.down("Space"); await p.waitForTimeout(500); await key("z", 30); await p.waitForTimeout(2200); await p.keyboard.up("Space"); s = await st();
check("block: chip damage + player posture, boss unaffected", s.php < 100 && s.php > 90 && s.ppost > 20 && s.bpost === 0, s);

// C: unguarded slash hurts
await setup(); await key("z", 30); await p.waitForTimeout(1400); s = await st();
check("no guard: takes damage", s.php < 90, s);

// D: roll through slash
await setup(); await key("z", 30); await waitHoldEnd(60); await key("Shift", 30); await p.waitForTimeout(1300); s = await st();
check("roll i-frames dodge the first slash", s.php >= 84, s);

// E: slip counter on thrust
await setup(); await key("c", 30); await waitHoldEnd(100); await key("Shift", 30); await p.waitForTimeout(900); s = await st();
check("thrust: roll gives SLIP (boss posture up, no damage)", s.bpost >= 25 && s.php === 100, s);

// F: thrust cannot be blocked
await setup(); await p.keyboard.down("Space"); await p.waitForTimeout(400); await key("c", 30); await p.waitForTimeout(1400); await p.keyboard.up("Space"); s = await st();
check("thrust is unblockable (full damage while guarding)", s.php <= 72, s);

// G: sweep hurts when standing, rolling avoids
await setup(); await key("v", 30); await p.waitForTimeout(1500); s = await st();
check("sweep hits a standing player", s.php < 85, s);
await setup(); await key("v", 30); await waitHoldEnd(70); await key("Shift", 30); await p.waitForTimeout(1200); s = await st();
check("sweep: roll avoids it", s.php === 100, s);

// H: grab ignores guard
await setup(); await p.keyboard.down("Space"); await p.waitForTimeout(400); await key("b", 30); await p.waitForTimeout(1600); await p.keyboard.up("Space"); s = await st();
check("grab ignores guard", s.php <= 66, s);

// I: kick breaks the boss guard
await setup({ dx: 38 }); await key("g", 30); await p.waitForTimeout(200); await key("e", 30); await p.waitForTimeout(500); s = await st();
check("kick breaks guard (boss flinches, posture up)", s.bpost >= 25, s);

// J: light chain A -> C -> B and damage
await setup(); const hp0 = (await st()).bhp; await key("j", 30); await p.waitForTimeout(260); await key("j", 30); await p.waitForTimeout(260); await key("j", 30); await p.waitForTimeout(900); s = await st();
check("light chain damages boss", s.bhp < hp0 - 20, { ...s, hp0 });

// K: posture break then deathblow advances the segment
await setup(); await p.evaluate(() => { window.__duel.b.posture = 96; });
await key("j", 30); await p.waitForTimeout(700); s = await st(); check("posture break puts boss in broken state", s.bmode === "broken", s);
await key("k", 30); await p.waitForTimeout(1200); s = await st(); check("deathblow advances to segment 2", s.seg === 1 && s.bmode !== "broken", s);

// L: gate sealed
await setup(); await p.evaluate(() => { const d = window.__duel; d.player.x = (d.world.gate.l + d.world.gate.r) / 2; d.player.y = d.world.gate.t - 20; });
await p.keyboard.down("s"); await p.waitForTimeout(1500); await p.keyboard.up("s");
const gy = await p.evaluate(() => ({ y: window.__duel.player.y, gate: window.__duel.world.gate.t }));
check("sealed gate blocks leaving", gy.y < gy.gate + 4, gy);

// N: heavy attack hits harder; heal restores hp and consumes a charge
await setup(); const h1 = (await st()).bhp; await key("k", 30); await p.waitForTimeout(1100); s = await st();
check("heavy deals more than a light", h1 - s.bhp >= 25, { dmg: h1 - s.bhp });
await setup(); await p.evaluate(() => { window.__duel.p.hp = 40; }); await key("q", 30); await p.waitForTimeout(1500);
const heal = await p.evaluate(() => ({ hp: window.__duel.p.hp, heals: window.__duel.p.heals }));
check("heal: +45 hp, one charge used", heal.hp === 85 && heal.heals === 2, heal);

// O: killing the last segment ends the fight and opens the gate
await setup(); await p.evaluate(() => { const d = window.__duel; d.b.seg = 1; d.b.hp = 10; d.b.posture = 0; });
await key("j", 30); await p.waitForTimeout(900); s = await st();
const open = await p.evaluate(() => window.__duel.world.gateOpen);
check("final segment dies, gate reopens", s.bmode === "dead" && open === true, { ...s, open });

// M: death + retry
await setup(); await p.evaluate(() => { const d = window.__duel; d.p.hp = 5; }); await key("z", 30); await p.waitForTimeout(1500); s = await st();
check("player can die", s.pmode === "dead", s);
await key("r", 30); await p.waitForTimeout(500); s = await st(); check("R resets the fight", s.php === 100 && s.pmode === "free", s);

console.log(errs.join("\n") || "no page errors");
console.log(`${results.filter(r => r[1]).length}/${results.length} passed`);
await b.close();
