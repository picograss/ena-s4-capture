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
      const res =
