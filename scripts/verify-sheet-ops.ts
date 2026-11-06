// Sheet-ops verification: formula extensions (Slice C), grid-shape and
// range operations (Slice A), and the style/format presentation layer
// (Slice B), plus the bulk/axis morphs those operations register.
// Style follows verify-selection.ts: bare asserts, one summary line.
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import "../src/framework/index";
import {
  applyMorph,
  evaluateFormula,
  evaluateFormulaValue,
  formatCellValue,
  formulaDependencies,
  getMorph,
  invertMorph,
  loadPlan,
  rewriteFormulaRefs,
  translateFormula,
  type Occupant,
  type PlanState,
  type RawValue,
} from "../src/framework";
import {
  applyRangeStyle,
  clearRange,
  copyRangeToCSV,
  copyRangeToTSV,
  deleteCols,
  deleteRows,
  fillRange,
  insertRows,
  parseDelimited,
  pasteTSV,
  setRangeFormat,
  sortRange,
  type SheetGridState,
} from "../src/framework/morphs/sheet-ops";
import type { GridPresentationConfig } from "../src/framework/presentations";

let checks = 0;
const eq = (a: unknown, b: unknown, msg?: string) => { checks++; assert.equal(a, b, msg); };
const deq = (a: unknown, b: unknown, msg?: string) => { checks++; assert.deepEqual(a, b, msg); };
const ok = (v: unknown, msg?: string) => { checks++; assert.ok(v, msg); };

const cell = (q: number, r: number, data: Record<string, unknown>): Occupant => ({
  id: `c-${q}-${r}`, anchor: { q, r }, span: [], type: "cell", data, tags: [],
});
const at = (list: Occupant[], q: number, r: number) => list.find(o => o.anchor.q === q && o.anchor.r === r);

// Numeric lookup from a { "q,r": n } map; raw lookup from a value map.
const numLookup = (m: Record<string, number>) => (c: number, r: number) => m[`${c},${r}`] ?? 0;
const rawLookup = (m: Record<string, RawValue>) => (c: number, r: number) => m[`${c},${r}`] ?? null;
const ev = (f: string, m: Record<string, number> = {}) => evaluateFormula(f, numLookup(m));
const evr = (f: string, m: Record<string, RawValue> = {}) => evaluateFormulaValue(f, rawLookup(m));

// ---------- Slice C: formula extensions ----------
eq(ev("=2^3^2"), 512, "power is right-associative");
eq(ev("=-2^2"), 4, "unary minus binds tighter than ^ (Excel)");
eq(ev("=2*3^2"), 18, "^ binds tighter than *");
eq(ev("=50%"), 0.5, "postfix percent");
eq(ev("=200*10%"), 20, "percent inside a term");
eq(ev('="a"&"b"'), "ab", "string concatenation");
eq(evr('=A1&" units"', { "0,0": 10 }), "10 units", "concat with a text cell ref");
eq(evr('="say ""hi"""'), 'say "hi"', "escaped quotes in string literals");
eq(ev("=3>2"), 1, "comparison > yields 1");
eq(ev("=3<2"), 0, "comparison < yields 0");
eq(ev("=2+2=4"), 1, "comparison = after arithmetic");
eq(ev("=2<>2"), 0, "comparison <>");
eq(ev("=2<=2"), 1, "comparison <=");
eq(evr('=A1=0', { "0,0": 0 }), 1, "comparison against a raw cell");
eq(evr("=IF(A1=0, 0, 1/A1)", { "0,0": 0 }), 0, "lazy IF: untaken 1/0 branch does not error");
eq(evr("=IF(A1=0, 1/A1, 7)", { "0,0": 5 }), 7, "lazy IF: untaken branch on the true side");
eq(evr("=IF(A1>1, \"big\", \"small\")", { "0,0": 5 }), "big", "IF with string results");
eq(evr("=COUNT(A1:A4)", { "0,0": 1, "0,1": "x", "0,2": 2 }), 2, "COUNT counts numeric cells only");
eq(evr("=COUNTA(A1:A4)", { "0,0": 1, "0,1": "x", "0,2": 2 }), 3, "COUNTA counts non-empty cells");
eq(ev("=ROUND(2.5)"), 3, "ROUND half away from zero");
eq(ev("=ROUND(-2.5)"), -3, "ROUND negative half away from zero");
eq(ev("=ROUND(1.234, 2)"), 1.23, "ROUND with digits");
eq(ev("=ABS(-3)+SQRT(9)+POWER(2, 10)"), 1030, "ABS, SQRT, POWER");
eq(ev("=$A$1+A$1+$A1", { "0,0": 7 }), 21, "$ absolute refs parse and evaluate");
eq(ev("=SUM($A$1:$A2)", { "0,0": 1, "0,1": 2 }), 3, "$ refs inside ranges");
assert.throws(() => ev("=NOPE(1)"), /unknown function "NOPE" \(available: .*IF/);
checks++;
deq(formulaDependencies('="A1"&B2'), ["1,1"], "dependencies ignore refs inside strings");
deq(formulaDependencies("=LOG10(A1)+A2"), ["0,0", "0,1"], "dependencies do not mistake LOG10 for a ref");

// translateFormula
eq(translateFormula("=SUM($B2:C$3)", 1, 1), "=SUM($B3:D$3)", "fill translation respects $ anchors");
eq(translateFormula("=A1+B2", -1, 0), "=A1+A2", "refs that would go negative stay put");
eq(translateFormula("=LOG10(A1)", 1, 0), "=LOG10(B1)", "LOG10 is a function, not a ref");
eq(translateFormula('="A1"&A1', 1, 0), '="A1"&B1', "translation skips string literals");
eq(translateFormula("=A$1+$A2", 2, 3), "=C$1+$A5", "mixed anchors translate per-axis");

// rewriteFormulaRefs
eq(rewriteFormulaRefs("=A1+A2", { kind: "insert", axis: "row", at: 1, count: 1 }), "=A1+A3", "insert shifts refs at/after");
eq(rewriteFormulaRefs("=SUM(A1:A2)", { kind: "insert", axis: "row", at: 1, count: 1 }), "=SUM(A1:A3)", "insert inside a range expands it");
eq(rewriteFormulaRefs("=A2", { kind: "delete", axis: "row", at: 1, count: 1 }), "=#REF!", "ref into a deleted row becomes #REF!");
eq(rewriteFormulaRefs("=A3", { kind: "delete", axis: "row", at: 1, count: 1 }), "=A2", "refs after a deleted row shift back");
eq(rewriteFormulaRefs("=SUM(A1:A3)", { kind: "delete", axis: "row", at: 1, count: 1 }), "=SUM(A1:A2)", "range shrinks over a deleted row");
eq(rewriteFormulaRefs("=SUM(A2:A2)", { kind: "delete", axis: "row", at: 1, count: 1 }), "=SUM(#REF!)", "range fully inside the band becomes #REF!");
eq(rewriteFormulaRefs("=B1+C1", { kind: "delete", axis: "col", at: 1, count: 1 }), "=#REF!+B1", "column delete rewrites per ref");

// ---------- Slice A: sheet-ops ----------
const base: SheetGridState = {
  width: 3, height: 3,
  occupants: [cell(0, 0, { value: 1 }), cell(0, 1, { formula: "=A1*2" }), cell(2, 2, { value: 9 })],
};
const ins = insertRows(1, 1, base);
eq(ins.height, 4, "insertRows grows height");
eq(at(ins.occupants, 0, 2)?.data.formula, "=A1*2", "insertRows keeps a formula pointing at the same cell above the band");
eq(at(ins.occupants, 2, 3)?.data.value, 9, "insertRows shifts occupants below");
const insF = insertRows(0, 1, base);
eq(at(insF.occupants, 0, 2)?.data.formula, "=A2*2", "insertRows above rewrites the formula's ref with its cell");
const del = deleteRows(0, 1, base);
eq(del.height, 2, "deleteRows shrinks height");
eq(at(del.occupants, 0, 0)?.data.formula, "=#REF!*2", "deleteRows turns refs to the deleted row into #REF!");
eq(at(del.occupants, 2, 1)?.data.value, 9, "deleteRows shifts occupants up");
const delC = deleteCols(2, 1, base);
eq(delC.width, 2, "deleteCols shrinks width");
ok(!at(delC.occupants, 2, 2), "deleteCols drops occupants on the deleted column");
eq(clearRange(base.occupants, { q0: 0, r0: 0, q1: 0, r1: 1 }).length, 1, "clearRange removes only the range");

// fill: numeric series + formula translation
const series = fillRange([cell(0, 0, { value: 1 }), cell(0, 1, { value: 3 })], { q0: 0, r0: 0, q1: 0, r1: 1 }, { q0: 0, r0: 0, q1: 0, r1: 3 });
eq(at(series, 0, 2)?.data.value, 5, "fill extends an arithmetic series (step from first two)");
eq(at(series, 0, 3)?.data.value, 7, "series continues");
const filled = fillRange(
  [cell(0, 0, { value: 2 }), cell(0, 1, { value: 3 }), cell(1, 0, { formula: "=A1*10" })],
  { q0: 1, r0: 0, q1: 1, r1: 0 }, { q0: 1, r0: 0, q1: 1, r1: 1 }
);
eq(at(filled, 1, 1)?.data.formula, "=A2*10", "fill translates formulas relatively");

// delimited text round trips
const csvOcc = [cell(0, 0, { value: "a,b" }), cell(1, 0, { value: 'say "hi"' }), cell(0, 1, { value: 42 })];
const csv = copyRangeToCSV(csvOcc, { q0: 0, r0: 0, q1: 1, r1: 1 });
deq(parseDelimited(csv, ","), [["a,b", 'say "hi"'], ["42", ""]], "CSV quoting round-trips commas and quotes");
const tsv = copyRangeToTSV([cell(0, 0, { formula: "=A2+1" }), cell(0, 1, { value: 5 })], { q0: 0, r0: 0, q1: 0, r1: 1 }, { mode: "formulas" });
eq(tsv, "=A2+1\n5", "TSV formulas mode copies source text");
const tsvVals = copyRangeToTSV([cell(0, 0, { formula: "=A2+1" }), cell(0, 1, { value: 5 })], { q0: 0, r0: 0, q1: 0, r1: 1 }, { mode: "values" });
eq(tsvVals, "6\n5", "TSV values mode copies derived results");

const config: GridPresentationConfig = {
  cell: { kind: "editableText", value: "data.value", formula: "data.formula", computed: "data.computed", style: "data.style", format: "data.format" },
  headers: { columns: "letters", rows: "numbers" },
  editing: { parse: "numberOrText", expressions: "formula", clear: "occupant", enter: "down" },
  selection: { mode: "range" },
  freeze: { rows: 1, cols: 0 },
};
const pasted = pasteTSV([], "=A1+1", { q: 2, r: 2 }, { config, width: 5, height: 5, origin: { q: 0, r: 0 } });
eq(at(pasted, 2, 2)?.data.formula, "=C3+1", "paste with an origin translates formulas");
const pastedRaw = pasteTSV([], "=A1+1", { q: 2, r: 2 }, { config, width: 5, height: 5 });
eq(at(pastedRaw, 2, 2)?.data.formula, "=A1+1", "paste without an origin is verbatim");

// sort
const unsorted = [cell(0, 0, { value: "b" }), cell(0, 1, { value: "a" }), cell(1, 0, { value: 1 }), cell(1, 1, { value: 2 })];
const sorted = sortRange(unsorted, { q0: 0, r0: 0, q1: 1, r1: 1 }, "asc");
eq(at(sorted, 0, 0)?.data.value, "a", "sortRange orders rows by the first column");
eq(at(sorted, 1, 0)?.data.value, 2, "sortRange moves whole rows together");

// ---------- Slice B: formatting + style ----------
eq(formatCellValue(1234.5, "currency"), "$1,234.50", "currency format");
eq(formatCellValue(-1234.5, "currency"), "-$1,234.50", "negative currency");
eq(formatCellValue(0.42, "percent"), "42.00%", "percent format");
eq(formatCellValue(44927, "date"), "2023-01-01", "date format from an Excel serial");
eq(formatCellValue(1.5, "fixed2"), "1.50", "fixed2 format");
eq(formatCellValue(1234.6, "int"), "1,235", "int format rounds and groups");
eq(formatCellValue("text", "currency"), "text", "non-numeric values fall back to plain text");
const styled = applyRangeStyle([cell(0, 0, { value: 1 })], { q0: 0, r0: 0, q1: 1, r1: 0 }, { bold: true }, config);
deq((at(styled, 0, 0)?.data as any).style, { bold: true }, "applyRangeStyle merges into existing cells");
deq((at(styled, 1, 0)?.data as any).style, { bold: true }, "applyRangeStyle creates style-only occupants");
const formatted = setRangeFormat([cell(0, 0, { value: 1 })], { q0: 0, r0: 0, q1: 0, r1: 0 }, "currency", config);
eq((at(formatted, 0, 0)?.data as any).format, "currency", "setRangeFormat writes the format binding");

// Style/format bindings + freeze validation through loadPlan.
const plan = JSON.parse(readFileSync("apps/spreadsheet/morph-plans/spreadsheet.json", "utf8"));
ok(loadPlan({ data: plan, errors: [] }, null).ok, "stored plan with style/format bindings and freeze loads");
const badStyle = structuredClone(plan);
badStyle.interpretation.grid.cell.style = "style";
ok(!loadPlan({ data: badStyle, errors: [] }, null).ok, "a non-data.* style binding is rejected");
const dupStyle = structuredClone(plan);
dupStyle.interpretation.grid.cell.style = "data.value";
ok(!loadPlan({ data: dupStyle, errors: [] }, null).ok, "a style binding duplicating value is rejected");
const badFreeze = structuredClone(plan);
badFreeze.interpretation.grid.freeze = { rows: -1 };
ok(!loadPlan({ data: badFreeze, errors: [] }, null).ok, "a negative freeze is rejected");
const badWidths = structuredClone(plan);
badWidths.interpretation.grid.columnWidths = [100, -5];
ok(!loadPlan({ data: badWidths, errors: [] }, null).ok, "non-positive column widths are rejected");

// ---------- Morphs: bulk + axis undo ----------
const s0: PlanState = { occupants: [cell(0, 0, { value: 1 })], width: 3, height: 3 };
const setCellsDef = getMorph("sheet.setCells")!;
const bulkParams = { set: [cell(0, 0, { value: 2 }), cell(1, 0, { value: 3 })], clear: [] as string[] };
const bulkApplied = { name: "sheet.setCells", params: bulkParams, inverse: setCellsDef.capture!(s0, bulkParams) };
const afterBulk = applyMorph(s0, bulkApplied);
ok(afterBulk.ok && afterBulk.state.occupants.length === 2, "sheet.setCells applies as one step");
const bulkUndone = afterBulk.ok ? invertMorph(afterBulk.state, bulkApplied) : null;
deq(bulkUndone?.occupants, s0.occupants, "sheet.setCells inverts to the previous occupants");

const insDef = getMorph("sheet.insertRows")!;
const insParams = { at: 0, count: 2 };
const insApplied = { name: "sheet.insertRows", params: insParams, inverse: insDef.capture!(s0, insParams) };
const afterIns = applyMorph(s0, insApplied);
ok(afterIns.ok && afterIns.state.height === 5, "sheet.insertRows applies dimensions");
const insUndone = afterIns.ok ? invertMorph(afterIns.state, insApplied) : null;
ok(insUndone?.height === 3 && insUndone?.occupants.length === 1, "sheet.insertRows inverts dimensions and occupants");

console.log(`Sheet-ops checks passed (${checks} assertions)`);
