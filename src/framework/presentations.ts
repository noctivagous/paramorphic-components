// ---------- Cell presentations: how grid data appears and edits ----------
// An occupant says what data is in a cell; a presentation says how that data
// appears and can be edited. Plans select a presentation plus field bindings
// under `interpretation.grid`, so the spreadsheet's editable cells, headers,
// and formula display are configured — not hard-coded in a custom view.
// Formula evaluation stays in the derivation mechanism (`formulas.ts`).
import type { Occupant } from "./types";
import { removeOccupant, upsertOccupant } from "./editing";
import { applyFormulas } from "./morphs/formulas";

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
  editing?: CellEditing;
};

/** Policies can be combined independently; legacy modes remain loadable. */
export type CellEditing =
  | { parse?: "text" | "numberOrText"; expressions?: "none" | "formula"; clear?: "value" | "occupant" }
  | { kind: "text" | "spreadsheet" };

export type CellEditingPolicies = {
  parse: "text" | "numberOrText";
  expressions: "none" | "formula";
  clear: "value" | "occupant";
};

const TEXT_POLICIES: CellEditingPolicies = { parse: "text", expressions: "none", clear: "value" };
const SPREADSHEET_POLICIES: CellEditingPolicies = { parse: "numberOrText", expressions: "formula", clear: "occupant" };

/** Normalize legacy plans and fill defaults for independently chosen policies. */
export function editingPolicies(config?: GridPresentationConfig): CellEditingPolicies {
  const editing = config?.editing;
  if (!editing) return { ...(config?.cell?.formula ? SPREADSHEET_POLICIES : TEXT_POLICIES) };
  if ("kind" in editing) return { ...(editing.kind === "spreadsheet" ? SPREADSHEET_POLICIES : TEXT_POLICIES) };
  return { ...TEXT_POLICIES, ...editing };
}

const bindingField = (path: string | undefined): string | undefined => {
  const name = /^data\.([A-Za-z_$][\w$]*)$/.exec(path ?? "")?.[1];
  return name && !["__proto__", "constructor", "prototype"].includes(name) ? name : undefined;
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
      if (v !== undefined && (typeof v !== "string" || !bindingField(v))) {
        errors.push(`interpretation.grid.cell.${key} must be a data.<field> path`);
      }
    }
    if (typeof cell.value !== "string") errors.push("interpretation.grid.cell.value is required");
    const bindings = [cell.value, cell.formula, cell.computed].filter((v): v is string => typeof v === "string");
    if (new Set(bindings).size !== bindings.length) errors.push("interpretation.grid.cell bindings must be distinct");
  }
  const editing = cfg.editing;
  if (editing !== undefined) {
    if (!isRecord(editing)) errors.push("interpretation.grid.editing must be an object");
    else {
      const allowed = ["kind", "parse", "expressions", "clear"];
      for (const key of Object.keys(editing)) if (!allowed.includes(key)) errors.push(`unknown editing policy "${key}"`);
      if (editing.kind !== undefined && editing.kind !== "text" && editing.kind !== "spreadsheet") errors.push("interpretation.grid.editing.kind must be text or spreadsheet");
      if (editing.kind !== undefined && (editing.parse !== undefined || editing.expressions !== undefined || editing.clear !== undefined)) errors.push("legacy editing.kind cannot be combined with editing policies");
      if (editing.parse !== undefined && editing.parse !== "text" && editing.parse !== "numberOrText") errors.push("editing.parse must be text or numberOrText");
      if (editing.expressions !== undefined && editing.expressions !== "none" && editing.expressions !== "formula") errors.push("editing.expressions must be none or formula");
      if (editing.clear !== undefined && editing.clear !== "value" && editing.clear !== "occupant") errors.push("editing.clear must be value or occupant");
    }
  }
  const formulasEnabled = isRecord(editing) ? editing.kind === "spreadsheet" || editing.expressions === "formula" : editing === undefined && isRecord(cell) && cell.formula !== undefined;
  if (isRecord(cell) && formulasEnabled &&
      (typeof cell.formula !== "string" || typeof cell.computed !== "string")) {
    errors.push("formula expressions require formula and computed bindings");
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
  const field = bindingField(path);
  if (!field) return { found: false, value: undefined };
  const data = (occ.data ?? {}) as Record<string, unknown>;
  if (!Object.prototype.hasOwnProperty.call(data, field)) return { found: false, value: undefined };
  return { found: true, value: data[field] };
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

/** Evaluate expressions only when the editing policy enables formulas. */
export function derivePresentedCells(occupants: Occupant[], config?: GridPresentationConfig) {
  if (!config || editingPolicies(config).expressions !== "formula") return { occupants, errors: [] as string[] };
  const value = bindingField(config.cell.value);
  const formula = bindingField(config.cell.formula);
  const computed = bindingField(config.cell.computed);
  if (!value || !formula || !computed) return { occupants, errors: ["Formula derivation requires value, formula, and computed bindings"] };
  return applyFormulas(occupants, { value, formula, computed });
}

/**
 * Commit through the configured bindings and independently selected parsing,
 * expression, and clearing policies.
 * Returns null when nothing changes.
 */
export function commitCellText(
  occupants: Occupant[],
  q: number,
  r: number,
  text: string,
  config: GridPresentationConfig = { cell: { kind: "editableText", value: "data.value", formula: "data.formula", computed: "data.computed" }, headers: { columns: "none", rows: "none" }, editing: { kind: "spreadsheet" } }
): Occupant[] | null {
  if (config.cell.kind !== "editableText") return null;
  const valueField = bindingField(config.cell.value);
  const formulaField = bindingField(config.cell.formula);
  const computedField = bindingField(config.cell.computed);
  if (!valueField) return null;
  const policies = editingPolicies(config);
  const t = text.trim();
  const existing = occupants.find(o => o.anchor.q === q && o.anchor.r === r);
  if (t === "") {
    if (!existing) return null;
    if (policies.clear === "occupant") return removeOccupant(occupants, existing.id);
    const data = { ...existing.data };
    const fields = [valueField, ...(policies.expressions === "formula" ? [formulaField, computedField] : [])].filter((f): f is string => !!f);
    if (!fields.some(f => Object.prototype.hasOwnProperty.call(data, f))) return null;
    for (const field of fields) delete data[field];
    return upsertOccupant(occupants, { ...existing, data });
  }
  const base = existing ?? blankCell(q, r);
  const data = { ...base.data };
  if (policies.expressions === "formula" && formulaField && t.startsWith("=")) {
    data[formulaField] = t;
    delete data[valueField];
    if (computedField) delete data[computedField];
  } else {
    const n = Number(t);
    data[valueField] = policies.parse === "numberOrText" && Number.isFinite(n) ? n : t;
    if (policies.expressions === "formula" && formulaField) delete data[formulaField];
    if (policies.expressions === "formula" && computedField) delete data[computedField];
  }
  const next = { ...base, data };
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
