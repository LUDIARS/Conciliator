import { unzipSync } from "fflate";
import { XMLParser } from "fast-xml-parser";

/**
 * xlsx クレバーマージ。
 * xlsx は XML の ZIP なので、ZIP を展開してシート / セル単位で値を取り出し、
 * baseline / A版 / B版 の 3-way 比較を行う。
 */

/** sheetName → (cellRef → value) */
export type SheetCells = Map<string, Map<string, string>>;

export interface CellDiff {
  ref: string;
  baseline: string | null;
  a: string | null;
  b: string | null;
  changedByA: boolean;
  changedByB: boolean;
  /** A と B が baseline からそれぞれ別の値に変更した = 競合 */
  conflict: boolean;
}

export interface SheetDiff {
  name: string;
  cells: CellDiff[];
  conflictCount: number;
}

export interface XlsxDiff {
  sheets: SheetDiff[];
  summary: { changedCells: number; conflictCells: number; sheets: number };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: false,
});

function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function decode(entries: Record<string, Uint8Array>, name: string): string | null {
  const e = entries[name];
  return e ? Buffer.from(e).toString("utf8") : null;
}

/** sharedStrings.xml → 文字列配列 */
function parseSharedStrings(entries: Record<string, Uint8Array>): string[] {
  const xml = decode(entries, "xl/sharedStrings.xml");
  if (!xml) return [];
  const doc = parser.parse(xml) as any;
  const items = asArray(doc?.sst?.si);
  return items.map((si: any) => {
    if (si == null) return "";
    if (typeof si === "string") return si;
    if (si.t !== undefined) return textOf(si.t);
    // rich text: <si><r><t>..</t></r>...</si>
    if (si.r !== undefined) {
      return asArray(si.r)
        .map((r: any) => textOf(r?.t))
        .join("");
    }
    return "";
  });
}

function textOf(t: any): string {
  if (t == null) return "";
  if (typeof t === "string") return t;
  // <t xml:space="preserve">..</t> → { "#text": ".." , "@_xml:space": ".." }
  if (typeof t === "object" && "#text" in t) return String(t["#text"]);
  return String(t);
}

/** xlsx Buffer を ZIP 展開してエントリ表を返す。 */
export function unzipXlsx(buf: Buffer): Record<string, Uint8Array> {
  return unzipSync(new Uint8Array(buf));
}

/** workbook.xml + rels → [{ name, target }] (シート名と worksheet XML パスの対応) */
export function parseSheetIndex(
  entries: Record<string, Uint8Array>,
): { name: string; target: string }[] {
  const wbXml = decode(entries, "xl/workbook.xml");
  const relsXml = decode(entries, "xl/_rels/workbook.xml.rels");
  if (!wbXml) return [];

  const rels = new Map<string, string>();
  if (relsXml) {
    const relsDoc = parser.parse(relsXml) as any;
    for (const r of asArray(relsDoc?.Relationships?.Relationship)) {
      const id = r?.["@_Id"];
      const target = r?.["@_Target"];
      if (id && target) rels.set(String(id), String(target));
    }
  }

  const wbDoc = parser.parse(wbXml) as any;
  const sheets = asArray(wbDoc?.workbook?.sheets?.sheet);
  return sheets.map((s: any, i: number) => {
    const name = s?.["@_name"] ? String(s["@_name"]) : `Sheet${i + 1}`;
    const rId = s?.["@_r:id"];
    let target = rId ? rels.get(String(rId)) : undefined;
    if (!target) target = `worksheets/sheet${i + 1}.xml`;
    // Target は xl/ からの相対 (例 "worksheets/sheet1.xml")
    const normalized = target.startsWith("/")
      ? target.slice(1)
      : `xl/${target.replace(/^\.\//, "")}`;
    return { name, target: normalized };
  });
}

/** worksheet XML → (cellRef → value) */
function parseSheet(
  entries: Record<string, Uint8Array>,
  target: string,
  shared: string[],
): Map<string, string> {
  const cells = new Map<string, string>();
  const xml = decode(entries, target);
  if (!xml) return cells;
  const doc = parser.parse(xml) as any;
  const rows = asArray(doc?.worksheet?.sheetData?.row);
  for (const row of rows) {
    for (const c of asArray(row?.c)) {
      const ref = c?.["@_r"];
      if (!ref) continue;
      cells.set(String(ref), cellValue(c, shared));
    }
  }
  return cells;
}

function cellValue(c: any, shared: string[]): string {
  const t = c?.["@_t"];
  if (t === "s") {
    const idx = Number(textOf(c?.v));
    return Number.isFinite(idx) ? (shared[idx] ?? "") : "";
  }
  if (t === "inlineStr") {
    return textOf(c?.is?.t);
  }
  if (t === "b") {
    return textOf(c?.v) === "1" ? "TRUE" : "FALSE";
  }
  if (c?.v !== undefined) return textOf(c.v);
  if (c?.f !== undefined) return `=${textOf(c.f)}`;
  return "";
}

/** xlsx Buffer を sheetName → (cellRef → value) に展開する。 */
export function parseXlsx(buf: Buffer): SheetCells {
  const entries = unzipSync(new Uint8Array(buf));
  const shared = parseSharedStrings(entries);
  const index = parseSheetIndex(entries);
  const result: SheetCells = new Map();
  for (const { name, target } of index) {
    result.set(name, parseSheet(entries, target, shared));
  }
  return result;
}

/** baseline / A / B の 3-way セル diff。 */
export function diffXlsx(baseline: Buffer, a: Buffer, b: Buffer): XlsxDiff {
  const base = parseXlsx(baseline);
  const va = parseXlsx(a);
  const vb = parseXlsx(b);

  const sheetNames = new Set<string>([...base.keys(), ...va.keys(), ...vb.keys()]);
  const sheets: SheetDiff[] = [];
  let changedCells = 0;
  let conflictCells = 0;

  for (const name of sheetNames) {
    const bs = base.get(name) ?? new Map();
    const as = va.get(name) ?? new Map();
    const bbs = vb.get(name) ?? new Map();
    const refs = new Set<string>([...bs.keys(), ...as.keys(), ...bbs.keys()]);

    const diffs: CellDiff[] = [];
    let sheetConflicts = 0;
    for (const ref of refs) {
      const baseVal = bs.has(ref) ? (bs.get(ref) ?? "") : null;
      const aVal = as.has(ref) ? (as.get(ref) ?? "") : null;
      const bVal = bbs.has(ref) ? (bbs.get(ref) ?? "") : null;
      const changedByA = aVal !== baseVal;
      const changedByB = bVal !== baseVal;
      if (!changedByA && !changedByB) continue;
      const conflict = changedByA && changedByB && aVal !== bVal;
      if (conflict) {
        sheetConflicts++;
        conflictCells++;
      }
      changedCells++;
      diffs.push({ ref, baseline: baseVal, a: aVal, b: bVal, changedByA, changedByB, conflict });
    }

    if (diffs.length > 0) {
      diffs.sort((x, y) => cellSortKey(x.ref) - cellSortKey(y.ref));
      sheets.push({ name, cells: diffs, conflictCount: sheetConflicts });
    }
  }

  return {
    sheets,
    summary: { changedCells, conflictCells, sheets: sheets.length },
  };
}

/** "B12" のようなセル参照を行優先のソートキーに変換する。 */
function cellSortKey(ref: string): number {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return 0;
  let col = 0;
  for (const ch of m[1]!) col = col * 26 + (ch.charCodeAt(0) - 64);
  return Number(m[2]) * 1000 + col;
}
