import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { PDFDocument } from "pdf-lib";
import * as XLSX from "xlsx";

// Synthetic fixtures only. --live makes exactly three paid OCR requests, without retries.
const mode = process.argv[2];
const base = process.env.APP_BASE_URL;
const fixtures = "tests/fixtures/ocr";
const reports = "docs/reports/ocr";
const executablePath = process.env.OCR_BROWSER_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
await mkdir(fixtures, { recursive: true });
await mkdir(reports, { recursive: true });
if (!["--fixtures", "--live", "--browser"].includes(mode)) throw new Error("Use --fixtures, --live or --browser (APP_BASE_URL must be explicit).");
if (mode !== "--fixtures" && (!base || new URL(base).port !== "3001" || !["localhost", "127.0.0.1"].includes(new URL(base).hostname))) throw new Error("APP_BASE_URL must point to this worker on localhost:3001.");

if (mode === "--fixtures") {
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1200, height: 560 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const document = body => `<html lang="ru"><meta charset="utf-8"><style>body{margin:45px;font:30px Arial;color:#111;background:white}h1{font-size:32px}table{border-collapse:collapse;width:100%}td,th{border:2px solid #333;text-align:left;padding:20px}small{font-size:18px}</style><h1>ТЕСТОВАЯ СПЕЦИФИКАЦИЯ</h1><small>Синтетический вход для проверки OCR. Не заказ клиента.</small>${body}</html>`;
    await page.setContent(document("<table><tr><th>Артикул</th><th>Количество</th><th>Ед. изм.</th></tr><tr><td>DEMO-AV16</td><td>2</td><td>шт</td></tr><tr><td>DEMO-AV25</td><td>3</td><td>шт</td></tr></table>"));
    await page.screenshot({ path: `${fixtures}/specification.jpg`, type: "jpeg", quality: 95 });
    await page.setContent(document('<p>Артикул (конец маркировки обрезан): <span style="display:inline-block;width:120px;overflow:hidden;white-space:nowrap;vertical-align:bottom;font-family:monospace">DEMO-AV25</span></p><p>Номинальный ток: 20 А</p><p>Количество не указано.</p>'));
    await page.screenshot({ path: `${fixtures}/unclear.jpg`, type: "jpeg", quality: 95 });
    const pdf = await PDFDocument.create();
    const image = await pdf.embedJpg(await readFile(`${fixtures}/specification.jpg`));
    pdf.addPage([1200, 560]).drawImage(image, { x: 0, y: 0, width: 1200, height: 560 });
    await writeFile(`${fixtures}/scan.pdf`, await pdf.save());
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
      ["Количество", "Ед. изм.", "Артикул", "Наименование"],
      [2, "шт", "DEMO-AV16", "Синтетический автомат"],
      ["", "", "DEMO-AV25", "Количество и единица отсутствуют"],
      [3, "упак", "UNKNOWN-ITEM", "Неизвестная позиция и единица"],
    ]), "Проверка");
    await writeFile(`${fixtures}/review.xlsx`, XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
    const replacement = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(replacement, XLSX.utils.aoa_to_sheet([["DEMO-AV25", 4, "шт"]]), "Новый файл");
    await writeFile(`${fixtures}/replacement.xlsx`, XLSX.write(replacement, { type: "buffer", bookType: "xlsx" }));
    console.log("Created synthetic JPEGs, an image-only PDF and review spreadsheets.");
  } finally { await browser.close(); }
}

if (mode === "--live") {
  const observations = [];
  for (const [name, mime, unclear] of [["specification.jpg", "image/jpeg", false], ["scan.pdf", "application/pdf", false], ["unclear.jpg", "image/jpeg", true]]) {
    const form = new FormData();
    form.set("file", new Blob([await readFile(`${fixtures}/${name}`)], { type: mime }), name);
    const start = Date.now();
    const response = await fetch(`${base}/api/uploads`, { method: "POST", headers: { Origin: base }, body: form });
    const body = await response.json();
    observations.push({ name, at: new Date().toISOString(), elapsedMs: Date.now() - start, status: response.status, rows: body.rows, error: body.error });
    await writeFile(`${reports}/live-results.json`, JSON.stringify(observations, null, 2) + "\n");
    assert.equal(response.status, 200, `${name}: ${body.error}`);
    if (unclear) {
      assert(body.rows.length > 0);
      assert(body.rows.every(row => row.article === null && row.quantity === null && row.productId === null), "Unclear marking must require clarification, not a guessed product/quantity");
    } else {
      assert.deepEqual(body.rows.map(row => [row.article, row.quantity, row.unit]), [["DEMO-AV16", 2, "шт"], ["DEMO-AV25", 3, "шт"]]);
    }
    console.log(`${name}: verified (${Date.now() - start} ms)`);
  }
}

if (mode === "--browser") {
  const httpChecks = [];
  for (const [name, mime, bytes, status] of [
    ["empty.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", Buffer.alloc(0), 400],
    ["fake.pdf", "application/pdf", Buffer.from("invalid"), 400],
    ["wrong.jpg", "application/pdf", Buffer.from([0xff, 0xd8, 0xff]), 400],
    ["broken.pdf", "application/pdf", Buffer.from("%PDF-1.7\ninvalid"), 400],
    ["old.doc", "application/msword", Buffer.from("old doc"), 400],
    ["large.jpg", "image/jpeg", Buffer.alloc(11 * 1024 * 1024), 413],
  ]) {
    const form = new FormData();
    form.set("file", new Blob([bytes], { type: mime }), name);
    const response = await fetch(`${base}/api/uploads`, { method: "POST", headers: { Origin: base }, body: form });
    const body = await response.json();
    assert.equal(response.status, status, `${name}: ${body.error}`);
    httpChecks.push({ name, status: response.status, message: body.error });
  }
  const browser = await chromium.launch({ executablePath, headless: true });
  const results = [];
  try {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(base);
      const input = page.locator('input[type="file"]');
      await input.setInputFiles(`${fixtures}/review.xlsx`);
      await page.getByText("Состав предложения: 0 из 3 строк. Исключено: 3.", { exact: true }).waitFor();
      assert(await page.getByRole("button", { name: "Подготовить предложение из проверенных строк" }).isDisabled());
      await page.getByLabel("Проверена строка 1", { exact: true }).check();
      await page.getByLabel("Количество строки 1", { exact: true }).fill("4");
      assert(!(await page.getByLabel("Проверена строка 1", { exact: true }).isChecked()), "Editing must revoke review");
      const repeatedUpload = page.waitForResponse(response => response.url().endsWith("/api/uploads") && response.request().method() === "POST");
      await input.setInputFiles(`${fixtures}/review.xlsx`);
      await repeatedUpload;
      await page.waitForFunction(() => document.querySelector('[aria-label="Количество строки 1"]')?.value === "2", undefined, { timeout: 5000 });
      await input.setInputFiles(`${fixtures}/replacement.xlsx`);
      await page.getByText("Состав предложения: 0 из 1 строк. Исключено: 1.", { exact: true }).waitFor();
      assert.equal(await page.getByLabel("Артикул строки 1", { exact: true }).inputValue(), "DEMO-AV25");
      await input.setInputFiles(`${fixtures}/review.xlsx`);
      await page.getByText("Состав предложения: 0 из 3 строк. Исключено: 3.", { exact: true }).waitFor();
      await page.getByLabel("Проверена строка 1", { exact: true }).check();
      await page.getByLabel("Количество строки 2", { exact: true }).fill("1");
      await page.getByLabel("Единица строки 2", { exact: true }).fill("шт");
      await page.getByLabel("Проверена строка 2", { exact: true }).check();
      await page.getByText("Состав предложения: 2 из 3 строк. Исключено: 1.", { exact: true }).waitFor();
      assert(await page.getByLabel("Проверена строка 3", { exact: true }).isDisabled());
      const cartBefore = await (await context.request.get(`${base}/api/cart`)).json();
      assert.equal(cartBefore.lines.length, 0);
      await page.getByRole("button", { name: "Подготовить предложение из проверенных строк" }).scrollIntoViewIfNeeded();
      await page.locator(".upload-table-wrap").evaluate(element => { element.scrollLeft = 0; element.scrollTop = 0; });
      await page.screenshot({ path: `${reports}/review-${viewport.width}.png`, fullPage: true });
      await page.getByRole("button", { name: "Подготовить предложение из проверенных строк" }).click();
      await page.getByText("ПРОВЕРЬТЕ ПЕРЕД ДОБАВЛЕНИЕМ", { exact: true }).waitFor();
      const cartAfter = await (await context.request.get(`${base}/api/cart`)).json();
      assert.equal(cartAfter.lines.length, 0, "Preparing an upload proposal must not mutate cart");
      assert.equal(await page.locator(".proposal-line").count(), 2);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert(overflow <= 2, `Page overflow: ${overflow}`);
      assert.deepEqual(errors, []);
      results.push({ viewport, correctedRows: 2, excludedRows: 1, cartBefore: 0, cartAfter: 0, overflow });
      await context.close();
    }
    await writeFile(`${reports}/browser-results.json`, JSON.stringify({ at: new Date().toISOString(), httpChecks, results }, null, 2) + "\n");
    console.log("Upload review passed on desktop/mobile: corrections, replacement, exclusions, preview and unchanged cart.");
  } finally { await browser.close(); }
}
