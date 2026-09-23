import { loadEnvConfig } from "@next/env";
import OpenAI from "openai";
import { dataMode, getPage, getProduct } from "../src/lib/ekt";

async function main() {
loadEnvConfig(process.cwd());
if (dataMode() !== "live") throw new Error("Для этой проверки задайте DATA_MODE=live в локальном .env.");
if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL) throw new Error("Укажите OPENAI_API_KEY и OPENAI_MODEL в локальном .env.");

const started = Date.now();
const items = await getPage(1);
if (!items.length) throw new Error("Первая страница каталога пуста.");
const product = await getProduct(items[0].id);
console.log(`EKT API: страница 1 содержит ${items.length} товаров; detail ID ${product.id} получен за ${Date.now() - started} мс.`);

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20000, maxRetries: 0 });
const tools: OpenAI.Responses.Tool[] = [{ type: "function", name: "get_product_details", description: "Read a current product from the EKT catalog", strict: true, parameters: { type: "object", properties: { id: { type: "integer" } }, required: ["id"], additionalProperties: false } }];
const input: OpenAI.Responses.ResponseInputItem[] = [{ role: "user", content: `Вызови get_product_details для ID ${product.id}, затем кратко скажи, что данные получены.` }];
const first = await client.responses.create({ model: process.env.OPENAI_MODEL, input, tools, tool_choice: { type: "function", name: "get_product_details" }, max_output_tokens: 120, store: false });
const call = first.output.find(item => item.type === "function_call");
if (!call) throw new Error("Модель не вызвала инструмент.");
const args = JSON.parse(call.arguments) as { id: number };
if (args.id !== product.id) throw new Error("Модель запросила неожиданный ID; выполнение отменено.");
const fresh = await getProduct(args.id);
input.push(...first.output as OpenAI.Responses.ResponseInputItem[], { type: "function_call_output", call_id: call.call_id, output: JSON.stringify({ id: fresh.id, article: fresh.article, fetchedAt: fresh.fetchedAt, source: fresh.source }) });
const second = await client.responses.create({ model: process.env.OPENAI_MODEL, input, tools, tool_choice: "none", max_output_tokens: 100, store: false });
if (!second.output_text) throw new Error("После результата инструмента модель не вернула ответ.");
console.log(`OpenAI Responses: инструмент get_product_details вызван и результат принят за ${Date.now() - started} мс. Модель: ${process.env.OPENAI_MODEL}.`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Неизвестная ошибка live-проверки.");
  process.exitCode = 1;
});
