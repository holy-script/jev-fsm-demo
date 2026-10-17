import { chromium } from "playwright";
import fs from "fs";
// Downloads the free itch.io packs the game uses into assets/_dl (gitignored). Usage: node tools/itch_download.mjs
// Then: npm run assets   (unzips nothing - see tools/README.md for the unzip one-liner)
// Usage: node tools/itch_download.mjs [boss-rush|duel|arena]   (default boss-rush)
const SETS = {
  "boss-rush": {
    out: "../assets/_dl",
    urls: [
      "https://luizmelo.itch.io/hero-knight-2",
      "https://luizmelo.itch.io/monsters-creatures-fantasy-2",
      "https://luizmelo.itch.io/fire-worm",
      "https://luizmelo.itch.io/evil-wizard-3",
      "https://luizmelo.itch.io/tiny-platformer-hills-asset-pack",
      "https://clembod.itch.io/bringer-of-death-free",
    ],
  },
  duel: {
    out: "../assets/_dl2",
    urls: [
      "https://szadiart.itch.io/hero-and-opponents-animation",
      "https://pixel-boy.itch.io/ninja-adventure-asset-pack",
      "https://darkpixel-kronovi.itch.io/mecha-golem-free",
    ],
  },
  arena: {
    out: "../assets/_dl4",
    urls: [
      "https://pimen.itch.io/battle-vfx-hit-spark",
      "https://pimen.itch.io/battle-vfx-slashes-and-thrusts",
      "https://pimen.itch.io/wood-spell-effect",
      "https://pimen.itch.io/acid-spell-effect",
      "https://pimen.itch.io/dark-spell-effect",
      "https://pimen.itch.io/holy-spell-effect",
      "https://pimen.itch.io/halloween-special-effects",
      "https://pimen.itch.io/ice-spell-effect-01",
      "https://pimen.itch.io/smoke-n-dust-03",
      "https://pimen.itch.io/smoke-vfx-1",
      "https://pimen.itch.io/thunder-spell-effect-02",
      "https://pimen.itch.io/thunder-spell-effect-01",
      "https://pimen.itch.io/earth-spell-effect-2",
      "https://pimen.itch.io/earth-spell-effect-01",
      "https://pimen.itch.io/wind-spell-effect",
      "https://pimen.itch.io/wind",
      "https://pimen.itch.io/fire-spell-effect-02",
      "https://pimen.itch.io/fire-spell",
      "https://pimen.itch.io/water-spell-effect-02",
      "https://pimen.itch.io/magical-water-effect",
      "https://pimen.itch.io/cutting-and-healing",
      "https://pimen.itch.io/pixel-battle-effects",
      "https://pimen.itch.io/magical-animation-effects",
      "https://chierit.itch.io/elementals-fire-knight",
      "https://chierit.itch.io/elementals-metal-bladekeeper",
      "https://chierit.itch.io/elementals-crystal-mauler",
      "https://chierit.itch.io/elementals-wind-hashashin",
      "https://chierit.itch.io/elementals-water-priestess",
      "https://chierit.itch.io/elementals-ground-monk",
      "https://chierit.itch.io/elementals-leaf-ranger",
      "https://chierit.itch.io/free-cthulu",
      "https://chierit.itch.io/boss-demon-slime",
      "https://chierit.itch.io/boss-frost-guardian",
      "https://chierit.itch.io/lively-npcs",
      "https://immunitys.itch.io/fm32x32",
      "https://immunitys.itch.io/resurected-rpg-tile",
      "https://immunitys.itch.io/pixel-ui-pack",
      "https://immunitys.itch.io/icon-pack-24x24",
      "https://immunitys.itch.io/skeletons-pack-1",
      "https://immunitys.itch.io/skeletons-pack-2",
      "https://immunitys.itch.io/goblin-sprite-pack",
    ],
  },
};
const set = SETS[process.argv[2] ?? "boss-rush"];
if (!set) throw new Error("unknown set; use: " + Object.keys(SETS).join(", "));
const OUT = new URL(set.out, import.meta.url).pathname;
const urls = set.urls;
const b = await chromium.launch();
const ctx = await b.newContext({ acceptDownloads: true });
for (const u of urls) {
  const slug = u.split("/").pop();
  const p = await ctx.newPage();
  try {
    await p.goto(u, { timeout: 45000 });
    const lic = await p.$$eval(".game_info_panel_widget tr", r => r.map(x => x.textContent.replace(/\s+/g, " ").trim()).filter(t => /licen|price|status|updated/i.test(t))).catch(() => []);
    await p.goto(u.replace(/\/$/, "") + "/purchase", { timeout: 45000 });
    const no = p.locator(".direct_download_btn");
    if (await no.count()) await no.first().click();
    await p.waitForSelector(".download_btn", { timeout: 20000 });
    const btns = await p.$$(".upload .download_btn");
    const names = await p.$$eval(".upload .upload_name .name", e => e.map(x => x.textContent.trim()));
    console.log("##", slug, "|", lic.join(" ; "), "| uploads:", names.join(", "));
    fs.mkdirSync(`${OUT}/${slug}`, { recursive: true });
    for (let i = 0; i < btns.length; i++) {
      if (!/\.(zip|rar|7z|png)/i.test(names[i] ?? "")) { console.log("  skip", names[i]); continue; }
      const [d] = await Promise.all([p.waitForEvent("download", { timeout: 60000 }), btns[i].click()]);
      await d.saveAs(`${OUT}/${slug}/${d.suggestedFilename()}`);
      console.log("  got", d.suggestedFilename());
    }
  } catch (e) { console.log("!!", slug, e.message.split("\n")[0]); }
  await p.close();
}
await b.close();
