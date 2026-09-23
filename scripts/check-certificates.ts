import { loadEnvConfig } from "@next/env";
import { mkdirSync, writeFileSync } from "node:fs";
import { normalize } from "../src/lib/ekt";

loadEnvConfig(process.cwd());

// Bounded GET-only investigation. No catalog sync, database, AI or arbitrary URL downloader.
async function main() {
  const user = process.env.EKT_API_USERNAME;
  const password = process.env.EKT_API_PASSWORD;
  if (!user || !password) throw new Error("EKT credentials are missing.");
  const authorization = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
  let apiRequests = 0;
  async function api(path: string) {
    apiRequests++;
    const response = await fetch(`https://ekt.kz/api${path}`, {
      headers: { Authorization: authorization, Accept: "application/json" },
      redirect: "error", signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`EKT HTTP ${response.status}`);
    return response.json();
  }
  const ids = new Set<number>([515291, 18157, 515262]);
  // Two small list requests, spread the sample across both pages.
  for (const page of [1, 20]) {
    const list = await api(`/products?page=${page}`);
    for (const item of (list.items ?? []).filter((_: unknown, i: number) => i % 2 === 0)) {
      if (Number.isSafeInteger(Number(item.id)) && Number(item.id) > 0) ids.add(Number(item.id));
    }
  }
  const products = [];
  for (const id of [...ids].slice(0, 40)) {
    const raw = await api(`/products/detail?id=${id}`);
    if (Number(raw.id) !== id) throw new Error("Unexpected product ID");
    const product = normalize(raw, "live");
    const paths: string[] = [];
    const scan = (value: unknown, path: string) => {
      if (!value || typeof value !== "object") return;
      for (const [key, child] of Object.entries(value)) {
        const next = path ? `${path}.${key}` : key;
        if (/cert|sert|сертиф/iu.test(key) || (typeof child === "string" && /cert|sert|сертиф/iu.test(child))) paths.push(next);
        scan(child, next);
      }
    };
    scan(raw, "");
    products.push({ id, article: product.article, name: product.name, url: product.url, checkedAt: product.fetchedAt, matchingFields: paths, certificates: product.certificates });
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  const pages = [];
  const publicUrls = ["https://ekt.kz/certificates/", "https://ekt.kz/catalog/shkafy_shchity/shchrn_24_395kh310kh120_ekt/", ...products.slice(0, 3).map(p => p.url)];
  for (const href of new Set(publicUrls)) {
    if (!href || new URL(href).origin !== "https://ekt.kz") continue;
    try {
      // Public requests deliberately have no Authorization and never follow redirects.
      const response = await fetch(href, { redirect: "manual", signal: AbortSignal.timeout(15000) });
      const html = await response.text();
      const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
        .map(match => ({ href: match[1], label: match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() }))
        .filter(link => /cert|sert|сертиф|\.pdf(?:\?|$)/iu.test(`${link.href} ${link.label}`)).slice(0, 30);
      pages.push({ url: href, checkedAt: new Date().toISOString(), status: response.status, links });
    } catch { pages.push({ url: href, checkedAt: new Date().toISOString(), error: "Request failed or timed out" }); }
  }
  const evidence = { checkedAt: new Date().toISOString(), apiRequests, detailRequests: products.length, products, pages, applicabilityConfirmed: false };
  mkdirSync("docs/reports/certificates", { recursive: true });
  writeFileSync("docs/reports/certificates/live-evidence.json", JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify({ apiRequests, detailRequests: products.length, extractedLinks: products.reduce((n, p) => n + p.certificates.length, 0), publicPages: pages.length }));
}

main().catch(error => {
  // Do not print fetch request objects, headers or environment variables.
  console.error(error instanceof Error && /^(EKT HTTP|EKT credentials|Unexpected)/.test(error.message) ? error.message : "Certificate investigation failed (network or response error).");
  process.exitCode = 1;
});
