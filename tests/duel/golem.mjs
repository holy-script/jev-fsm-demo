// Needs `npm run dev` running and the duel assets built (see tools/README.md). Run: node tests/duel/golem.mjs
import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1300, height: 700 } });
const errs = []; p.on("pageerror", (e) => errs.push("PAGEERR: " + (e.stack || e.message).split("\n").slice(0, 3).join(" | ")));
const cfg = { idle: "STONE_FIST", gate: "ARM_SHOT" };
await p.route("**/api/jev/ask", async (route) => {
  const q = JSON.parse(route.request().postData()).questions; const pr = (c, ks) => Object.fromEntries(ks.map((k) => [k, k === c ? 0.8 : 0.2 / Math.max(1, ks.length - 1)]));
  const answers = q.next_action ? { next_action: { type: "choice", choice: cfg.idle, confidence: 0.8, probabilities: pr(cfg.idle, Object.keys(q.next_action.criteria)) } }
    : { gate_choice: { type: "choice", choice: cfg.gate, confidence: 0.8, probabilities: pr(cfg.gate, Object.keys(q.gate_choice.criteria)) } };
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ answers }) });
});
await p.addInitScript(() => localStorage.setItem("duel.settings", JSON.stringify({ beat: "classic", difficulty: "duelist", music: true, sfx: 0.8 }))); // legacy timing keeps these checks deterministic
await p.goto("http://localhost:3000/duel?dev=1", { waitUntil: "load" });
await p.waitForFunction(() => window.__duel?.player, null, { timeout: 30000 }); await p.waitForTimeout(800);
const results = []; const check = (n, c, i) => { results.push(c); console.log((c ? "PASS " : "FAIL ") + n + "  " + JSON.stringify(i)); };
const st = () => p.evaluate(() => { const d = window.__duel; return { php: Math.round(d.p.hp * 10) / 10, ppost: Math.round(d.p.posture * 10) / 10, bmode: d.b.mode, bpost: Math.round(d.b.posture * 10) / 10, bhp: d.b.hp, seg: d.b.seg, projs: d.projs.length, idx: d.bossIdx }; });
const setup = (dx = 150, boss = 1) => p.evaluate(([dx, boss]) => { const d = window.__duel; d.hud.brain = "JEV"; d.reset(boss); d.debugWake(); d.b.auto = false; d.refill(); d.boss.x = d.world.spawns.boss.x; d.boss.y = d.world.spawns.boss.y;
  d.player.x = d.boss.x - dx; d.player.y = d.boss.y; d.b.mode = "idle"; d.b.nextThink = 1e12; d.p.mode = "free"; d.p.invulnUntil = 0; d.b.cd = {}; d.b.armorUntil = 0; d.p.hp = 100; d.p.posture = 0; d.b.posture = 0; d.b.hp = d.def.segmentHp; d.b.seg = 0;
  if (!window.__spawnWrapped) { window.__spawnWrapped = true; window.__spawned = 0; const o = d.spawnProjectile.bind(d); d.spawnProjectile = (...a) => { window.__spawned++; return o(...a); }; } window.__spawned = 0; }, [dx, boss]);
const key = async (k, ms = 40) => { await p.keyboard.down(k); await p.waitForTimeout(ms); await p.keyboard.up(k); };
const projNear = (px) => p.waitForFunction((px) => { const d = window.__duel; return d.projs.length > 0 && Math.hypot(d.projs[0].x - d.player.x, d.projs[0].y - d.player.y) < px; }, px, { timeout: 6000, polling: "raf" });
const beamLocked = (extra = 40) => p.waitForFunction((e) => { const d = window.__duel; return d.b.held && d.b.holdIdx === 1 && d.time.now >= d.b.holdUntil - d.b.move.beam.lockMs + e; }, extra, { timeout: 6000, polling: "raf" });

// --- thrown fist
await setup(170); await key("x", 30); await projNear(34); await p.keyboard.down("Space"); await p.waitForTimeout(450); await p.keyboard.up("Space"); await p.waitForTimeout(1800); let s = await st();
check("fist: well-timed guard tap deflects it back and raises boss posture", s.php === 100 && s.bpost >= 14, s);
await setup(170); await p.keyboard.down("Space"); await p.waitForTimeout(300); await key("x", 30); await p.waitForTimeout(2200); await p.keyboard.up("Space"); s = await st();
check("fist: held guard only blocks (chip damage, player posture up)", s.php > 95 && s.php < 100 && s.ppost >= 20 && s.bpost === 0, s);
await setup(170); await key("x", 30); await p.waitForTimeout(2200); s = await st();
check("fist: unguarded player takes damage", s.php <= 84, s);
await setup(170); await key("x", 30); await projNear(80); await p.keyboard.down("d"); await key("Shift", 30); await p.keyboard.up("d"); await p.waitForTimeout(1500); s = await st();
check("fist: rolling through it (toward it) avoids damage", s.php === 100, s);

// --- laser
await setup(200); await key("c", 30); await p.waitForTimeout(2300); s = await st();
check("laser hits a standing player", s.php <= 70, s);
await setup(200); await p.keyboard.down("Space"); await p.waitForTimeout(300); await key("c", 30); await p.waitForTimeout(2300); await p.keyboard.up("Space"); s = await st();
check("laser is unblockable (guarding changes nothing)", s.php <= 70, s);
await setup(200); await key("c", 30); await beamLocked(40); await p.keyboard.down("w"); await p.waitForTimeout(900); await p.keyboard.up("w"); await p.waitForTimeout(700); s = await st();
check("laser: stepping off the line after the aim locks avoids it", s.php === 100, s);
await setup(200); await key("c", 30); await beamLocked(150); await p.keyboard.down("w"); await key("Shift", 30); await p.keyboard.up("w"); await p.waitForTimeout(1500); s = await st();
check("laser: a sideways roll avoids it", s.php === 100, s);

// --- stone guard
await setup(60); await key("g", 30); await p.waitForTimeout(300); const h0 = (await st()).bhp; await key("j", 30); await p.waitForTimeout(500); await key("e", 30); await p.waitForTimeout(500); s = await st();
check("stone guard shrugs off light attacks and kicks", s.bhp === h0 && s.bmode === "guard", s);
await key("k", 30); await p.waitForTimeout(900); s = await st();
check("a heavy attack breaks the stone guard", s.bmode !== "guard" && s.bpost >= 30, s);

// --- armor / flinch
await setup(60); const g0 = (await st()).bhp; await key("j", 30); await p.waitForTimeout(500); s = await st();
check("unarmored golem takes full damage and is never flinched", g0 - s.bhp >= 11 && s.bmode === "idle", { dmg: g0 - s.bhp, mode: s.bmode });
await setup(120); await key("v", 30); await p.waitForFunction(() => window.__duel.time.now < window.__duel.b.armorUntil, null, { timeout: 4000, polling: "raf" });
await p.evaluate(() => { const d = window.__duel; d.b.mode = "idle"; d.player.x = d.boss.x - 60; d.b.hp = d.def.segmentHp; });
await p.waitForTimeout(400); const a0 = (await st()).bhp; await key("j", 30); await p.waitForTimeout(500); s = await st();
check("armored: takes about half damage", a0 - s.bhp > 0 && a0 - s.bhp <= 7, { dmg: a0 - s.bhp });
const arm = await p.evaluate(() => window.__duel.hud.bossArmor); check("armor shows in the HUD state", arm === true, { arm });

// --- phase 2 and progression
await setup(170); await p.evaluate(() => { window.__duel.b.seg = 1; }); await key("x", 30); await p.waitForTimeout(2200); const sp = await p.evaluate(() => window.__spawned);
check("phase 2: arm shot fires two fists", sp === 2, { spawned: sp });
await setup(60, 0); await p.evaluate(() => { const d = window.__duel; d.b.seg = 1; d.b.hp = 5; d.p.hp = 50; d.p.heals = 1; }); await key("j", 30);
await p.waitForFunction(() => window.__duel.bossIdx === 1 && window.__duel.b.awake, null, { timeout: 9000, polling: 200 }).then(() => 0, () => 0);
s = await st(); const gate = await p.evaluate(() => ({ open: window.__duel.world.gateOpen, heals: window.__duel.p.heals, def: window.__duel.def.id }));
check("killing the Captain wakes the Golem with +40 HP and the gate sealed", s.idx === 1 && gate.def === "golem" && s.php >= 89 && gate.open === false && gate.heals === 2, { ...s, ...gate });

// --- Jev combo gate on the Golem (mocked API)
await setup(60); await p.evaluate(() => { const d = window.__duel; d.b.auto = true; d.b.mode = "recover"; d.b.until = d.time.now + 100; d.b.nextAsk = 0; });
const chained = await p.waitForFunction(() => window.__duel.b.move?.id === "ARM_SHOT", null, { timeout: 8000, polling: 100 }).then(() => true, () => false);
check("Jev branch gate: STONE_FIST chains into ARM_SHOT", chained, {});

console.log(errs.join("\n") || "no page errors"); console.log(`${results.filter(Boolean).length}/${results.length} passed`);
await b.close();
