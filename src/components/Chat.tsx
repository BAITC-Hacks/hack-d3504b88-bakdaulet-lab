"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatReply, Product, ProposalLine } from "@/lib/types";
import UploadReview, { type UploadRow } from "./UploadReview";
import { availability } from "@/lib/inventory";

type Message = { role: "assistant" | "user"; content: string; reply?: ChatReply };
const examples = ["DEMO-AV16", "DEMO-AV16-OLD", "Условия доставки в Алматы", "Нужен автомат на 16 А"];
const formatMoney = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value) + " ₸";

async function jsonFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", ...options });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Ошибка запроса");
  return body as T;
}

function ProductCard({ product, city, onPrepare }: { product: Product; city?: string | null; onPrepare: (id: number, quantity: number) => void }) {
  const [quantity, setQuantity] = useState(1);
  const stock = availability(product, city || undefined);
  const price = product.price !== null && product.price > 0 ? formatMoney(product.price) : "Цена требует уточнения";
  return <article className="product-card"><div className="product-main"><div className="product-image">{product.image ? <img src={product.image} alt="" /> : <span>ЕКТ</span>}</div><div><p className="card-kicker">АРТИКУЛ {product.article || "не указан"}</p><h3>{product.name}</h3><p className="muted">{product.supplierArticle ? `Артикул поставщика: ${product.supplierArticle}` : ""}</p><p className="product-price">{price}</p></div></div>
    <div className="stock-row"><span className={stock.quantity && stock.quantity > 0 ? "stock-chip" : "stock-chip muted-chip"}>{stock.quantity === null ? stock.label : stock.quantity > 0 ? `${stock.label}: ${stock.quantity} шт.` : `Нет в наличии (${stock.label})`}</span><span className="muted">Проверено {new Date(product.fetchedAt).toLocaleString("ru-RU")}</span></div>
    {product.conflicts.map(item => <p className="warning" key={item}>⚠ {item}. Для замены нужна проверка.</p>)}
    <details className="details"><summary>Характеристики и склады</summary><div className="property-list">{Object.entries(product.properties).slice(0, 18).map(([key, value]) => <div key={key}><span>{key}</span><strong>{Array.isArray(value) ? value.join(", ") : String(value ?? "неизвестно")}</strong></div>)}</div>{product.stores.map(store => <p key={store.id} className="store-line">{store.name}: {store.quantity ?? "неизвестно"}</p>)}</details>
    <p className="certificate">{product.certificates.length ? product.certificates.map(c => <a key={c.url} href={c.url} target="_blank" rel="noreferrer">Сертификат: {c.label} ↗</a>) : "Сертификат в доступных данных не найден"}</p>
    <div className="card-actions">{product.url && <a href={product.url} target="_blank" rel="noreferrer">Карточка EKT ↗</a>}{stock.quantity !== null && stock.quantity > 0 && product.price !== null && <><label className="quantity-label">Кол-во <input type="number" min="1" step="1" value={quantity} onChange={e => setQuantity(Number(e.target.value))}/></label><button type="button" className="small-primary" onClick={() => onPrepare(product.id, quantity)}>Подготовить предложение</button></>}</div>
  </article>;
}

function Proposal({ proposal, onConfirm, onCancel }: { proposal: NonNullable<ChatReply["proposal"]>; onConfirm: () => void; onCancel: () => void }) {
  const total = proposal.lines.reduce((sum: number, item: ProposalLine) => sum + item.price * item.quantity, 0);
  return <div className="proposal"><p className="card-kicker">ПРОВЕРЬТЕ ПЕРЕД ДОБАВЛЕНИЕМ</p>{proposal.lines.map(item => <div className="proposal-line" key={`${item.productId}:${item.storeId}:${item.city}`}><span>{item.name}<small>{item.article} · {item.quantity} шт.{item.city ? ` · ${item.city}` : ""}</small></span><strong>{formatMoney(item.price * item.quantity)}</strong></div>)}<div className="proposal-total"><span>Итого</span><strong>{formatMoney(total)}</strong></div><p className="muted">Корзина пока не изменена. Предложение действительно до {new Date(proposal.expiresAt).toLocaleTimeString("ru-RU")}.</p><div className="proposal-actions"><button onClick={onConfirm}>Подтвердить добавление</button><button className="outline" onClick={onCancel}>Отмена</button></div></div>;
}

export default function Chat({ mode }: { mode: string }) {
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", content: "Здравствуйте! Помогу найти товар по артикулу, проверить наличие, сравнить варианты и подготовить корзину." }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadRows, setUploadRows] = useState<UploadRow[] | null>(null);
  const [ready, setReady] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    fetch("/api/chat", { credentials: "same-origin" }).then(response => response.json()).then(data => {
      if (Array.isArray(data.messages)) {
        const history = data.messages as Message[];
        const pending = data.pendingProposal as ChatReply["proposal"];
        if (pending && !history.some(message => message.reply?.proposal?.id === pending.id)) history.push({ role: "assistant", content: "У вас есть неподтверждённое предложение. Проверьте позиции перед добавлением.", reply: { text: "", proposal: pending } });
        if (history.length) setMessages(history);
      }
    }).catch(() => {}).finally(() => setReady(true));
  }, []);
  useEffect(() => { end.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages, busy]);
  const addReply = (reply: ChatReply) => setMessages(current => [...current, { role: "assistant", content: reply.text, reply }]);
  async function send(value = input) {
    const message = value.trim(); if (!message || busy || !ready) return;
    setInput(""); setMessages(current => [...current, { role: "user", content: message }]); setBusy(true);
    try { addReply(await jsonFetch<ChatReply>("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) })); }
    catch (error) { addReply({ text: error instanceof Error ? error.message : "Ошибка сети. Попробуйте снова." }); }
    finally { setBusy(false); }
  }
  async function prepare(productId: number, quantity: number) {
    setBusy(true);
    try { const proposal = await jsonFetch<NonNullable<ChatReply["proposal"]>>("/api/cart/proposals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines: [{ productId, quantity }] }) }); addReply({ text: "Проверьте состав предложения и подтвердите добавление.", proposal }); }
    catch (error) { addReply({ text: error instanceof Error ? error.message : "Не удалось подготовить предложение." }); }
    finally { setBusy(false); }
  }
  async function confirm(proposal: NonNullable<ChatReply["proposal"]>) {
    setBusy(true);
    try { const result = await jsonFetch<{ cartUrl: string }>("/api/cart/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: proposal.id, version: proposal.version }) }); addReply({ text: "Готово. Товар добавлен в корзину прототипа.", cartUrl: result.cartUrl }); }
    catch (error) { addReply({ text: error instanceof Error ? error.message : "Не удалось подтвердить предложение." }); }
    finally { setBusy(false); }
  }
  async function cancel(proposal: NonNullable<ChatReply["proposal"]>) {
    try { await jsonFetch("/api/cart/proposals", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: proposal.id }) }); addReply({ text: "Предложение отменено. Корзина не изменена." }); }
    catch (error) { addReply({ text: error instanceof Error ? error.message : "Не удалось отменить предложение." }); }
  }
  async function upload(file: File) {
    setUploadBusy(true);
    try { const data = new FormData(); data.append("file", file); const result = await jsonFetch<{ message: string; rows: UploadRow[] }>("/api/uploads", { method: "POST", body: data }); addReply({ text: result.message }); setUploadRows(result.rows); }
    catch (error) { addReply({ text: error instanceof Error ? error.message : "Файл не обработан." }); }
    finally { setUploadBusy(false); }
  }
  return <section className="chat-layout"><aside className="side-panel"><p className="eyebrow">ЧЕМ Я ПОМОГУ</p><h2>Подбор с опорой<br/>на данные</h2><div className="feature"><span>01</span><div><strong>Найти по артикулу</strong><p>Карточка, цена и остаток с отметкой времени проверки</p></div></div><div className="feature"><span>02</span><div><strong>Сравнить замену</strong><p>Совпадения и различия характеристик</p></div></div><div className="feature"><span>03</span><div><strong>Собрать корзину</strong><p>Только после вашего подтверждения</p></div></div><p className="sidebar-note">{mode === "demo" ? "Сейчас используются синтетические данные для демонстрации. Для реального каталога настройте API и режим live." : "Товары читаются из API EKT. Индекс может покрывать лишь часть каталога."}</p></aside><div className="chat-panel"><div className="chat-heading"><div className="avatar">E</div><div><strong>EKT Assistant</strong><small>Онлайн-консультация · прототип</small></div><span className="online-indicator"/></div><div className="chat-messages">{messages.map((message, index) => <div key={index} className={`message ${message.role}`}><div className="bubble">{message.content}</div>{message.reply?.products?.map(p => <ProductCard product={p} city={message.reply?.city} key={p.id} onPrepare={prepare}/>)}{message.reply?.analogs?.map(a => <div className="analog" key={a.product.id}><strong>Возможная замена: {a.product.name}</strong><p>Совпадает: {a.matches.join(", ")}</p>{a.differences.length > 0 && <p>Различия: {a.differences.join(", ")}</p>}<button className="text-button" onClick={() => prepare(a.product.id, 1)}>Предложить 1 шт.</button></div>)}{message.reply?.proposal && <Proposal proposal={message.reply.proposal} onConfirm={() => confirm(message.reply!.proposal!)} onCancel={() => cancel(message.reply!.proposal!)}/>} {message.reply?.cartUrl && <a className="cart-success" href={message.reply.cartUrl}>Открыть корзину ↗</a>}</div>)}{uploadRows && <UploadReview initialRows={uploadRows} onProposal={reply => { addReply(reply); setUploadRows(null); }}/>} {busy && <div className="message assistant"><div className="bubble loading">Проверяю данные…</div></div>}<div ref={end}/></div><div className="composer"><div className="example-row">{examples.map(example => <button type="button" key={example} onClick={() => send(example)}>{example}</button>)}</div><form onSubmit={e => { e.preventDefault(); send(); }}><label className="file-button" title="Загрузить файл">＋<input type="file" accept=".xlsx,.xls,.docx,.pdf,.jpg,.jpeg" onChange={e => { const file = e.target.files?.[0]; if (file) upload(file); e.currentTarget.value = ""; }}/></label><input className="chat-input" placeholder="Введите артикул или задайте вопрос…" value={input} onChange={e => setInput(e.target.value)} disabled={busy || uploadBusy || !ready}/><button className="send-button" disabled={busy || uploadBusy || !ready || !input.trim()} aria-label="Отправить">↗</button></form>{uploadBusy && <p className="upload-status">Обрабатываю файл…</p>}</div></div></section>;
}
