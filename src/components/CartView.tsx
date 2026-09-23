"use client";

import { useEffect, useState } from "react";
import type { CartLine } from "@/lib/types";

type Cart = { lines: CartLine[]; total: number; version: number };
const money = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value) + " ₸";

export default function CartView() {
  const [cart, setCart] = useState<Cart | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch("/api/cart", { credentials: "same-origin" }).then(r => r.json()).then(setCart).catch(() => setError("Корзина временно недоступна.")); }, []);
  async function edit(method: "PATCH" | "DELETE", line: CartLine) {
    if (!cart) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/cart", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: line.key, version: cart.version, ...(method === "PATCH" ? { quantity: quantities[line.key] ?? line.quantity } : {}) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Не удалось обновить корзину.");
      setCart(data); setQuantities({});
    } catch (error) { setError(error instanceof Error ? error.message : "Ошибка сети."); }
    finally { setBusy(false); }
  }
  return <main className="cart-page"><header className="topbar"><a className="brand" href="/">EKT<span>Assistant</span></a><a className="cart-link" href="/">← Вернуться в чат</a></header><div className="cart-content"><p className="eyebrow">ВАША ПОКУПКА</p><h1>Корзина</h1><p className="cart-notice">Корзина прототипа. Заказ в ekt.kz ещё не оформлен.</p>{error && <p className="warning">{error}</p>}{!cart && !error && <p>Загружаю корзину…</p>}{cart?.lines.length === 0 && <div className="empty-cart">Пока нет товаров. <a href="/">Вернуться к ассистенту →</a></div>}{cart?.lines.map(line => <div className="cart-item" key={line.key}><div><strong>{line.name}</strong><small>Артикул {line.article} · {money(line.price)} за шт.</small><div className="cart-edit"><label>Количество <input type="number" min="1" step="1" value={quantities[line.key] ?? line.quantity} onChange={event => setQuantities(current => ({ ...current, [line.key]: Number(event.target.value) }))}/></label><button disabled={busy || (quantities[line.key] ?? line.quantity) === line.quantity} onClick={() => edit("PATCH", line)}>Сохранить</button><button className="text-button" disabled={busy} onClick={() => edit("DELETE", line)}>Удалить</button></div></div><strong>{money(line.price * line.quantity)}</strong></div>)}{cart && cart.lines.length > 0 && <div className="cart-summary"><span>Итого</span><strong>{money(cart.total)}</strong></div>}</div></main>;
}
