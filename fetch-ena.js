import { chromium } from "playwright";

async function main() {
  const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL;
  if (!GAS_WEBHOOK_URL) throw new Error("Missing GAS_WEBHOOK_URL");

  // 代理（HTTP/HTTPS/SOCKS5 均可），形如：
  // http://user:pass@proxyhost:port   或   http://proxyhost:port
  const PROXY_SERVER = process.env.PROXY_SERVER || ""; // 必填
  const PROXY_USERNAME = process.env.PROXY_USERNAME || ""; // 按需
  const PROXY_PASSWORD = process.env.PROXY_PASSWORD || ""; // 按需

  const browser = await chromium.launch({
    args: ["--no-sandbox"],
    proxy: PROXY_SERVER
      ? { server: PROXY_SERVER, username: PROXY_USERNAME || undefined, password: PROXY_PASSWORD || undefined }
      : undefined
  });

  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    locale: "en-US",
    viewport: { width: 1366, height: 768 }
  });

  // 可选：预置 cookie（之前版本保留）
  await context.addCookies([{ name: "termsAccepted", value: "true", domain: "app.ethena.fi", path: "/", secure: true, sameSite: "Lax" }]);

  const page = await context.newPage();

  // 进入同域页面，建立前端环境
  await page.goto("https://app.ethena.fi/overview", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(3000);

  // 在页面环境里发同源请求（Strategy A）
  const result = await page.evaluate(async () => {
    try {
      const res = await fetch("/api/airdrop/stats", { headers: { accept: "application/json" }, cache: "no-store", credentials: "include" });
      const text = await res.text();
      if (!res.ok) return { ok: false, status: res.status, ct: res.headers.get("content-type"), head: text.slice(0, 400) };
      return { ok: true, json: JSON.parse(text) };
    } catch (e) {
      return { ok: false, err: String(e) };
    }
  });

  if (!result.ok) {
    console.error("Still blocked:", result);
    throw new Error("Geofenced/blocked even with proxy?");
  }

  const json = result.json;
  const total = json?.aggregateWallet?.accumulatedTotalShardsEarnedSum;
  if (typeof total !== "number") throw new Error("accumulatedTotalShardsEarnedSum not found");

  // 回推表格
  const r = await page.request.post(GAS_WEBHOOK_URL, { data: { totalShards: total } });
  if (!r.ok()) throw new Error(`GAS webhook error: ${r.status()} ${await r.text()}`);
  console.log("OK:", total);

  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
