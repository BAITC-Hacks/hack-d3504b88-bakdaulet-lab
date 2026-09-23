import { loadEnvConfig } from "@next/env";
import { db } from "../src/lib/db";
import { dataMode } from "../src/lib/ekt";
import { freshProduct, catalogStatus } from "../src/lib/catalog";
import { availability } from "../src/lib/inventory";
import { findAnalogs } from "../src/lib/analogs";

loadEnvConfig(process.cwd());
if (dataMode() !== "live") throw new Error("Для поиска реальной пары задайте DATA_MODE=live и синхронизируйте каталог.");
const status = catalogStatus();
if (!status.count) throw new Error("Индекс пуст. Сначала запустите npm run catalog:sync.");
const maxProducts = Math.max(1, Math.min(200, Number(process.env.ANALOG_SCAN_LIMIT || 80)));
const rows = db().prepare("SELECT id FROM products ORDER BY id LIMIT ?").all(maxProducts) as { id: number }[];
let examined = 0;
let outOfStock = 0;
for (const row of rows) {
  try {
    const source = await freshProduct(row.id);
    examined++;
    if (availability(source).quantity !== 0) continue;
    outOfStock++;
    const analogs = await findAnalogs(source);
    if (analogs.length) {
      console.log(JSON.stringify({ checkedAt: new Date().toISOString(), source: { id: source.id, article: source.article, name: source.name, url: source.url }, candidates: analogs.map(item => ({ id: item.product.id, article: item.product.article, name: item.product.name, url: item.product.url, matches: item.matches, differences: item.differences, caveats: item.caveats })) }, null, 2));
      process.exit(0);
    }
  } catch (error) { console.warn(`ID ${row.id}: ${error instanceof Error ? error.message : "неизвестная ошибка"}`); }
  await new Promise(resolve => setTimeout(resolve, 100));
}
console.log(`Проверено ${examined} карточек из частичного индекса (${status.count}); без остатка ${outOfStock}. Подтверждённая пара не найдена. Увеличьте индекс/лимит или уточните параметры.`);
