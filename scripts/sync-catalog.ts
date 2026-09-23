import { loadEnvConfig } from "@next/env";
import { syncCatalog } from "../src/lib/catalog";

loadEnvConfig(process.cwd());
const max = Math.max(1, Math.min(100, Number(process.env.CATALOG_MAX_PAGES || 25)));
syncCatalog(max, (page, count) => console.log(`Страница ${page}: проиндексировано ${count} товаров`))
  .then(status => console.log("Индекс готов:", status))
  .catch(error => { console.error(error instanceof Error ? error.message : "Ошибка индексации"); process.exitCode = 1; });
