// Audio wiring. Headless Chromium has no audible output, so this checks what the game asks for: cues per event, samples loaded, music per area.
// Needs `npm run dev` and `npm run assets:arena` (with public/duel-assets built for samples and music). Run: node tests/arena/phase5b.mjs
import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"] });
const p = await b.newPage({ viewport: { width: 1100, height: 640 } });
const errs = [];
p.on("pageerror", (e) => errs.push("PAGEERR: " + (e.stack || e.message).split("\n").slice(0, 3).join(" | ")));
p.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errs.push("CONSOLE: " + m.text()));
await p.route("**/api/jev/ask", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "off" }) }));
await p.goto("http://localhost:3000/arena?dev=1&nocard=1&qte=on", { waitUntil: "load" });
await p.waitForFunction(() => window.__arena?.player, null, { timeout: 40000 });
await p.waitForTimeout(800);
const results = [];
const check = (name, cond, info) => { results.push(cond); console.log((cond ? "PASS " : "FAIL ") + name + "  " + JSON.stringify(info)); };
// count every cue the scene asks for
await p.evaluate(() => {
  const d = window.__arena; window.__cues = [];
  for (const n of ["swing", "hit", "deflect", "block", "hurt", "roll", "warn", "postureBreak", "deathblow", "clash", "locked", "spirit", "riposteReady", "slip", "skill", "blip"]) {
    const orig = d.sfx[n].bind(d.sfx); d.sfx[n] = (...a) => { window.__cues.push(n + (n === "swing" ? (a[1] ? ":boss" : ":hero") : "")); return orig(...a); };
  }
});
const setup = (boss = "mb", gap = 100) => p.evaluate(({ id, g }) => { const d = window.__arena; if (d.boss.id !== id) d.loadBoss(id); else d.reset(); d.e.auto = false; d.e.thinkAt = 1e12; d.player.x = 500; d.player.y = 400; d.enemy.x = 500 + g; d.enemy.y = 400; window.__cues.length = 0; }, { id: boss, g: gap });
const cues = () => p.evaluate(() => [...window.__cues]);
const key = async (k, ms = 40) => { await p.keyboard.down(k); await p.waitForTimeout(ms); await p.keyboard.up(k); };
const enemyAttack = (id) => p.evaluate((i) => { const d = window.__arena; d.__t0 = d.now; d.forceEnemyAttack(i); }, id);
const waitSim = (ms) => p.waitForFunction((m) => window.__arena.now - window.__arena.__t0 >= m, ms, { timeout: 8000, polling: "raf" });

// ---- assets
const a = await p.evaluate(() => { const d = window.__arena, c = d.cache.audio; return { clash: [1, 5, 10].every((i) => c.exists("clash" + i)), blade: [1, 5, 10].every((i) => c.exists("blade" + i)), music: ["captain", "temple", "crypt", "final"].every((k) => c.exists("music_" + k)) }; });
check("sword samples and area music tracks are loaded", a.clash && a.blade && a.music, a);
const mus = [];
for (const id of ["mb", "cm", "wh", "echo"]) { await setup(id); mus.push(await p.evaluate(() => window.__arena.sfx.music?.key)); }
check("each area plays its own track (captain, temple, crypt, final)", mus.join() === "music_captain,music_temple,music_crypt,music_final", mus);

// ---- cues
await setup(); await key("j", 30); await p.waitForTimeout(300); let c = await cues();
check("player attack: hero swing then hit", c.includes("swing:hero") && c.includes("hit"), c);
await setup(); await enemyAttack("SLASH"); await waitSim(470); await key("Space", 400); await p.waitForTimeout(400); c = await cues();
check("deflect: boss swing, deflect, riposteReady", c.includes("swing:boss") && c.includes("deflect") && c.includes("riposteReady"), c);
await setup(); await p.keyboard.down("Space"); await p.waitForTimeout(450); await enemyAttack("SLASH"); await waitSim(900); await p.keyboard.up("Space"); c = await cues();
check("block cue on a held guard", c.includes("block") && !c.includes("deflect"), c);
await setup(); await enemyAttack("SLASH"); await waitSim(900); c = await cues();
check("being hit: hurt cue", c.includes("hurt"), c);
await setup(); await key("Shift", 40); await p.waitForTimeout(100); c = await cues();
check("roll cue", c.includes("roll"), c);
await setup(); await enemyAttack("BLOOM"); await p.waitForTimeout(100); c = await cues();
check("a perilous attack sounds its warning at the start of the telegraph", c.includes("warn"), c);
await setup(); await p.evaluate(() => { window.__arena.e.posture = 100; window.__arena.breakEnemy(); }); c = await cues();
check("posture break cue", c.includes("postureBreak"), c);
await setup(); await p.evaluate(() => { const d = window.__arena; d.qteKeys = ["J", "K", "L"]; d.e.posture = 100; d.breakEnemy(); window.__cues.length = 0; }); await key("j", 30);
await p.waitForFunction(() => window.__arena.qte, null, { timeout: 2000 }); await key("k", 30); c = await cues();
check("QTE: a wrong/early press gives the 'locked' cue", c.includes("locked"), c);
await p.waitForFunction(() => !window.__arena.qte, null, { timeout: 8000 }); await p.waitForTimeout(300); c = await cues();
check("deathblow finisher sound (hit or deathblow)", c.includes("hit") || c.includes("deathblow"), c);
await setup(); await p.evaluate(() => (window.__arena.e.hp = 3)); await key("j", 30); await p.waitForTimeout(500); c = await cues();
check("victory plays the deathblow cue", c.includes("deathblow"), c);
await setup(); await enemyAttack("SLASH"); await waitSim(420); await key("j", 30); await p.waitForFunction(() => window.__arena.qteKind === "clash", null, { timeout: 3000, polling: "raf" }); c = await cues();
check("clash cue when the swings meet", c.includes("clash"), c);
await setup(); await p.evaluate(() => (window.__arena.p.spirit = 3)); await key("e", 30); await p.waitForTimeout(200); c = await cues();
check("flame burst skill cue", c.includes("skill"), c);
await setup(); await p.evaluate(() => { window.__arena.settings.sfx = 0; });
const silent = await p.evaluate(() => window.__arena.sfx.out());
check("volume 0 produces no output node (nothing is synthesised)", silent === null, silent);
await p.evaluate(() => { window.__arena.settings.sfx = 0.8; });

check("no page or console errors", errs.length === 0, errs.slice(0, 3));
await b.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
