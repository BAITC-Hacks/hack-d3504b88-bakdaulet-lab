import { describe, expect, it } from "vitest";
import { normalize } from "../src/lib/ekt";
import { compareAnalogs } from "../src/lib/analogs";

const source = normalize({
  id: 18157, name: "11224 ВА 63 (3ф) 20А 404057 Legrand", properties: {
    NOMINALNYY_TOK: "20А", KOLICHESTVO_POLYUSOV: "3", NOMINALNOE_NAPRYAZHENIE: "400В",
    NOMINALNAYA_OTKLYUCHAYUSHCHAYA_SPOSOBNOST: "4,5кА", KHARAKTERISTIKA_SRABATYVANIYA: "C",
    TIP_USTROYSTVA: "Автоматический выключатель с тепловым расцепителем",
  },
}, "live");

const candidate = normalize({
  id: 515262, name: "419709 RX3 ВА 3ф С 20А 4,5ka Legrand", properties: {
    NOMINALNYY_TOK: "20А", KOLICHESTVO_POLYUSOV: "3", NOMINALNOE_NAPRYAZHENIE: "400В",
    NOMINALNAYA_OTKLYUCHAYUSHCHAYA_SPOSOBNOST: "4,5кА",
  },
}, "live");

describe("live breaker comparison", () => {
  it("recognizes ВА and the C curve from a product title", () => {
    const result = compareAnalogs(source, candidate);
    expect(result?.matches).toContain("Характеристика срабатывания: C");
    expect(result?.caveats).toHaveLength(1);
  });

  it("rejects a different breaking capacity or a source conflict", () => {
    const stronger = { ...candidate, properties: { ...candidate.properties, NOMINALNAYA_OTKLYUCHAYUSHCHAYA_SPOSOBNOST: "6кА" } };
    expect(compareAnalogs(source, stronger)).toBeNull();
    expect(compareAnalogs({ ...source, conflicts: ["20 А / 25 А"] }, candidate)).toBeNull();
  });
});
