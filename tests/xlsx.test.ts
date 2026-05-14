import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { diffXlsx, parseXlsx } from "../src/merge/xlsx.js";

/** 最小構成の xlsx Buffer を組み立てる (Conciliator のパーサが読む範囲だけ)。 */
function buildXlsx(cells: Record<string, string | number>): Buffer {
  const byRow = new Map<number, string[]>();
  for (const [ref, val] of Object.entries(cells)) {
    const row = Number(/\d+/.exec(ref)?.[0] ?? "1");
    const list = byRow.get(row) ?? [];
    list.push(`<c r="${ref}"><v>${val}</v></c>`);
    byRow.set(row, list);
  }
  const rows = [...byRow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([r, cs]) => `<row r="${r}">${cs.join("")}</row>`)
    .join("");

  const files: Record<string, Uint8Array> = {
    "xl/workbook.xml": strToU8(
      `<?xml version="1.0"?><workbook xmlns:r="http://x"><sheets>` +
        `<sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<?xml version="1.0"?><Relationships>` +
        `<Relationship Id="rId1" Type="ws" Target="worksheets/sheet1.xml"/></Relationships>`,
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      `<?xml version="1.0"?><worksheet><sheetData>${rows}</sheetData></worksheet>`,
    ),
  };
  return Buffer.from(zipSync(files));
}

describe("parseXlsx", () => {
  it("シート名とセル値を取り出す", () => {
    const sheets = parseXlsx(buildXlsx({ A1: 10, B2: "x" }));
    expect(sheets.has("Sheet1")).toBe(true);
    expect(sheets.get("Sheet1")?.get("A1")).toBe("10");
    expect(sheets.get("Sheet1")?.get("B2")).toBe("x");
  });
});

describe("diffXlsx — 3-way セル diff", () => {
  const baseline = buildXlsx({ A1: 10, B1: 20, C1: 30, D1: 5 });
  const versionA = buildXlsx({ A1: 11, B1: 20, C1: 30, D1: 7 }); // A1, D1 を変更
  const versionB = buildXlsx({ A1: 10, B1: 20, C1: 99, D1: 8 }); // C1, D1 を変更

  const result = diffXlsx(baseline, versionA, versionB);
  const cells = new Map(
    result.sheets.flatMap((s) => s.cells.map((c) => [c.ref, c] as const)),
  );

  it("変更の無いセルは diff に含めない", () => {
    expect(cells.has("B1")).toBe(false);
  });

  it("A だけが変更したセルを検出する", () => {
    const a1 = cells.get("A1")!;
    expect(a1.changedByA).toBe(true);
    expect(a1.changedByB).toBe(false);
    expect(a1.conflict).toBe(false);
  });

  it("B だけが変更したセルを検出する", () => {
    const c1 = cells.get("C1")!;
    expect(c1.changedByA).toBe(false);
    expect(c1.changedByB).toBe(true);
    expect(c1.conflict).toBe(false);
  });

  it("両者が別の値に変更したセルを競合として検出する", () => {
    const d1 = cells.get("D1")!;
    expect(d1.changedByA).toBe(true);
    expect(d1.changedByB).toBe(true);
    expect(d1.conflict).toBe(true);
    expect(d1.baseline).toBe("5");
    expect(d1.a).toBe("7");
    expect(d1.b).toBe("8");
  });

  it("サマリの集計が正しい", () => {
    expect(result.summary.changedCells).toBe(3);
    expect(result.summary.conflictCells).toBe(1);
    expect(result.summary.sheets).toBe(1);
  });
});
