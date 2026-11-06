// ---------- Sheet operations: pure grid-shape and range operations ----------
// The operations a spreadsheet needs over a Grid of cell occupants, written
// as pure functions over Occupant[] + dimensions so any shell (or a morph,
// see morphs/sheet.ts) can use them and every one is testable without React.
// Nothing here mutates its input.
//
// Choices worth knowing:
// - Cell ids that encode their position ("c-<q>-<r>", the convention
//   commitCellText creates) are re-encoded when an operation moves the
//   cell, so a later commit at the old position cannot collide with the
//   moved occupant. Foreign ids are left untouched.
// - Insert/delete rewrite every stored formula with rewriteFormulaRefs
//   (formulas.ts): refs into a deleted band become #REF!, ranges shrink or
//   expand per Excel-like rules documented there.
// - Sort moves occupants but does NOT rewrite their formulas (Excel
//   rewrites; recorded as an honest limit in TASKS.md).
import type { Occupant, Pos } from "../types";
import { upsertOccupant } from "../editing";
import {
  bindingField,
  commitCellText,
  type CellStyle,
  type GridPresentationConfig,
  type NumberFormatKind,
} from "../presentations";
import { applyFormulas, rewriteFormulaRefs, translateFormula } from "./formulas";

export type SheetGridState = { occupants: Occupant[]; width: number; height: number };

/** Inclusive rectangle, normalized so q0 <= q1 and r0 <= r1. */
export type RangeRect = { q0: number; r0: number; q1: number; r1: number };

export function normalizeRange(input: RangeRect | { anchor: Pos; active: Pos }): RangeRect {
  if ("q0" in input) {
    return {
      q0: Math.min(input.q0, input.q1),
      r0: Math.min(input.r0, input.r1),
      q1: Math.max(input.q0, input.q1),
      r1: Math.max(input.r0, input.r1),
    };
  }
  return normalizeRange({
    q0: input.anchor.q,
    r0: input.anchor.r,
    q1: input.active.q,
    r1: input.active.r,
  });
}

export function rangeCells(range: RangeRect): Pos[] {
  const out: Pos[] = [];
  for (let r = range.r0; r <= range.r1; r++) for (let q = range.q0; q <= range.q1; q++) out.push({ q, r });
  return out;
}

export function inRange(range: RangeRect, q: number, r: number): boolean {
  return q >= range.q0 && q <= range.q1 && r >= range.r0 && r <= range.r1;
}

const cellId = (q: number, r: number) => `c-${q}-${r}`;

function moveOcc(occ: Occupant, q: number, r: number): Occupant {
  const wasPositional = occ.id === cellId(occ.anchor.q, occ.anchor.r);
  return { ...occ, anchor: { q, r }, id: wasPositional ? cellId(q, r) : occ.id };
}

function rewriteAllFormulas(occupants: Occupant[], op: Parameters<typeof rewriteFormulaRefs>[1]): Occupant[] {
  return occupants.map(o => {
    const f = (o.data as any)?.formula;
    return typeof f === "string" ? { ...o, data: { ...o.data, formula: rewriteFormulaRefs(f, op) } } : o;
  });
}

function insertAxis(at: number, count: number, state: SheetGridState, axis: "row" | "col"): SheetGridState {
  const dim = axis === "row" ? state.height : state.width;
  if (!Number.isInteger(count) || count < 1) return state;
  const atC = Math.max(0, Math.min(dim, Math.trunc(at)));
  const occupants = state.occupants.map(o => {
    const v = axis === "row" ? o.anchor.r : o.anchor.q;
    if (v < atC) return o;
    return axis === "row" ? moveOcc(o, o.anchor.q, v + count) : moveOcc(o, v + count, o.anchor.r);
  });
  return {
    occupants: rewriteAllFormulas(occupants, { kind: "insert", axis, at: atC, count }),
    width: axis === "col" ? state.width + count : state.width,
    height: axis === "row" ? state.height + count : state.height,
  };
}

function deleteAxis(at: number, count: number, state: SheetGridState, axis: "row" | "col"): SheetGridState {
  const dim = axis === "row" ? state.height : state.width;
  if (!Number.isInteger(count) || count < 1 || dim <= 1) return state;
  const atC = Math.max(0, Math.min(dim - 1, Math.trunc(at)));
  let eff = Math.min(count, dim - atC);
  if (dim - eff < 1) eff = dim - 1;
  if (eff < 1) return state;
  const bandEnd = atC + eff;
  const occupants = state.occupants
    .filter(o => {
      const v = axis === "row" ? o.anchor.r : o.anchor.q;
      return v < atC || v >= bandEnd;
    })
    .map(o => {
      const v = axis === "row" ? o.anchor.r : o.anchor.q;
      if (v < bandEnd) return o;
      return axis === "row" ? moveOcc(o, o.anchor.q, v - eff) : moveOcc(o, v - eff, o.anchor.r);
    });
  return {
    occupants: rewriteAllFormulas(occupants, { kind: "delete", axis, at: atC, count: eff }),
    width: axis === "col" ? state.width - eff : state.width,
    height: axis === "row" ? state.height - eff : state.height,
  };
}

/** Insert `count` empty rows before row `at` (0-based); formulas retarget. */
export function insertRows(at: number, count: number, state: SheetGridState): SheetGridState {
  return insertAxis(at, count, state, "row");
}

/** Insert `count` empty columns before column `at` (0-based). */
export function insertCols(at: number, count: number, state: SheetGridState): SheetGridState {
  return insertAxis(at, count, state, "col");
}

/** Delete `count` rows starting at row `at`; occupants on them are dropped. At least one row always remains. */
export function deleteRows(at: number, count: number, state: SheetGridState): SheetGridState {
  return deleteAxis(at, count, state, "row");
}

/** Delete `count` columns starting at column `at`; at least one column always remains. */
export function deleteCols(at: number, count: number, state: SheetGridState): SheetGridState {
  return deleteAxis(at, count, state, "col");
}

/** Remove every occupant anchored inside the range. */
export function clearRange(occupants: Occupant[], range: RangeRect): Occupant[] {
  return occupants.filter(o => !inRange(range, o.anchor.q, o.anchor.r));
}

// ---------- Delimited text (TSV / CSV): the serialization adapter ----------

export type DelimitedOptions = {
  /** "formulas" copies the source text; "values" copies derived results. */
  mode?: "formulas" | "values";
  delimiter?: string;
  /** Quote cells containing the delimiter, a quote, or a newline. Default true. */
  quote?: boolean;
  config?: GridPresentationConfig;
};

function shownOccupants(occupants: Occupant[], config?: GridPresentationConfig): Occupant[] {
  const formulaField = config ? bindingField(config.cell.formula) : undefined;
  const valueField = config ? bindingField(config.cell.value) : undefined;
  const computedField = config ? bindingField(config.cell.computed) : undefined;
  if (formulaField && valueField && computedField) {
    return applyFormulas(occupants, { value: valueField, formula: formulaField, computed: computedField }).occupants;
  }
  return applyFormulas(occupants).occupants;
}

function cellSourceText(occ: Occupant | undefined): string {
  if (!occ) return "";
  const d = (occ.data ?? {}) as Record<string, unknown>;
  if (typeof d.formula === "string") return d.formula;
  return d.value === undefined || d.value === null ? "" : String(d.value);
}

function cellValueText(occ: Occupant | undefined): string {
  if (!occ) return "";
  const d = (occ.data ?? {}) as Record<string, unknown>;
  const v = d.computed ?? d.value;
  return v === undefined || v === null ? "" : String(v);
}

function escapeCell(text: string, delimiter: string, quote: boolean): string {
  if (!quote) return text;
  if (text.includes(delimiter) || text.includes('"') || text.includes("\n") || text.includes("\r")) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** Serialize a range as delimited text (TSV by default, CSV with delimiter ","). */
export function rangeToDelimited(occupants: Occupant[], range: RangeRect, opts: DelimitedOptions = {}): string {
  const delimiter = opts.delimiter ?? "\t";
  const quote = opts.quote ?? true;
  const mode = opts.mode ?? "values";
  const source = mode === "values" ? shownOccupants(occupants, opts.config) : occupants;
  const byKey = new Map(source.map(o => [`${o.anchor.q},${o.anchor.r}`, o]));
  const lines: string[] = [];
  for (let r = range.r0; r <= range.r1; r++) {
    const cells: string[] = [];
    for (let q = range.q0; q <= range.q1; q++) {
      const occ = byKey.get(`${q},${r}`);
      cells.push(escapeCell(mode === "formulas" ? cellSourceText(occ) : cellValueText(occ), delimiter, quote));
    }
    lines.push(cells.join(delimiter));
  }
  return lines.join("\n");
}

export function copyRangeToTSV(occupants: Occupant[], range: RangeRect, opts: DelimitedOptions = {}): string {
  return rangeToDelimited(occupants, range, { ...opts, delimiter: "\t" });
}

export function copyRangeToCSV(occupants: Occupant[], range: RangeRect, opts: DelimitedOptions = {}): string {
  return rangeToDelimited(occupants, range, { ...opts, delimiter: "," });
}

/** Parse delimited text, honoring quoted fields ("" escapes, embedded newlines). */
export function parseDelimited(text: string, delimiter = "\t"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStarted = false;
  const pushField = () => {
    row.push(field);
    field = "";
    fieldStarted = false;
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  let i = 0;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  while (i < src.length) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
      i++;
      continue;
    }
    if (c === delimiter) { pushField(); i++; continue; }
    if (c === "\n") { pushRow(); i++; continue; }
    field += c;
    fieldStarted = true;
    i++;
  }
  // A trailing newline ends the last row inside the loop's pushRow only when
  // a field follows; guard the phantom-row case explicitly.
  if (field !== "" || fieldStarted || row.length > 0) pushRow();
  return rows;
}

export function parseTSV(text: string): string[][] {
  return parseDelimited(text, "\t");
}

export type PasteOptions = {
  config: GridPresentationConfig;
  width: number;
  height: number;
  /**
   * Top-left of the range this text was copied from. When given, formulas
   * are translated by (at - origin), the way a spreadsheet paste retargets
   * relative refs. Omit for a verbatim paste.
   */
  origin?: Pos;
  delimiter?: string;
};

/**
 * Paste delimited text with its top-left at `at`, committing cell by cell
 * through commitCellText so parsing/expression/clear policies match typing.
 * Cells landing outside the grid are clipped.
 */
export function pasteTSV(occupants: Occupant[], text: string, at: Pos, opts: PasteOptions): Occupant[] {
  const rows = parseDelimited(text, opts.delimiter ?? "\t");
  const dQ = opts.origin ? at.q - opts.origin.q : 0;
  const dR = opts.origin ? at.r - opts.origin.r : 0;
  let current = occupants;
  rows.forEach((cells, dr) => {
    cells.forEach((rawText, dc) => {
      const q = at.q + dc;
      const r = at.r + dr;
      if (q < 0 || r < 0 || q >= opts.width || r >= opts.height) return;
      const cellText = rawText.startsWith("=") && opts.origin ? translateFormula(rawText, dQ, dR) : rawText;
      current = commitCellText(current, q, r, cellText, opts.config) ?? current;
    });
  });
  return current;
}

// ---------- Fill ----------

/**
 * Fill `target` from `source` (target normally contains source). Copies
 * tile with their formulas translated; an arithmetic series of >= 2 numeric
 * source values along the fill direction is extrapolated with the step
 * between its first two values. An empty source cell clears its target.
 */
export function fillRange(occupants: Occupant[], source: RangeRect, target: RangeRect): Occupant[] {
  const shown = shownOccupants(occupants);
  const shownByKey = new Map(shown.map(o => [`${o.anchor.q},${o.anchor.r}`, o]));
  const numericAt = (q: number, r: number): number | null => {
    const o = shownByKey.get(`${q},${r}`);
    if (!o) return null;
    const d = (o.data ?? {}) as Record<string, unknown>;
    const v = d.computed ?? d.value;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  };
  const srcW = source.q1 - source.q0 + 1;
  const srcH = source.r1 - source.r0 + 1;
  // Arithmetic series along one axis of the source, or null.
  const series = (fixed: number, from: number, to: number, axis: "q" | "r"): { first: number; step: number; firstAt: number } | null => {
    const vals: { at: number; v: number }[] = [];
    for (let i = from; i <= to; i++) {
      const v = axis === "q" ? numericAt(i, fixed) : numericAt(fixed, i);
      if (v === null) return null;
      vals.push({ at: i, v });
    }
    if (vals.length < 2) return null;
    const step = vals[1].v - vals[0].v;
    for (let i = 2; i < vals.length; i++) if (vals[i].v - vals[i - 1].v !== step) return null;
    return { first: vals[0].v, step, firstAt: vals[0].at };
  };

  let result = occupants;
  const set = (occ: Occupant | null, q: number, r: number) => {
    result = occ ? upsertOccupant(result, occ) : result.filter(o => !(o.anchor.q === q && o.anchor.r === r));
  };
  for (const { q, r } of rangeCells(target)) {
    if (inRange(source, q, r)) continue;
    // Series extrapolation takes precedence when filling straight out
    // along one axis beyond the source edge.
    if (q > source.q1 && r >= source.r0 && r <= source.r1) {
      const s = series(r, source.q0, source.q1, "q");
      if (s) {
        const template = shownByKey.get(`${source.q1},${r}`);
        const data: Record<string, unknown> = { value: s.first + s.step * (q - s.firstAt) };
        if (template) {
          const td = (template.data ?? {}) as Record<string, unknown>;
          if (td.style !== undefined) data.style = td.style;
          if (td.format !== undefined) data.format = td.format;
        }
        set({ id: cellId(q, r), anchor: { q, r }, span: [], type: "cell", data, tags: [] }, q, r);
        continue;
      }
    }
    if (r > source.r1 && q >= source.q0 && q <= source.q1) {
      const s = series(q, source.r0, source.r1, "r");
      if (s) {
        const template = shownByKey.get(`${q},${source.r1}`);
        const data: Record<string, unknown> = { value: s.first + s.step * (r - s.firstAt) };
        if (template) {
          const td = (template.data ?? {}) as Record<string, unknown>;
          if (td.style !== undefined) data.style = td.style;
          if (td.format !== undefined) data.format = td.format;
        }
        set({ id: cellId(q, r), anchor: { q, r }, span: [], type: "cell", data, tags: [] }, q, r);
        continue;
      }
    }
    const sq = source.q0 + (((q - source.q0) % srcW) + srcW) % srcW;
    const sr = source.r0 + (((r - source.r0) % srcH) + srcH) % srcH;
    const src = occupants.find(o => o.anchor.q === sq && o.anchor.r === sr);
    if (!src) {
      set(null, q, r);
      continue;
    }
    const data = { ...(src.data as Record<string, unknown>) };
    delete data.computed;
    if (typeof data.formula === "string") data.formula = translateFormula(data.formula, q - sq, r - sr);
    set({ ...src, id: cellId(q, r), anchor: { q, r }, data }, q, r);
  }
  return result;
}

// ---------- Style / format over a range (Slice B applied) ----------

function blankStyled(q: number, r: number, field: string, val: unknown): Occupant {
  return { id: cellId(q, r), anchor: { q, r }, span: [], type: "cell", data: { [field]: val }, tags: [] };
}

/** Merge a style patch into every cell of the range (creating style-only occupants for empty cells). */
export function applyRangeStyle(occupants: Occupant[], range: RangeRect, patch: Partial<CellStyle>, config?: GridPresentationConfig): Occupant[] {
  const field = (config && bindingField(config.cell.style)) || "style";
  let result = occupants;
  for (const { q, r } of rangeCells(range)) {
    const existing = result.find(o => o.anchor.q === q && o.anchor.r === r);
    if (!existing) {
      if (Object.keys(patch).length > 0) result = upsertOccupant(result, blankStyled(q, r, field, { ...patch }));
      continue;
    }
    const merged: Record<string, unknown> = { ...((existing.data as any)?.[field] ?? {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete merged[k];
      else merged[k] = v;
    }
    const data = { ...(existing.data as Record<string, unknown>) };
    if (Object.keys(merged).length > 0) data[field] = merged;
    else delete data[field];
    result = upsertOccupant(result, { ...existing, data });
  }
  return result;
}

/** Set (or clear, with null) the number format of every cell in the range. */
export function setRangeFormat(occupants: Occupant[], range: RangeRect, format: NumberFormatKind | null, config?: GridPresentationConfig): Occupant[] {
  const field = (config && bindingField(config.cell.format)) || "format";
  let result = occupants;
  for (const { q, r } of rangeCells(range)) {
    const existing = result.find(o => o.anchor.q === q && o.anchor.r === r);
    if (!existing) {
      if (format) result = upsertOccupant(result, blankStyled(q, r, field, format));
      continue;
    }
    const data = { ...(existing.data as Record<string, unknown>) };
    if (format) data[field] = format;
    else delete data[field];
    result = upsertOccupant(result, { ...existing, data });
  }
  return result;
}

// ---------- Sort ----------

/**
 * Sort the rows inside a range by the shown value of its first column.
 * Occupants move as whole rows; their formulas are NOT rewritten (see the
 * module header). Empty keys sort last in both directions.
 */
export function sortRange(occupants: Occupant[], range: RangeRect, dir: "asc" | "desc", config?: GridPresentationConfig): Occupant[] {
  const shown = shownOccupants(occupants, config);
  const shownByKey = new Map(shown.map(o => [`${o.anchor.q},${o.anchor.r}`, o]));
  const keyOf = (r: number): { empty: boolean; num: number | null; text: string } => {
    const o = shownByKey.get(`${range.q0},${r}`);
    const v = o ? ((o.data as any)?.computed ?? (o.data as any)?.value) : undefined;
    if (v === undefined || v === null || v === "") return { empty: true, num: null, text: "" };
    return { empty: false, num: typeof v === "number" ? v : null, text: String(v) };
  };
  const rows: number[] = [];
  for (let r = range.r0; r <= range.r1; r++) rows.push(r);
  const sign = dir === "asc" ? 1 : -1;
  const sorted = [...rows].sort((a, b) => {
    const ka = keyOf(a);
    const kb = keyOf(b);
    if (ka.empty && kb.empty) return 0;
    if (ka.empty) return 1;
    if (kb.empty) return -1;
    const cmp = ka.num !== null && kb.num !== null ? ka.num - kb.num : ka.text < kb.text ? -1 : ka.text > kb.text ? 1 : 0;
    return cmp * sign;
  });
  if (sorted.every((r, i) => r === rows[i])) return occupants;
  const destination = new Map<number, number>();
  sorted.forEach((srcR, i) => destination.set(srcR, range.r0 + i));
  return occupants.map(o => {
    if (!inRange(range, o.anchor.q, o.anchor.r)) return o;
    const nr = destination.get(o.anchor.r)!;
    return nr === o.anchor.r ? o : moveOcc(o, o.anchor.q, nr);
  });
}
