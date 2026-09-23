import { Product, SearchItem } from "./types";
import fixture from "../../data/fixtures/catalog.json";

export const dataMode = () => process.env.DATA_MODE === "live" ? "live" : "demo";
const base = () => {
  const url = new URL(process.env.EKT_API_BASE_URL || "https://ekt.kz/api");
  if (url.protocol !== "https:" || url.hostname !== "ekt.kz" || url.pathname.replace(/\/$/, "") !== "/api") throw new Error("EKT_API_BASE_URL должен указывать на https://ekt.kz/api.");
  return url.href.replace(/\/$/, "");
};

function liveCredentials() {
  const user = process.env.EKT_API_USERNAME;
  const password = process.env.EKT_API_PASSWORD;
  if (!user || !password) throw new Error("Для live-каталога задайте EKT_API_USERNAME и EKT_API_PASSWORD.");
  return `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
}

async function request(path: string) {
  const authorization = liveCredentials();
  const apiBase = base();
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${apiBase}${path}`, {
        headers: { Authorization: authorization, Accept: "application/json" },
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(9000),
      });
    } catch { throw new Error("Не удалось получить ответ API каталога за 9 секунд."); }
    if ((response.status === 429 || response.status >= 500) && attempt < 2) { await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1))); continue; }
    if (response.status === 401 || response.status === 403) throw new Error("Доступ к API каталога отклонён. Проверьте учётные данные.");
    if (response.status === 404) throw new Error("Товар не найден в API каталога.");
    if (response.status === 429) throw new Error("Каталог временно ограничил запросы. Повторите позже.");
    if (!response.ok) throw new Error(`Каталог временно недоступен (${response.status}).`);
    try { return await response.json(); } catch { throw new Error("API каталога вернул некорректный JSON."); }
  }
  throw new Error("Каталог временно недоступен.");
}

const num = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
const str = (value: unknown): string => typeof value === "string" ? value : "";
const safeUrl = (value: unknown) => {
  if (typeof value !== "string") return "";
  try { const url = new URL(value, "https://ekt.kz"); return url.protocol === "https:" && url.hostname === "ekt.kz" ? url.href : ""; } catch { return ""; }
};

export function normalize(raw: Record<string, unknown>, source: "live" | "demo", fetchedAt = new Date().toISOString()): Product {
  const properties = raw.properties && typeof raw.properties === "object" && !Array.isArray(raw.properties) ? raw.properties as Record<string, unknown> : {};
  const stores = Array.isArray(raw.stores) ? raw.stores.map((item: unknown) => {
    const value = item as Record<string, unknown>;
    return { id: Number(value.id), name: str(value.name), quantity: num(value.quantity) };
  }).filter(s => Number.isInteger(s.id)) : [];
  const name = str(raw.name);
  const description = str(raw.description);
  const propertyCurrent = str(properties.NOMINALNYY_TOK);
  const titleCurrent = name.match(/(?:^|[^\d])(\d+)\s*[АA](?=$|[^\p{L}])/iu)?.[1];
  const propertyCurrentNumber = propertyCurrent.match(/(?:^|[^\d])(\d+)\s*[АA](?=$|[^\p{L}])/iu)?.[1];
  const conflicts = titleCurrent && propertyCurrentNumber && titleCurrent !== propertyCurrentNumber ? [`Номинальный ток: название ${titleCurrent} А, свойство ${propertyCurrent}`] : [];
  const certificates = Object.entries(properties).filter(([key]) => /cert|sert|сертиф/i.test(key)).flatMap(([key, value]) => {
    const values = Array.isArray(value) ? value : [value];
    return values.filter((v): v is string => typeof v === "string" && /^https:\/\//.test(v)).map(v => ({ label: key, url: v, source: `properties.${key}` }));
  });
  return {
    id: Number(raw.id), name, article: str(raw.article), supplierArticle: str(properties.ARTIKULPOSTAVSHCHIKA) || null,
    description, price: num(raw.price), quantity: num(raw.quantity), stores,
    image: safeUrl(raw.image) || null, url: source === "demo" ? "" : safeUrl(raw.url),
    offers: Array.isArray(raw.offers) ? raw.offers : [], properties, certificates, conflicts, fetchedAt, source,
  };
}

export async function getProduct(id: number): Promise<Product> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Некорректный ID товара.");
  if (dataMode() === "demo") {
    const item = fixture.products.find(p => p.id === id);
    if (!item) throw new Error("Товар не найден в демонстрационном каталоге.");
    return normalize(item, "demo");
  }
  const raw = await request(`/products/detail?id=${id}`);
  if (!raw || typeof raw !== "object" || Number(raw.id) !== id) throw new Error("Некорректный ответ каталога.");
  return normalize(raw, "live");
}

export async function getPage(page: number): Promise<SearchItem[]> {
  if (dataMode() === "demo") return page === 1 ? fixture.products.map(p => ({ id: p.id, name: p.name, article: p.article, supplierArticle: null, url: "", image: null })) : [];
  const raw = await request(`/products${page > 1 ? `?page=${page}` : ""}`);
  if (!raw || !Array.isArray(raw.items)) throw new Error("Некорректный список каталога.");
  return raw.items.map((item: Record<string, unknown>) => ({ id: Number(item.id), name: str(item.name), article: str(item.article), supplierArticle: null, url: safeUrl(item.url), image: safeUrl(item.image) || null })).filter((item: SearchItem) => Number.isSafeInteger(item.id));
}
