import { NextRequest, NextResponse } from "next/server";
import { extractFile, saveAttachment } from "@/lib/uploads";
import { checkMutation, errorResponse } from "@/lib/http";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const forbidden = checkMutation(request); if (forbidden) return forbidden;
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Выберите файл." }, { status: 400 });
    const max = Math.max(1, Math.min(20, Number(process.env.UPLOAD_MAX_MB || 10))) * 1024 * 1024;
    if (file.size > max) return NextResponse.json({ error: "Файл превышает допустимый размер." }, { status: 413 });
    const rows = await extractFile(file.name, Buffer.from(await file.arrayBuffer()));
    const response = NextResponse.json({ id: saveAttachment(getSession(request), file.name, rows), rows, message: rows.length ? `Извлечено строк: ${rows.length}. Проверьте артикулы и количество; файл не является согласием на добавление.` : "В файле не найдено строк для обработки. Попробуйте документ с текстом или более чёткое фото." });
    getSession(request, response);
    return response;
  } catch (error) { return errorResponse(error); }
}
