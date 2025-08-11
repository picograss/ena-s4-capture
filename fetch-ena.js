import { chromium } from "playwright";

async function main() {
  const GAS_WEBHOOK_URL = process.env.GAS_WEBHOOK_URL;
  if (!GAS_WEBHOOK_URL) throw new Error("Missing GAS_WEBHOOK_URL");

  // 可选：如果你愿意把浏览器里抓到的 posthog cookie 作为机密传入，也支持：
  // 在仓库 Secrets 新增 POSTHOG_COOKIE，值形如 ph_phc_xxx=xxxxx
  const POSTHOG_COOKIE = process.env.POSTHOG_COOKIE || ""; // 可留空

  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    locale: "en-US",
    viewport: { width: 1366, height: 768 }
  });

  // 预置可能需要的 cookie
  const baseDomain = "app.ethena.fi";
  const cookies = [
    { name: "termsAccepted", value: "true", domain: baseDomain, path: "/", httpOnly: false, secure: true, sameSite: "Lax" }
  ];
  if (POSTHOG_COOKIE) {
    const [name, ...rest] = POSTHOG_COOKIE.split("=");
    cookies.push({
      name,
      value: rest.join("="),
      domain: baseDomain,
      path: "/",
      httpOnly: false,
      secure: true,
      sameSite: "Lax"
    });
  }
  await context.addCookies(cookies);

  const page = await context.newPage();

  // 1) 先进入同域页面，建立前端环境（有些前端会跑 JS challenge）
  await page.goto("https://app.ethena.fi/overview", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(3000); // 给脚本初始化一点时间

  // ---- 策略 A：在页面上下文用同源 fetch 抓 JSON ----
  const tryA = await page.evaluate(async () => {
    try {
      const res = await fetch("/api/airdrop/stats", {
        headers: { accept: "application/json" },
        cache: "no-store",
        credentials: "include"
      });
      const text = await res.text();
      if (!res.ok) return { ok: false, where: "A", status: res.status, ct: res.headers.get("content-type"), head: text.slice(0, 500) };
      try {
        const json = JSON.parse(text);
        return { ok: true, where: "A", json };
      } catch {
        return { ok: false, where: "A", status: res.status, ct: res.headers.get("content-type"), head: text.slice(0, 500) };
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

    // ---- 策略 B：直接导航到 API（document 请求），然后读返回体 ----
    try {
      const resp = await page.goto("https://app.ethena.fi/api/airdrop/stats", { waitUntil: "domcontentloaded" });
      const status = resp ? resp.status() : -1;
      const ct = resp ? (resp.headers()["content-type"] || "") : "";
      const body = await page.evaluate(() => document.body ? document.body.innerText || "" : "");
      if (status === 200 && ct.includes("application/json")) {
        try {
          json = JSON.parse(body);
          console.log("Strategy B success");
        } catch {
          console.warn("Strategy B got 200 but body not JSON head:", body.slice(0, 500));
        }
      } else {
        console.warn("Strategy B failed:", { status, ct, head: body.slice(0, 500) });
      }
    } catch (e) {
      console.warn("Strategy B exception:", String(e));
    }

    // ---- 策略 C：Playwright 的 request，在同一浏览器上下文里发 GET 带 Referer ----
    if (!json) {
      try {
        const r = await page.request.get("https://app.ethena.fi/api/airdrop/stats", {
          he
