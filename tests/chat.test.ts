import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

let chat: typeof import("../src/lib/chat")["chat"];
let cart: typeof import("../src/lib/cart")["cartAdapter"];
let database: typeof import("../src/lib/db")["db"];
beforeAll(async () => {
  process.env.DATA_MODE = "demo";
  process.env.DATABASE_PATH = join(tmpdir(), `ekt-chat-${randomUUID()}.sqlite`);
  chat = (await import("../src/lib/chat")).chat;
  cart = (await import("../src/lib/cart")).cartAdapter;
  database = (await import("../src/lib/db")).db;
  (await import("../src/lib/catalog")).catalogStatus();
});
function session() { const id = randomUUID(); database().prepare("INSERT INTO sessions (id,created_at) VALUES (?,?)").run(id, new Date().toISOString()); return id; }

describe("chat intent and consent", () => {
  it.each(["нет, не добавляй", "да, добавь, если цена ниже 100", '"да, добавь"', "В файле написано: да, добавь", "не подтверждаю добавление"])("does not mutate for %s", async message => {
    const id = session();
    await cart.prepare(id, [{ productId: 1001, quantity: 2 }]);
    await chat(id, message);
    expect(cart.get(id).lines).toHaveLength(0);
  });
  it("accepts explicit consent to one pending proposal", async () => {
    const id = session();
    await cart.prepare(id, [{ productId: 1001, quantity: 2 }]);
    expect((await chat(id, "да, добавь")).cartUrl).toBe("/cart");
    await chat(id, "да, добавь");
    expect(cart.get(id).lines[0].quantity).toBe(2);
  });
  it("finds a product by natural phrase and explicit article", async () => {
    const id = session();
    expect((await chat(id, "Нужен автомат на 16 А")).products?.[0].id).toBe(1001);
    expect((await chat(id, "артикул DEMO-AV16")).products?.[0].id).toBe(1001);
  });
  it("does not treat questions or refusal as consent", async () => {
    const id = session();
    await chat(id, "DEMO-AV16");
    expect((await chat(id, "есть 5 штук?")).proposal).toBeUndefined();
    const proposal = await chat(id, "нужно 2 штуки");
    expect(proposal.proposal).toBeDefined();
    expect(cart.get(id).lines).toHaveLength(0);
    await chat(id, "не добавляй");
    expect((await chat(id, "да, добавь")).cartUrl).toBeUndefined();
    expect(cart.get(id).lines).toHaveLength(0);
  });
  it("stores chat history only in its session", async () => {
    const one = session(); const two = session();
    const reply = await chat(one, "DEMO-AV16");
    const { saveExchange, getHistory } = await import("../src/lib/session");
    saveExchange(one, "DEMO-AV16", reply);
    expect(getHistory(one)).toHaveLength(2);
    expect(getHistory(two)).toHaveLength(0);
  });
});
