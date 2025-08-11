import { chromium } from "playwright";

async function main() {
  const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL;
  if (!GAS_WEBHOOK_URL) throw new Error("Missing GAS_WEBHOOK_URL");

  // 可选：把浏览器里抓到的 posthog cookie（形如 ph_phc_xxx=...）存到仓库 Secrets: POSTHOG_COOKIE
  const POSTHOG_COOKIE = process.env.POSTHOG_COOKIE || ""; // 可留空

  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    locale: "en-US",
    viewport: { width: 1366, height: 768 }
  });

  // 预置 cookie（有助于通过前端校验）
  const baseDomain = "app.ethena.fi";
  const cookies = [
    { name: "termsAccepted", value: "true", domain: baseDomain, path: "/", httpOnly: false, secure: true, sameSite: "Lax" }
  ];
  if (POSTHOG_COOKIE) {
    const idx = POSTHOG_COOKIE.indexOf("=");
    if (idx > 0) {
      const name = POSTHOG_COOKIE.slice(0, idx);
      const value = POSTHOG_COOKIE.slice(idx + 1);
      cookies.push({ name, value, domain: baseDomain, path: "/", httpOnly: false, secure: true, sameSite: "Lax" });
    }
  }
  await context.addCookies(cookies);

  const page = await context.newPage();

  // 1) 进站建立前端环境
  await page.goto("https://app.ethena.fi/overview", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(3000);

  // ---- 策略 A：页面上下文同源 fetch ----
  const tryA = await page.evaluate(async () => {
    try {
      const res = await fetch("/api/airdrop/stats", {
        headers: { accept: "application/json" },
        cache: "no-store",
        credentials: "include"
      });
      const text = await res.text();
      if (!res.ok) {
        return { ok: false, where: "A", status: res.status, ct: res.headers.get("content-type") || "", head: text.slice(0, 500) };
      }
      try {
        const json = JSON.parse(text);
        return { ok: true, where: "A", json };
      } catch {
        return { ok: false, where: "A", status: res.status, ct: res.headers.get("content-type") || "", head: text.slice(0, 500) };
      }
    } catch (e) {
      return { ok: false, where: "A", err: String(e) };
    }
  });

  let json = null;

  if (tryA.ok) {
    json = tryA.json;
    console.log("Strategy A success");
  } else {
    console.warn("Strategy A failed:", tryA);

    // ---- 策略 B：直接导航到 API，再读返回体 ----
    try {
      const resp = await page.goto("https://app.ethena.fi/api/airdrop/stats", { waitUntil: "domcontentloaded" });
      const status = resp ? resp.status() : -1;
      const ct = resp ? (resp.headers()["content-type"] || "") : "";
      const body = await page.evaluate(() => document.body ? (document.body.innerText || "") : "");
      if (status === 200 && ct.includes("application/json")) {
        try {
          json = JSON.parse(body);
          console.log("Strategy B success");
        } catch {
          console.warn("Strategy B got 200 but non-JSON body head:", body.slice(0, 500));
        }
      } else {
        console.warn("Strategy B failed:", { status, ct, head: body.slice(0, 500) });
      }
    } catch (e) {
      console.warn("Strategy B exception:", String(e));
    }

    // ---- 策略 C：Playwright request（同一上下文，带 referer）----
    if (!json) {
      try {
        const ua = await page.evaluate(() => navigator.userAgent);
        const r = await page.request.get("https://app.ethena.fi/api/airdrop/stats", {
          headers: { accept: "application/json", referer: "https://app.ethena.fi/overview", "user-agent": ua }
        });
        const text = await r.text();
        if (r.ok()) {
          json = JSON.parse(text);
          console.log("Strategy C success");
        } else {
          console.warn("Strategy C failed:", { status: r.status(), ct: r.headers()["content-type"], head: text.slice(0, 500) });
        }
      } catch (e) {
        console.warn("Strategy C exception:", String(e));
      }
    }
  }

  if (!json) {
    throw new Error("All strategies failed to get JSON.");
  }

  const total = json?.aggregateWallet?.accumulatedTotalShardsEarnedSum;
  if (typeof total !== "number") {
    console.error("Unexpected JSON shape:", JSON.stringify(json).slice(0, 800));
    throw new Error("accumulatedTotalShardsEarnedSum not found or not a number");
  }

  // 推送到 Google 表格
  const post = await page.request.post(GAS_WEBHOOK_URL, { data: { totalShards: total } });
  if (!post.ok()) {
    throw new Error(`GAS webhook error: ${post.status()} ${await post.text()}`);
  }

  console.log("OK:", total);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
