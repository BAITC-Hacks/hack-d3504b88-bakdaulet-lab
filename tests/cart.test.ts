import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

let cart: typeof import("../src/lib/cart");
let database: typeof import("../src/lib/db");

beforeAll(async () => {
  process.env.DATA_MODE = "demo";
  process.env.DATABASE_PATH = join(tmpdir(), `ekt-test-${randomUUID()}.sqlite`);
  cart = await import("../src/lib/cart");
  database = await import("../src/lib/db");
  (await import("../src/lib/catalog")).catalogStatus();
});

beforeEach(() => {
  const d = database.db();
  d.exec("DELETE FROM proposals; DELETE FROM cart_items; DELETE FROM carts; DELETE FROM sessions;");
});

function session() {
  const id = randomUUID();
  database.db().prepare("INSERT INTO sessions (id,created_at) VALUES (?,?)").run(id, new Date().toISOString());
  return id;
}

describe("cart confirmation", () => {
  it("does not mutate the cart before confirmation and is idempotent", async () => {
    const id = session();
    const proposal = await cart.cartAdapter.prepare(id, [{ productId: 1001, quantity: 3 }]);
    expect(cart.cartAdapter.get(id).lines).toHaveLength(0);
    const first = await cart.cartAdapter.confirm(id, proposal.id, proposal.version);
    const second = await cart.cartAdapter.confirm(id, proposal.id, proposal.version);
    expect(first.cart.lines[0].quantity).toBe(3);
    expect(second.repeated).toBe(true);
    expect(cart.cartAdapter.get(id).lines[0].quantity).toBe(3);
  });

  it("rejects cumulative quantity over available stock", async () => {
    const id = session();
    const first = await cart.cartAdapter.prepare(id, [{ productId: 1001, quantity: 7 }]);
    await cart.cartAdapter.confirm(id, first.id, first.version);
    await expect(cart.cartAdapter.prepare(id, [{ productId: 1001, quantity: 5 }])).rejects.toThrow(/Доступно 10/);
    expect(cart.cartAdapter.get(id).lines[0].quantity).toBe(7);
  });

  it("keeps proposals and carts private between sessions", async () => {
    const one = session(); const two = session();
    const proposal = await cart.cartAdapter.prepare(one, [{ productId: 1001, quantity: 1 }]);
    await expect(cart.cartAdapter.confirm(two, proposal.id, proposal.version)).rejects.toThrow(/не найдено/);
    await cart.cartAdapter.confirm(one, proposal.id, proposal.version);
    expect(cart.cartAdapter.get(two).lines).toHaveLength(0);
  });

  it("rejects expired and superseded proposals", async () => {
    const id = session();
    const old = await cart.cartAdapter.prepare(id, [{ productId: 1001, quantity: 1 }]);
    await cart.cartAdapter.prepare(id, [{ productId: 1001, quantity: 2 }]);
    await expect(cart.cartAdapter.confirm(id, old.id, old.version)).rejects.toThrow(/не действует/);
    const row = await cart.cartAdapter.prepare(id, [{ productId: 1001, quantity: 3 }]);
    database.db().prepare("UPDATE proposals SET expires_at=? WHERE id=?").run("2020-01-01T00:00:00.000Z", row.id);
    await expect(cart.cartAdapter.confirm(id, row.id, row.version)).rejects.toThrow(/не действует/);
  });

  it("rejects unknown stock and items with variants", async () => {
    const id = session();
    await expect(cart.cartAdapter.prepare(id, [{ productId: 1004, quantity: 1 }])).rejects.toThrow(/не подтверждено/);
  });

  it("updates and removes only a session-owned item with current cart version", async () => {
    const id = session();
    const proposal = await cart.cartAdapter.prepare(id, [{ productId: 1001, quantity: 2 }]);
    await cart.cartAdapter.confirm(id, proposal.id, proposal.version);
    const before = cart.cartAdapter.get(id);
    const key = before.lines[0].key;
    await expect(cart.cartAdapter.update(id, key, 11, before.version)).rejects.toThrow(/не более 10/);
    const changed = await cart.cartAdapter.update(id, key, 4, before.version);
    expect(changed.lines[0].quantity).toBe(4);
    await expect(cart.cartAdapter.update(id, key, 5, before.version)).rejects.toThrow(/изменилась/);
    const after = cart.cartAdapter.remove(id, key, changed.version);
    expect(after.lines).toHaveLength(0);
  });

  it("checks availability in the selected city", async () => {
    const id = session();
    database.db().prepare("UPDATE sessions SET city=? WHERE id=?").run("Астана", id);
    await expect(cart.cartAdapter.prepare(id, [{ productId: 1001, quantity: 1 }])).rejects.toThrow(/не подтверждено/);
    database.db().prepare("UPDATE sessions SET city=? WHERE id=?").run("Алматы", id);
    const proposal = await cart.cartAdapter.prepare(id, [{ productId: 1001, quantity: 1 }]);
    expect(proposal.lines[0].city).toBe("Алматы");
    expect((await cart.cartAdapter.confirm(id, proposal.id, proposal.version)).cart.lines[0].quantity).toBe(1);
  });
});
