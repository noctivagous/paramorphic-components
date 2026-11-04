// ---------- Cell presentations: how grid data appears and edits ----------
// An occupant says what data is in a cell; a presentation says how that data
// appears and can be edited. Plans select a presentation plus field bindings
// under `interpretation.grid`, so the spreadsheet's editable cells, headers,
// and formula display are configured — not hard-coded in a custom view.
// The same `editableText` presentation renders a calendar's event titles;
// formula evaluation stays in the derivation mechanism (`formulas.ts`).
import type { Occupant } from "./types";
import { removeOccupant, upsertOccupant } from "./editing";

export type CellPresentationKind = "editableText" | "readOnly" | "eventCard";

export const PRESENTATION_KINDS: CellPresentationKind[] = ["editableText", "readOnly", "eventCard"];

export type CellPresentation = {
  kind: CellPresentationKind;
  /** Binding path for the shown/edited value, e.g. "data.value". */
  value: string;
  /** Binding path for the formula source, e.g. "data.formula". */
  formula?: string;
  /** Binding path for the derived result, e.g. "data.computed". */
  computed?: string;
};

export type GridHeaders = {
  columns: "letters" | "none";
  rows: "numbers" | "none";
};

export type GridPresentationConfig = {
  cell: CellPresentation;
  headers: GridHeaders;
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function isPresentationKind(v: unknown): v is CellPresentationKind {
  return v === "editableText" || v === "readOnly" || v === "eventCard";
}

/** Validate a plan's `interpretation.grid` block. Empty means usable. */
export function validatePresentationConfig(cfg: unknown): string[] {
  if (!isRecord(cfg)) return ["interpretation.grid must be an object"];
  const errors: string[] = [];
  const cell = (cfg as Record<string, unknown>).cell;
  if (!isRecord(cell)) {
    errors.push("interpretation.grid.cell must be an object");
  } else {
    if (!isPresentationKind(cell.kind)) {
      errors.push(
        `interpretation.grid.cell.kind "${String(cell.kind)}" unknown (available: ${PRESENTATION_KINDS.join(", ")})`
      );
    }
    for (const key of ["value", "formula", "computed"] as const) {
      const v = cell[key];
      if (v !== undefined && (typeof v !== "string" || !/^data\.[A-Za-z_$][\w$]*$/.test(v))) {
        errors.push(`interpretation.grid.cell.${key} must be a data.<field> path`);
      }
    }
    if (typeof cell.value !== "string") errors.push("interpretation.grid.cell.value is required");
  }
  const headers = (cfg as Record<string, unknown>).headers;
  if (!isRecord(headers)) {
    errors.push("interpretation.grid.headers must be an object");
  } else {
    if (headers.columns !== "letters" && headers.columns !== "none") {
      errors.push(`interpretation.grid.headers.columns "${String(headers.columns)}" unknown (available: letters, none)`);
    }
    if (headers.rows !== "numbers" && headers.rows !== "none") {
      errors.push(`interpretation.grid.headers.rows "${String(headers.rows)}" unknown (available: numbers, none)`);
    }
  }
  return errors;
}

/** Read a `data.<field>` path off an occupant. Missing fields resolve empty, never throw. */
export function resolveBinding(occ: Occupant | undefined, path: string | undefined): { found: boolean; value: unknown } {
  if (!occ || typeof path !== "string") return { found: false, value: undefined };
  const m = /^data\.([A-Za-z_$][\w$]*)$/.exec(path);
  if (!m) return { found: false, value: undefined };
  const data = (occ.data ?? {}) as Record<string, unknown>;
  if (!(m[1] in data)) return { found: false, value: undefined };
  return { found: true, value: data[m[1]] };
}

/** Column header label: 0 -> A, 25 -> Z, 26 -> AA. Shared with every header renderer. */
export function colName(q: number): string {
  let n = q + 1;
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function blankCell(q: number, r: number): Occupant {
  return { id: `c-${q}-${r}`, anchor: { q, r }, span: [], type: "cell", data: {}, tags: [] };
}

/**
 * Pure spreadsheet commit shared by every shell: empty text clears the cell,
 * `=...` writes a formula, anything else writes a value (numbers as numbers).
 * Returns null when nothing changes, so callers keep the snapshot path.
 */
export function commitCellText(
  occupants: Occupant[],
  q: number,
  r: number,
  text: string
): Occupant[] | null {
  const t = text.trim();
  const existing = occupants.find(o => o.anchor.q === q && o.anchor.r === r);
  if (t === "") {
    if (!existing) return null;
    return removeOccupant(occupants, existing.id);
  }
  const base = existing ?? blankCell(q, r);
  if (t.startsWith("=")) {
    const next = { ...base, data: { ...(base.data as any), formula: t } };
    if (existing && JSON.stringify(existing) === JSON.stringify(next)) return null;
    return upsertOccupant(occupants, next);
  }
  const n = Number(t);
  const next = {
    ...base,
    data: { ...(base.data as any), value: t !== "" && Number.isFinite(n) ? n : t, formula: undefined },
  };
  if (existing && JSON.stringify(existing) === JSON.stringify(next)) return null;
  return upsertOccupant(occupants, next);
}

/** Formula error ids: `applyFormulas` reports `"id: reason"`. */
export function errorIdsFor(errors: string[]): string[] {
  const ids = new Set<string>();
  for (const e of errors) {
    const id = e.split(":")[0];
    if (id) ids.add(id);
  }
  return [...ids];
}
