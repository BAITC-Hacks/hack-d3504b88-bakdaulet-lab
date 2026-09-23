import { chromium } from "playwright-core";

const base = process.env.APP_BASE_URL || "http://localhost:3000";
const browser = await chromium.launch({ executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe", headless: true });
const errors = [];
try {
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  desktop.on("pageerror", error => errors.push(error.message));
  await desktop.goto(base);
  await desktop.getByPlaceholder("Введите артикул или задайте вопрос…").fill("310100086_");
  await desktop.getByRole("button", { name: "Отправить" }).click();
  await desktop.getByText("АРТИКУЛ 310100086_", { exact: true }).waitFor();
  const analog = desktop.locator(".analog").filter({ hasText: "419709 RX3 ВА 3ф С 20А" });
  await analog.getByText("Совпадает:").waitFor();
  await analog.getByText("Совместимость монтажа и аксессуаров", { exact: false }).waitFor();
  await desktop.screenshot({ path: "docs/screenshot-live-desktop.png", fullPage: true });
  await analog.getByRole("button", { name: "Предложить 1 шт." }).click();
  await desktop.getByText("ПРОВЕРЬТЕ ПЕРЕД ДОБАВЛЕНИЕМ").waitFor();
  await desktop.locator(".topbar .cart-link").click();
  await desktop.getByText("Пока нет товаров.", { exact: false }).waitFor();
  await desktop.goBack();
  await desktop.getByText("ПРОВЕРЬТЕ ПЕРЕД ДОБАВЛЕНИЕМ").waitFor();
  await desktop.getByRole("button", { name: "Подтвердить добавление" }).click();
  await desktop.getByRole("link", { name: "Открыть корзину ↗" }).click();
  await desktop.getByText("419709 RX3 ВА 3ф С 20А", { exact: false }).waitFor();
  await desktop.reload();
  await desktop.getByText("419709 RX3 ВА 3ф С 20А", { exact: false }).waitFor();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  mobile.on("pageerror", error => errors.push(error.message));
  await mobile.goto(base);
  await mobile.getByPlaceholder("Введите артикул или задайте вопрос…").fill("310100086_");
  await mobile.getByRole("button", { name: "Отправить" }).click();
  await mobile.locator(".analog").filter({ hasText: "419709 RX3 ВА 3ф С 20А" }).waitFor();
  await mobile.screenshot({ path: "docs/screenshot-live-mobile.png", fullPage: true });
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 2) throw new Error(`Горизонтальное переполнение на мобильном экране: ${overflow}px`);
  if (errors.length) throw new Error(`Ошибки браузера: ${errors.join("; ")}`);
  console.log("Live browser passed: desktop and 390px mobile, real analog, confirmation, cart, refresh.");
} finally {
  await browser.close();
}
