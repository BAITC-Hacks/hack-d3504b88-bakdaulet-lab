import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { Document, Packer, Paragraph } from "docx";
import { PDFDocument } from "pdf-lib";

const { create, search } = vi.hoisted(() => ({ create: vi.fn(), search: vi.fn() }));
vi.mock("../src/lib/catalog", () => ({ searchProducts: search }));
vi.mock("openai", () => ({ default: class { responses = { create }; } }));
import { extractFile, uploadMaxBytes, validateUploadMime } from "../src/lib/uploads";

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]);
const workbook = (rows: unknown[][]) => {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "Заказ");
  return Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
};
const docx = (lines: string[]) => Packer.toBuffer(new Document({ sections: [{ children: lines.map(text => new Paragraph(text)) }] }));
const output = (rows: unknown[], truncated = false) => ({ status: "completed", output_text: JSON.stringify({ rows, truncated }) });
const ocrRow = { source: "страница 1, строка 1", text: "DEMO-AV16 2 шт", article: "DEMO-AV16", quantity: 2, unit: "шт", uncertain: false };

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "mock-only");
  vi.stubEnv("OPENAI_MODEL", "mock-only");
  search.mockReset().mockResolvedValue([{ id: 1001, article: "DEMO-AV16", supplierArticle: null }]);
  create.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("OCR and specification regressions", () => {
  it("checks MIME while tolerating an absent browser MIME", () => {
    expect(() => validateUploadMime("input.jpg", "application/pdf")).toThrow(/MIME/);
    expect(() => validateUploadMime("input.xlsx", "application/octet-stream")).not.toThrow();
    expect(() => validateUploadMime("input.pdf", "")).not.toThrow();
  });
  it("enforces file size even when the configured limit is invalid", async () => {
    vi.stubEnv("UPLOAD_MAX_MB", "not-a-number");
    expect(uploadMaxBytes()).toBe(10 * 1024 * 1024);
    vi.stubEnv("UPLOAD_MAX_MB", "1");
    await expect(extractFile("input.jpg", Buffer.alloc(1024 * 1024 + 1))).rejects.toThrow(/размер/);
  });
  it.each(["broken.pdf", "broken.docx", "broken.xlsx"])("rejects a corrupt document %s", async filename => {
    const bytes = filename.endsWith("pdf") ? Buffer.from("%PDF-1.7\ninvalid") : Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("invalid")]);
    await expect(extractFile(filename, bytes)).rejects.toThrow(/повреждён|не читается/);
  });
  it("rejects a plain text file disguised with a PK prefix", async () => {
    await expect(extractFile("fake.xlsx", Buffer.from("PK invalid"))).rejects.toThrow(/не соответствует/);
  });
  it("rejects a workbook with more than five sheets", async () => {
    const book = XLSX.utils.book_new();
    for (let i = 0; i < 6; i++) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["DEMO-AV16", 1, "шт"]]), `Лист${i}`);
    await expect(extractFile("input.xlsx", Buffer.from(XLSX.write(book, { type: "buffer", bookType: "xlsx" })))).rejects.toThrow(/5 листов/);
  });
  it.each(["DEMO-AV16 20 А", "DEMO-AV16 2 шт DEMO-AV25 3 шт", "DEMO-AV16 20A"])("does not invent quantity from %s", async text => {
    const [row] = await extractFile("input.docx", await docx([text]));
    expect(row.quantity).toBeNull();
  });
  it("keeps an article when the quantity is missing, without high confidence", async () => {
    const [row] = await extractFile("input.docx", await docx(["DEMO-AV16"]));
    expect(row.article).toBe("DEMO-AV16");
    expect(row.quantity).toBeNull();
    expect(row.confidence).toBe("low");
  });
  it.each([-2, 0, 1.5])("preserves invalid quantity %s for review rather than reinterpreting it", async quantity => {
    const [row] = await extractFile("input.docx", await docx([`DEMO-AV16 ${quantity} шт`]));
    expect(row.quantity).toBe(quantity);
    expect(row.status).toMatch(/целое положительное/);
  });
  it("maps reordered spreadsheet headers and decimal commas", async () => {
    const rows = await extractFile("input.xlsx", workbook([["Наименование", "Кол-во", "Ед. изм.", "Артикул"], ["Автомат 20 А", "1,5", "м", "DEMO-AV16"]]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ article: "DEMO-AV16", quantity: 1.5, unit: "м", confidence: "low" });
    expect(rows[0].source).toContain("2");
  });
  it("keeps ambiguous spreadsheet columns visible without guessing", async () => {
    const rows = await extractFile("input.xlsx", workbook([["Артикул", "Количество", "Количество", "Единица"], ["DEMO-AV16", 2, 20, "шт"]]));
    expect(rows.at(-1)?.quantity).toBeNull();
    expect(rows.at(-1)?.status).toMatch(/Неоднозначные/);
  });
  it("rejects row truncation instead of silently dropping rows", async () => {
    await expect(extractFile("input.xlsx", workbook(Array.from({ length: 101 }, () => ["DEMO-AV16", 1, "шт"])))).rejects.toThrow(/100 строк/);
  });
  it("does not promote a matched article to verified quantity or unit", async () => {
    const [row] = await extractFile("input.xlsx", workbook([["DEMO-AV16", 2, "упак"]]));
    expect(row.productId).toBe(1001);
    expect(row.confidence).toBe("low");
    expect(row.status).toMatch(/единиц/);
  });
  it("extracts structured OCR with no inferred missing quantity", async () => {
    create.mockResolvedValue(output([{ ...ocrRow, quantity: null, unit: null }]));
    const [row] = await extractFile("input.jpg", jpeg);
    expect(row).toMatchObject({ article: "DEMO-AV16", quantity: null, confidence: "low" });
  });
  it("keeps illegible markings visible and unmatched", async () => {
    create.mockResolvedValue(output([{ ...ocrRow, text: "DEMO-AV?? 2 шт", uncertain: true }]));
    const [row] = await extractFile("input.jpg", jpeg);
    expect(row.productId).toBeNull();
    expect(row.article).toBeNull();
    expect(row.status).toMatch(/неразборчив/);
    expect(search).not.toHaveBeenCalled();
  });
  it("actually invokes OCR for an image-only PDF (ignores parser page markers)", async () => {
    create.mockResolvedValue(output([ocrRow]));
    const pdf = await PDFDocument.create();
    pdf.addPage([200, 200]);
    const rows = await extractFile("scan.pdf", Buffer.from(await pdf.save()));
    expect(create).toHaveBeenCalledOnce();
    expect(rows[0].quantity).toBe(2);
  });
  it.each([
    { status: "incomplete", output_text: "" },
    { status: "completed", output_text: "not json" },
    output([], true),
    output([]),
  ])("rejects incomplete, malformed or empty OCR results", async response => {
    create.mockResolvedValue(response);
    await expect(extractFile("input.jpg", jpeg)).rejects.toThrow(/распозна|OCR|читаем|обрезан/);
  });
});
