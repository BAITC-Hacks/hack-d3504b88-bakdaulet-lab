import Chat from "@/components/Chat";
import { catalogStatus } from "@/lib/catalog";

export const dynamic = "force-dynamic";
export default function Home() {
  const status = catalogStatus();
  return <main className="site-shell">
    <header className="topbar"><a className="brand" href="/">EKT<span>Assistant</span></a><span className="top-caption">Помощник по выбору электротоваров</span><a className="cart-link" href="/cart">Корзина <span>↗</span></a></header>
    <section className="hero"><div className="hero-copy"><p className="eyebrow">КОНСУЛЬТАЦИЯ ПО КАТАЛОГУ</p><h1>Найдите нужный товар<br/><em>без долгого поиска</em></h1><p>Спросите об артикуле, наличии, характеристиках или условиях покупки. Перед добавлением товара мы покажем точный состав предложения.</p><div className="hero-meta"><span className="status-dot"/> {status.mode === "demo" ? "Демонстрационные данные" : "Каталог EKT: live"} <span className="meta-divider">·</span> В индексе {status.count} товаров, выборка неполная</div></div><div className="hero-accent"><div className="accent-ring"><span>ЕКТ</span><small>AI ASSISTANT</small></div></div></section>
    <Chat mode={status.mode} />
    <footer className="footer">Прототип. Корзина сохраняется в этом приложении; заказ на ekt.kz не оформляется.</footer>
  </main>;
}
