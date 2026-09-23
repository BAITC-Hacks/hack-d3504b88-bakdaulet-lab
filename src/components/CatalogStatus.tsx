"use client";

import { useEffect, useState } from "react";

export default function CatalogStatus({ initialMode, initialCount }: { initialMode: string; initialCount: number }) {
  const [status, setStatus] = useState<{ mode: string; count: number; ready: boolean; credentials?: boolean }>({ mode: initialMode, count: initialCount, ready: initialMode === "demo" || initialCount > 0 });
  useEffect(() => {
    let active = true;
    const refresh = () => fetch("/api/health").then(response => response.json()).then(data => {
      if (active) setStatus({ mode: data.catalog.mode, count: data.catalog.count, ready: data.ready, credentials: data.catalogCredentialsConfigured });
    }).catch(() => {});
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return <div className="hero-meta"><span className="status-dot"/> {status.mode === "demo" ? "Демонстрационные данные" : status.ready ? "Каталог EKT: live" : status.credentials === false ? "Каталог EKT: укажите доступ в .env" : "Индекс каталога обновляется"} <span className="meta-divider">·</span> В индексе {status.count} товаров, выборка неполная</div>;
}
