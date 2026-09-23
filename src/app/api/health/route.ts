import { NextResponse } from "next/server";
import { catalogStatus } from "@/lib/catalog";

export const runtime = "nodejs";
export async function GET() {
  return NextResponse.json({ ok: true, catalog: catalogStatus(), aiConfigured: Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL) });
}
