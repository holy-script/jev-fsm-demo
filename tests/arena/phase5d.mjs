// HUD behaviour (plates, spirit flames, damage trail, name plate, help fade). Needs `npm run dev`. Run: node tests/arena/phase5d.mjs
import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1100, height: 640 } });
const errs = [];
p.on("pageerror", (e) => errs.push("PAGEERR: " + (e.stack || e.message).split("\n").slice(0, 3).join(" | ")));
p.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errs.push("CONSOLE: " + m.text()));
await p.route("**/api/jev/ask", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "off" }) }));
await p.goto("http://localhost:3000/arena?dev=1&nocard=1&boss=wh", { waitUntil: "load" });
await p.waitForFunction(() => window.__arena?.player, null, { timeout: 40000 });
await p.waitForTimeout(600);
const results = [];
const check = (name, cond, info) => { results.push(cond); console.log((cond ? "PASS " : "FAIL ") + name + "  " + JSON.stringify(info)); };
await p.evaluate(() => { const d = window.__arena; d.e.auto = false; d.e.thinkAt = 1e12; });

const names = await p.evaluate(() => ({ n: window.__arena.texts.enemyName.text, t: window.__arena.texts.enemyTitle.text }));
check("the name plate shows the boss name and the title under the bar", names.n === "Wind Hashashin" && names.t === "The Gale That Cuts", names);
const objs = await p.evaluate(() => ({ plates: window.__arena.hudObjects.filter((o) => o.type === "NineSlice").length, banner: window.__arena.hudObjects.filter((o) => o.texture?.key === "ui_44").length, pips: window.__arena.pips.length }));
check("five nine-slice plates (HP bars + skill slots), a parchment banner and five spirit flames exist", objs.plates === 5 && objs.banner === 1 && objs.pips === 5, objs);

await p.evaluate(() => { window.__arena.p.spirit = 2.5; }); await p.waitForTimeout(150);
const pips = await p.evaluate(() => window.__arena.pips.map((i) => i.texture.key));
check("spirit 2.5: two full flames, the rest faded", pips.join() === "ui_31,ui_31,ui_37,ui_37,ui_37", pips);

// trail: after damage the trail stays above the real value, then eases down
await p.evaluate(() => { const d = window.__arena; d.p.hp = 100; d.trail.p = 1; });
await p.waitForTimeout(100);
await p.evaluate(() => { window.__arena.p.hp = 50; }); await p.waitForTimeout(120);
const t1 = await p.evaluate(() => window.__arena.trail.p); await p.waitForTimeout(700); const t2 = await p.evaluate(() => window.__arena.trail.p);
check("the health trail lags above the real value after damage, then drops toward it", t1 > 0.5 && t2 < t1 && t2 >= 0.5, { t1, t2 });
await p.evaluate(() => { window.__arena.p.hp = 100; }); await p.waitForTimeout(120);
check("healing moves the trail up at once", (await p.evaluate(() => window.__arena.trail.p)) >= 0.99, "");

// HUD hidden on the title (menu mode), shown in play
await p.evaluate(() => window.__arena.setHudVisible(false)); await p.waitForTimeout(80);
const hid = await p.evaluate(() => ({ g: window.__arena.hud.visible, plate: window.__arena.hudObjects.every((o) => !o.visible), name: window.__arena.texts.enemyName.visible }));
check("setHudVisible(false) hides graphics, plates, banner, flames and texts", !hid.g && hid.plate && !hid.name, hid);
await p.evaluate(() => window.__arena.setHudVisible(true));

// help text fades after about 9 s of play
const h0 = await p.evaluate(() => window.__arena.texts.help.alpha);
await p.evaluate(() => { window.__arena.now = 13000; }); await p.waitForTimeout(150);
const h1 = await p.evaluate(() => window.__arena.texts.help.alpha);
check("the controls hint is visible at the start and gone after 12 s", h0 > 0.9 && h1 === 0, { h0, h1 });

// QTE prompt shows the bound key (not a hard-coded letter)
await p.evaluate(() => { const d = window.__arena; d.reset(); d.e.auto = false; d.e.thinkAt = 1e12; d.settings.keymap.attack = ["H"]; d.inp.setKeymap(d.settings.keymap); d.qteKeys = ["J", "K", "L"]; d.e.posture = 100; d.breakEnemy(); d.player.x = 500; d.enemy.x = 600; });
await p.keyboard.down("h"); await p.waitForTimeout(40); await p.keyboard.up("h");
await p.waitForFunction(() => window.__arena.qte, null, { timeout: 2000 }); await p.waitForTimeout(150);
const lab = await p.evaluate(() => window.__arena.texts.qtekey.text);
check("the QTE prompt shows the key the player bound (H, not J)", lab === "H", lab);

check("no page or console errors", errs.length === 0, errs.slice(0, 3));
await b.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
