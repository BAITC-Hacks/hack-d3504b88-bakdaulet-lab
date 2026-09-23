import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";

const base = process.env.APP_BASE_URL || "http://localhost:3000";
const browser = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
const errors = [];
try {
  await mkdir("docs", { recursive: true });
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  desktop.on("pageerror", error => errors.push(error.message));
  await desktop.goto(base);
  await desktop.getByPlaceholder("Введите артикул или задайте вопрос…").fill("DEMO-AV16");
  await desktop.getByRole("button", { name: "Отправить" }).click();
  await desktop.getByText("АРТИКУЛ DEMO-AV16", { exact: true }).waitFor();
  await desktop.screenshot({ path: "docs/screenshot-desktop.png", fullPage: true });
  await desktop.getByRole("button", { name: "Подготовить предложение" }).click();
  await desktop.getByText("ПРОВЕРЬТЕ ПЕРЕД ДОБАВЛЕНИЕМ").waitFor();
  await desktop.getByRole("button", { name: "Подтвердить добавление" }).click();
  await desktop.getByRole("link", { name: "Открыть корзину ↗" }).click();
  await desktop.getByText("Корзина прототипа. Заказ в ekt.kz ещё не оформлен.").waitFor();
  await desktop.getByText("Автоматический выключатель DemoLine 1P 16 А C", { exact: true }).waitFor();
  await desktop.reload();
  await desktop.getByText("Автоматический выключатель DemoLine 1P 16 А C", { exact: true }).waitFor();
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  mobile.on("pageerror", error => errors.push(error.message));
  await mobile.goto(base);
  await mobile.getByPlaceholder("Введите артикул или задайте вопрос…").fill("DEMO-AV16");
  await mobile.getByRole("button", { name: "Отправить" }).click();
  await mobile.getByText("АРТИКУЛ DEMO-AV16", { exact: true }).waitFor();
  await mobile.screenshot({ path: "docs/screenshot-mobile.png", fullPage: true });
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 2) throw new Error(`Mobile horizontal overflow: ${overflow}px`);
  if (errors.length) throw new Error(`Browser errors: ${errors.join("; ")}`);
  console.log("Browser checks passed: desktop and 390px mobile, chat, proposal, cart, refresh.");
} finally { await browser.close(); }
