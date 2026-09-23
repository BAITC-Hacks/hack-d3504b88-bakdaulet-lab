import { beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest, NextResponse } from "next/server";

let session: typeof import("../src/lib/session");
beforeAll(async () => {
  process.env.DATA_MODE = "demo";
  process.env.DATABASE_PATH = join(tmpdir(), `ekt-session-${randomUUID()}.sqlite`);
  session = await import("../src/lib/session");
});
it("sets a private HTTPS cookie and reuses the request session", () => {
  const request = new NextRequest("https://localhost:3004/api/cart");
  const id = session.getSession(request);
  const response = NextResponse.json({});
  expect(session.getSession(request, response)).toBe(id);
  expect(response.cookies.get("ekt_session")).toMatchObject({ value: id, httpOnly: true, sameSite: "lax", secure: true, path: "/" });
  const next = new NextRequest(request.url, { headers: { cookie: `ekt_session=${id}` } });
  expect(session.getSession(next)).toBe(id);
});
it.each(["untrusted", "' OR 1=1 --", randomUUID()])("does not adopt an invalid or unknown cookie %s", cookie => {
  const request = new NextRequest("http://localhost:3004/api/cart", { headers: { cookie: `ekt_session=${cookie}` } });
  expect(session.getSession(request)).not.toBe(cookie);
});
it.each([undefined, "null", "invalid", "https://evil.example", "http://localhost:3000", "https://localhost:3004"])("rejects Origin %s", origin => {
  const request = new NextRequest("http://localhost:3004/api/cart", { headers: origin ? { origin } : {} });
  expect(session.mutationAllowed(request)).toBe(false);
});
it("permits a same-origin mutation", () => {
  expect(session.mutationAllowed(new NextRequest("http://localhost:3004/api/cart", { headers: { origin: "http://localhost:3004" } }))).toBe(true);
});
