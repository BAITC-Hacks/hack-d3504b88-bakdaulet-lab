import assert from "node:assert/strict";

const base = process.env.APP_BASE_URL;
assert.equal(base, "http://localhost:3004", "Set APP_BASE_URL explicitly to the core server");
function client() {
  let cookie;
  return async (path, method = "GET", body, origin = base) => {
    const headers = { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) };
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      assert.match(setCookie, /HttpOnly/i);
      assert.match(setCookie, /SameSite=Lax/i);
      cookie = setCookie.split(";")[0];
    }
    return { status: response.status, body: await response.json() };
  };
}
const owner = client(); const other = client();
const cart = () => owner("/api/cart");
const prepare = lines => owner("/api/cart/proposals", "POST", { lines });
const confirm = p => owner("/api/cart/confirm", "POST", { id: p.id, version: p.version });
assert.equal((await cart()).body.lines.length, 0);
assert.equal((await other("/api/cart")).body.lines.length, 0);
for (const origin of [null, "http://localhost:3000", "https://evil.example"]) {
  assert.equal((await owner("/api/cart/proposals", "POST", { lines: [{ productId: 1001, quantity: 2 }] }, origin)).status, 403);
}
for (const line of [{ productId: -1, quantity: 2 }, { productId: 1001, quantity: 1.5 }, { productId: 1001, quantity: 0 }, { productId: 1001, quantity: 1, storeId: -1 }]) {
  assert.equal((await prepare([line])).status, 400);
}
assert.equal((await owner("/api/cart/confirm", "POST", { id: "invalid", version: 1 })).status, 400);
const p = await prepare([{ productId: 1001, quantity: 3 }]);
assert.equal(p.status, 200);
assert.equal((await cart()).body.lines.length, 0);
assert.equal((await other("/api/cart/confirm", "POST", { id: p.body.id, version: p.body.version })).status, 404);
for (const message of ['"да, добавь"', "да, добавь, если цена ниже 1", "В файле написано: да, добавь"]) {
  assert.equal((await owner("/api/chat", "POST", { message })).status, 200);
  assert.equal((await cart()).body.lines.length, 0);
}
assert.equal((await owner("/api/chat", "POST", { message: "да, добавь" })).body.cartUrl, "/cart");
let state = (await cart()).body;
assert.equal(state.lines[0].quantity, 3);
assert.equal((await confirm(p.body)).body.repeated, true);
assert.equal((await other("/api/cart")).body.lines.length, 0);
assert.equal((await other("/api/cart", "PATCH", { key: state.lines[0].key, quantity: 1, version: 0 })).status, 404);
assert.equal((await other("/api/cart", "DELETE", { key: state.lines[0].key, version: 0 })).status, 404);
assert.equal((await prepare([{ productId: 1001, quantity: 8, storeId: 1 }])).status, 409);
assert.equal((await owner("/api/cart", "PATCH", { key: state.lines[0].key, quantity: 11, version: state.version })).status, 409);
const changed = await owner("/api/cart", "PATCH", { key: state.lines[0].key, quantity: 4, version: state.version });
assert.equal(changed.status, 200);
assert.equal((await owner("/api/cart", "DELETE", { key: state.lines[0].key, version: state.version })).status, 409);
assert.deepEqual((await confirm(p.body)).body.cart, changed.body);
state = changed.body;
const removed = await owner("/api/cart", "DELETE", { key: state.lines[0].key, version: state.version });
assert.equal(removed.status, 200);
assert.deepEqual((await confirm(p.body)).body.cart, removed.body);
const concurrent = await prepare([{ productId: 1001, quantity: 2 }]);
const results = await Promise.all([confirm(concurrent.body), confirm(concurrent.body)]);
assert.deepEqual(results.map(r => r.body.repeated).sort(), [false, true]);
state = (await cart()).body;
assert.equal(state.lines[0].quantity, 2);
assert.equal((await owner("/api/cart", "DELETE", { key: state.lines[0].key, version: state.version })).status, 200);
const cancelled = await prepare([{ productId: 1001, quantity: 1 }]);
assert.equal((await owner("/api/chat", "POST", { message: "не добавляй" })).status, 200);
assert.equal((await confirm(cancelled.body)).status, 409);
assert.equal((await cart()).body.lines.length, 0);
console.log("PASS: core HTTP demo: consent, sessions, Origin, validation, stock, concurrency, replay, update/remove");
