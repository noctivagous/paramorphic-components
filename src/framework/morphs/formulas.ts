// ---------- Formula vocabulary (morph library, not core) ----------
// Spreadsheet-style expressions over grid addresses. A1 means column A (0),
// row 1 (0). Supported: numbers, string literals ("..." with "" escapes),
// cell refs (with $ absolute anchors: $A$1, A$1, $A1), ranges inside
// aggregate functions, + - * / ^ (right-associative power), postfix %,
// & concatenation, comparisons = <> < <= > >= (yielding 1/0), parentheses,
// unary minus, and the functions SUM, AVG, MIN, MAX, COUNT, COUNTA, IF,
// ROUND, ABS, SQRT, POWER. Anything else throws a message the plan author
// or AI can act on. Wiring (which cells feed which) is derived with
// formulaDependencies and evaluated in order with derivation.ts.
//
// Precedence (Excel-like): comparisons lowest, then &, then + -, then
// * /, then ^, then unary minus — note unary minus binds TIGHTER than ^
// here, so -2^2 = (-2)^2 = 4, as in Excel. IF is lazy: the untaken branch
// is never evaluated, so =IF(A1=0, 0, 1/A1) is safe at A1=0.
import type { Occupant } from "../types";
import { bindingField, colName, editingPolicies, type GridPresentationConfig } from "../presentations";

export type NumberLookup = (col: number, row: number) => number;

/** A cell's raw content: number, text, boolean, or null for empty. */
export type RawValue = number | string | boolean | null;
export type RawLookup = (col: number, row: number) => RawValue;
export type FormulaValue = number | string | boolean;

export function colLabelToIndex(label: string): number {
  let n = 0;
  for (const ch of label.toUpperCase()) {
    const v = ch.charCodeAt(0) - 64; // A = 1
    if (v < 1 || v > 26) throw new Error(`[formulas] bad column label "${label}"`);
    n = n * 26 + v;
  }
  return n - 1;
}

export type CellRefParts = { col: number; row: number; colAbs: boolean; rowAbs: boolean };

export function parseCellRefParts(ref: string): CellRefParts | null {
  const m = /^(\$?)([A-Za-z]+)(\$?)([0-9]+)$/.exec(ref.trim());
  if (!m) return null;
  return { col: colLabelToIndex(m[2]), row: parseInt(m[4], 10) - 1, colAbs: m[1] === "$", rowAbs: m[3] === "$" };
}

export function parseCellRef(ref: string): [number, number] | null {
  const parts = parseCellRefParts(ref);
  return parts ? [parts.col, parts.row] : null;
}

export function formatCellRef(col: number, row: number, colAbs = false, rowAbs = false): string {
  return `${colAbs ? "$" : ""}${colName(col)}${rowAbs ? "$" : ""}${row + 1}`;
}

// ---------- Source scanning (shared by dependencies / translation / rewrite) ----------
// Walks a formula string, reporting each cell reference it finds. String
// literals are skipped (their contents are never refs), and identifiers
// followed by "(" are function names — so LOG10( is never mistaken for the
// ref LOG10, and "A1" inside quotes is never rewritten.

type RefHit = CellRefParts & { raw: string; start: number; end: number };

function scanRefs(src: string): RefHit[] {
  const hits: RefHit[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"') {
      i++;
      while (i < src.length) {
        if (src[i] === '"') {
          if (src[i + 1] === '"') { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if ((c >= "0" && c <= "9") || (c === "." && src[i + 1] >= "0" && src[i + 1] <= "9")) {
      const m = /^[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?/.exec(src.slice(i))!;
      i += m[0].length;
      continue;
    }
    if (c === "$" || (c >= "A" && c <= "Z") || (c >= "a" && c <= "z")) {
      const rest = src.slice(i);
      const ref = /^(\$?)([A-Za-z]+)(\$?)([0-9]+)/.exec(rest);
      if (ref) {
        const after = rest[ref[0].length];
        if (after === "(") {
          // Function name that happens to look like a ref (LOG10(, SIN1().
          const name = /^[A-Za-z]+[0-9]*/.exec(rest)!;
          i += name[0].length;
          continue;
        }
        if (after !== undefined && /[A-Za-z]/.test(after)) {
          // Longer identifier (e.g. a name) — not a ref.
          const name = /^[A-Za-z]+/.exec(rest)!;
          i += name[0].length;
          continue;
        }
        hits.push({
          col: colLabelToIndex(ref[2]),
          row: parseInt(ref[4], 10) - 1,
          colAbs: ref[1] === "$",
          rowAbs: ref[3] === "$",
          raw: ref[0],
          start: i,
          end: i + ref[0].length,
        });
        i += ref[0].length;
        continue;
      }
      const name = /^[A-Za-z]+/.exec(rest);
      if (name) { i += name[0].length; continue; }
      i++;
      continue;
    }
    i++;
  }
  return hits;
}

/** Apply a per-ref replacement over a formula, preserving all other text. */
function mapRefs(formula: string, fn: (hit: RefHit, isRangeStart: boolean, isRangeEnd: boolean) => string): string {
  const hasEq = formula.trimStart().startsWith("=");
  const body = hasEq ? formula.slice(formula.indexOf("=") + 1) : formula;
  const hits = scanRefs(body);
  let out = "";
  let last = 0;
  hits.forEach((hit, idx) => {
    const prev = hits[idx - 1];
    const next = hits[idx + 1];
    const isRangeEnd = !!prev && body.slice(prev.end, hit.start).trim() === ":";
    const isRangeStart = !!next && body.slice(hit.end, next.start).trim() === ":";
    out += body.slice(last, hit.start) + fn(hit, isRangeStart, isRangeEnd);
    last = hit.end;
  });
  out += body.slice(last);
  return (hasEq ? "=" : "") + out;
}

/**
 * Shift every relative ref by (dCol, dRow); $-anchored parts stay put.
 * A ref that would move before column A or row 1 is left unchanged
 * (documented choice: fill/paste near the edge keeps the edge ref rather
 * than inventing a #REF!).
 */
export function translateFormula(formula: string, dCol: number, dRow: number): string {
  if (dCol === 0 && dRow === 0) return formula;
  return mapRefs(formula, hit => {
    const col = hit.colAbs ? hit.col : hit.col + dCol;
    const row = hit.rowAbs ? hit.row : hit.row + dRow;
    if (col < 0 || row < 0) return hit.raw;
    return formatCellRef(col, row, hit.colAbs, hit.rowAbs);
  });
}

/**
 * How one axis (rows or columns) of a formula's refs changes when rows or
 * columns are inserted or deleted. See sheet-ops for the full policy.
 */
export type RefRewriteOp =
  | { kind: "insert"; axis: "row" | "col"; at: number; count: number }
  | { kind: "delete"; axis: "row" | "col"; at: number; count: number };

/**
 * Rewrite refs for an insert/delete on one axis.
 * Insert: refs at or after `at` shift by count (a range whose start is
 * before `at` and whose end is at/after `at` therefore expands).
 * Delete: a single ref into the deleted band becomes #REF!; a range fully
 * inside the band becomes #REF!; a partially overlapping range clamps its
 * inside endpoint to the band edge (start -> at, end -> at - 1), matching
 * Excel's shrink behaviour; refs after the band shift back by count.
 */
export function rewriteFormulaRefs(formula: string, op: RefRewriteOp): string {
  const idx = (hit: RefHit) => (op.axis === "row" ? hit.row : hit.col);
  const rebuild = (hit: RefHit, newIdx: number): string =>
    op.axis === "row"
      ? formatCellRef(hit.col, newIdx, hit.colAbs, hit.rowAbs)
      : formatCellRef(newIdx, hit.row, hit.colAbs, hit.rowAbs);
  if (op.kind === "insert") {
    return mapRefs(formula, hit => (idx(hit) >= op.at ? rebuild(hit, idx(hit) + op.count) : hit.raw));
  }
  const bandEnd = op.at + op.count; // exclusive
  // Pair-aware walk: a range fully inside the band collapses to #REF! as a
  // whole, which per-ref mapping cannot express.
  const hasEq = formula.trimStart().startsWith("=");
  const body = hasEq ? formula.slice(formula.indexOf("=") + 1) : formula;
  const hits = scanRefs(body);
  let out = "";
  let last = 0;
  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    const next = hits[i + 1];
    const isRangeStart = !!next && body.slice(hit.end, next.start).trim() === ":";
    out += body.slice(last, hit.start);
    if (isRangeStart && next) {
      const s = idx(hit);
      const e = idx(next);
      const sep = body.slice(hit.end, next.start);
      if (s >= op.at && e < bandEnd) {
        out += "#REF!"; // whole range deleted
      } else {
        const ns = s < op.at ? s : s >= bandEnd ? s - op.count : op.at;
        const ne = e < op.at ? e : e >= bandEnd ? e - op.count : op.at - 1;
        out += rebuild(hit, ns) + sep + rebuild(next, ne);
      }
      last = next.end;
      i++;
      continue;
    }
    const v = idx(hit);
    if (v < op.at) out += hit.raw;
    else if (v >= bandEnd) out += rebuild(hit, v - op.count);
    else out += "#REF!";
    last = hit.end;
  }
  out += body.slice(last);
  return (hasEq ? "=" : "") + out;
}

// ---------- Tokenizer / parser (AST, so IF can be lazy) ----------

type Tok =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "ref"; col: number; row: number }
  | { t: "name"; v: string }
  | { t: "op"; v: string }
  | { t: "lparen" }
  | { t: "rparen" }
  | { t: "comma" }
  | { t: "colon" };

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const err = (): Error => new Error(`[formulas] cannot parse ${JSON.stringify(src)} at offset ${i}`);
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t") { i++; continue; }
    if (c === '"') {
      let j = i + 1;
      let s = "";
      for (;;) {
        if (j >= src.length) throw err();
        if (src[j] === '"') {
          if (src[j + 1] === '"') { s += '"'; j += 2; continue; }
          j++;
          break;
        }
        s += src[j];
        j++;
      }
      toks.push({ t: "str", v: s });
      i = j;
      continue;
    }
    if ((c >= "0" && c <= "9") || (c === "." && src[i + 1] >= "0" && src[i + 1] <= "9")) {
      const m = /^[0-9]*\.?[0-9]+([eE][+-]?[0-9]+)?/.exec(src.slice(i))!;
      toks.push({ t: "num", v: parseFloat(m[0]) });
      i += m[0].length;
      continue;
    }
    if (c === "$" || (c >= "A" && c <= "Z") || (c >= "a" && c <= "z")) {
      const rest = src.slice(i);
      const ref = /^(\$?)([A-Za-z]+)(\$?)([0-9]+)/.exec(rest);
      if (ref && rest[ref[0].length] !== "(") {
        toks.push({ t: "ref", col: colLabelToIndex(ref[2]), row: parseInt(ref[4], 10) - 1 });
        i += ref[0].length;
        continue;
      }
      const name = /^[A-Za-z]+[0-9]*/.exec(rest);
      if (name) {
        toks.push({ t: "name", v: name[0].toUpperCase() });
        i += name[0].length;
        continue;
      }
      throw err();
    }
    if (c === "<") {
      if (src[i + 1] === "=") { toks.push({ t: "op", v: "<=" }); i += 2; continue; }
      if (src[i + 1] === ">") { toks.push({ t: "op", v: "<>" }); i += 2; continue; }
      toks.push({ t: "op", v: "<" }); i++; continue;
    }
    if (c === ">") {
      if (src[i + 1] === "=") { toks.push({ t: "op", v: ">=" }); i += 2; continue; }
      toks.push({ t: "op", v: ">" }); i++; continue;
    }
    if ("+-*/^%&= ".includes(c) && c !== " ") { toks.push({ t: "op", v: c }); i++; continue; }
    if (c === "(") { toks.push({ t: "lparen" }); i++; continue; }
    if (c === ")") { toks.push({ t: "rparen" }); i++; continue; }
    if (c === ",") { toks.push({ t: "comma" }); i++; continue; }
    if (c === ":") { toks.push({ t: "colon" }); i++; continue; }
    throw err();
  }
  return toks;
}

type Node =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "ref"; col: number; row: number }
  | { k: "range"; c0: number; r0: number; c1: number; r1: number }
  | { k: "call"; name: string; args: Node[] }
  | { k: "un"; op: string; x: Node }
  | { k: "pct"; x: Node }
  | { k: "bin"; op: string; l: Node; r: Node };

const FUNCTIONS = ["SUM", "AVG", "MIN", "MAX", "COUNT", "COUNTA", "IF", "ROUND", "ABS", "SQRT", "POWER"];

function parseFormula(expr: string): Node {
  const src = expr.trim().startsWith("=") ? expr.trim().slice(1) : expr.trim();
  const toks = tokenize(src);
  let pos = 0;
  const peek = (): Tok | null => toks[pos] || null;
  const next = (): Tok => {
    const t = toks[pos++];
    if (!t) throw new Error(`[formulas] unexpected end of ${JSON.stringify(expr)}`);
    return t;
  };
  const isOp = (t: Tok | null, ...vs: string[]): t is { t: "op"; v: string } =>
    !!t && t.t === "op" && vs.includes((t as { v: string }).v);

  const parseComparison = (): Node => {
    let l = parseConcat();
    for (;;) {
      const t = peek();
      if (isOp(t, "=", "<>", "<", "<=", ">", ">=")) {
        next();
        l = { k: "bin", op: t.v, l, r: parseConcat() };
      } else return l;
    }
  };
  const parseConcat = (): Node => {
    let l = parseAdd();
    for (;;) {
      const t = peek();
      if (isOp(t, "&")) { next(); l = { k: "bin", op: "&", l, r: parseAdd() }; }
      else return l;
    }
  };
  const parseAdd = (): Node => {
    let l = parseMul();
    for (;;) {
      const t = peek();
      if (isOp(t, "+", "-")) { next(); l = { k: "bin", op: t.v, l, r: parseMul() }; }
      else return l;
    }
  };
  const parseMul = (): Node => {
    let l = parsePow();
    for (;;) {
      const t = peek();
      if (isOp(t, "*", "/")) { next(); l = { k: "bin", op: t.v, l, r: parsePow() }; }
      else return l;
    }
  };
  const parsePow = (): Node => {
    const base = parseUnary();
    const t = peek();
    if (isOp(t, "^")) {
      next();
      return { k: "bin", op: "^", l: base, r: parsePow() }; // right-associative
    }
    return base;
  };
  const parseUnary = (): Node => {
    const t = peek();
    if (isOp(t, "-", "+")) {
      next();
      return { k: "un", op: t.v, x: parseUnary() };
    }
    return parsePostfix();
  };
  const parsePostfix = (): Node => {
    let x = parsePrimary();
    for (;;) {
      const t = peek();
      if (isOp(t, "%")) { next(); x = { k: "pct", x }; }
      else return x;
    }
  };
  const parsePrimary = (): Node => {
    const t = next();
    if (t.t === "num") return { k: "num", v: t.v };
    if (t.t === "str") return { k: "str", v: t.v };
    if (t.t === "ref") {
      if (peek()?.t === "colon") {
        next();
        const to = next();
        if (to.t !== "ref") throw new Error(`[formulas] expected cell ref after ":" in ${JSON.stringify(expr)}`);
        return {
          k: "range",
          c0: Math.min(t.col, to.col), c1: Math.max(t.col, to.col),
          r0: Math.min(t.row, to.row), r1: Math.max(t.row, to.row),
        };
      }
      return { k: "ref", col: t.col, row: t.row };
    }
    if (t.t === "lparen") {
      const v = parseComparison();
      const c = next();
      if (c.t !== "rparen") throw new Error(`[formulas] expected ")" in ${JSON.stringify(expr)}`);
      return v;
    }
    if (t.t === "name") {
      if (t.v === "TRUE" || t.v === "FALSE") {
        if (peek()?.t !== "lparen") return { k: "bool", v: t.v === "TRUE" };
      }
      const open = next();
      if (open.t !== "lparen") throw new Error(`[formulas] expected "(" after ${t.v} in ${JSON.stringify(expr)}`);
      const args: Node[] = [];
      if (peek()?.t === "rparen") {
        next();
      } else {
        for (;;) {
          args.push(parseComparison());
          const sep = next();
          if (sep.t === "comma") continue;
          if (sep.t === "rparen") break;
          throw new Error(`[formulas] expected "," or ")" in ${t.v}() of ${JSON.stringify(expr)}`);
        }
      }
      return { k: "call", name: t.v, args };
    }
    throw new Error(`[formulas] unexpected token in ${JSON.stringify(expr)}`);
  };

  const v = parseComparison();
  if (pos < toks.length) throw new Error(`[formulas] trailing input in ${JSON.stringify(expr)}`);
  return v;
}

// ---------- Evaluation ----------

function toNum(v: RawValue, expr: string): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null || v === "") return 0;
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  throw new Error(`[formulas] value ${JSON.stringify(v)} is not a number in ${JSON.stringify(expr)}`);
}

function toStr(v: RawValue): string {
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}

function truthy(v: RawValue, expr: string): boolean {
  if (typeof v === "boolean") return v;
  if (v === null) return false;
  if (typeof v === "number") return v !== 0;
  if (v.toUpperCase() === "TRUE") return true;
  if (v.toUpperCase() === "FALSE") return false;
  return toNum(v, expr) !== 0;
}

type EvalResult = RawValue | { rangeValues: RawValue[] };

function evalNode(node: Node, raw: RawLookup, expr: string): EvalResult {
  switch (node.k) {
    case "num": return node.v;
    case "str": return node.v;
    case "bool": return node.v;
    case "ref": return raw(node.col, node.row);
    case "range": {
      const vals: RawValue[] = [];
      for (let r = node.r0; r <= node.r1; r++) for (let c = node.c0; c <= node.c1; c++) vals.push(raw(c, r));
      return { rangeValues: vals };
    }
    case "un": {
      const x = evalScalar(node.x, raw, expr);
      return node.op === "-" ? -toNum(x, expr) : toNum(x, expr);
    }
    case "pct": return toNum(evalScalar(node.x, raw, expr), expr) / 100;
    case "bin": return evalBin(node, raw, expr);
    case "call": return evalCall(node, raw, expr);
  }
}

function evalScalar(node: Node, raw: RawLookup, expr: string): RawValue {
  const v = evalNode(node, raw, expr);
  if (v !== null && typeof v === "object") {
    throw new Error(`[formulas] a range cannot be used as a single value in ${JSON.stringify(expr)}`);
  }
  return v;
}

function evalBin(node: Extract<Node, { k: "bin" }>, raw: RawLookup, expr: string): RawValue {
  const { op } = node;
  if (op === "&") {
    return toStr(evalScalar(node.l, raw, expr)) + toStr(evalScalar(node.r, raw, expr));
  }
  if (["=", "<>", "<", "<=", ">", ">="].includes(op)) {
    const l = evalScalar(node.l, raw, expr);
    const r = evalScalar(node.r, raw, expr);
    let cmp: number;
    const ln = typeof l === "number" || typeof l === "boolean" ? toNum(l, expr) : Number.NaN;
    const rn = typeof r === "number" || typeof r === "boolean" ? toNum(r, expr) : Number.NaN;
    if (!Number.isNaN(ln) && !Number.isNaN(rn)) cmp = ln < rn ? -1 : ln > rn ? 1 : 0;
    else {
      const ls = toStr(l).toUpperCase();
      const rs = toStr(r).toUpperCase();
      cmp = ls < rs ? -1 : ls > rs ? 1 : 0;
    }
    const out = op === "=" ? cmp === 0 : op === "<>" ? cmp !== 0 : op === "<" ? cmp < 0 : op === "<=" ? cmp <= 0 : op === ">" ? cmp > 0 : cmp >= 0;
    return out ? 1 : 0;
  }
  const l = toNum(evalScalar(node.l, raw, expr), expr);
  const r = toNum(evalScalar(node.r, raw, expr), expr);
  switch (op) {
    case "+": return l + r;
    case "-": return l - r;
    case "*": return l * r;
    case "/":
      if (r === 0) throw new Error(`[formulas] division by zero in ${JSON.stringify(expr)}`);
      return l / r;
    case "^": return Math.pow(l, r);
  }
  throw new Error(`[formulas] unknown operator "${op}" in ${JSON.stringify(expr)}`);
}

function flattenArgs(node: Extract<Node, { k: "call" }>, raw: RawLookup, expr: string): RawValue[] {
  const out: RawValue[] = [];
  for (const arg of node.args) {
    const v = evalNode(arg, raw, expr);
    if (v !== null && typeof v === "object") out.push(...v.rangeValues);
    else out.push(v);
  }
  return out;
}

function numericEntries(vals: RawValue[]): number[] {
  return vals.filter((v): v is number => typeof v === "number");
}

function evalCall(node: Extract<Node, { k: "call" }>, raw: RawLookup, expr: string): RawValue {
  const { name, args } = node;
  switch (name) {
    case "IF": {
      // Lazy: only the taken branch is evaluated, so a guarded division by
      // zero (or any other error) in the other branch never fires.
      if (args.length < 2 || args.length > 3) throw new Error(`[formulas] IF takes 2 or 3 arguments in ${JSON.stringify(expr)}`);
      const cond = truthy(evalScalar(args[0], raw, expr), expr);
      if (cond) return evalScalar(args[1], raw, expr);
      return args.length === 3 ? evalScalar(args[2], raw, expr) : 0;
    }
    case "SUM": return numericEntries(flattenArgs(node, raw, expr)).reduce((a, b) => a + b, 0);
    case "AVG": {
      const nums = numericEntries(flattenArgs(node, raw, expr));
      if (nums.length === 0) throw new Error(`[formulas] AVG of nothing in ${JSON.stringify(expr)}`);
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    }
    case "MIN": {
      const nums = numericEntries(flattenArgs(node, raw, expr));
      return nums.length ? Math.min(...nums) : 0;
    }
    case "MAX": {
      const nums = numericEntries(flattenArgs(node, raw, expr));
      return nums.length ? Math.max(...nums) : 0;
    }
    case "COUNT": return numericEntries(flattenArgs(node, raw, expr)).length;
    case "COUNTA": return flattenArgs(node, raw, expr).filter(v => v !== null && v !== "").length;
    case "ROUND": {
      if (args.length < 1 || args.length > 2) throw new Error(`[formulas] ROUND takes 1 or 2 arguments in ${JSON.stringify(expr)}`);
      const x = toNum(evalScalar(args[0], raw, expr), expr);
      const digits = args.length === 2 ? Math.trunc(toNum(evalScalar(args[1], raw, expr), expr)) : 0;
      const f = Math.pow(10, digits);
      return (Math.sign(x) * Math.round(Math.abs(x) * f)) / f; // half away from zero, like Excel
    }
    case "ABS": {
      if (args.length !== 1) throw new Error(`[formulas] ABS takes 1 argument in ${JSON.stringify(expr)}`);
      return Math.abs(toNum(evalScalar(args[0], raw, expr), expr));
    }
    case "SQRT": {
      if (args.length !== 1) throw new Error(`[formulas] SQRT takes 1 argument in ${JSON.stringify(expr)}`);
      const x = toNum(evalScalar(args[0], raw, expr), expr);
      if (x < 0) throw new Error(`[formulas] SQRT of a negative number in ${JSON.stringify(expr)}`);
      return Math.sqrt(x);
    }
    case "POWER": {
      if (args.length !== 2) throw new Error(`[formulas] POWER takes 2 arguments in ${JSON.stringify(expr)}`);
      return Math.pow(
        toNum(evalScalar(args[0], raw, expr), expr),
        toNum(evalScalar(args[1], raw, expr), expr)
      );
    }
  }
  throw new Error(`[formulas] unknown function "${name}" (available: ${FUNCTIONS.join(", ")})`);
}

/** Evaluate a formula against a raw cell lookup (numbers, text, empty). */
export function evaluateFormulaValue(expr: string, raw: RawLookup): FormulaValue {
  const ast = parseFormula(expr);
  const v = evalNode(ast, raw, expr);
  if (v !== null && typeof v === "object") {
    throw new Error(`[formulas] a range cannot be the result of ${JSON.stringify(expr)}`);
  }
  return v ?? 0;
}

/**
 * Evaluate a formula against a numeric lookup (the original contract:
 * every cell reads as a number, missing or non-numeric as 0). Arithmetic
 * results are numbers; & and string functions can yield strings.
 */
export function evaluateFormula(expr: string, lookup: NumberLookup): FormulaValue {
  return evaluateFormulaValue(expr, (c, r) => lookup(c, r));
}

// Cell keys ("col,row") an expression reads, ranges expanded. Feeds
// derivation.ts as the dependsOn wiring; needs no framework imports.
// Uses the source scanner, so refs inside string literals never register
// and function names like LOG10 are not mistaken for refs.
export function formulaDependencies(expr: string): string[] {
  const src = expr.trim().startsWith("=") ? expr.trim().slice(1) : expr.trim();
  const hits = scanRefs(src);
  const deps = new Set<string>();
  for (let i = 0; i < hits.length; i++) {
    const nxt = hits[i + 1];
    if (nxt && src.slice(hits[i].end, nxt.start).trim() === ":") {
      const c0 = Math.min(hits[i].col, nxt.col), c1 = Math.max(hits[i].col, nxt.col);
      const r0 = Math.min(hits[i].row, nxt.row), r1 = Math.max(hits[i].row, nxt.row);
      for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) deps.add(`${c},${r}`);
      i++;
    } else {
      deps.add(`${hits[i].col},${hits[i].row}`);
    }
  }
  return [...deps].sort();
}

// Spreadsheet convention: a cell's numeric value is occupant data.value;
// missing or non-numeric reads as 0.
export function occupantValueLookup(occupants: Occupant[], valueField = "value"): NumberLookup {
  const m = new Map<string, unknown>();
  for (const o of occupants) m.set(`${o.anchor.q},${o.anchor.r}`, (o.data as any)?.[valueField]);
  return (col, row) => {
    const v = m.get(`${col},${row}`);
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
  };
}

// ---------- Grid formula recalc (morph over the derivation mechanism) ----------
// Recomputes every occupant carrying data.formula, in dependency order, and
// writes the result to data.computed. Pure: returns new occupants, never
// mutates. Cycles and cell errors come back as messages, not throws, so a
// sheet stays usable while one cell is broken.
export type FormulaRecalc = { occupants: Occupant[]; errors: string[] };

/** Connect a presentation's optional formula policy to this vocabulary. */
export function derivePresentedCells(occupants: Occupant[], config?: GridPresentationConfig): FormulaRecalc {
  if (!config || editingPolicies(config).expressions !== "formula") return { occupants, errors: [] };
  const value = bindingField(config.cell.value);
  const formula = bindingField(config.cell.formula);
  const computed = bindingField(config.cell.computed);
  if (!value || !formula || !computed) return { occupants, errors: ["Formula derivation requires value, formula, and computed bindings"] };
  return applyFormulas(occupants, { value, formula, computed });
}

export function applyFormulas(occupants: Occupant[], fields: { value: string; formula: string; computed: string } = { value: "value", formula: "formula", computed: "computed" }): FormulaRecalc {
  const isFormulaCell = (o: Occupant) => typeof (o.data as any)?.[fields.formula] === "string";
  const formulaCells = occupants.filter(isFormulaCell);
  const keyOf = (q: number, r: number) => `${q},${r}`;
  const idByKey = new Map(occupants.map(o => [keyOf(o.anchor.q, o.anchor.r), o.id]));
  const byId = new Map(occupants.map(o => [o.id, o]));
  const dependsOn = (id: string): string[] => {
    const o = byId.get(id)!;
    const out: string[] = [];
    for (const k of formulaDependencies((o.data as any)[fields.formula])) {
      const dep = idByKey.get(k);
      if (dep && dep !== id && isFormulaCell(byId.get(dep)!)) out.push(dep);
    }
    return [...new Set(out)];
  };
  // Kahn's algorithm: a cycle quarantines only its own cells (and their
  // dependents), never the whole sheet.
  const ids = formulaCells.map(o => o.id);
  const indeg = new Map(ids.map(id => [id, 0]));
  const dependents = new Map(ids.map(id => [id, [] as string[]]));
  for (const id of ids) {
    for (const d of dependsOn(id)) {
      indeg.set(id, indeg.get(id)! + 1);
      dependents.get(d)!.push(id);
    }
  }
  const queue = ids.filter(id => indeg.get(id) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const m of dependents.get(id)!) {
      indeg.set(m, indeg.get(m)! - 1);
      if (indeg.get(m) === 0) queue.push(m);
    }
  }
  const errors: string[] = [];
  const ordered = new Set(order);
  const cyclic = ids.filter(id => !ordered.has(id));
  if (cyclic.length > 0) {
    errors.push(`[framework] derivation cycle detected: ${findLoop().join(" -> ")}`);
  }
  function findLoop(): string[] {
    let loop: string[] | null = null;
    const stack: string[] = [];
    const onStack = new Set<string>();
    const done = new Set<string>();
    const visit = (id: string): void => {
      if (loop !== null || done.has(id)) return;
      if (onStack.has(id)) {
        loop = [...stack.slice(stack.indexOf(id)), id];
        return;
      }
      onStack.add(id);
      stack.push(id);
      for (const d of dependsOn(id)) if (!ordered.has(d)) visit(d);
      stack.pop();
      onStack.delete(id);
      done.add(id);
    };
    for (const id of cyclic) visit(id);
    return loop ?? cyclic;
  }
  const computed = new Map<string, FormulaValue>();
  const errored = new Set<string>(cyclic);
  // Raw lookup: a formula cell's computed result (once derived, in
  // dependency order) wins over its stored value; text cells read as text;
  // absent cells read as empty (null).
  const look: RawLookup = (c, r) => {
    const id = idByKey.get(keyOf(c, r));
    if (id === undefined) return null;
    if (computed.has(id)) return computed.get(id)!;
    const v = (byId.get(id)!.data as any)?.[fields.value];
    return typeof v === "number" || typeof v === "string" || typeof v === "boolean" ? v : null;
  };
  for (const id of order) {
    const badDep = dependsOn(id).find(d => errored.has(d));
    if (badDep !== undefined) {
      errors.push(`${id}: depends on failed cell ${badDep}`);
      errored.add(id);
      continue;
    }
    try {
      computed.set(id, evaluateFormulaValue((byId.get(id)!.data as any)[fields.formula], look));
    } catch (e: any) {
      errors.push(`${id}: ${String(e?.message ?? e)}`);
      errored.add(id);
    }
  }
  return {
    occupants: occupants.map(o =>
      computed.has(o.id) ? { ...o, data: { ...(o.data as any), [fields.computed]: computed.get(o.id) } } : o
    ),
    errors,
  };
}
