import { describe, expect, it } from "vitest";
import { normalize } from "../src/lib/ekt";
import { availability } from "../src/lib/inventory";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("catalog normalization", () => {
  it("preserves unknown stock and detects conflicting current", () => {
    const product = normalize({ id: 515291, name: "Выключатель 160 А", article: "200300285_", price: 64920, quantity: null, stores: [], properties: { NOMINALNYY_TOK: "250 А" } }, "live");
    expect(product.quantity).toBeNull();
    expect(product.conflicts).toHaveLength(1);
    expect(availability(product).quantity).toBeNull();
  });

  it("excludes defective warehouses from availability", () => {
    const product = normalize({ id: 1, name: "Светильник", quantity: 8, stores: [{ id: 1, name: "Брак MEGALIGHT", quantity: 7 }, { id: 2, name: "Алматы", quantity: 1 }], properties: {} }, "live");
    expect(availability(product).quantity).toBe(1);
    expect(availability(product, "Астана").quantity).toBeNull();
  });

  it("shows certificate only for a real URL tied to the detail", () => {
    const product = normalize({ id: 1, name: "Demo", properties: { SERTIFIKAT: "https://example.org/certificate.pdf" } }, "demo");
    expect(product.certificates).toHaveLength(1);
    expect(product.certificates[0].source).toBe("properties.SERTIFIKAT");
  });

  it("does not expose demo index entries after switching to live mode", async () => {
    process.env.DATABASE_PATH = join(tmpdir(), `ekt-mode-${randomUUID()}.sqlite`);
    process.env.DATA_MODE = "demo";
    const catalog = await import("../src/lib/catalog");
    await catalog.bootstrapCatalog();
    expect(catalog.catalogStatus().count).toBe(4);
    process.env.DATA_MODE = "live";
    expect(catalog.catalogStatus().count).toBe(0);
    process.env.DATA_MODE = "demo";
  });
});
