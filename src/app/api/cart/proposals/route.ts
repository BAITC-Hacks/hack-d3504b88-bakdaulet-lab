import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cartAdapter, cancelProposal } from "@/lib/cart";
import { checkMutation, errorResponse } from "@/lib/http";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
const schema = z.object({ lines: z.array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().positive(), storeId: z.number().int().positive().nullable().optional() })).min(1).max(30) });
export async function POST(request: NextRequest) {
  const forbidden = checkMutation(request); if (forbidden) return forbidden;
  try {
    const body = schema.parse(await request.json());
    const response = NextResponse.json(await cartAdapter.prepare(getSession(request), body.lines));
    getSession(request, response);
    return response;
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: NextRequest) {
  const forbidden = checkMutation(request); if (forbidden) return forbidden;
  try {
    const body = z.object({ id: z.string().uuid() }).parse(await request.json());
    const response = NextResponse.json({ ok: true });
    cancelProposal(getSession(request, response), body.id);
    return response;
  } catch (error) { return errorResponse(error); }
}
