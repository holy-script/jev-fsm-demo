import { chromium } from "playwright";
// Lists the uploads (and sizes) on itch.io pages without downloading. Usage: node tools/itch_survey.mjs <creator> url...
// Opens <page>/purchase and clicks "No thanks" like itch_download.mjs. Pages that need payment show no .download_btn.
const urls = process.argv.slice(2);
const b = await chromium.launch();
const ctx = await b.newContext();
const run = async (u) => {
  const p = await ctx.newPage();
  const slug = u.split("/").pop();
  try {
    await p.goto(u.replace(/\/$/, "") + "/purchase", { timeout: 45000 });
    const no = p.locator(".direct_download_btn");
    if (await no.count()) await no.first().click();
    await p.waitForTimeout(1200);
    const ups = await p.$$eval(".upload", e => e.map(x => (x.querySelector(".upload_name .name")?.textContent ?? "?").trim() + " [" + (x.querySelector(".file_size")?.textContent ?? "").trim() + "]" + (x.querySelector(".download_btn") ? "" : " NO-BTN")));
    const price = await p.$$eval(".buy_row .price_tag, .buy_row .dollars, .money_input", e => e.map(x => (x.textContent || x.value || "").trim()).join("/")).catch(() => "");
    console.log(slug.padEnd(38), ups.length ? ups.join(" | ") : "NO UPLOADS VISIBLE", price ? "price:" + price : "");
  } catch (e) { console.log(slug.padEnd(38), "ERR", e.message.split("\n")[0]); }
  await p.close();
};
const q = [...urls];
await Promise.all([0, 1, 2, 3].map(async () => { while (q.length) await run(q.shift()); }));
await b.close();
