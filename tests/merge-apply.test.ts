import { describe, it, expect } from "vitest";
import { buildXlsx } from "./helpers.js";
import { applyXlsxMerge } from "../src/merge/apply.js";
import { parseXlsx } from "../src/merge/xlsx.js";

describe("applyXlsxMerge — xlsx マージ適用", () => {
  it("既存セルの値を書き換え、触っていないセルは保持する", () => {
    const base = buildXlsx({ A1: 10, B1: 20, C1: 30 });
    const merged = applyXlsxMerge(base, [{ sheet: "Sheet1", ref: "A1", value: "99" }]);
    const cells = parseXlsx(merged).get("Sheet1")!;
    expect(cells.get("A1")).toBe("99");
    expect(cells.get("B1")).toBe("20");
    expect(cells.get("C1")).toBe("30");
  });

  it("存在しないセルを挿入する (文字列値)", () => {
    const base = buildXlsx({ A1: 1 });
    const merged = applyXlsxMerge(base, [{ sheet: "Sheet1", ref: "C5", value: "merged value" }]);
    const cells = parseXlsx(merged).get("Sheet1")!;
    expect(cells.get("C5")).toBe("merged value");
    expect(cells.get("A1")).toBe("1");
  });

  it("複数セルを一括適用する", () => {
    const base = buildXlsx({ A1: 1, A2: 2 });
    const merged = applyXlsxMerge(base, [
      { sheet: "Sheet1", ref: "A1", value: "10" },
      { sheet: "Sheet1", ref: "A2", value: "20" },
    ]);
    const cells = parseXlsx(merged).get("Sheet1")!;
    expect(cells.get("A1")).toBe("10");
    expect(cells.get("A2")).toBe("20");
  });

  it("未知のシート名はエラーになる", () => {
    const base = buildXlsx({ A1: 1 });
    expect(() =>
      applyXlsxMerge(base, [{ sheet: "NoSuchSheet", ref: "A1", value: "x" }]),
    ).toThrow();
  });
});
