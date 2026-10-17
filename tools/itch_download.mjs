import { chromium } from "playwright";
import fs from "fs";
// Downloads the free itch.io packs the game uses into assets/_dl (gitignored). Usage: node tools/itch_download.mjs
// Then: npm run assets   (unzips nothing - see tools/README.md for the unzip one-liner)
// Usage: node tools/itch_download.mjs [boss-rush|duel]   (default boss-rush)
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
