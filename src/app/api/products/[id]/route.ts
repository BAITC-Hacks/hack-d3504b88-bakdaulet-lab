import { NextResponse } from "next/server";
import { freshProduct } from "@/lib/catalog";
import { errorResponse } from "@/lib/http";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try { return NextResponse.json(await freshProduct(Number((await context.params).id))); }
  catch (error) { return errorResponse(error); }
}
