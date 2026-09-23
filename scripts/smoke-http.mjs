const base = process.env.APP_BASE_URL || "http://localhost:3000";
let cookie = "";
async function call(path, method = "GET", data) {
  const response = await fetch(base + path, { method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method !== "GET" ? { Origin: base, "Content-Type": "application/json" } : {}) }, body: data ? JSON.stringify(data) : undefined });
  if (response.headers.get("set-cookie")) cookie = response.headers.get("set-cookie").split(";")[0];
  const body = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${body.error || ""}`);
  return body;
}
const health = await call("/api/health");
if (health.catalog.mode !== "demo") throw new Error("Smoke script is for demo mode only.");
const search = await call("/api/products/search?q=DEMO-AV16");
if (!search.items.some(item => item.id === 1001)) throw new Error("Search failed");
const chat = await call("/api/chat", "POST", { message: "DEMO-AV16" });
if (chat.products?.[0]?.id !== 1001) throw new Error("Chat lookup failed");
const before = await call("/api/cart");
const proposal = await call("/api/cart/proposals", "POST", { lines: [{ productId: 1001, quantity: 2 }] });
const unchanged = await call("/api/cart");
if (before.lines.length || unchanged.lines.length) throw new Error("Cart changed before confirmation");
const result = await call("/api/cart/confirm", "POST", { id: proposal.id, version: proposal.version });
const repeat = await call("/api/cart/confirm", "POST", { id: proposal.id, version: proposal.version });
const after = await call("/api/cart");
if (result.cartUrl !== "/cart" || after.lines[0]?.quantity !== 2 || !repeat.repeated) throw new Error("Confirmation failed");
console.log("HTTP smoke passed: search, chat, proposal, confirmation, idempotency, cart. Session cookie:", Boolean(cookie));
