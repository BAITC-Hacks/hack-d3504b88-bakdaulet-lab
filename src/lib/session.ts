import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "./db";
import { ensureMode } from "./catalog";
import { ChatReply } from "./types";

const name = "ekt_session";
const requestSessions = new WeakMap<NextRequest, { id: string; fresh: boolean }>();

export function getSession(request: NextRequest, response?: NextResponse) {
  ensureMode();
  const cached = requestSessions.get(request);
  if (cached) {
    if (cached.fresh) response?.cookies.set(name, cached.id, { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/", maxAge: 60 * 60 * 24 * 14 });
    return cached.id;
  }
  const existing = request.cookies.get(name)?.value;
  if (existing && /^[0-9a-f-]{36}$/.test(existing)) {
    const row = db().prepare("SELECT id FROM sessions WHERE id=?").get(existing);
    if (row) { requestSessions.set(request, { id: existing, fresh: false }); return existing; }
  }
  const id = randomUUID();
  db().prepare("INSERT INTO sessions (id,created_at) VALUES (?,?)").run(id, new Date().toISOString());
  requestSessions.set(request, { id, fresh: true });
  response?.cookies.set(name, id, { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/", maxAge: 60 * 60 * 24 * 14 });
  return id;
}

export function getHistory(sessionId: string) {
  const rows = db().prepare("SELECT role,content,reply FROM messages WHERE session_id=? ORDER BY id DESC LIMIT 40").all(sessionId) as { role: "assistant" | "user"; content: string; reply: string | null }[];
  return rows.reverse().map(row => ({ role: row.role, content: row.content, reply: row.reply ? JSON.parse(row.reply) as ChatReply : undefined }));
}

export function saveExchange(sessionId: string, userMessage: string, reply: ChatReply) {
  db().transaction(() => {
    const statement = db().prepare("INSERT INTO messages (session_id,role,content,reply,created_at) VALUES (?,?,?,?,?)");
    const now = new Date().toISOString();
    statement.run(sessionId, "user", userMessage.slice(0, 1000), null, now);
    statement.run(sessionId, "assistant", reply.text.slice(0, 4000), JSON.stringify(reply), now);
    db().prepare("DELETE FROM messages WHERE session_id=? AND id NOT IN (SELECT id FROM messages WHERE session_id=? ORDER BY id DESC LIMIT 40)").run(sessionId, sessionId);
  })();
}

export function mutationAllowed(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).origin === request.nextUrl.origin; } catch { return false; }
}

export function sessionContext(sessionId: string) {
  return db().prepare("SELECT last_product_id lastProductId, city FROM sessions WHERE id=?").get(sessionId) as { lastProductId: number | null; city: string | null };
}

export function setLastProduct(sessionId: string, id: number) {
  db().prepare("UPDATE sessions SET last_product_id=? WHERE id=?").run(id, sessionId);
}

export function setCity(sessionId: string, city: string) {
  db().prepare("UPDATE sessions SET city=? WHERE id=?").run(city.slice(0, 80), sessionId);
}
