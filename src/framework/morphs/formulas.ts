// ---------- Formula vocabulary (morph library, not core) ----------
// Spreadsheet-style expressions over grid addresses. A1 means column A (0),
// row 1 (0). Supported: numbers, cell refs, ranges inside SUM/AVG/MIN/MAX,
// + - * / and parentheses. Anything else throws a message the plan author or
// AI can act on. Wiring (which cells feed which) is derived with
// formulaDependencies and evaluated in order with derivation.ts.
import type { Occupant } from "../types";

export type NumberLookup = (col: number, row: number) => number;

export function colLabelToIndex(label: string): number {
  let n = 0;
  for (const ch of label.toUpperCase()) {
    const v = ch.charCodeAt(0) - 64; // A = 1
    if (v < 1 || v > 26) throw new Error(`[formulas] bad column label "${label}"`);
    n = n * 26 + v;
  }
  return n - 1;
}

export function parseCellRef(ref: string): [number, number] | null {
  const m = /^([A-Za-z]+)([0-9]+)$/.exec(ref.trim());
  if (!m) return null;
  return [colLabelToIndex(m[1]), parseInt(m[2], 10) - 1];
}

type Tok =
  | { t: "num"; v: number }
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
    if ((c >= "0" && c <= "9") || (c === "." && src[i + 1] >= "0" && src[i + 1] <= "9")) {
      const m = /^[0-9]*\.?[0-9]+/.exec(src.slice(i))!;
      toks.push({ t: "num", v: parseFloat(m[0]) });
      i += m[0].length;
      continue;
    }
    if ((c >= "A" && c <= "Z") || (c >= "a" && c <= "z")) {
      const m = /^[A-Za-z]+/.exec(src.slice(i))!;
      const word = m[0];
      i += word.length;
      const rest = /^[0-9]+/.exec(src.slice(i));
      if (rest) {
        toks.push({ t: "ref", col: colLabelToIndex(word), row: parseInt(rest[0], 10) - 1 });
        i += rest[0].length;
      } else {
        toks.push({ t: "name", v: word.toUpperCase() });
      }
      continue;
    }
    if (c === "+" || c === "-" || c === "*" || c === "/") { toks.push({ t: "op", v: c }); i++; continue; }
    if (c === "(") { toks.push({ t: "lparen" }); i++; continue; }
    if (c === ")") { toks.push({ t: "rparen" }); i++; continue; }
    if (c === ",") { toks.push({ t: "comma" }); i++; continue; }
    if (c === ":") { toks.push({ t: "colon" }); i++; continue; }
    throw err();
  }
  return toks;
}

export function evaluateFormula(expr: string, lookup: NumberLookup): number {
  const src = expr.trim().startsWith("=") ? expr.trim().slice(1) : expr.trim();
  const toks = tokenize(src);
  let pos = 0;
  const peek = (): Tok | null => toks[pos] || null;
  const next = (): Tok => {
    const t = toks[pos++];
    if (!t) throw new Error(`[formulas] unexpected end of ${JSON.stringify(expr)}`);
    return t;
  };
  const parseExpr = (): number => {
    let v = parseTerm();
    for (;;) {
      const t = peek();
      if (t?.t === "op" && (t.v === "+" || t.v === "-")) {
        next();
        const r = parseTerm();
        v = t.v === "+" ? v + r : v - r;
      } else return v;
    }
  };
  const parseTerm = (): number => {
    let v = parseFactor();
    for (;;) {
      const t = peek();
      if (t?.t === "op" && (t.v === "*" || t.v === "/")) {
        next();
        const r = parseFactor();
        if (t.v === "/" && r === 0) throw new Error(`[formulas] division by zero in ${JSON.stringify(expr)}`);
        v = t.v === "*" ? v * r : v / r;
      } else return v;
    }
  };
  const parseRange = (from: { col: number; row: number }): number[] => {
    const colon = next();
    if (colon.t !== "colon") throw new Error(`[formulas] expected ":" in ${JSON.stringify(expr)}`);
    const to = next();
    if (to.t !== "ref") throw new Error(`[formulas] expected cell ref after ":" in ${JSON.stringify(expr)}`);
    const vals: number[] = [];
    const c0 = Math.min(from.col, to.col), c1 = Math.max(from.col, to.col);
    const r0 = Math.min(from.row, to.row), r1 = Math.max(from.row, to.row);
    for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) vals.push(lookup(c, r));
    return vals;
  };
  const parseCallArgs = (name: string): number[] => {
    const vals: number[] = [];
    for (;;) {
      const t = peek();
      if (!t) throw new Error(`[formulas] unexpected end in ${name}() of ${JSON.stringify(expr)}`);
      if (t.t === "rparen") { next(); break; }
      if (t.t === "ref" && toks[pos + 1]?.t === "colon") {
        const from = next() as { col: number; row: number };
        vals.push(...parseRange(from));
      } else {
        vals.push(parseExpr());
      }
      const sep = peek();
      if (sep?.t === "comma") { next(); continue; }
      if (sep?.t === "rparen") continue;
      throw new Error(`[formulas] expected "," or ")" in ${name}() of ${JSON.stringify(expr)}`);
    }
    return vals;
  };
  const parseFactor = (): number => {
    const t = next();
    if (t.t === "num") return t.v;
    if (t.t === "ref") return lookup(t.col, t.row);
    if (t.t === "op" && t.v === "-") return -parseFactor();
    if (t.t === "lparen") {
      const v = parseExpr();
      const c = next();
      if (c.t !== "rparen") throw new Error(`[formulas] expected ")" in ${JSON.stringify(expr)}`);
      return v;
    }
    if (t.t === "name") {
      const open = next();
      if (open.t !== "lparen") throw new Error(`[formulas] expected "(" after ${t.v} in ${JSON.stringify(expr)}`);
      const args = parseCallArgs(t.v);
      if (t.v === "SUM") return args.reduce((a, b) => a + b, 0);
      if (t.v === "AVG") {
        if (args.length === 0) throw new Error(`[formulas] AVG of nothing in ${JSON.stringify(expr)}`);
        return args.reduce((a, b) => a + b, 0) / args.length;
      }
      if (t.v === "MIN") return Math.min(...args);
      if (t.v === "MAX") return Math.max(...args);
      throw new Error(`[formulas] unknown function "${t.v}" (available: SUM, AVG, MIN, MAX)`);
    }
    throw new Error(`[formulas] unexpected token in ${JSON.stringify(expr)}`);
  };
  const v = parseExpr();
  if (pos < toks.length) throw new Error(`[formulas] trailing input in ${JSON.stringify(expr)}`);
  return v;
}

// Cell keys ("col,row") an expression reads, ranges expanded. Feeds
// derivation.ts as the dependsOn wiring; needs no framework imports.
export function formulaDependencies(expr: string): string[] {
  const src = expr.trim().startsWith("=") ? expr.trim().slice(1) : expr.trim();
  const toks = tokenize(src);
  const deps = new Set<string>();
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t === "ref") {
      const nxt = toks[i + 1];
      if (nxt?.t === "colon" && toks[i + 2]?.t === "ref") {
        const to = toks[i + 2] as { col: number; row: number };
        const c0 = Math.min(t.col, to.col), c1 = Math.max(t.col, to.col);
        const r0 = Math.min(t.row, to.row), r1 = Math.max(t.row, to.row);
        for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) deps.add(`${c},${r}`);
        i += 2;
      } else {
        deps.add(`${t.col},${t.row}`);
      }
    }
  }
  return [...deps].sort();
}

// Spreadsheet convention: a cell's numeric value is occupant data.value;
// missing or non-numeric reads as 0.
export function occupantValueLookup(occupants: Occupant[]): NumberLookup {
  const m = new Map<string, unknown>();
  for (const o of occupants) m.set(`${o.anchor.q},${o.anchor.r}`, (o.data as any)?.value);
  return (col, row) => {
    const v = m.get(`${col},${row}`);
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
  };
}
