import { afterEach, describe, expect, it, vi } from "vitest";
import { getProduct, normalize } from "../src/lib/ekt";

const certificates = (raw: Record<string, unknown>) => normalize({ id: 1, name: "Товар", ...raw }, "live").certificates;

describe("certificate extraction", () => {
  it.each(["Да", "Нет", "", "   ", "12345", 12345, true, null, "Сертификат по запросу", "certificate", "#certificate", "?file=123", "javascript:alert(1)", "data:application/pdf;base64,AA", "http://ekt.kz/cert.pdf", "https://user:password@ekt.kz/cert.pdf", "https://", "https:\\ekt.kz\\cert.pdf"])("rejects non-links and unsafe values: %s", value => {
    expect(certificates({ properties: { SERTIFIKAT: value } })).toEqual([]);
  });

  it.each(["https://example.org/cert.pdf", "/upload/cert.pdf", "upload/cert.pdf", "./upload/cert.pdf", "../upload/cert.pdf", "cert.pdf", "//ekt.kz/upload/cert.pdf", "/download?id=123", "/certificates/Megaligt/Лампы T8/Сертификат.pdf"])("preserves explicit links: %s", value => {
    expect(certificates({ certificate_url: value })[0]?.url).toBe(new URL(value, "https://ekt.kz").href);
  });

  it("extracts nested file structures and records their precise source", () => {
    expect(certificates({ properties: { SeRtIfIkAt: { VALUE: [{ ID: 123, SRC: "/upload/cert.pdf", ORIGINAL_NAME: "cert.pdf" }] } } })).toEqual([
      { label: "SeRtIfIkAt", url: "https://ekt.kz/upload/cert.pdf", source: "properties.SeRtIfIkAt.VALUE[0].SRC" },
    ]);
  });

  it("recognizes a certificate file by metadata, without taking its preview or name as a URL", () => {
    expect(certificates({ files: [{ NAME: "Сертификат соответствия", SRC: "/files/a.pdf", PREVIEW: "/images/a.jpg" }, { NAME: "Инструкция", SRC: "/files/manual.pdf" }] })).toEqual([
      { label: "Сертификат соответствия", url: "https://ekt.kz/files/a.pdf", source: "files[0].SRC" },
    ]);
  });

  it("deduplicates normalized URLs across properties, top-level fields and HTML", () => {
    expect(certificates({ properties: { CERT: ["/cert.pdf", "https://ekt.kz/cert.pdf"] }, certificate_url: "/cert.pdf", description: '<a href="/cert.pdf">Сертификат</a>' })).toHaveLength(1);
  });

  it("handles HTML markup, attribute case, unquoted href and entity encoding", () => {
    expect(certificates({ description: '<A HREF=/download?id=7&amp;type=cert><span>Сертификат</span> соответствия</A>' })).toEqual([
      { label: "Сертификат соответствия", url: "https://ekt.kz/download?id=7&type=cert", source: "description" },
    ]);
    expect(certificates({ properties: { CERT: '<a href="/cert.pdf">Скачать</a>' } })[0]?.url).toBe("https://ekt.kz/cert.pdf");
  });

  it("does not treat unrelated metadata or HTML attributes as certificate evidence", () => {
    expect(certificates({ description: '<a data-href="/cert.pdf">Сертификат</a><a href="/catalog.pdf">Каталог</a>', properties: { INSERT: "/tool.pdf", CERT: { NAME: "cert.pdf", ID: 123, PREVIEW: "/preview.jpg" } } })).toEqual([]);
  });

  it("handles absent and malformed data", () => {
    expect(certificates({})).toEqual([]);
    expect(certificates({ properties: { CERT: [null, {}, false, 42] } })).toEqual([]);
  });

  it("ignores commented/script anchors and href text inside another attribute", () => {
    expect(certificates({ description: '<!-- <a href="/a.pdf">Сертификат</a> --><script>"<a href=\'/b.pdf\'>Сертификат</a>"</script><a title="href=\'/c.pdf\'">Сертификат</a>' })).toEqual([]);
  });

  it("does not use a product name to classify ordinary product URLs as certificates", () => {
    expect(certificates({ name: "Подарочный сертификат", url: "https://ekt.kz/catalog/gift", image: "/gift.jpg" })).toEqual([]);
  });
});

describe("certificate transport boundary", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("only authenticates the API detail request and never fetches a document", async () => {
    vi.stubEnv("DATA_MODE", "live");
    vi.stubEnv("EKT_API_USERNAME", "test-user");
    vi.stubEnv("EKT_API_PASSWORD", "test-password");
    vi.stubEnv("EKT_API_BASE_URL", "https://ekt.kz/api");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 1, certificate_url: "https://example.org/cert.pdf" })));
    vi.stubGlobal("fetch", fetchMock);
    expect((await getProduct(1)).certificates[0].url).toBe("https://example.org/cert.pdf");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://ekt.kz/api/products/detail?id=1", expect.objectContaining({ redirect: "error" }));
  });
});
