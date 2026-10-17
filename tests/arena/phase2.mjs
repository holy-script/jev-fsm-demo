// Needs `npm run dev` running and the arena assets built. Run: node tests/arena/phase2.mjs
import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1100, height: 640 } });
const errs = [];
p.on("pageerror", (e) => errs.push("PAGEERR: " + (e.stack || e.message).split("\n").slice(0, 3).join(" | ")));
p.on("console", (m) => m.type() === "error" && errs.push("CONSOLE: " + m.text() + " " + (m.location().url || "")));
await p.goto("http://localhost:3000/arena?dev=1&qte=on", { waitUntil: "load" });
await p.waitForFunction(() => window.__arena?.player, null, { timeout: 40000 });
await p.waitForTimeout(600);
const results = [];
const check = (name, cond, info) => { results.push(cond); console.log((cond ? "PASS " : "FAIL ") + name + "  " + JSON.stringify(info)); };
const setup = (gap = 100, qte = "on") => p.evaluate(({ g, q }) => {
  const d = window.__arena; d.reset(); d.settings.qte = q; d.qteKeys = ["J", "K", "L"]; d.e.auto = false; d.e.thinkAt = 1e12;
  d.player.x = 500; d.player.y = 400; d.enemy.x = 500 + g; d.enemy.y = 400;
}, { g: gap, q: qte });
const key = async (k, ms = 40) => { await p.keyboard.down(k); await p.waitForTimeout(ms); await p.keyboard.up(k); };
const st = () => p.evaluate(() => { const d = window.__arena; return { php: d.p.hp, ppost: Math.round(d.p.posture), pmode: d.p.mode, spirit: d.p.spirit, ehp: d.e.hp, epost: Math.round(d.e.posture), emode: d.e.mode, log: d.log.map((l) => ({ ...l })) }; });
const enemyAttack = (id) => p.evaluate((i) => { const d = window.__arena; d.__t0 = d.now; d.forceEnemyAttack(i); }, id);
const waitSim = (ms) => p.waitForFunction((m) => window.__arena.now - window.__arena.__t0 >= m, ms, { timeout: 6000, polling: "raf" });
const outcome = (s, i = 0) => s.log.filter((l) => l.type === "enemyHit")[i]?.outcome;
const breakEnemy = () => p.evaluate(() => { const d = window.__arena; d.e.posture = 100; d.breakEnemy(); });
/** wait until the current QTE ring is `offset` ms from closing (negative = early), then press the key */
const pressPrompt = async (key, offset) => {
  await p.waitForFunction((o) => { const q = window.__arena.qte; return q && q.current && q.t >= q.current.windowMs + o; }, offset, { timeout: 4000, polling: "raf" });
  await key_(key);
};
const key_ = (k) => key(k.toLowerCase(), 30);

// A: deathblow QTE, three perfect presses = EXECUTE (70)
await setup(); await breakEnemy(); await key("j", 30);
await p.waitForFunction(() => window.__arena.p.mode === "qte" && window.__arena.qte, null, { timeout: 2000 });
const slow = await p.evaluate(() => window.__arena.timeScale);
await pressPrompt("J", -25); await pressPrompt("K", -25); await pressPrompt("L", -25);
await p.waitForTimeout(600); let s = await st();
let db = s.log.find((l) => l.type === "deathblow");
check("QTE starts in slow motion when a broken enemy is attacked", slow < 0.5, { slow });
check("three perfect presses = EXECUTE for 70", db && db.grade === "execute" && db.dmg === 70 && s.ehp === 90, { db, ehp: s.ehp });
check("execute grants +2 spirit and the player is free again after the finisher", s.spirit >= 2 && s.pmode !== "qte", { spirit: s.spirit, mode: s.pmode });

// B: one perfect, one good (early), one miss = CLEAN (45)
await setup(); await breakEnemy(); await key("j", 30); await p.waitForFunction(() => window.__arena.qte, null, { timeout: 2000 });
await pressPrompt("J", -25); await pressPrompt("K", -170); await key_("J"); // third prompt expects L: wrong key = miss
await p.waitForTimeout(500); s = await st(); db = s.log.find((l) => l.type === "deathblow");
check("perfect + good + miss = CLEAN for 45", db && db.grade === "clean" && db.perfect === 1 && db.good === 1 && db.miss === 1 && db.dmg === 45, { db });

// C: mashing early/wrong = SCUFFED (20)
await setup(); await breakEnemy(); await key("j", 30); await p.waitForFunction(() => window.__arena.qte, null, { timeout: 2000 });
await key_("J"); await key_("J"); await key_("J"); await p.waitForTimeout(500); s = await st(); db = s.log.find((l) => l.type === "deathblow");
check("mashing too early = SCUFFED for 20", db && db.grade === "scuffed" && db.dmg === 20, { db });

// D: ignoring the prompts also scuffs it (timeout)
await setup(); await breakEnemy(); await key("j", 30); await p.waitForFunction(() => window.__arena.qte, null, { timeout: 2000 });
await p.waitForFunction(() => !window.__arena.qte, null, { timeout: 8000 }); await p.waitForTimeout(300); s = await st(); db = s.log.find((l) => l.type === "deathblow");
check("no input: the QTE times out as SCUFFED", db && db.grade === "scuffed" && db.miss === 3, { db });

// E: assist stretches the window; off skips the QTE (plain x2.5 deathblow)
await setup(100, "assist"); await breakEnemy(); await key("j", 30); await p.waitForFunction(() => window.__arena.qte, null, { timeout: 2000 });
const win = await p.evaluate(() => window.__arena.qte.prompts[0].windowMs); check("assist: prompt window x1.6 (1152 ms)", Math.round(win) === 1152, { win });
await setup(100, "off"); await breakEnemy(); await key("j", 30); await p.waitForTimeout(500); s = await st();
check("qte off: no QTE, the hit is a deathblow (x2.5 = 20)", !s.log.some((l) => l.type === "qteStart") && s.log.some((l) => l.type === "playerHit" && l.broken && l.dmg === 20), s.log.filter((l) => l.type === "playerHit"));

// F: perilous BLOOM, counter with an attack press just before it lands
await setup(); await enemyAttack("BLOOM"); await p.waitForFunction(() => window.__arena.e.strikeAt - window.__arena.now <= 110, null, { polling: "raf", timeout: 4000 });
await key("j", 30); await p.waitForTimeout(700); s = await st();
check("perilous: attack press inside the counter window = COUNTERED", outcome(s) === "countered" && s.php === 100, { out: outcome(s), hp: s.php });
check("counter: enemy posture +45 and +1 spirit", s.epost >= 44 && s.spirit >= 1, { epost: s.epost, spirit: s.spirit });

// G: perilous cannot be blocked
await setup(); await p.keyboard.down("Space"); await p.waitForTimeout(300); await enemyAttack("BLOOM"); await waitSim(1300); s = await st(); await p.keyboard.up("Space");
check("perilous ignores guard: full damage 24", outcome(s) === "hit" && s.php === 76, { out: outcome(s), hp: s.php });

// H: too early an attack press does not counter
await setup(); await enemyAttack("BLOOM"); await waitSim(250); await key("j", 30); await waitSim(1300); s = await st();
check("perilous: an early attack press is not a counter", outcome(s) === "hit", { out: outcome(s) });

// I: roll through it = SLIP
await setup(); await enemyAttack("BLOOM"); await p.waitForFunction(() => window.__arena.e.strikeAt - window.__arena.now <= 140, null, { polling: "raf", timeout: 4000 }); await key("Shift", 40); await p.waitForTimeout(900); s = await st();
check("perilous: roll i-frames SLIP it (no damage, posture +20, spirit +0.5)", outcome(s) === "dodged" && s.php === 100 && s.epost >= 19 && s.spirit >= 0.5, { out: outcome(s), epost: s.epost, spirit: s.spirit });

// J: clash, won by mashing
await setup(); await enemyAttack("SLASH"); await waitSim(420); await key("j", 30);
await p.waitForFunction(() => window.__arena.qteKind === "clash", null, { timeout: 3000, polling: "raf" });
for (let i = 0; i < 8; i++) await key("j", 25);
await p.waitForTimeout(900); s = await st(); let ce = s.log.find((l) => l.type === "clashEnd");
check("clash: mashing J wins it, the enemy is thrown back (no damage)", ce && ce.won && s.php === 100 && s.log.some((l) => l.type === "clashStart"), { ce, hp: s.php });
const rev = s.emode;

// K: clash lost without input
await setup(); await enemyAttack("SLASH"); await waitSim(420); await key("j", 30);
await p.waitForFunction(() => window.__arena.qteKind === "clash", null, { timeout: 3000, polling: "raf" });
await p.waitForFunction(() => window.__arena.qteKind === null, null, { timeout: 4000 }); await p.waitForTimeout(300); s = await st(); ce = s.log.find((l) => l.type === "clashEnd");
check("clash: no mashing loses it (7 damage, player staggered)", ce && !ce.won && s.php === 93, { ce, hp: s.php });

// L: Flame Burst needs 2 spirit, then costs it
await setup(); await key("e", 30); await p.waitForTimeout(300); s = await st();
check("flame burst without spirit does nothing", !s.log.some((l) => l.type === "skill"), s.log);
await setup(); await p.evaluate(() => (window.__arena.p.spirit = 3)); await key("e", 30); await p.waitForTimeout(1500); s = await st();
const fh = s.log.find((l) => l.type === "playerHit" && l.id === "FLAME");
check("flame burst: -2 spirit, hits for 24 and 34 posture", s.log.some((l) => l.type === "skill") && fh && fh.dmg === 24 && s.epost >= 33 && s.spirit < 1.5, { fh, epost: s.epost, spirit: s.spirit });

// M: a deflect gives +1 spirit
await setup(); await enemyAttack("SLASH"); await waitSim(470); await key("Space", 400); await p.waitForTimeout(400); s = await st();
check("deflect grants +1 spirit", outcome(s) === "deflected" && s.spirit >= 1, { spirit: s.spirit });

await p.screenshot({ path: process.env.SHOT || "/tmp/arena_phase2.png" });
check("no page or console errors", errs.length === 0, errs.slice(0, 3));
await b.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
