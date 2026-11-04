import type { PlanRecipe } from "../plan-inventory";
import "../morphs/sheet";

export type SpreadsheetRecipeParams = {
  width?: number;
  height?: number;
  formulas?: boolean;
  cells?: Array<{ q: number; r: number; value: string | number }>;
};

/** A reusable starting recipe, producing a regular base + morphs Grid plan. */
export const spreadsheetRecipe: PlanRecipe<SpreadsheetRecipeParams> = {
  id: "spreadsheet",
  label: "Spreadsheet",
  description: "An editable grid with optional formulas and initial cells.",
  parameters: [
    { name: "width", type: "integer (1–64)", description: "Number of columns", default: 5 },
    { name: "height", type: "integer (1–64)", description: "Number of rows", default: 4 },
    { name: "formulas", type: "boolean", description: "Enable formula expressions", default: true },
    { name: "cells", type: "array", description: "Initial {q, r, value} cells", default: [] },
  ],
  validate(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)) return ["parameters must be an object"];
    const p = input as SpreadsheetRecipeParams;
    const errors: string[] = [];
    for (const key of Object.keys(p)) if (!["width", "height", "formulas", "cells"].includes(key)) errors.push(`unknown parameter "${key}"`);
    for (const key of ["width", "height"] as const) {
      const value = p[key] === undefined ? (key === "width" ? 5 : 4) : p[key];
      if (!Number.isInteger(value) || value < 1 || value > 64) errors.push(`${key} must be an integer in 1..64`);
    }
    if (p.formulas !== undefined && typeof p.formulas !== "boolean") errors.push("formulas must be a boolean");
    if (p.cells !== undefined && !Array.isArray(p.cells)) return [...errors, "cells must be an array"];
    const seen = new Set<string>();
    (p.cells ?? []).forEach((cell, i) => {
      if (!cell || typeof cell !== "object") { errors.push(`cells[${i}] must be {q, r, value}`); return; }
      if (!Number.isInteger(cell.q) || !Number.isInteger(cell.r) || cell.q < 0 || cell.r < 0 || cell.q >= (p.width ?? 5) || cell.r >= (p.height ?? 4)) errors.push(`cells[${i}] is outside the grid`);
      const key = `${cell.q},${cell.r}`;
      if (seen.has(key)) errors.push(`cells[${i}] duplicates ${key}`);
      seen.add(key);
      if ((typeof cell.value !== "string" && typeof cell.value !== "number") || (typeof cell.value === "number" && !Number.isFinite(cell.value))) errors.push(`cells[${i}].value must be text or a finite number`);
    });
    return errors;
  },
  build(p) {
    const width = p.width ?? 5, height = p.height ?? 4, formulas = p.formulas ?? true;
    const occupants = (p.cells ?? []).map(({ q, r, value }) => ({
      id: `c-${q}-${r}`, anchor: { q, r }, span: [], type: "cell",
      data: typeof value === "string" && value.startsWith("=") && formulas ? { formula: value } : { value }, tags: [],
    }));
    return {
      $schema: "paramorphic-plan/1", component: "Grid", tilingId: "square8", presetId: "spreadsheet",
      width, height,
      ruleSet: { id: "spreadsheet", setup: { width, height, description: "Editable grid" }, moves: [], turns: { type: "free", order: [], first: "sheet" }, outcomes: [], end: { condition: "none", action: "none" }, regions: [] },
      regions: [], occupants,
      interpretation: { view: "spreadsheet", grid: {
        cell: { kind: "editableText", value: "data.value", ...(formulas ? { formula: "data.formula", computed: "data.computed" } : {}) },
        editing: { parse: "numberOrText", expressions: formulas ? "formula" : "none", clear: "occupant", enter: "down" },
        selection: { mode: "range" },
        headers: { columns: "letters", rows: "numbers" },
      } },
      base: { occupants: [], width, height },
      morphs: occupants.map(occ => ({ name: "sheet.setCell", params: { occ } })),
    };
  },
};
