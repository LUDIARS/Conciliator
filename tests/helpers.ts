import { zipSync, strToU8 } from "fflate";

/** 最小構成の xlsx Buffer を組み立てる (Conciliator のパーサが読む範囲だけ)。 */
export function buildXlsx(cells: Record<string, string | number>): Buffer {
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
