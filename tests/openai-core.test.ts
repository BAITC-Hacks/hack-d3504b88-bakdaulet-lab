import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({ create: vi.fn(), fresh: vi.fn(), search: vi.fn(), prepare: vi.fn(), get: vi.fn() }));
vi.mock("openai", () => ({ default: class { responses = { create: mocks.create }; } }));
vi.mock("../src/lib/catalog", () => ({ freshProduct: mocks.fresh, searchProducts: mocks.search }));
vi.mock("../src/lib/cart", () => ({ cartAdapter: { prepare: mocks.prepare, get: mocks.get } }));
vi.mock("../src/lib/session", () => ({ sessionContext: () => ({ city: null, lastProductId: null }), setLastProduct: vi.fn() }));
let askAI: typeof import("../src/lib/openai")["askAI"];
let db: typeof import("../src/lib/db")["db"];
const fabricated = "Куплено! Цена 999 тенге, 500 штук, сертификат https://fake.invalid/cert.pdf";
const call = (name: string, args: unknown) => ({ type: "function_call", name, call_id: "call_1", arguments: JSON.stringify(args) });
beforeAll(async () => {
  process.env.DATABASE_PATH = join(tmpdir(), `ekt-openai-${randomUUID()}.sqlite`);
  askAI = (await import("../src/lib/openai")).askAI;
  db = (await import("../src/lib/db")).db;
});
beforeEach(() => {
  vi.resetAllMocks();
  process.env.OPENAI_API_KEY = "test-key-no-network";
  process.env.OPENAI_MODEL = "test-model";
  mocks.create.mockResolvedValue({ output: [], output_text: fabricated });
});
it("does not expose unsupported model claims without tool facts", async () => {
  const reply = await askAI("session", "вопрос");
  expect(reply?.text).not.toContain("999");
  expect(reply?.text).not.toContain("Куплено");
  const tools = mocks.create.mock.calls[0][0].tools;
  expect(tools.map((tool: { name: string }) => tool.name)).toEqual([
    "search_products", "get_product_details", "find_analogs", "get_purchase_policy", "get_cart", "prepare_cart_proposal", "read_attachment_rows",
  ]);
});
it.each([
  ["get_product_details", { id: -1 }], ["get_product_details", { id: 0 }],
  ["get_product_details", { id: "1" }], ["get_product_details", { id: 1, extra: true }],
  ["find_analogs", { id: -2 }], ["search_products", { query: "" }],
  ["search_products", { query: "x".repeat(1001) }],
  ["prepare_cart_proposal", { productId: 1, quantity: -1 }],
  ["prepare_cart_proposal", { productId: 1, quantity: 1.5 }],
  ["prepare_cart_proposal", { productId: 1, quantity: 1, confirmed: true }],
  ["get_cart", { sessionId: "other" }], ["confirm_cart", {}],
])("rejects untrusted arguments for %s before execution", async (name, args) => {
  mocks.create.mockResolvedValueOnce({ output: [call(name as string, args)], output_text: "" });
  const reply = await askAI("session", "вопрос");
  expect(mocks.fresh).not.toHaveBeenCalled();
  expect(mocks.search).not.toHaveBeenCalled();
  expect(mocks.prepare).not.toHaveBeenCalled();
  expect(mocks.get).not.toHaveBeenCalled();
  expect(reply?.text).not.toContain("999");
});
it("renders trusted search facts instead of free model text", async () => {
  mocks.search.mockResolvedValue([{ id: 1, name: "Товар", article: "ART" }]);
  mocks.create.mockResolvedValueOnce({ output: [call("search_products", { query: "ART" })], output_text: "" });
  const reply = await askAI("session", "ART");
  expect(reply?.text).toContain("ART");
  expect(reply?.text).not.toContain("999");
});
it("only prepares a proposal and requires separate consent", async () => {
  const proposal = { id: "proposal", version: 1, lines: [], expiresAt: "later" };
  mocks.prepare.mockResolvedValue(proposal);
  mocks.create.mockResolvedValueOnce({ output: [call("prepare_cart_proposal", { productId: 1, quantity: 2 })], output_text: "" });
  const reply = await askAI("owner", "нужно 2");
  expect(mocks.prepare).toHaveBeenCalledWith("owner", [{ productId: 1, quantity: 2 }]);
  expect(reply?.proposal).toEqual(proposal);
  expect(reply?.cartUrl).toBeUndefined();
});
it("does not disclose another session's attachment to the model", async () => {
  const owner = randomUUID(); const other = randomUUID(); const attachment = randomUUID();
  db().prepare("INSERT INTO sessions (id,created_at) VALUES (?,?)").run(owner, "now");
  db().prepare("INSERT INTO attachments (id,session_id,filename,rows,created_at) VALUES (?,?,?,?,?)")
    .run(attachment, owner, "private.txt", JSON.stringify([{ text: "PRIVATE_ROW" }]), "now");
  mocks.create.mockResolvedValueOnce({ output: [call("read_attachment_rows", { id: attachment })], output_text: "" });
  await askAI(other, "read");
  const outputs = mocks.create.mock.calls[1][0].input.filter((item: { type: string }) => item.type === "function_call_output");
  expect(JSON.stringify(outputs)).not.toContain("PRIVATE_ROW");
  expect(JSON.stringify(outputs)).toContain("Файл не найден");
});
it.each(["null", "{", "[]"])("handles malformed arguments %s without mutation", async argumentsText => {
  mocks.create.mockResolvedValueOnce({ output: [{ ...call("prepare_cart_proposal", {}), arguments: argumentsText }], output_text: "" });
  expect((await askAI("owner", "вопрос"))?.cartUrl).toBeUndefined();
  expect(mocks.prepare).not.toHaveBeenCalled();
});
