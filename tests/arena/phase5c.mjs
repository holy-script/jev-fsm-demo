// The game flow in the browser: title, slots, pause, settings, rebinding, victory, defeat, saves, stats, ending, credits.
// Needs `npm run dev`. Jev is mocked. Run: node tests/arena/phase5c.mjs
import { chromium } from "playwright";
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(() => {
  window.__pad = { id: "fake pad", index: 0, connected: true, mapping: "standard", axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) };
  Object.defineProperty(window.__pad, "timestamp", { get: () => performance.now() });
  navigator.getGamepads = () => [window.__pad, null, null, null];
});
const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push("PAGEERR: " + (e.stack || e.message).split("\n").slice(0, 3).join(" | ")));
p.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errs.push("CONSOLE: " + m.text()));
await p.route("**/api/jev/ask", async (route) => {
  const q = JSON.parse(route.request().postData()).questions, answers = {};
  const pick = (n) => { const o = Object.keys(q[n].criteria); return { type: "choice", choice: o.includes("WAIT") ? "WAIT" : o[0], confidence: 0.9, probabilities: Object.fromEntries(o.map((k) => [k, k === (o.includes("WAIT") ? "WAIT" : o[0]) ? 0.7 : 0.3 / Math.max(1, o.length - 1)])) }; };
  if (q.next_action) answers.next_action = pick("next_action");
  if (q.gate_choice) answers.gate_choice = pick("gate_choice");
  for (const n of ["turtling", "roll_reliant", "trade_hungry", "panicking"]) if (q[n]) answers[n] = { type: "noul", noul: 0.3 };
  if (q.taunt) answers.taunt = { type: "choice", choice: "NONE", confidence: 1, probabilities: { NONE: 1 } };
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ answers }) });
});
const results = [];
const check = (name, cond, info) => { results.push(cond); console.log((cond ? "PASS " : "FAIL ") + name + "  " + JSON.stringify(info)); };
const scr = () => p.getAttribute("[data-screen]", "data-screen");
const waitScreen = (s, t = 8000) => p.waitForFunction((x) => document.querySelector("[data-screen]")?.getAttribute("data-screen") === x, s, { timeout: t });
const ls = (k) => p.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), k);
const sc = (fn) => p.evaluate(fn);
const boot = async (url = "/arena?nocard=1", clear = true) => {
  await p.goto("http://localhost:3000" + url, { waitUntil: "load" });
  if (clear) { await p.evaluate(() => localStorage.clear()); await p.reload({ waitUntil: "load" }); }
  await p.waitForFunction(() => window.__arena?.player, null, { timeout: 40000 });
  await p.waitForTimeout(700);
};

// ---- the page must render on the server (a client-only crash hides behind browser recovery)
for (const u of ["/arena", "/arena?dev=1", "/arena/lab"]) { const r = await ctx.request.get("http://localhost:3000" + u); check(`GET ${u} returns 200 (server render does not touch window)`, r.status() === 200, r.status()); }

// ---- dev skips the menus
await boot("/arena?dev=1&nocard=1", true);
check("?dev=1 goes straight into the fight (no title)", (await scr()) === "playing" && (await sc(() => window.__arena.mode)) === "play", await scr());

// ---- title
await boot();
check("non-dev starts on the title screen over a live backdrop (menu mode, AI idle, HUD hidden)", (await scr()) === "title" && (await sc(() => window.__arena.mode === "menu" && !window.__arena.e.auto && !window.__arena.hud.visible)), await scr());
check("Continue is disabled when there is no save", await p.getByTestId("continue").isDisabled(), "");
await p.keyboard.down("j"); await p.waitForTimeout(100); await p.keyboard.up("j");
check("game input is ignored on the title screen", !(await sc(() => window.__arena.log.some((l) => l.type === "attack"))), "");

// ---- new game in slot 1
await p.getByTestId("new-game").click();
check("New game opens the slot list", (await scr()) === "slots" && (await p.getByTestId("slot-1").innerText()).includes("Empty"), "");
await p.getByTestId("slot-1").getByRole("button", { name: "New" }).click();
await waitScreen("playing");
let st = await sc(() => ({ mode: window.__arena.mode, boss: window.__arena.boss.id, auto: window.__arena.e.auto, slot: window.__arena.run?.slot, hud: window.__arena.hud.visible }));
check("starting a run: play mode, boss 1 (Bladekeeper), AI on, HUD visible", st.mode === "play" && st.boss === "mb" && st.auto && st.slot === 1 && st.hud, st);
const sv0 = await ls("arena.save.1");
check("the save slot is written immediately", sv0 && sv0.bossIndex === 0 && sv0.cleared.length === 0, sv0);
check("the Jev strip is visible with the brain badge", (await p.getByTestId("jev-strip").innerText()).includes("JEV"), "");
await p.waitForFunction(() => document.querySelector('[data-testid="jev-last"]')?.textContent?.includes("[jev"), null, { timeout: 8000 });
check("the strip shows Jev's latest decision with source and latency", (await p.getByTestId("jev-last").innerText()).includes("[jev"), await p.getByTestId("jev-last").innerText());

// ---- pause
await p.keyboard.press("Escape"); await waitScreen("paused");
const paused = await sc(() => window.__game.scene.isPaused("arena"));
const t0 = await sc(() => window.__arena.now); await p.waitForTimeout(500); const t1 = await sc(() => window.__arena.now);
check("Esc pauses the game: scene paused and the simulation clock stops", paused && t1 === t0, { paused, t0, t1 });
await p.getByTestId("resume").click(); await waitScreen("playing");
const t2 = await sc(() => window.__arena.now); await p.waitForTimeout(400);
check("Resume continues the simulation", (await sc(() => window.__arena.now)) > t2, "");
await p.keyboard.press("Escape"); await waitScreen("paused"); const s1 = await scr(); await p.keyboard.press("Escape"); await waitScreen("playing");
check("Esc toggles pause both ways", s1 === "paused" && (await scr()) === "playing" && !(await sc(() => window.__game.scene.isPaused("arena"))), s1);
// pad Start pauses
await p.evaluate(() => { window.__pad.buttons[9] = { pressed: true, touched: true, value: 1 }; }); await waitScreen("paused", 4000);
await p.evaluate(() => { window.__pad.buttons[9] = { pressed: false, touched: false, value: 0 }; });
check("gamepad Start pauses", (await scr()) === "paused", await scr());
await p.getByTestId("resume").click(); await waitScreen("playing");

// ---- settings from the pause menu
await p.keyboard.press("Escape"); await waitScreen("paused");
await p.getByRole("button", { name: /Settings/ }).click(); await waitScreen("settings");
await p.getByTestId("qte-assist").click();
check("QTE mode Assist: saved and applied live to the scene", (await ls("arena.settings")).qte === "assist" && (await sc(() => window.__arena.settings.qte)) === "assist", await ls("arena.settings"));
await p.getByTestId("music").click();
check("music off: saved, applied, music stopped", (await ls("arena.settings")).music === false && (await sc(() => window.__arena.sfx.music === undefined)), "");
await p.getByTestId("music").click();
await p.getByTestId("brain-rules").click();
check("default brain Rules is saved", (await ls("arena.settings")).brain === "rules", "");
await p.getByTestId("brain-jev").click();
await p.getByTestId("sfx").fill("0.3");
check("sound volume slider is saved and applied", Math.abs((await sc(() => window.__arena.settings.sfx)) - 0.3) < 0.01, "");

// ---- rebinding
await p.getByTestId("bind-attack-0").click(); await p.keyboard.press("h");
let km = (await ls("arena.settings")).keymap;
check("click a binding, press a key: attack is now H, live in the scene", km.attack[0] === "H" && (await sc(() => window.__arena.inp.keymap.attack[0])) === "H", km.attack);
await p.getByTestId("bind-guard-0").click(); await p.keyboard.press("h"); km = (await ls("arena.settings")).keymap;
check("binding a key already used moves it (H leaves attack, which falls back to its default J)", km.guard[0] === "H" && !km.attack.includes("H") && km.attack[0] === "J", { attack: km.attack, guard: km.guard });
await p.getByTestId("bind-roll-0").click(); await p.keyboard.press("Escape");
check("Esc while listening cancels the rebind (and does not close the screen)", (await scr()) === "settings" && (await ls("arena.settings")).keymap.roll[0] === "SHIFT", await scr());
await p.getByTestId("reset-keys").click();
check("Reset keys restores the defaults", JSON.stringify((await ls("arena.settings")).keymap.attack) === '["J"]' && (await ls("arena.settings")).keymap.guard[0] === "SPACE", "");
await p.getByRole("button", { name: "Back", exact: true }).click(); await waitScreen("paused");
check("Back from settings returns to the pause menu (game still paused)", (await scr()) === "paused" && (await sc(() => window.__game.scene.isPaused("arena"))), await scr());
await p.getByTestId("resume").click(); await waitScreen("playing");

// ---- victory -> next boss, run saved
await sc(() => { const d = window.__arena; d.e.auto = false; d.e.hp = 0; d.killEnemy(); });
await waitScreen("victory", 6000);
check("victory screen names the boss and shows the fight line (brain, time, parries)", (await p.getByTestId("victory").innerText()).toLowerCase().includes("metal bladekeeper") && (await p.getByTestId("fightline").innerText()).includes("Jev"), await p.getByTestId("fightline").innerText());
const sv1 = await ls("arena.save.1");
check("the run is saved: bossIndex 1, cleared [mb]", sv1.bossIndex === 1 && sv1.cleared.join() === "mb", sv1);
const rec = await ls("arena.stats");
check("the fight is recorded with its brain (jev) and result (player won)", rec.length === 1 && rec[0].brain === "jev" && rec[0].won === true && rec[0].boss === "mb", rec[0]);
await p.getByTestId("next").click(); await waitScreen("playing");
check("Next loads the Crystal Mauler in the river area with the AI on", (await sc(() => ({ b: window.__arena.boss.id, a: window.__arena.area.def.id, auto: window.__arena.e.auto }))).b === "cm", "");

// ---- defeat -> retry
await sc(() => { const d = window.__arena; d.p.hp = 0; d.killPlayer(); });
await waitScreen("defeat", 6000);
check("defeat screen offers retry", await p.getByTestId("retry").isVisible(), "");
await p.getByTestId("retry").click(); await waitScreen("playing");
const sv2 = await ls("arena.save.1");
check("retry restarts the same boss; the death is counted in the save", sv2.deaths === 1 && (await sc(() => window.__arena.boss.id)) === "cm" && (await sc(() => window.__arena.p.hp)) === 100, sv2);

// ---- quit to title, continue
await p.keyboard.press("Escape"); await waitScreen("paused"); await p.getByTestId("quit").click(); await waitScreen("title");
check("quit returns to the title in menu mode", (await sc(() => window.__arena.mode)) === "menu", "");
check("Continue now names the next boss", (await p.getByTestId("continue").innerText()).toLowerCase().includes("crystal mauler") && !(await p.getByTestId("continue").isDisabled()), await p.getByTestId("continue").innerText());
await p.getByTestId("continue").click(); await waitScreen("playing");
check("Continue resumes the run at the Mauler", (await sc(() => window.__arena.boss.id)) === "cm" && (await sc(() => window.__arena.run.bossIndex)) === 1, "");

// ---- Jev vs rules: a rules-brain fight and a mixed fight
await p.keyboard.press("Escape"); await waitScreen("paused"); await p.getByRole("button", { name: /Settings/ }).click(); await waitScreen("settings"); await p.getByTestId("brain-rules").click(); await p.getByRole("button", { name: "Back", exact: true }).click(); await p.getByTestId("resume").click(); await waitScreen("playing");
await sc(() => window.__arena.retry());
check("with 'bosses think with Rules bot' a new fight starts on the rules brain", (await sc(() => window.__arena.brain.mode)) === "rules", "");
await sc(() => { const d = window.__arena; d.e.hp = 0; d.e.auto = false; d.killEnemy(); });
await waitScreen("victory", 6000);
const rec2 = await ls("arena.stats");
check("that fight is recorded as 'rules'", rec2[rec2.length - 1].brain === "rules", rec2.map((r) => r.brain));
await p.getByTestId("next").click(); await waitScreen("playing");
await p.keyboard.down("f"); await p.waitForTimeout(60); await p.keyboard.up("f"); await p.waitForTimeout(200);
check("F swaps the brain mid-fight (rules -> jev)", (await sc(() => window.__arena.brain.mode)) === "jev", "");
await sc(() => { const d = window.__arena; d.e.hp = 0; d.e.auto = false; d.killEnemy(); }); await waitScreen("victory", 6000);
const rec3 = await ls("arena.stats");
check("toggling the brain mid-fight tags the record 'mixed'", rec3[rec3.length - 1].brain === "mixed", rec3.map((r) => r.brain));
await p.getByTestId("quit").click(); await waitScreen("title");
await p.getByRole("button", { name: /Jev vs the rules bot/i }).click(); await waitScreen("stats");
const cmp = await p.getByTestId("compare").innerText();
check("the comparison table has Jev and Rules columns with Jev 2 fights (the win and the defeat), Rules 1 (mixed excluded)", /Fights\s+2\s+1/.test(cmp.replace(/\n/g, " ").replace(/\t/g, " ")), cmp.replace(/\s+/g, " "));
await p.getByRole("button", { name: "Back", exact: true }).click(); await waitScreen("title");

// ---- credits
await p.getByRole("button", { name: "Credits" }).click(); await waitScreen("credits");
const cr = await p.locator("[data-screen]").innerText();
check("credits name chierit, pimen and immunitys", /chierit/.test(cr) && /pimen/.test(cr) && /immunitys/.test(cr), "");
await p.getByRole("button", { name: "Back", exact: true }).click(); await waitScreen("title");

// ---- ending (last boss) and new run
await p.getByTestId("new-game").click(); await p.getByTestId("slot-2").getByRole("button", { name: "New" }).click(); await waitScreen("playing");
await sc(() => { const d = window.__arena; d.run.bossIndex = 3; d.loadBoss("echo"); d.e.auto = false; d.e.hp = 0; d.killEnemy(); });
await waitScreen("ending", 6000);
check("beating the last boss shows the ending with the Jev-vs-rules table", (await p.getByTestId("ending").innerText()).toLowerCase().includes("echo fades") && (await p.getByTestId("compare").isVisible()), "");
const sv3 = await ls("arena.save.2");
check("the finished run is saved as finished", sv3.finished === true && sv3.cleared.includes("echo"), sv3);
const memBefore = await ls("arena.memory");
await p.getByTestId("ngplus").click(); await waitScreen("playing");
check("a new run starts at boss 1 and the bosses keep their memory of you", (await sc(() => window.__arena.boss.id)) === "mb" && !!memBefore && !!(await ls("arena.memory")), Object.keys(memBefore ?? {}));

// ---- delete a slot, forget
await p.keyboard.press("Escape"); await waitScreen("paused"); await p.getByTestId("quit").click(); await waitScreen("title");
await p.getByTestId("new-game").click(); await p.getByTestId("slot-2").getByRole("button", { name: "Delete" }).click();
check("Delete empties the slot", (await ls("arena.save.2")) === null, "");
await p.getByRole("button", { name: "Back", exact: true }).click(); await p.getByRole("button", { name: /Settings/ }).click(); await waitScreen("settings");
await p.getByTestId("forget").click();
check("'Make the bosses forget me' clears memory and fight records", (await ls("arena.memory")) === null && (await ls("arena.stats")) === null, "");

check("no page or console errors", errs.length === 0, errs.slice(0, 3));
await p.screenshot({ path: process.env.SHOT || "/tmp/arena_phase5c.png" });
await b.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
