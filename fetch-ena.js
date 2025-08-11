import { chromium } from "playwright";

async function main() {
  const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL;
  if (!GAS_WEBHOOK_URL) throw new Error("Missing GAS_WEBHOOK_URL");

  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // 进 app 建立前端上下文（cookie/挑战等）
  await page.goto("https://app.ethena.fi/overview", { waitUntil: "domcontentloaded" });

  // 在同一上下文请求 API（带上同源指纹）
  const resp = await page.request.get("https://app.ethena.fi/api/airdrop/stats", {
    headers: { accept: "application/json" }
  });
  if (!resp.ok()) throw new Error(`Ethena API non-200: ${resp.status()}`);

  const json = await resp.json();
  const total = json?.aggregateWallet?.accumulatedTotalShardsEarnedSum;
  if (typeof total !== "number") throw new Error("accumulatedTotalShardsEarnedSum not found");

  // 推送到你的表格
  const post = await page.request.post(GAS_WEBHOOK_URL, { data: { totalShards: total } });
  if (!post.ok()) throw new Error(`GAS webhook error: ${post.status()} ${await post.text()}`);

  console.log("OK:", total);
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
