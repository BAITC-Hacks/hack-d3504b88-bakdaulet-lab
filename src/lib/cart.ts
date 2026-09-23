import { randomUUID } from "node:crypto";
import { db } from "./db";
import { freshProduct } from "./catalog";
import { availability } from "./inventory";
import { CartLine, Product, ProposalLine } from "./types";

type ProposalRow = { id: string; session_id: string; version: number; cart_version: number; status: string; lines: string; expires_at: string; result: string | null };
export class CartError extends Error { constructor(message: string, public status = 400) { super(message); } }

export interface CartAdapter {
  get(sessionId: string): { version: number; lines: CartLine[]; total: number };
  prepare(sessionId: string, requests: { productId: number; quantity: number; storeId?: number | null }[]): Promise<{ id: string; version: number; lines: ProposalLine[]; expiresAt: string }>;
  confirm(sessionId: string, id: string, version: number): Promise<{ cart: ReturnType<CartAdapter["get"]>; cartUrl: string; repeated: boolean }>;
  update(sessionId: string, key: string, quantity: number, version: number): Promise<ReturnType<CartAdapter["get"]>>;
  remove(sessionId: string, key: string, version: number): ReturnType<CartAdapter["get"]>;
}

const keyOf = (productId: number, storeId: number | null, city: string | null) => `${productId}:${storeId ?? city?.toLocaleLowerCase("ru") ?? "all"}`;
const money = (price: number) => Math.round(price * 100);

// No warehouse allocation is persisted for city/aggregate lines. Do not count
// their stock again through a different, overlapping selection.
function checkStock(product: Product, lines: ProposalLine[]) {
  const scopes = new Map<string, { quantity: number; available: number; stores: Set<number> }>();
  let total = 0;
  for (const line of lines.filter(item => item.productId === product.id)) {
    const stock = availability(product, line.city || undefined, line.storeId);
    if (stock.quantity === null) throw new CartError("Наличие этого товара для добавления не подтверждено.", 409);
    const key = keyOf(line.productId, line.storeId, line.city);
    const scope = scopes.get(key) || { quantity: 0, available: stock.quantity, stores: new Set(product.stores.filter(store =>
      availability(product, undefined, store.id).quantity !== null &&
      (line.storeId !== null ? store.id === line.storeId : !line.city || store.name.toLocaleLowerCase("ru").includes(line.city.toLocaleLowerCase("ru")))
    ).map(store => store.id)) };
    scope.quantity += line.quantity;
    total += line.quantity;
    if (!Number.isSafeInteger(scope.quantity) || scope.quantity > scope.available) throw new CartError(`Доступно ${scope.available} шт. с учётом уже выбранного количества.`, 409);
    scopes.set(key, scope);
  }
  const selections = [...scopes.values()];
  for (let i = 0; i < selections.length; i++) {
    for (let j = i + 1; j < selections.length; j++) {
      if ([...selections[i].stores].some(store => selections[j].stores.has(store))) {
        throw new CartError("Остатки выбранных строк пересекаются. Выберите один город или отдельные склады для этого товара.", 409);
      }
    }
  }
  const overall = availability(product).quantity;
  const limit = overall === null ? product.quantity : overall;
  if (!Number.isSafeInteger(total) || (limit !== null && total > limit)) throw new CartError(`Общее доступное количество: ${limit ?? 0} шт. Уточните состав корзины.`, 409);
}

function sameProduct(product: Product, line: ProposalLine) {
  return product.id === line.productId && !product.offers.length && product.name === line.name && product.article === line.article && product.price === line.price;
}

export class PrototypeCartAdapter implements CartAdapter {
  get(sessionId: string) {
    const cart = db().prepare("SELECT version FROM carts WHERE session_id=?").get(sessionId) as { version: number } | undefined;
    const lines = (db().prepare("SELECT payload FROM cart_items WHERE session_id=? ORDER BY item_key").all(sessionId) as { payload: string }[]).map(row => JSON.parse(row.payload) as CartLine);
    return { version: cart?.version || 0, lines, total: lines.reduce((sum, line) => sum + money(line.price) * line.quantity, 0) / 100 };
  }

  async prepare(sessionId: string, requests: { productId: number; quantity: number; storeId?: number | null }[]) {
    if (!requests.length || requests.length > 30) throw new CartError("Выберите от 1 до 30 позиций.");
    const grouped = new Map<string, { productId: number; quantity: number; storeId: number | null }>();
    for (const request of requests) {
      if (!Number.isSafeInteger(request.productId) || request.productId <= 0 || !Number.isSafeInteger(request.quantity) || request.quantity <= 0) throw new CartError("ID товара и количество должны быть положительными целыми числами.");
      const storeId = request.storeId ?? null;
      if (storeId !== null && (!Number.isSafeInteger(storeId) || storeId <= 0)) throw new CartError("Некорректный склад.");
      const key = keyOf(request.productId, storeId, null);
      const existing = grouped.get(key);
      const quantity = request.quantity + (existing?.quantity || 0);
      if (!Number.isSafeInteger(quantity)) throw new CartError("Слишком большое количество.");
      grouped.set(key, { productId: request.productId, storeId, quantity });
    }
    const cart = this.get(sessionId);
    const session = db().prepare("SELECT city FROM sessions WHERE id=?").get(sessionId) as { city: string | null };
    const city = session?.city || null;
    const lines: ProposalLine[] = [];
    const products = new Map<number, Product>();
    for (const request of grouped.values()) {
      const product = products.get(request.productId) || await freshProduct(request.productId);
      if (product.id !== request.productId) throw new CartError("Данные товара изменились. Повторите поиск.", 409);
      products.set(product.id, product);
      if (product.offers.length) throw new CartError("У товара есть варианты. Выберите конкретный вариант перед добавлением.");
      const stock = availability(product, city || undefined, request.storeId);
      const already = cart.lines.find(line => line.key === keyOf(product.id, request.storeId, city))?.quantity || 0;
      if (stock.quantity === null) throw new CartError("Наличие этого товара для добавления не подтверждено.");
      if (already + request.quantity > stock.quantity) throw new CartError(`Доступно ${stock.quantity} шт., в корзине уже ${already} шт. Уточните количество.`);
      if (product.price === null || product.price <= 0) throw new CartError("Цена товара требует уточнения.");
      lines.push({ productId: product.id, name: product.name, article: product.article, quantity: request.quantity, unit: "шт", storeId: request.storeId, city, price: product.price, available: stock.quantity, checkedAt: product.fetchedAt });
    }
    for (const product of products.values()) checkStock(product, [...cart.lines, ...lines]);
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    db().transaction(() => {
      db().prepare("UPDATE proposals SET status='superseded' WHERE session_id=? AND status='pending'").run(sessionId);
      db().prepare("INSERT INTO proposals (id,session_id,version,cart_version,status,lines,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)")
        .run(id, sessionId, 1, cart.version, "pending", JSON.stringify(lines), new Date().toISOString(), expiresAt);
    })();
    return { id, version: 1, lines, expiresAt };
  }

  async confirm(sessionId: string, id: string, version: number) {
    const proposal = db().prepare("SELECT * FROM proposals WHERE id=? AND session_id=?").get(id, sessionId) as ProposalRow | undefined;
    if (!proposal) throw new CartError("Предложение не найдено в вашей сессии.", 404);
    if (proposal.version !== version) throw new CartError("Предложение больше не действует. Подготовьте новое.", 409);
    if (proposal.status === "confirmed" && proposal.result) return { cart: this.get(sessionId), cartUrl: "/cart", repeated: true };
    if (proposal.status !== "pending" || !(Date.parse(proposal.expires_at) > Date.now())) throw new CartError("Предложение больше не действует. Подготовьте новое.", 409);
    const lines = JSON.parse(proposal.lines) as ProposalLine[];
    const cartBefore = this.get(sessionId);
    if (cartBefore.version !== proposal.cart_version) throw new CartError("Корзина изменилась. Подготовьте предложение заново.", 409);
    const products = new Map<number, Product>();
    for (const line of lines) {
      const product = products.get(line.productId) || await freshProduct(line.productId);
      products.set(product.id, product);
      const stock = availability(product, line.city || undefined, line.storeId);
      const existing = cartBefore.lines.find(item => item.key === keyOf(line.productId, line.storeId, line.city))?.quantity || 0;
      if (!sameProduct(product, line) || stock.quantity === null || stock.quantity < existing + line.quantity) {
        throw new CartError("Цена, товар или наличие изменились. Обновите предложение и подтвердите его снова.", 409);
      }
    }
    for (const product of products.values()) checkStock(product, [...cartBefore.lines, ...lines]);
    return db().transaction(() => {
      const current = db().prepare("SELECT * FROM proposals WHERE id=? AND session_id=?").get(id, sessionId) as ProposalRow;
      if (current.version !== version) throw new CartError("Предложение больше не действует.", 409);
      if (current.status === "confirmed" && current.result) return { cart: this.get(sessionId), cartUrl: "/cart", repeated: true };
      if (current.status !== "pending" || !(Date.parse(current.expires_at) > Date.now())) throw new CartError("Предложение больше не действует.", 409);
      const cart = this.get(sessionId);
      if (cart.version !== current.cart_version) throw new CartError("Корзина изменилась. Подготовьте предложение заново.", 409);
      db().prepare("INSERT OR IGNORE INTO carts (session_id,version) VALUES (?,0)").run(sessionId);
      for (const line of lines) {
        const key = keyOf(line.productId, line.storeId, line.city);
        const existing = cart.lines.find(item => item.key === key);
        const item: CartLine = { ...line, key, quantity: line.quantity + (existing?.quantity || 0) };
        db().prepare("INSERT INTO cart_items (session_id,item_key,payload) VALUES (?,?,?) ON CONFLICT(session_id,item_key) DO UPDATE SET payload=excluded.payload")
          .run(sessionId, key, JSON.stringify(item));
      }
      db().prepare("UPDATE carts SET version=version+1 WHERE session_id=?").run(sessionId);
      const result = { cart: this.get(sessionId), cartUrl: "/cart" };
      db().prepare("UPDATE proposals SET status='confirmed',result=? WHERE id=?").run(JSON.stringify(result), id);
      return { ...result, repeated: false };
    })();
  }

  async update(sessionId: string, key: string, quantity: number, version: number) {
    if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new CartError("Количество должно быть положительным целым числом.");
    const cart = this.get(sessionId);
    if (cart.version !== version) throw new CartError("Корзина изменилась. Обновите страницу.", 409);
    const line = cart.lines.find(item => item.key === key);
    if (!line) throw new CartError("Позиция не найдена в вашей корзине.", 404);
    const product = await freshProduct(line.productId);
    const stock = availability(product, line.city || undefined, line.storeId);
    if (!sameProduct(product, line) || stock.quantity === null) throw new CartError("Данные товара изменились. Подготовьте новое предложение через чат.", 409);
    if (quantity > stock.quantity) throw new CartError(`Доступно не более ${stock.quantity} шт.`, 409);
    checkStock(product, cart.lines.map(item => item.key === key ? { ...item, quantity } : item));
    return db().transaction(() => {
      if (this.get(sessionId).version !== version) throw new CartError("Корзина изменилась. Обновите страницу.", 409);
      db().prepare("UPDATE cart_items SET payload=? WHERE session_id=? AND item_key=?").run(JSON.stringify({ ...line, quantity }), sessionId, key);
      db().prepare("UPDATE carts SET version=version+1 WHERE session_id=?").run(sessionId);
      return this.get(sessionId);
    })();
  }

  remove(sessionId: string, key: string, version: number) {
    return db().transaction(() => {
      if (this.get(sessionId).version !== version) throw new CartError("Корзина изменилась. Обновите страницу.", 409);
      const result = db().prepare("DELETE FROM cart_items WHERE session_id=? AND item_key=?").run(sessionId, key);
      if (!result.changes) throw new CartError("Позиция не найдена в вашей корзине.", 404);
      db().prepare("UPDATE carts SET version=version+1 WHERE session_id=?").run(sessionId);
      return this.get(sessionId);
    })();
  }
}

export const cartAdapter: CartAdapter = new PrototypeCartAdapter();

export function latestPendingProposal(sessionId: string) {
  const row = db().prepare("SELECT * FROM proposals WHERE session_id=? AND status='pending' AND expires_at>? ORDER BY created_at DESC LIMIT 1").get(sessionId, new Date().toISOString()) as ProposalRow | undefined;
  return row ? { id: row.id, version: row.version, lines: JSON.parse(row.lines) as ProposalLine[], expiresAt: row.expires_at } : null;
}

export function cancelProposal(sessionId: string, id: string) {
  const result = db().prepare("UPDATE proposals SET status='cancelled' WHERE id=? AND session_id=? AND status='pending'").run(id, sessionId);
  if (!result.changes) throw new CartError("Активное предложение не найдено.", 404);
}
