import { loadEnvConfig } from "@next/env";
import { getProduct } from "../src/lib/ekt";
import { availability } from "../src/lib/inventory";

loadEnvConfig(process.cwd());
const ids = process.argv.slice(2).map(Number).filter(id => Number.isSafeInteger(id) && id > 0);
if (!ids.length) throw new Error("Укажите ID товаров для проверки.");

async function main() {
  for (const id of ids) {
    try {
      const product = await getProduct(id);
      const stock = availability(product);
      const keys = [
        "TIP_USTROYSTVA", "KATEGORIYA", "KATEGORIYA_1", "TIP_SOEDINITELYA",
        "NOMINALNYY_TOK", "KOLICHESTVO_POLYUSOV", "NOMINALNOE_NAPRYAZHENIE",
        "NOMINALNAYA_OTKLYUCHAYUSHCHAYA_SPOSOBNOST", "KHARAKTERISTIKA_SRABATYVANIYA",
        "NOMINALNYY_OTKLYUCHAYUSHCHIY_DIFFERENTSIALNYY_TOK", "SECHENIE_PODKLYUCHAEMOGO_PROVODA",
      ];
      console.log(JSON.stringify({
        id, name: product.name, article: product.article, supplierArticle: product.supplierArticle,
        price: product.price, quantity: stock.quantity, stockLabel: stock.label,
        properties: Object.fromEntries(keys.filter(key => product.properties[key] != null).map(key => [key, product.properties[key]])),
        conflicts: product.conflicts, url: product.url, checkedAt: product.fetchedAt,
      }));
    } catch (error) {
      console.error(`ID ${id}: ${error instanceof Error ? error.message : "ошибка запроса"}`);
      process.exitCode = 1;
    }
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Неизвестная ошибка.");
  process.exitCode = 1;
});
