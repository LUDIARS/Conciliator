import { describe, it, expect } from "vitest";
import { parseMaya, diffMaya } from "../src/merge/maya.js";

const baseline = `
createNode transform -n "pCube1";
	setAttr ".t" -type "double3" 0 0 0 ;
	setAttr ".v" on;
createNode mesh -n "pCubeShape1" -p "pCube1";
	setAttr ".io" no;
`;

// A: pCube1 の位置 (.t) を変更
const versionA = `
createNode transform -n "pCube1";
	setAttr ".t" -type "double3" 5 0 0 ;
	setAttr ".v" on;
createNode mesh -n "pCubeShape1" -p "pCube1";
	setAttr ".io" no;
`;

// B: pCube1 の位置 (.t) を別の値に変更 + 可視性 (.v) を変更
const versionB = `
createNode transform -n "pCube1";
	setAttr ".t" -type "double3" 0 9 0 ;
	setAttr ".v" off;
createNode mesh -n "pCubeShape1" -p "pCube1";
	setAttr ".io" no;
`;

describe("parseMaya", () => {
  it("createNode / setAttr を node→attr に展開する", () => {
    const nodes = parseMaya(baseline);
    expect(nodes.has("pCube1")).toBe(true);
    expect(nodes.get("pCube1")?.get("(nodeType)")).toBe("transform");
    expect(nodes.get("pCube1")?.get(".v")).toBe("on");
    expect(nodes.get("pCubeShape1")?.get(".io")).toBe("no");
  });
});

describe("diffMaya — 3-way ノード/アトリビュート diff", () => {
  const result = diffMaya(
    Buffer.from(baseline),
    Buffer.from(versionA),
    Buffer.from(versionB),
  );
  const node = result.sheets.find((s) => s.name === "pCube1")!;
  const cells = new Map(node.cells.map((c) => [c.ref, c] as const));

  it("変更の無いノードは含めない", () => {
    expect(result.sheets.find((s) => s.name === "pCubeShape1")).toBeUndefined();
  });

  it("A と B が別の値に変更した .t を競合として検出する", () => {
    const t = cells.get(".t")!;
    expect(t.changedByA).toBe(true);
    expect(t.changedByB).toBe(true);
    expect(t.conflict).toBe(true);
  });

  it("B だけが変更した .v は競合でない", () => {
    const v = cells.get(".v")!;
    expect(v.changedByA).toBe(false);
    expect(v.changedByB).toBe(true);
    expect(v.conflict).toBe(false);
  });

  it("サマリの集計が正しい", () => {
    expect(result.summary.changedCells).toBe(2);
    expect(result.summary.conflictCells).toBe(1);
  });
});
