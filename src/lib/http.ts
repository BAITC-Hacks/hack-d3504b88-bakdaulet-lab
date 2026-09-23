import { NextRequest, NextResponse } from "next/server";
import { CartError } from "./cart";
import { mutationAllowed } from "./session";

export function errorResponse(error: unknown) {
  const status = error instanceof CartError ? error.status : 500;
  const message = error instanceof Error ? error.message : "Неизвестная ошибка";
  return NextResponse.json({ error: message }, { status });
}

export function checkMutation(request: NextRequest) {
  return mutationAllowed(request) ? null : NextResponse.json({ error: "Недопустимый источник запроса." }, { status: 403 });
}
