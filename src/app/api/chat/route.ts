import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { chat } from "@/lib/chat";
import { checkMutation, errorResponse } from "@/lib/http";
import { getHistory, getSession, saveExchange } from "@/lib/session";
import { latestPendingProposal } from "@/lib/cart";

export const runtime = "nodejs";
const schema = z.object({ message: z.string().min(1).max(1000) });
export async function GET(request: NextRequest) {
  try { const sessionId = getSession(request); const response = NextResponse.json({ messages: getHistory(sessionId), pendingProposal: latestPendingProposal(sessionId) }); getSession(request, response); return response; }
  catch (error) { return errorResponse(error); }
}
export async function POST(request: NextRequest) {
  const forbidden = checkMutation(request); if (forbidden) return forbidden;
  try {
    const body = schema.parse(await request.json());
    const sessionId = getSession(request);
    const reply = await chat(sessionId, body.message);
    saveExchange(sessionId, body.message, reply);
    const response = NextResponse.json(reply);
    getSession(request, response);
    return response;
  } catch (error) { return errorResponse(error); }
}
