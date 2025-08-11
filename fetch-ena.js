import { chromium } from "playwright";

async function main() {
  const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL;
  if (!GAS_WEBHOOK_URL) throw new Error("Missing GAS_WEBHOOK_URL");

  // 更接近真实用户的上下文（可选 UA）
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    locale: "en-US"
  });
  const page = await context.newPage();

  // 1) 进站建立前端环境（cookie / JS challenge）
  await page.goto("https://app.ethena.fi/overview", { waitUntil: "domcontentloaded" });
  // 给前端脚本留点时间（很重要）
  await page.waitForTimeout(3000);

  // 2) 在页面里用同源 fetch 拉 JSON（关键！）
  const json = await page.evaluate(async () => {
    const res = await fetch("/api/airdrop/stats", {
      // 浏览器会自动带上合适的头和 cookie
      headers: { accept: "application/json" },
      cache: "no-store",
      credentials: "include"
    });
    // 如果上游返回 HTML，这里会抛错
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      // 让我们在日志里看到为何失败
      return { __html__: text.slice(0, 500), __status__: res.status, __ct__: res.headers.get("content-type") };
    }
  });

  // 3) 解析数值，做健壮性检查
  const total = json?.aggregateWallet?.accumulatedTotalShardsEarnedSum;
  if (typeof total !== "number") {
    console.error("Unexpected response:", json);
    throw new Error("accumulatedTotalShardsEarnedSum not found or not a number");
  }

  // 4) 推送到你的 Google 表格（GAS Webhook）
  const resp = await page.request.post(GAS_WEBHOOK_URL, {
    data: { totalShards: total }
  });
  if (!resp.ok()) {
    throw new Error(`GAS webhook error: ${resp.status()} ${await resp.text()}`);
  }

  console.log("OK:", total);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
