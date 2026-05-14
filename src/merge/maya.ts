import { readFileSync } from "node:fs";
import type { XlsxDiff } from "./xlsx.js";

/**
 * Maya ASCII シーン (`.ma`) の構造化 diff。
 *
 * `.ma` は MEL コマンドのテキスト。`createNode <type> -n "name"` がカレントノードを
 * 確立し、後続の `setAttr ".attr" <value>` がそのノードに適用される。
 * これを node → (attr → value) に展開し、xlsx と同じ 3-way diff にかける。
 *
 * 戻り値は xlsx と同じ XlsxDiff 形 — node を「シート」、attr を「セル」に対応させ、
 * Web UI を変更せずに同じ diff ビューアで表示できるようにしている。
 *
 * v0.1 best-effort: createNode / setAttr のみ解釈する (connectAttr 等は対象外)。
 * `.mb` (バイナリ) は専有フォーマットで構造 diff 不能 — 恒久的に非対応。
 */

export type MayaNodes = Map<string, Map<string, string>>;

/** .ma テキストを node → (attr → value) に展開する。 */
export function parseMaya(text: string): MayaNodes {
  const nodes: MayaNodes = new Map();
  // MEL 文は ';' 終端。文字列内の ';' は稀なので best-effort で分割する。
  const statements = text.split(";");
  let current: string | null = null;

  for (const raw of statements) {
    const stmt = raw.replace(/\/\/.*$/gm, "").trim();
    if (stmt.length === 0) continue;

    if (stmt.startsWith("createNode")) {
      const nameMatch = /-n\s+"([^"]+)"/.exec(stmt);
      const typeMatch = /^createNode\s+(\S+)/.exec(stmt);
      const name = nameMatch?.[1] ?? `unnamed_${nodes.size}`;
      current = name;
      if (!nodes.has(name)) nodes.set(name, new Map());
      if (typeMatch?.[1]) nodes.get(name)!.set("(nodeType)", typeMatch[1]);
      continue;
    }

    if (stmt.startsWith("setAttr") && current) {
      // setAttr 文の最初のクォート文字列がアトリビュート名 (".t" / ".attrName" など)。
      // 残りを値とみなす (-type フラグ等を含む生文字列、best-effort)。
      const q1 = stmt.indexOf('"');
      const q2 = q1 >= 0 ? stmt.indexOf('"', q1 + 1) : -1;
      if (q1 >= 0 && q2 > q1) {
        const attr = stmt.slice(q1 + 1, q2);
        const value = stmt.slice(q2 + 1).replace(/\s+/g, " ").trim();
        nodes.get(current)!.set(attr, value);
      }
    }
  }
  return nodes;
}

function diff3(base: string | null, a: string | null, b: string | null) {
  const changedByA = a !== base;
  const changedByB = b !== base;
  return { changedByA, changedByB, conflict: changedByA && changedByB && a !== b };
}

/** baseline / A / B の 3-way diff (xlsx と同じ XlsxDiff 形で返す)。 */
export function diffMaya(baseline: Buffer, a: Buffer, b: Buffer): XlsxDiff {
  const base = parseMaya(baseline.toString("utf8"));
  const va = parseMaya(a.toString("utf8"));
  const vb = parseMaya(b.toString("utf8"));

  const nodeNames = new Set<string>([...base.keys(), ...va.keys(), ...vb.keys()]);
  const sheets: XlsxDiff["sheets"] = [];
  let changedCells = 0;
  let conflictCells = 0;

  for (const node of nodeNames) {
    const bn = base.get(node) ?? new Map();
    const an = va.get(node) ?? new Map();
    const bbn = vb.get(node) ?? new Map();
    const attrs = new Set<string>([...bn.keys(), ...an.keys(), ...bbn.keys()]);

    const cells = [];
    let nodeConflicts = 0;
    for (const attr of attrs) {
      const baseVal = bn.has(attr) ? (bn.get(attr) ?? "") : null;
      const aVal = an.has(attr) ? (an.get(attr) ?? "") : null;
      const bVal = bbn.has(attr) ? (bbn.get(attr) ?? "") : null;
      const d = diff3(baseVal, aVal, bVal);
      if (!d.changedByA && !d.changedByB) continue;
      if (d.conflict) {
        nodeConflicts++;
        conflictCells++;
      }
      changedCells++;
      cells.push({ ref: attr, baseline: baseVal, a: aVal, b: bVal, ...d });
    }
    if (cells.length > 0) {
      cells.sort((x, y) => x.ref.localeCompare(y.ref));
      sheets.push({ name: node, cells, conflictCount: nodeConflicts });
    }
  }

  return { sheets, summary: { changedCells, conflictCells, sheets: sheets.length } };
}

export function diffMayaFiles(baselinePath: string, aPath: string, bPath: string): XlsxDiff {
  return diffMaya(readFileSync(baselinePath), readFileSync(aPath), readFileSync(bPath));
}
