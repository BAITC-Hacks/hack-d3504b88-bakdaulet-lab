import { db } from "./db";
import { dataMode, getPage, getProduct } from "./ekt";
import { Product, SearchItem } from "./types";

const searchKey = (value: string) => value.toLocaleLowerCase("ru").normalize("NFKC").replace(/\s+/g, " ").trim();
export function ensureMode() {
  const mode = dataMode();
  const row = db().prepare("SELECT value FROM catalog_meta WHERE key='mode'").get() as { value: string } | undefined;
  if (row?.value === mode) return;
  db().transaction(() => {
    db().prepare("DELETE FROM messages").run();
    db().prepare("DELETE FROM proposals").run();
    db().prepare("DELETE FROM cart_items").run();
    db().prepare("DELETE FROM carts").run();
    db().prepare("DELETE FROM attachments").run();
    db().prepare("DELETE FROM sessions").run();
    db().prepare("DELETE FROM products").run();
    db().prepare("DELETE FROM catalog_meta").run();
    db().prepare("INSERT INTO catalog_meta (key,value) VALUES ('mode',?)").run(mode);
  })();
}

export function saveProduct(product: Product) {
  ensureMode();
  const text = [product.article, product.supplierArticle, product.name, product.description, ...Object.values(product.properties).filter(v => typeof v === "string")].join(" ");
  db().prepare(`INSERT INTO products (id,article,supplier_article,name,search_text,payload,fetched_at)
    VALUES (@id,@article,@supplierArticle,@name,@searchText,@payload,@fetchedAt)
    ON CONFLICT(id) DO UPDATE SET article=excluded.article,supplier_article=excluded.supplier_article,name=excluded.name,search_text=excluded.search_text,payload=excluded.payload,fetched_at=excluded.fetched_at`)
    .run({ id: product.id, article: product.article, supplierArticle: product.supplierArticle, name: product.name, searchText: searchKey(text), payload: JSON.stringify(product), fetchedAt: product.fetchedAt });
}

export function catalogStatus() {
  ensureMode();
  const row = db().prepare("SELECT COUNT(*) count FROM products").get() as { count: number };
  const meta = db().prepare("SELECT key,value FROM catalog_meta").all() as { key: string; value: string }[];
  return { count: row.count, mode: dataMode(), complete: false, ...Object.fromEntries(meta.map(m => [m.key, m.value])) };
}

export async function bootstrapCatalog() {
  if (dataMode() !== "demo" || catalogStatus().count > 0) return;
  const items = await getPage(1);
  for (const item of items) saveProduct(await getProduct(item.id));
  db().prepare("INSERT OR REPLACE INTO catalog_meta (key,value) VALUES ('last_page','1'),('updated_at',?)").run(new Date().toISOString());
}

export async function searchProducts(query: string, limit = 8): Promise<SearchItem[]> {
  ensureMode();
  await bootstrapCatalog();
  const q = searchKey(query).slice(0, 120);
  if (!q) return [];
  let rows = db().prepare(`SELECT id,name,article,supplier_article supplierArticle,payload FROM products
    WHERE lower(article)=? OR lower(supplier_article)=? OR search_text LIKE ?
    ORDER BY CASE WHEN lower(article)=? THEN 0 WHEN lower(supplier_article)=? THEN 1 WHEN lower(name)=? THEN 2 ELSE 3 END, length(name)
    LIMIT ?`).all(q, q, `%${q.replace(/[%_]/g, "")}%`, q, q, q, limit) as { id: number; name: string; article: string; supplierArticle: string | null; payload: string }[];
  if (!rows.length) {
    const stop = new Set(["нужен", "нужна", "найди", "покажи", "товар", "артикул", "есть", "для", "штук", "штуки", "шт", "на", "в", "и"]);
    const tokens = (q.match(/[\p{L}\p{N}_-]+/gu) || []).filter(token => token.length >= 2 && !stop.has(token)).map(token => token === "лампа" ? "светильник" : token === "ватт" ? "вт" : token);
    if (tokens.length) {
      const all = db().prepare("SELECT id,name,article,supplier_article supplierArticle,payload,search_text searchText FROM products LIMIT 3000").all() as (typeof rows[number] & { searchText: string })[];
      rows = all.map(row => ({ row, score: tokens.reduce((sum, token) => sum + (row.searchText.includes(token) ? 1 : 0), 0) }))
        .filter(item => item.score >= Math.min(2, tokens.length))
        .sort((a, b) => b.score - a.score || a.row.name.length - b.row.name.length)
        .slice(0, limit).map(item => item.row);
    }
  }
  return rows.map(r => { const p = JSON.parse(r.payload) as Product; return { id: r.id, name: r.name, article: r.article, supplierArticle: r.supplierArticle, url: p.url, image: p.image }; });
}

export async function freshProduct(id: number) {
  const product = await getProduct(id);
  saveProduct(product);
  return product;
}

export async function syncCatalog(maxPages: number, onPage?: (page: number, count: number) => void) {
  ensureMode();
  if (dataMode() === "demo") { await bootstrapCatalog(); return catalogStatus(); }
  const detailPages = Math.max(0, Math.min(maxPages, Number(process.env.CATALOG_DETAIL_PAGES || 2)));
  const seen = new Set<number>();
  let previousSignature = "";
  for (let page = 1; page <= maxPages; page++) {
    const items = await getPage(page);
    if (!items.length) break;
    const signature = items.map(item => item.id).join(",");
    if (signature === previousSignature) break;
    previousSignature = signature;
    for (const item of items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      if (db().prepare("SELECT 1 FROM products WHERE id=?").get(item.id)) continue;
      const partial: Product = { ...item, supplierArticle: null, description: "", price: null, quantity: null, stores: [], offers: [], properties: {}, certificates: [], conflicts: [], fetchedAt: new Date().toISOString(), source: "live" };
      saveProduct(partial);
    }
    if (page <= detailPages) {
      for (const item of items) {
        try { await freshProduct(item.id); } catch { /* keep list entry; detail can be retried on demand */ }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    db().prepare("INSERT OR REPLACE INTO catalog_meta (key,value) VALUES ('last_page',?),('updated_at',?)").run(String(page), new Date().toISOString());
    onPage?.(page, seen.size);
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return catalogStatus();
}
