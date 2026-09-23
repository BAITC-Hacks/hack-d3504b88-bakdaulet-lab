import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cartAdapter } from "@/lib/cart";
import { checkMutation, errorResponse } from "@/lib/http";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const forbidden = checkMutation(request); if (forbidden) return forbidden;
  try {
    const body = z.object({ id: z.string().uuid(), version: z.number().int().positive() }).parse(await request.json());
    const response = NextResponse.json(await cartAdapter.confirm(getSession(request), body.id, body.version));
    getSession(request, response);
    return response;
  } catch (error) { return errorResponse(error); }
}
