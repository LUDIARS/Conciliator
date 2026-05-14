import { zipSync } from "fflate";
import { parseSheetIndex, unzipXlsx } from "./xlsx.js";

/** 1 セル分のマージ解決指定。 */
export interface CellResolution {
  sheet: string;
  ref: string;
  /** 採用する値 ("a" / "b" / baseline / 手入力のいずれかを呼び出し側が決める)。 */
  value: string;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** 値が純粋な数値なら `<v>` セル、そうでなければ inlineStr セルとして組み立てる。 */
function cellXml(ref: string, value: string): string {
  if (/^-?\d+(\.\d+)?$/.test(value.trim())) {
    return `<c r="${ref}"><v>${value.trim()}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

/** worksheet XML 内の 1 セルを surgical に置換 (無ければ行へ挿入、行も無ければ追加)。 */
function replaceCell(xml: string, ref: string, value: string): string {
  const newCell = cellXml(ref, value);
  // 既存セル (通常 / 自己終端) を置換
  const cellRe = new RegExp(`<c r="${ref}"(?:\\s[^>]*)?(?:/>|>[\\s\\S]*?</c>)`);
  if (cellRe.test(xml)) return xml.replace(cellRe, newCell);

  // セルが無い → 同じ行に挿入
  const rowNum = /\d+/.exec(ref)?.[0] ?? "1";
  const rowRe = new RegExp(`(<row r="${rowNum}"(?:\\s[^>]*)?>)([\\s\\S]*?)(</row>)`);
  if (rowRe.test(xml)) return xml.replace(rowRe, (_m, open, body, close) => `${open}${body}${newCell}${close}`);

  // 行も無い → sheetData 末尾に行を追加
  return xml.replace(
    /<\/sheetData>/,
    `<row r="${rowNum}">${newCell}</row></sheetData>`,
  );
}

/**
 * 現在のファイル (B = ディスク上の最新) をベースに、選択したセル解決を書き戻した
 * 新しい xlsx Buffer を生成する。
 *
 * v1.0 注意: 書き戻しはセル値のみ。スタイル / 数式 / 結合セル等は B の状態を引き継ぐ
 * (surgical 置換のため、編集していないセルは完全に保持される)。出力は呼び出し側が
 * サイドカーファイル (`*.conciliator-merged.xlsx`) として保存し、原本は上書きしない。
 */
export function applyXlsxMerge(currentFile: Buffer, resolutions: CellResolution[]): Buffer {
  const entries = unzipXlsx(currentFile);
  const index = parseSheetIndex(entries);
  const targetOf = new Map(index.map((s) => [s.name, s.target]));

  // sheet ごとに resolutions をまとめて適用
  const bySheet = new Map<string, CellResolution[]>();
  for (const r of resolutions) {
    const list = bySheet.get(r.sheet) ?? [];
    list.push(r);
    bySheet.set(r.sheet, list);
  }

  for (const [sheet, rs] of bySheet) {
    const target = targetOf.get(sheet);
    if (!target || !entries[target]) {
      throw new Error(`シートが見つかりません: ${sheet}`);
    }
    let xml = Buffer.from(entries[target]).toString("utf8");
    for (const r of rs) xml = replaceCell(xml, r.ref, r.value);
    entries[target] = new TextEncoder().encode(xml);
  }

  return Buffer.from(zipSync(entries));
}
