"use client";

import { useState } from "react";
import type { ChatReply } from "@/lib/types";

export type UploadRow = { source: string; text: string; article: string | null; quantity: number | null; unit: string | null; confidence: "high" | "low"; productId: number | null; status: string };

export default function UploadReview({ initialRows, onProposal }: { initialRows: UploadRow[]; onProposal: (reply: ChatReply) => void }) {
  const [rows, setRows] = useState(initialRows);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function update(index: number, patch: Partial<UploadRow>) { setRows(current => current.map((row, i) => i === index ? { ...row, ...patch } : row)); }
  async function match(index: number) {
    const article = rows[index].article?.trim(); if (!article) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/products/search?q=${encodeURIComponent(article)}`);
      const data = await response.json();
      const item = data.items?.find((p: { article: string; supplierArticle: string | null }) => p.article.toLocaleLowerCase("ru") === article.toLocaleLowerCase("ru") || p.supplierArticle?.toLocaleLowerCase("ru") === article.toLocaleLowerCase("ru"));
      update(index, { productId: item?.id || null, status: item ? `Найден: ${item.name}` : "Точное совпадение не найдено" });
    } catch { setError("Поиск артикула временно недоступен."); }
    finally { setBusy(false); }
  }
  async function prepare() {
    const valid = rows.filter(row => row.productId && Number.isSafeInteger(row.quantity) && row.quantity! > 0 && (!row.unit || /^(шт|штук|штуки)$/iu.test(row.unit)));
    if (!valid.length) { setError("Нет подтверждённых штучных позиций. Проверьте артикулы, количество и единицы."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/cart/proposals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines: valid.map(row => ({ productId: row.productId, quantity: row.quantity })) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось подготовить предложение.");
      onProposal({ text: "Черновик из файла подготовлен. Проверьте позиции и подтвердите добавление отдельно.", proposal: data });
    } catch (error) { setError(error instanceof Error ? error.message : "Ошибка подготовки."); }
    finally { setBusy(false); }
  }
  return <div className="upload-review"><strong>Черновик спецификации</strong><p className="muted">Исправьте распознанное. Строки без точного артикула или с неизвестной единицей не попадут в предложение.</p><div className="upload-table-wrap"><table><thead><tr><th>Источник и текст</th><th>Артикул</th><th>Количество</th><th>Единица</th><th>Сопоставление</th></tr></thead><tbody>{rows.map((row, index) => <tr key={index}><td><small>{row.source}</small><br/>{row.text}</td><td><input value={row.article || ""} onChange={e => update(index, { article: e.target.value, productId: null, status: "Нужно сопоставить" })}/></td><td><input type="number" min="1" step="1" value={row.quantity ?? ""} onChange={e => update(index, { quantity: Number(e.target.value) || null })}/></td><td><input value={row.unit || ""} onChange={e => update(index, { unit: e.target.value })}/></td><td>{row.status}<br/><button type="button" className="text-button" onClick={() => match(index)}>Проверить</button></td></tr>)}</tbody></table></div>{error && <p className="warning">{error}</p>}<button type="button" className="small-primary" disabled={busy} onClick={prepare}>Подготовить предложение из найденных строк</button></div>;
}
