// Needs `npm run dev` running and the arena assets built. Run: node tests/arena/phase4.mjs
import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1100, height: 640 } });
const errs = [];
p.on("pageerror", (e) => errs.push("PAGEERR: " + (e.stack || e.message).split("\n").slice(0, 3).join(" | ")));
p.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errs.push("CONSOLE: " + m.text()));
await p.route("**/api/jev/ask", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "off" }) }));
await p.goto("http://localhost:3000/arena?dev=1", { waitUntil: "load" });
await p.waitForFunction(() => window.__arena?.player, null, { timeout: 40000 });
await p.waitForTimeout(800);
const results = [];
const check = (name, cond, info) => { results.push(cond); console.log((cond ? "PASS " : "FAIL ") + name + "  " + JSON.stringify(info)); };
const load = (id) => p.evaluate((i) => { const d = window.__arena; d.loadBoss(i); d.e.auto = false; d.e.thinkAt = 1e12; }, id);

// 1: data validation: every stamp key exists as a manifest entry AND a loaded texture; obstacles are sane
const bad = await p.evaluate(() => {
  const d = window.__arena, out = [];
  for (const a of Object.values(window.__areas)) {
    for (const s of a.stamps) { if (!d.manifest.env[s.k]) out.push(`${a.id}:${s.k} not in manifest`); else if (!d.textures.exists(s.k)) out.push(`${a.id}:${s.k} not loaded`); }
    if (!d.textures.exists(a.ground.fill)) out.push(`${a.id} fill ${a.ground.fill}`);
    for (const o of a.obstacles) if (o.x < 0 || o.x > 960 || o.y < 0 || o.y > 540 || o.r <= 0) out.push(`${a.id} obstacle ${JSON.stringify(o)}`);
    if (a.portal && !d.textures.exists("env_portal")) out.push("portal texture");
  }
  for (const bb of Object.values(window.__bosses)) if (!window.__areas[bb.area]) out.push(`boss ${bb.id} area ${bb.area}`);
  return out;
});
check("every stamp, fill, portal and boss->area reference resolves to a loaded texture", bad.length === 0, bad);

// 2: each boss loads its own area
const areas = [];
for (const id of ["mb", "cm", "wh", "echo"]) { await load(id); areas.push(await p.evaluate(() => window.__arena.area.def.id)); }
check("mb, cm, wh, echo load forest, river, ruins, gate", areas.join() === "forest,river,ruins,gate", areas);

// 3: no leak when switching areas repeatedly
await load("mb"); await p.waitForTimeout(2800);   // let the first title card finish
const n0 = await p.evaluate(() => window.__arena.children.length);
for (let i = 0; i < 12; i++) await load(["cm", "wh", "echo", "mb"][i % 4]);
await p.waitForTimeout(3200);
const n1 = await p.evaluate(() => window.__arena.children.length);
check("12 area switches do not leak display objects", Math.abs(n1 - n0) <= 12, { n0, n1 });

// 4: title card
await load("cm"); await p.waitForTimeout(500);
const card = await p.evaluate(() => window.__arena.children.list.filter((c) => c.type === "Text" && /RIVER SHRINE/.test(c.text)).length);
await p.waitForTimeout(3200);
const gone = await p.evaluate(() => window.__arena.children.list.filter((c) => c.type === "Text" && /RIVER SHRINE/.test(c.text)).length);
check("area title card appears, then removes itself", card === 1 && gone === 0, { card, gone });

// 5: obstacle collision (forest: stump at 790,440 r18)
await load("mb"); await p.evaluate(() => { const d = window.__arena; d.reset(); d.e.auto = false; d.e.thinkAt = 1e12; d.enemy.x = 300; d.enemy.y = 300; d.player.x = 690; d.player.y = 440; });
await p.keyboard.down("d"); await p.waitForTimeout(1600); await p.keyboard.up("d");
const col = await p.evaluate(() => { const d = window.__arena, o = d.area.obstacles.find((q) => q.x === 790 && q.y === 440); const ox = d.player.x - o.x, oy = (d.player.y - o.y) / 0.55; return { x: Math.round(d.player.x), dist: Math.round(Math.hypot(ox, oy)), min: o.r + d.player.radius * 0.6 }; });
check("walking into the stump stops at its edge (not through it)", col.dist >= col.min - 1 && col.x < 790, col);

// 6: both fighters are pushed out of an obstacle they are placed in
await p.evaluate(() => { const d = window.__arena; d.player.x = 790; d.player.y = 440; });
await p.keyboard.down("a"); await p.waitForTimeout(80); await p.keyboard.up("a");
const pushed = await p.evaluate(() => { const d = window.__arena, o = { x: 790, y: 440, r: 18 }; return Math.hypot(d.player.x - o.x, (d.player.y - o.y) / 0.55) >= o.r + d.player.radius * 0.6 - 1; });
check("a fighter standing inside an obstacle is pushed out on its next step", pushed, pushed);

// 7: depth sorting: props sort with the fighters by y
const depth = await p.evaluate(() => { const d = window.__arena; const sorted = d.area.objects.filter((o) => o.type === "Image" && o.depth >= 10 && o.depth < 20); const ok = sorted.every((o) => Math.abs(o.depth - (10 + o.y / 100)) < 1e-6); d.player.y = 400; d.player.tick(0); return { n: sorted.length, ok, playerDepth: d.player.sprite.depth }; });
check("props use the same depth rule as fighters (10 + y/100)", depth.ok && depth.n > 5 && Math.abs(depth.playerDepth - 14) < 1e-6, depth);

// 8: layers: ground fill, ambient multiply, vignette, particles
const lay = await p.evaluate(() => { const d = window.__arena; const l = d.area.objects; return { tile: l.filter((o) => o.type === "TileSprite").length, rect: l.filter((o) => o.type === "Rectangle" && o.blendMode === 2).length, vig: l.filter((o) => o.type === "Image" && o.texture.key === "vignette").length, emitters: l.filter((o) => o.type === "ParticleEmitter").length }; });
check("each area has a ground fill, a multiply ambient layer, a vignette and a particle emitter", lay.tile >= 1 && lay.rect === 1 && lay.vig === 1 && lay.emitters === 1, lay);

// 9: river water animates
await load("cm"); const w0 = await p.evaluate(() => window.__arena.area.waterA.tilePositionX); await p.waitForTimeout(600); const w1 = await p.evaluate(() => window.__arena.area.waterA.tilePositionX);
check("river water scrolls over time", w1 > w0, { w0, w1 });

// 10: gate portal animates
await load("echo"); await p.waitForTimeout(500);
const por = await p.evaluate(() => { const s = window.__arena.area.objects.find((o) => o.type === "Sprite" && o.texture.key === "env_portal"); const f0 = s.anims.currentFrame.index; return { playing: s.anims.isPlaying, f0 }; });
await p.waitForTimeout(400); const f1 = await p.evaluate(() => window.__arena.area.objects.find((o) => o.type === "Sprite" && o.texture.key === "env_portal").anims.currentFrame.index);
check("the gate portal animation is running", por.playing && f1 !== por.f0, { por, f1 });

// 11: combat still works inside every area (a parry in each)
const res = [];
for (const id of ["mb", "cm", "wh", "echo"]) {
  await load(id); await p.evaluate(() => { const d = window.__arena; d.reset(); d.e.auto = false; d.e.thinkAt = 1e12; d.player.x = 480; d.player.y = 400; d.enemy.x = 580; d.enemy.y = 400; d.p.hp = 100; });
  const atk = await p.evaluate(() => Object.keys(window.__arena.boss.attacks).find((k) => !window.__arena.boss.attacks[k].perilous));
  await p.evaluate((a) => { const d = window.__arena; d.__t0 = d.now; d.forceEnemyAttack(a); }, atk);
  await p.waitForTimeout(3000); res.push(await p.evaluate(() => window.__arena.log.some((l) => l.type === "enemyHit")));
}
check("an attack resolves in each of the four areas", res.every(Boolean), res);

check("no page or console errors", errs.length === 0, errs.slice(0, 3));
await p.screenshot({ path: process.env.SHOT || "/tmp/arena_phase4.png" });
await b.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
