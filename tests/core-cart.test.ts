import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Product } from "../src/lib/types";

const { freshProduct } = vi.hoisted(() => ({ freshProduct: vi.fn() }));
vi.mock("../src/lib/catalog", () => ({ freshProduct }));
let cart: typeof import("../src/lib/cart");
let db: typeof import("../src/lib/db")["db"];
let id: string;
let product: Product;

beforeAll(async () => {
  process.env.DATABASE_PATH = join(tmpdir(), `ekt-core-${randomUUID()}.sqlite`);
  cart = await import("../src/lib/cart");
  db = (await import("../src/lib/db")).db;
});
beforeEach(() => {
  id = randomUUID();
  db().prepare("INSERT INTO sessions (id,created_at) VALUES (?,?)").run(id, new Date().toISOString());
  product = { id: 1, name: "Товар", article: "ART", supplierArticle: null, description: "", price: 100, quantity: 10,
    stores: [{ id: 1, name: "Алматы", quantity: 10 }], image: null, url: "", offers: [], properties: {}, certificates: [], conflicts: [], fetchedAt: new Date().toISOString(), source: "demo" };
  freshProduct.mockReset().mockImplementation(async () => structuredClone(product));
});
afterEach(() => vi.restoreAllMocks());
const prepare = (quantity = 2, storeId?: number) => cart.cartAdapter.prepare(id, [{ productId: 1, quantity, storeId }]);
async function added(quantity = 2, storeId?: number) {
  const proposal = await prepare(quantity, storeId);
  return cart.cartAdapter.confirm(id, proposal.id, proposal.version);
}
function pauseDetail() {
  let release!: (value: Product) => void;
  freshProduct.mockImplementationOnce(() => new Promise<Product>(resolve => { release = resolve; }));
  return () => release(structuredClone(product));
}

it("serializes simultaneous confirmations without double addition", async () => {
  const p = await prepare();
  const results = await Promise.all([cart.cartAdapter.confirm(id, p.id, 1), cart.cartAdapter.confirm(id, p.id, 1)]);
  expect(results.map(r => r.repeated).sort()).toEqual([false, true]);
  expect(cart.cartAdapter.get(id).lines[0].quantity).toBe(2);
});
it("returns the current cart on replay after a later removal", async () => {
  const p = await prepare();
  const first = await cart.cartAdapter.confirm(id, p.id, 1);
  const current = cart.cartAdapter.remove(id, first.cart.lines[0].key, first.cart.version);
  expect((await cart.cartAdapter.confirm(id, p.id, 1)).cart).toEqual(current);
});
it("rejects a wrong proposal version even on replay", async () => {
  const p = await prepare();
  await cart.cartAdapter.confirm(id, p.id, 1);
  await expect(cart.cartAdapter.confirm(id, p.id, 2)).rejects.toThrow();
});
it("rechecks expiry after the network read", async () => {
  const p = await prepare();
  const release = pauseDetail();
  const pending = cart.cartAdapter.confirm(id, p.id, 1);
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(p.expiresAt));
  release();
  await expect(pending).rejects.toThrow(/не действует/);
  expect(cart.cartAdapter.get(id).lines).toHaveLength(0);
});
it.each(["update", "remove"] as const)("rejects confirm racing with %s", async action => {
  const first = await added();
  const p = await prepare();
  const release = pauseDetail();
  const pending = cart.cartAdapter.confirm(id, p.id, 1);
  if (action === "remove") cart.cartAdapter.remove(id, first.cart.lines[0].key, first.cart.version);
  else await cart.cartAdapter.update(id, first.cart.lines[0].key, 3, first.cart.version);
  const current = cart.cartAdapter.get(id);
  release();
  await expect(pending).rejects.toThrow(/изменилась/);
  expect(cart.cartAdapter.get(id)).toEqual(current);
});
it("rejects update racing with confirm", async () => {
  const first = await added();
  const p = await prepare();
  const release = pauseDetail();
  const pending = cart.cartAdapter.update(id, first.cart.lines[0].key, 3, first.cart.version);
  await cart.cartAdapter.confirm(id, p.id, 1);
  release();
  await expect(pending).rejects.toThrow(/изменилась/);
  expect(cart.cartAdapter.get(id).lines[0].quantity).toBe(4);
});
it.each(["offers", "article", "id", "price", "stock", "excluded"])("rejects changed %s on confirm", async field => {
  const p = await prepare();
  change(field);
  await expect(cart.cartAdapter.confirm(id, p.id, 1)).rejects.toThrow();
  expect(cart.cartAdapter.get(id).lines).toHaveLength(0);
});
it.each(["offers", "article", "id", "price", "stock", "excluded"])("rejects changed %s on update", async field => {
  const first = await added();
  change(field);
  await expect(cart.cartAdapter.update(id, first.cart.lines[0].key, 3, first.cart.version)).rejects.toThrow();
  expect(cart.cartAdapter.get(id)).toEqual(first.cart);
});
function change(field: string) {
  if (field === "offers") product.offers = [{ id: 99 }];
  if (field === "article") product.article = "OTHER";
  if (field === "id") product.id = 99;
  if (field === "price") product.price = 200;
  if (field === "stock") product.stores[0].quantity = 1;
  if (field === "excluded") product.stores[0].name = "Брак Алматы";
}
it("rejects overlapping aggregate and warehouse stock in one proposal", async () => {
  await expect(cart.cartAdapter.prepare(id, [{ productId: 1, quantity: 7 }, { productId: 1, quantity: 7, storeId: 1 }])).rejects.toThrow();
});
it("counts existing aggregate stock before a warehouse addition", async () => {
  await added(7);
  await expect(prepare(7, 1)).rejects.toThrow();
});
it("counts existing city stock before an aggregate addition", async () => {
  db().prepare("UPDATE sessions SET city='Алматы' WHERE id=?").run(id);
  await added(7);
  db().prepare("UPDATE sessions SET city=NULL WHERE id=?").run(id);
  await expect(prepare(7)).rejects.toThrow();
});
it("permits disjoint known warehouses but respects the total stock", async () => {
  product.stores = [{ id: 1, name: "Алматы", quantity: 8 }, { id: 2, name: "Астана", quantity: 8 }];
  const p = await cart.cartAdapter.prepare(id, [{ productId: 1, quantity: 4, storeId: 1 }, { productId: 1, quantity: 4, storeId: 2 }]);
  const first = await cart.cartAdapter.confirm(id, p.id, 1);
  expect(first.cart.lines).toHaveLength(2);
  await expect(cart.cartAdapter.update(id, first.cart.lines[0].key, 8, first.cart.version)).rejects.toThrow();
  await expect(prepare(4, 1)).rejects.toThrow();
});
it("revalidates scopes when warehouse membership changes", async () => {
  product.quantity = 20;
  product.stores.push({ id: 2, name: "Астана", quantity: 10 });
  db().prepare("UPDATE sessions SET city='Алматы' WHERE id=?").run(id);
  const p = await cart.cartAdapter.prepare(id, [{ productId: 1, quantity: 7 }, { productId: 1, quantity: 7, storeId: 2 }]);
  product.stores[1].name = "Алматы 2";
  await expect(cart.cartAdapter.confirm(id, p.id, 1)).rejects.toThrow();
});
it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("rejects invalid product ID %s before fetching", async productId => {
  await expect(cart.cartAdapter.prepare(id, [{ productId, quantity: 1 }])).rejects.toThrow();
  expect(freshProduct).not.toHaveBeenCalled();
});
