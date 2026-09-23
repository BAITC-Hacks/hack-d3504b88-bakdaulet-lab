import { NextRequest, NextResponse } from "next/server";
import { cartAdapter } from "@/lib/cart";
import { errorResponse } from "@/lib/http";
import { checkMutation } from "@/lib/http";
import { getSession } from "@/lib/session";
import { z } from "zod";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const response = NextResponse.json(cartAdapter.get(getSession(request)));
    getSession(request, response);
    return response;
  } catch (error) { return errorResponse(error); }
}
const editSchema = z.object({ key: z.string().min(3).max(100), version: z.number().int().nonnegative() });
export async function PATCH(request: NextRequest) {
  const forbidden = checkMutation(request); if (forbidden) return forbidden;
  try {
    const body = editSchema.extend({ quantity: z.number().int().positive() }).parse(await request.json());
    const response = NextResponse.json(await cartAdapter.update(getSession(request), body.key, body.quantity, body.version));
    getSession(request, response); return response;
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: NextRequest) {
  const forbidden = checkMutation(request); if (forbidden) return forbidden;
  try {
    const body = editSchema.parse(await request.json());
    const response = NextResponse.json(cartAdapter.remove(getSession(request), body.key, body.version));
    getSession(request, response); return response;
  } catch (error) { return errorResponse(error); }
}
