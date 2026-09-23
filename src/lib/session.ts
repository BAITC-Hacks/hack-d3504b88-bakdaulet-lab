import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "./db";

const name = "ekt_session";
const requestSessions = new WeakMap<NextRequest, { id: string; fresh: boolean }>();

export function getSession(request: NextRequest, response?: NextResponse) {
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
