import { db } from "./db";
import { bootstrapCatalog, freshProduct } from "./catalog";
import { availability } from "./inventory";
import { Product } from "./types";

type Comparison = { matches: string[]; differences: string[]; caveats: string[] };
const breakerKeys = ["KOLICHESTVO_POLYUSOV", "NOMINALNYY_TOK", "NOMINALNOE_NAPRYAZHENIE", "NOMINALNAYA_OTKLYUCHAYUSHCHAYA_SPOSOBNOST"];
const lightKeys = ["MOSHCHNOST", "NOMINALNOE_NAPRYAZHENIE"];
const labels: Record<string, string> = {
  KOLICHESTVO_POLYUSOV: "Полюса", NOMINALNYY_TOK: "Номинальный ток",
  NOMINALNOE_NAPRYAZHENIE: "Напряжение", NOMINALNAYA_OTKLYUCHAYUSHCHAYA_SPOSOBNOST: "Отключающая способность",
  MOSHCHNOST: "Мощность", KHARAKTERISTIKA_SRABATYVANIYA: "Характеристика срабатывания",
};

function categoryOf(product: Product) {
  const name = product.name.toLocaleLowerCase("ru");
  if (/дифавтомат|дифференциальн|\bавдт\b/.test(name)) return "дифавтомат";
  if (/\bузо\b|\bвдт\b/.test(name)) return "узо";
  if (/светильник|лампа|\bled\b/.test(name)) return "светильник";
  const type = String(product.properties.TIP_USTROYSTVA || "").toLocaleLowerCase("ru");
  if (/автоматическ.*выключател/.test(type) || /автомат|(?:^|\s)(?:ав|ва)(?=\s|$)/.test(name) || product.url.includes("modulnye_avtomaticheskie_vyklyuchateli")) return "автомат";
  return "";
}

const normalized = (value: unknown) => String(value ?? "").toLocaleLowerCase("ru").replace(/,/g, ".").replace(/\s+/g, "").replace(/a/g, "а").replace(/b/g, "в").replace(/v/g, "в").replace(/k/g, "к");
function curveOf(product: Product) {
  const property = product.properties.KHARAKTERISTIKA_SRABATYVANIYA ?? product.properties.KHARAKTERISTIKA;
  const value = String(property ?? "").trim().toUpperCase();
  if (/^[BCDСВД]$/.test(value)) return value.replace("С", "C").replace("В", "B").replace("Д", "D");
  const match = product.name.match(/(?:^|\s)([BCDСВД])\s+\d+\s*[АA](?=\W|$)/iu);
  return match ? match[1].toUpperCase().replace("С", "C").replace("В", "B").replace("Д", "D") : "";
}

export function compareAnalogs(original: Product, candidate: Product): Comparison | null {
  if (original.id === candidate.id || original.conflicts.length || candidate.conflicts.length) return null;
  const category = categoryOf(original);
  if (!category || category !== categoryOf(candidate) || category === "узо") return null;
  const keys = category === "светильник" ? lightKeys : breakerKeys;
  const matches: string[] = [];
  for (const key of keys) {
    const from = original.properties[key];
    const to = candidate.properties[key];
    if (!from || !to || normalized(from) !== normalized(to)) return null;
    matches.push(`${labels[key]}: ${String(to)}`);
  }
  if (category === "автомат" || category === "дифавтомат") {
    const sourceCurve = curveOf(original);
    const candidateCurve = curveOf(candidate);
    if (sourceCurve && (!candidateCurve || sourceCurve !== candidateCurve)) return null;
    if (sourceCurve) matches.push(`${labels.KHARAKTERISTIKA_SRABATYVANIYA}: ${candidateCurve}`);
  }
  if (category === "дифавтомат") {
    for (const key of ["NOMINALNYY_OTKLYUCHAYUSHCHIY_DIFFERENTSIALNYY_TOK", "TIP_UTECHKI"]) {
      const from = original.properties[key];
      const to = candidate.properties[key];
      if (!from || !to || normalized(from) !== normalized(to)) return null;
      matches.push(`${key}: ${String(to)}`);
    }
  }
  const differences: string[] = [];
  const sourceBrand = String(original.properties.TORGOVAYA_MARKA || "").trim();
  const candidateBrand = String(candidate.properties.TORGOVAYA_MARKA || "").trim();
  if (sourceBrand && candidateBrand && sourceBrand !== candidateBrand) differences.push(`Бренд: ${sourceBrand} → ${candidateBrand}`);
  return { matches, differences, caveats: ["Совместимость монтажа и аксессуаров не подтверждена данными API; проверьте перед заменой."] };
}

function indexedCandidates(original: Product) {
  const rows = db().prepare("SELECT payload FROM products LIMIT 5000").all() as { payload: string }[];
  const current = Number(String(original.properties.NOMINALNYY_TOK ?? "").match(/\d+(?:[.,]\d+)?/)?.[0].replace(",", "."));
  const poles = Number(String(original.properties.KOLICHESTVO_POLYUSOV ?? "").match(/\d+/)?.[0]);
  return rows.map(row => JSON.parse(row.payload) as Product)
    .filter(product => product.id !== original.id && categoryOf(product) === categoryOf(original))
    .map(product => {
      const currentInName = Number(product.name.match(/(\d+(?:[.,]\d+)?)\s*[АA](?=\W|$)/iu)?.[1].replace(",", "."));
      const polesInName = Number(product.name.match(/(\d+)\s*(?:ф|p|полюс)/iu)?.[1]);
      const score = Number(current > 0 && currentInName === current) * 3 + Number(poles > 0 && polesInName === poles) * 2 + Number(product.properties.NOMINALNYY_TOK != null);
      return { product, score };
    })
    .filter(item => !(current > 0) || item.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 60).map(item => item.product);
}

export async function findAnalogs(original: Product, city?: string) {
  if (original.conflicts.length || !categoryOf(original)) return [];
  await bootstrapCatalog();
  const results: { product: Product; matches: string[]; differences: string[]; caveats: string[] }[] = [];
  for (const candidate of indexedCandidates(original)) {
    try {
      const product = await freshProduct(candidate.id);
      const stock = availability(product, city);
      if (stock.quantity === null || stock.quantity <= 0 || product.price === null || product.price <= 0 || product.offers.length) continue;
      const comparison = compareAnalogs(original, product);
      if (!comparison) continue;
      results.push({ product, ...comparison });
      if (results.length >= 3) break;
    } catch { /* stale index entry; another candidate may still be valid */ }
  }
  return results;
}
