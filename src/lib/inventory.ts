import { Product } from "./types";

const excluded = (name: string) => /брак|defect|поврежд/i.test(name);

export function availability(product: Product, city?: string, storeId?: number | null): { quantity: number | null; label: string; storeId: number | null } {
  if (storeId != null) {
    const store = product.stores.find(s => s.id === storeId);
    if (!store || excluded(store.name)) return { quantity: null, label: "Склад недоступен для продажи или не найден", storeId };
    return { quantity: store.quantity, label: store.name, storeId };
  }
  if (city) {
    const stores = product.stores.filter(s => !excluded(s.name) && s.name.toLocaleLowerCase("ru").includes(city.toLocaleLowerCase("ru")));
    if (!stores.length) return { quantity: null, label: `Наличие в городе ${city} не подтверждено`, storeId: null };
    if (stores.some(s => s.quantity === null)) return { quantity: null, label: `Наличие в городе ${city} неизвестно`, storeId: null };
    return { quantity: stores.reduce((sum, s) => sum + (s.quantity || 0), 0), label: city, storeId: null };
  }
  const eligible = product.stores.filter(s => !excluded(s.name));
  if (eligible.length) {
    if (eligible.some(s => s.quantity === null)) return { quantity: null, label: "Наличие по складам неизвестно", storeId: null };
    const storeTotal = eligible.reduce((sum, s) => sum + (s.quantity || 0), 0);
    const amount = product.quantity === null ? storeTotal : Math.min(product.quantity, storeTotal);
    return { quantity: amount, label: product.quantity !== null && product.quantity !== storeTotal ? "Данные общего и складского остатка различаются; показано меньшее значение" : "Доступные склады", storeId: null };
  }
  if (product.quantity === 0) return { quantity: 0, label: "Общий остаток равен нулю", storeId: null };
  return { quantity: null, label: product.quantity === null ? "Наличие неизвестно" : `Общий остаток ${product.quantity} шт., но доступный склад продажи не подтверждён`, storeId: null };
}
