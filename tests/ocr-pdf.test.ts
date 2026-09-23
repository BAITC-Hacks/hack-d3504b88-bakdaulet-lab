import { expect, it, vi } from "vitest";

const { destroy } = vi.hoisted(() => ({ destroy: vi.fn() }));
vi.mock("pdf-parse", () => ({ PDFParse: class {
  getText() { throw new Error("PasswordException: No password given"); }
  destroy = destroy;
} }));
import { extractFile } from "../src/lib/uploads";

it("explains a password-protected PDF and releases the parser (mock parser)", async () => {
  await expect(extractFile("locked.pdf", Buffer.from("%PDF-1.7"))).rejects.toThrow(/защищён паролем/);
  expect(destroy).toHaveBeenCalledOnce();
});
