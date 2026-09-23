"use client";

import { useState } from "react";
import type { ChatReply } from "@/lib/types";

export type UploadRow = { source: string; text: string; article: string | null; quantity: number | null; unit: string | null; confidence: "high" | "low"; productId: number | null; status: string };

function exclusion(row: UploadRow) {
  if (!row.productId) return "Нужно точное сопоставление артикула";
  if (!Number.isSafeInteger(row.quantity) || row.quantity! <= 0) return "Нужно целое положительное количество";
  if (!row.unit || !/^(шт\.?|штук|штуки)$/iu.test(row.unit.trim())) return "Укажите шт.; другие единицы пока не поддерживаются";
  return null;
}

// Reset edits and selections when another upload arrives while the review remains mounted.
export default function UploadReview(props: { initialRows: UploadRow[]; onProposal: (reply: ChatReply) => void }) {
  const [upload, setUpload] = useState({ rows: props.initialRows, revision: 0 });
  if (upload.rows !== props.initialRows) {
    setUpload({ rows: props.initialRows, revision: upload.revision + 1 });
  }
  return <Review key={upload.revision} {...props}/>;
}

function Review({ initialRows, onProposal }: { initialRows: UploadRow[]; onProposal: (reply: ChatReply) => void }) {
  const [rows, setRows] = useState(initialRows);
  const [reviewed, setReviewed] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const selected = rows.flatMap((row, index) => reviewed.has(index) && !exclusion(row) ? [{ row, index }] : []);
  function update(index: number, patch: Partial<UploadRow>) {
    setRows(current => current.map((row, i) => i === index ? { ...row, ...patch, status: patch.status ?? (row.productId ? "Артикул найден. Проверьте изменённые значения." : "Нужно сопоставить артикул.") } : row));
    setReviewed(current => { const next = new Set(current); next.delete(index); return next; });
  }
  async function match(index: number) {
    const article = rows[index].article?.trim(); if (!article) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/products/search?q=${encodeURIComponent(article)}`);
      if (!response.ok) throw new Error("Поиск недоступен");
      const data = await response.json();
      const item = data.items?.find((p: { article: string; supplierArticle: string | null }) => p.article.toLocaleLowerCase("ru") === article.toLocaleLowerCase("ru") || p.supplierArticle?.toLocaleLowerCase("ru") === article.toLocaleLowerCase("ru"));
      update(index, { productId: item?.id || null, status: item ? `Найден: ${item.name}. Проверьте количество и единицу.` : "Точное совпадение не найдено" });
    } catch { setError("Поиск артикула временно недоступен."); }
    finally { setBusy(false); }
  }
  async function prepare() {
    if (!selected.length) { setError("Проверьте строки и отметьте позиции для предложения."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/cart/proposals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines: selected.map(({ row }) => ({ productId: row.productId, quantity: row.quantity })) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось подготовить предложение.");
      onProposal({ text: `Черновик из файла подготовлен: ${selected.length} строк. Исключено: ${rows.length - selected.length}. Проверьте состав и подтвердите добавление отдельно.`, proposal: data });
    } catch (error) { setError(error instanceof Error ? error.message : "Ошибка подготовки."); }
    finally { setBusy(false); }
  }
  return <div className="upload-review">
    <strong>Черновик спецификации</strong>
    <p className="muted">Распознавание требует проверки. Точный артикул не подтверждает количество и единицу. Исправьте значения и отметьте проверенные строки.</p>
    <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div className="upload-table-wrap"><table>
        <thead><tr><th>Источник и текст</th><th>Артикул</th><th>Количество</th><th>Единица</th><th>Сопоставление</th><th>В предложение</th></tr></thead>
        <tbody>{rows.map((row, index) => {
          const reason = exclusion(row);
          return <tr key={index}>
            <td><small>{row.source}</small><br/>{row.text}</td>
            <td><input aria-label={`Артикул строки ${index + 1}`} value={row.article || ""} onChange={e => update(index, { article: e.target.value, productId: null, status: "Нужно сопоставить" })}/></td>
            <td><input aria-label={`Количество строки ${index + 1}`} type="number" min="1" step="1" value={row.quantity ?? ""} onChange={e => update(index, { quantity: e.target.value === "" ? null : Number(e.target.value) })}/></td>
            <td><input aria-label={`Единица строки ${index + 1}`} value={row.unit || ""} onChange={e => update(index, { unit: e.target.value })}/></td>
            <td>{row.status}<br/><button type="button" className="text-button" onClick={() => match(index)}>Проверить</button></td>
            <td><label><input type="checkbox" style={{ width: "auto", marginRight: 6 }} aria-label={`Проверена строка ${index + 1}`} disabled={!!reason} checked={reviewed.has(index)} onChange={e => setReviewed(current => { const next = new Set(current); if (e.target.checked) next.add(index); else next.delete(index); return next; })}/>Проверено</label><p className="muted">{reason ? `Исключена: ${reason}` : reviewed.has(index) ? "Включена в предложение" : "Исключена: подтвердите проверку строки"}</p></td>
          </tr>;
        })}</tbody>
      </table></div>
      <div aria-live="polite">
        <p><strong>Состав предложения: {selected.length} из {rows.length} строк. Исключено: {rows.length - selected.length}.</strong></p>
        {selected.length > 0 && <ul>{selected.map(({ row, index }) => <li key={index}>{row.article} — {row.quantity} шт. ({row.source})</li>)}</ul>}
        <p className="muted">Подготовка предложения не меняет корзину. Добавление нужно подтвердить отдельно.</p>
      </div>
      {error && <p className="warning" role="alert">{error}</p>}
      <button type="button" className="small-primary" disabled={busy || !selected.length} onClick={prepare}>Подготовить предложение из проверенных строк</button>
    </fieldset>
  </div>;
}
