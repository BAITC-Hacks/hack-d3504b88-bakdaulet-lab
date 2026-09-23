import { findAnalogs } from "./analogs";
import { cartAdapter, cancelProposal, latestPendingProposal } from "./cart";
import { freshProduct, searchProducts } from "./catalog";
import { availability } from "./inventory";
import { purchasePolicy } from "./policy";
import { ChatReply } from "./types";
import { sessionContext, setCity, setLastProduct } from "./session";
import { askAI } from "./openai";

const yes = /^(да[,!\s]*(добавь|подтверждаю)|подтверждаю добавление|добавь в корзину)[.!\s]*$/iu;
const no = /^(нет[,!\s]*(не добавляй)?|не добавляй|отмена)[.!\s]*$/iu;

export async function chat(sessionId: string, message: string): Promise<ChatReply> {
  const input = message.trim().slice(0, 1000);
  if (!input) return { text: "Напишите вопрос или артикул товара." };
  const context = sessionContext(sessionId);
  if (yes.test(input)) {
    const proposal = latestPendingProposal(sessionId);
    if (!proposal) return { text: "Нет действующего предложения. Сначала выберите товар и количество." };
    const result = await cartAdapter.confirm(sessionId, proposal.id, proposal.version);
    return { text: "Позиции добавлены в корзину прототипа.", cartUrl: result.cartUrl };
  }
  if (no.test(input)) { const proposal = latestPendingProposal(sessionId); if (proposal) cancelProposal(sessionId, proposal.id); return { text: "Хорошо, предложение отменено. Корзина не изменена." }; }
  const cityMatch = input.match(/(?:в городе|в)\s+(Алматы|Астане|Шымкенте|Караганде)/iu);
  if (cityMatch) setCity(sessionId, cityMatch[1].replace("Астане", "Астана").replace("Шымкенте", "Шымкент").replace("Караганде", "Караганда"));
  const city = sessionContext(sessionId).city || undefined;
  if (/оплат|достав|самовывоз|минимальн|партия|кратность/iu.test(input)) {
    const policy = purchasePolicy(input, city);
    return { text: `${policy.text}\nИсточник: ${policy.source} (проверено ${policy.checkedAt}).` };
  }
  const quantity = input.match(/(?:нужно|добавь|возьму|купить)\s+(\d+)\s*(?:шт|штук|штуки)?/iu);
  if (quantity && context.lastProductId) {
    const proposal = await cartAdapter.prepare(sessionId, [{ productId: context.lastProductId, quantity: Number(quantity[1]) }]);
    return { text: "Подготовил предложение. Проверьте товар и количество, затем подтвердите добавление.", proposal };
  }
  const explicitArticle = input.match(/(?:арт(?:икул)?\.?\s+)([\p{L}\d][\p{L}\d_-]{3,})/iu);
  const searchTerm = explicitArticle?.[1] || input.replace(/^(найди|покажи|есть ли|нужен|ищу)\s+/iu, "").trim();
  let candidates = await searchProducts(searchTerm, 5);
  if (!candidates.length && searchTerm !== input) candidates = await searchProducts(input, 5);
  if (!candidates.length && /^\d{4,9}$/.test(searchTerm)) {
    try { const product = await freshProduct(Number(searchTerm)); candidates = [{ id: product.id, name: product.name, article: product.article, supplierArticle: product.supplierArticle, url: product.url, image: product.image }]; } catch { /* ID not found */ }
  }
  if (!candidates.length && process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL) {
    const ai = await askAI(sessionId, input);
    if (ai) return ai;
  }
  if (!candidates.length) return { text: "В доступной выборке товар не найден. Попробуйте точный артикул или обновите индекс каталога." };
  const product = await freshProduct(candidates[0].id);
  setLastProduct(sessionId, product.id);
  const stock = availability(product, city);
  const analogs = stock.quantity === 0 ? await findAnalogs(product, city) : [];
  const stockText = stock.quantity === null ? "наличие не подтверждено" : `доступно ${stock.quantity} шт.`;
  const conflicts = product.conflicts.length ? ` Есть расхождение характеристик: ${product.conflicts.join("; ")}.` : "";
  return {
    text: `${product.name}. ${stockText} (${stock.label}).${conflicts}${analogs.length ? " Ниже показаны проверенные кандидаты на замену." : stock.quantity === 0 ? " Подтверждённых аналогов в доступной выборке пока нет." : ""}`,
    products: [product], analogs,
  };
}
