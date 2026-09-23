import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as XLSX from "xlsx";

let extractFile: typeof import("../src/lib/uploads")["extractFile"];
beforeAll(async () => {
  process.env.DATA_MODE = "demo";
  process.env.DATABASE_PATH = join(tmpdir(), `ekt-upload-${randomUUID()}.sqlite`);
  extractFile = (await import("../src/lib/uploads")).extractFile;
});

describe("document extraction", () => {
  it.each(["xlsx", "xls"])("extracts and matches an %s article", async format => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["DEMO-AV16", 2, "шт"]]), "Заказ");
    const bytes = XLSX.write(workbook, { type: "buffer", bookType: format as "xlsx" | "xls" });
    const rows = await extractFile(`spec.${format}`, Buffer.from(bytes));
    expect(rows[0].article).toBe("DEMO-AV16");
    expect(rows[0].quantity).toBe(2);
    expect(rows[0].productId).toBe(1001);
  });

  it("rejects incorrect file signatures and unsupported DOC", async () => {
    await expect(extractFile("fake.pdf", Buffer.from("not a pdf"))).rejects.toThrow(/не соответствует/);
    await expect(extractFile("old.doc", Buffer.from("word"))).rejects.toThrow(/Старый DOC/);
  });
});
