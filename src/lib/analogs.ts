import { searchProducts, freshProduct } from "./catalog";
import { availability } from "./inventory";
import { Product } from "./types";

const breakerKeys = ["KOLICHESTVO_POLYUSOV", "NOMINALNYY_TOK", "NOMINALNOE_NAPRYAZHENIE"];
const lightKeys = ["MOSHCHNOST", "NOMINALNOE_NAPRYAZHENIE"];
const categoryOf = (product: Product) => {
  const name = product.name.toLocaleLowerCase("ru");
  if (/дифавтомат|дифференциальн/.test(name)) return "дифавтомат";
  if (/автомат|выключатель/.test(name)) return "автомат";
  if (/светильник|лампа|led/.test(name)) return "светильник";
  return "";
};

export async function findAnalogs(original: Product, city?: string) {
  if (original.conflicts.length) return [];
  const category = categoryOf(original);
  if (!category) return [];
  const keys = category === "светильник" ? lightKeys : breakerKeys;
  const candidates = await searchProducts(category === "дифавтомат" ? "дифавтомат" : category, 20);
  const results: { product: Product; matches: string[]; differences: string[]; caveats: string[] }[] = [];
  for (const candidate of candidates) {
    if (candidate.id === original.id) continue;
    const product = await freshProduct(candidate.id);
    if (categoryOf(product) !== category) continue;
    if (availability(product, city).quantity === null || (availability(product, city).quantity || 0) <= 0 || product.conflicts.length) continue;
    const matches: string[] = [];
    const differences: string[] = [];
    const caveats: string[] = [];
    for (const key of keys) {
      const a = original.properties[key]; const b = product.properties[key];
      if (!a || !b) { caveats.push(`${key}: недостаточно данных`); continue; }
      if (String(a).trim() === String(b).trim()) matches.push(`${key}: ${a}`);
      else differences.push(`${key}: ${a} → ${b}`);
    }
    for (const key of category === "светильник" ? ["TIP", "TSOKOL", "SVETOVOY_POTOK"] : ["KHARAKTERISTIKA", "NOMINALNAYA_OTKLYUCHAYUSHCHAYA_SPOSOBNOST", ...(category === "дифавтомат" ? ["TOK_UTECHKI", "TIP_UTECHKI"] : [])]) {
      const a = original.properties[key]; const b = product.properties[key];
      if (a && !b) caveats.push(`${key}: у кандидата нет данных`);
      else if (a && b && String(a).trim() !== String(b).trim()) differences.push(`${key}: ${a} → ${b}`);
    }
    if (differences.length || caveats.length || matches.length < keys.length) continue;
    results.push({ product, matches, differences, caveats });
    if (results.length >= 3) break;
  }
  return results;
}
