import { NextRequest, NextResponse } from "next/server";
import { searchProducts, catalogStatus } from "@/lib/catalog";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const items = await searchProducts(request.nextUrl.searchParams.get("q") || "");
    return NextResponse.json({ items, catalog: catalogStatus() });
  } catch (error) { return errorResponse(error); }
}
