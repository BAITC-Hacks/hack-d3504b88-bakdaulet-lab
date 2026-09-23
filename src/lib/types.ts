export type Store = { id: number; name: string; quantity: number | null };
export type Certificate = { label: string; url: string; source: string };
export type Product = {
  id: number;
  name: string;
  article: string;
  supplierArticle: string | null;
  description: string;
  price: number | null;
  quantity: number | null;
  stores: Store[];
  image: string | null;
  url: string;
  offers: unknown[];
  properties: Record<string, unknown>;
  certificates: Certificate[];
  conflicts: string[];
  fetchedAt: string;
  source: "live" | "demo";
};

export type SearchItem = Pick<Product, "id" | "name" | "article" | "supplierArticle" | "url" | "image">;
export type ProposalLine = {
  productId: number;
  name: string;
  article: string;
  quantity: number;
  unit: "шт";
  storeId: number | null;
  price: number;
  available: number;
  checkedAt: string;
};
export type CartLine = ProposalLine & { key: string };
export type ChatReply = {
  text: string;
  products?: Product[];
  analogs?: { product: Product; matches: string[]; differences: string[]; caveats: string[] }[];
  proposal?: { id: string; version: number; lines: ProposalLine[]; expiresAt: string };
  cartUrl?: string;
};
