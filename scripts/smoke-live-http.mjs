const base = process.env.APP_BASE_URL || "http://localhost:3000";
const sourceId = Number(process.env.LIVE_SOURCE_ID || 18157);
const analogId = Number(process.env.LIVE_ANALOG_ID || 515262);
let cookie = "";

async function call(path, method = "GET", body) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method !== "GET" ? { Origin: base, "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const issued = response.headers.get("set-cookie");
  if (issued) cookie = issued.split(";")[0];
  const data = await response.json();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}: ${data.error || "нет описания"}`);
  return data;
}

const health = await call("/api/health");
if (health.catalog.mode !== "live" || !health.ready || !health.aiConfigured) throw new Error("Сервер не готов к live-сценарию EKT/OpenAI.");
const ai = await call("/api/chat", "POST", { message: "Что в моей корзине?" });
if (!ai.text.includes("Корзина прототипа пока пуста")) throw new Error(`AI не вызвал серверный инструмент корзины: ${ai.text}`);
const source = await call(`/api/products/${sourceId}`);
const analog = await call(`/api/products/${analogId}`);
if (source.source !== "live" || analog.source !== "live" || source.quantity !== 0 || !(analog.quantity > 0)) throw new Error("Проверочная пара изменилась; выберите новые ID.");
const search = await call(`/api/products/search?q=${encodeURIComponent(source.article)}`);
if (!search.items.some(item => item.id === sourceId)) throw new Error("Поиск по реальному артикулу не нашёл исходный товар.");
const reply = await call("/api/chat", "POST", { message: source.article });
if (reply.products?.[0]?.id !== sourceId || !reply.analogs?.some(item => item.product.id === analogId)) throw new Error("Чат не вернул проверенный аналог.");
const before = await call("/api/cart");
if (before.lines.length) throw new Error("Новая сессия уже содержит товары.");
const proposal = await call("/api/cart/proposals", "POST", { lines: [{ productId: analogId, quantity: 1 }] });
if (proposal.lines?.[0]?.productId !== analogId || proposal.lines[0].price !== analog.price) throw new Error("Предложение не соответствует свежей карточке.");
const pending = await call("/api/chat");
if (pending.pendingProposal?.id !== proposal.id) throw new Error("Предложение не восстановилось в сессии.");
if ((await call("/api/cart")).lines.length) throw new Error("Корзина изменилась до подтверждения.");
const confirmed = await call("/api/cart/confirm", "POST", { id: proposal.id, version: proposal.version });
const repeated = await call("/api/cart/confirm", "POST", { id: proposal.id, version: proposal.version });
const cart = await call("/api/cart");
if (confirmed.cartUrl !== "/cart" || cart.lines[0]?.productId !== analogId || cart.lines[0]?.quantity !== 1 || !repeated.repeated) throw new Error("Подтверждение, сохранение или идемпотентность не сработали.");
const otherSession = await fetch(base + "/api/cart").then(response => response.json());
if (otherSession.lines?.length) throw new Error("Корзина видна другой сессии.");
const removed = await call("/api/cart", "DELETE", { key: cart.lines[0].key, version: cart.version });
if (removed.lines.length) throw new Error("Тестовую позицию не удалось удалить.");
console.log(`Live HTTP passed: EKT ${sourceId} (0) → ${analogId} (${analog.quantity}); app AI tool call, search, chat, proposal, confirmation, repeat, isolation, cart cleanup.`);
