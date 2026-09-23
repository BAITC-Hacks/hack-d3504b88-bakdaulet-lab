import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as XLSX from "xlsx";
import { Document, Packer, Paragraph } from "docx";
import { PDFDocument, StandardFonts } from "pdf-lib";

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
    await expect(extractFile("empty.xlsx", Buffer.alloc(0))).rejects.toThrow(/пустой/);
  });

  it("extracts a DOCX specification", async () => {
    const document = new Document({ sections: [{ children: [new Paragraph("DEMO-AV16 3 шт")] }] });
    const rows = await extractFile("spec.docx", await Packer.toBuffer(document));
    expect(rows[0].article).toBe("DEMO-AV16");
    expect(rows[0].quantity).toBe(3);
  }, 15_000);

  it("extracts a text PDF", async () => {
    const document = await PDFDocument.create();
    const page = document.addPage([400, 200]);
    const font = await document.embedFont(StandardFonts.Helvetica);
    page.drawText("DEMO-AV16 4", { x: 30, y: 150, font, size: 16 });
    const rows = await extractFile("spec.pdf", Buffer.from(await document.save()));
    expect(rows[0].article).toBe("DEMO-AV16");
    expect(rows[0].quantity).toBe(4);
  });

  it("rejects a PDF beyond the page limit before OCR", async () => {
    const document = await PDFDocument.create();
    for (let page = 0; page < 11; page++) document.addPage([200, 200]);
    await expect(extractFile("long.pdf", Buffer.from(await document.save()))).rejects.toThrow(/более 10 страниц/);
  });
});
