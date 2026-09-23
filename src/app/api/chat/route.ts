import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { chat } from "@/lib/chat";
import { checkMutation, errorResponse } from "@/lib/http";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
const schema = z.object({ message: z.string().min(1).max(1000) });
export async function POST(request: NextRequest) {
  const forbidden = checkMutation(request); if (forbidden) return forbidden;
  try {
    const body = schema.parse(await request.json());
    const response = NextResponse.json(await chat(getSession(request), body.message));
    getSession(request, response);
    return response;
  } catch (error) { return errorResponse(error); }
}
