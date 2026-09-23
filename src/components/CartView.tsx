"use client";

import { useEffect, useState } from "react";
import type { CartLine } from "@/lib/types";

type Cart = { lines: CartLine[]; total: number; version: number };
const money = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value) + " ₸";
export default function CartView() {
  const [cart, setCart] = useState<Cart | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { fetch("/api/cart", { credentials: "same-origin" }).then(r => r.json()).then(setCart).catch(() => setError("Корзина временно недоступна.")); }, []);
  return <main className="cart-page"><header className="topbar"><a className="brand" href="/">EKT<span>Assistant</span></a><a className="cart-link" href="/">← Вернуться в чат</a></header><div className="cart-content"><p className="eyebrow">ВАША ПОКУПКА</p><h1>Корзина</h1><p className="cart-notice">Корзина прототипа. Заказ в ekt.kz ещё не оформлен.</p>{error && <p className="warning">{error}</p>}{!cart && !error && <p>Загружаю корзину…</p>}{cart?.lines.length === 0 && <div className="empty-cart">Пока нет товаров. <a href="/">Вернуться к ассистенту →</a></div>}{cart?.lines.map(line => <div className="cart-item" key={line.key}><div><strong>{line.name}</strong><small>Артикул {line.article} · {line.quantity} шт. × {money(line.price)}</small></div><strong>{money(line.price * line.quantity)}</strong></div>)}{cart && cart.lines.length > 0 && <div className="cart-summary"><span>Итого</span><strong>{money(cart.total)}</strong></div>}</div></main>;
}
