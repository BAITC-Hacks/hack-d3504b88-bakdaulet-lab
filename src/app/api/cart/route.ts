import { NextRequest, NextResponse } from "next/server";
import { cartAdapter } from "@/lib/cart";
import { errorResponse } from "@/lib/http";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const response = NextResponse.json(cartAdapter.get(getSession(request)));
    getSession(request, response);
    return response;
  } catch (error) { return errorResponse(error); }
}
