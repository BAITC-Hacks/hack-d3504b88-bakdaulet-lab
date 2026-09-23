import { NextResponse } from "next/server";
import { catalogStatus } from "@/lib/catalog";

export const runtime = "nodejs";
export async function GET() {
  const catalog = catalogStatus();
  const catalogCredentialsConfigured = Boolean(process.env.EKT_API_USERNAME && process.env.EKT_API_PASSWORD);
  return NextResponse.json({ ok: true, catalog, catalogCredentialsConfigured, ready: catalog.mode === "demo" || (catalogCredentialsConfigured && catalog.count > 0), aiConfigured: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL) });
}
