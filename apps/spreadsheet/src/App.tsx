// Spreadsheet app: GridViewport for cells, app-kit shell for the window.
// Menus, toolbar, dialogs, shortcuts, and status come from a replayed
// shell morph plan; the sheet itself still boots through loadPlan.
//
// Full-spreadsheet adaptation (2026-11-05): the toolbar row, sheet tabs,
// clipboard, aggregates, chart, and conditional formatting in this shell
// are thin wiring over framework capabilities — sheet-ops (insert/delete,
// fill, paste, sort, style, format), the extended formula vocabulary, and
// the presentation style/format/freeze layer. Every occupant edit goes
// through push()/pushSized() so it lands in history as ONE undo step
// (bulk steps use the sheet.setCells morph; axis steps use the
// sheet.insertRows/insertCols/deleteRows/deleteCols morphs).
//
// Known limits: Save/Open (JSON plan) covers the ACTIVE sheet only — the
// tabs are a shell-level model, not yet part of the plan format. Freeze is
// a settings change, not an undoable edit. Cross-sheet formulas are not
// supported; each tab derives independently.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { GridViewport } from "../../../src/framework/components/GridViewport";
import {
  applyRangeStyle,
  appKit,
  clearRange,
  colName,
  commitCellText,
  copyRangeToCSV,
  copyRangeToTSV,
  deleteCols,
  deleteRows,
  derivePresentedCells,
  editingPolicies,
  errorIdsFor,
  fillRange,
  getTiling,
  insertCols,
  insertRows,
  loadPlan,
  normalizeRange,
  parseDelimited,
  parsePlan,
  pasteTSV,
  planInventory,
  pushHistory,
  redoHistory,
  resolveBinding,
  selectedCellCount,
  setRangeFormat,
  sortRange,
  undoHistory,
  type GridSelection,
  type NumberFormatKind,
  type RangeRect,
} from "../../../src/framework";
import type { AppliedMorph, HistoryStep, Occupant, PlanBase } from "../../../src/framework";
import { AppShell } from "../../../src/framework/app-kit/Chrome";
import { PLANS } from "./plans";
import { buildSheetSave, type SheetSettings } from "./save";

const seed = PLANS[0].data as any;
const shellRecipe = appKit.instantiate("spreadsheet", { title: "Spreadsheet" });
if (!shellRecipe.ok) throw new Error(shellRecipe.errors.join("; "));
const shell = shellRecipe.plan;

const seedSettings: SheetSettings = {
  tilingId: seed.tilingId,
  presetId: seed.presetId,
  ruleSet: seed.ruleSet,
  regions: seed.regions,
  interpretation: seed.interpretation,
};

const boot = loadPlan({ data: seed, errors: [] }, null);
const bootPlan = boot.ok ? boot.plan : null;
const bootErrors: string[] = boot.ok ? [] : boot.errors;
const bootBase: PlanBase = bootPlan?.base ?? {
  occupants: seed.occupants ?? [],
  width: seed.width as number,
  height: seed.height as number,
};
const bootSettings: SheetSettings = bootPlan
  ? {
      tilingId: bootPlan.tilingId ?? seed.tilingId,
      presetId: bootPlan.presetId,
      ruleSet: bootPlan.ruleSet,
      regions: bootPlan.regions ?? seed.regions,
      interpretation: bootPlan.interpretation,
    }
  : seedSettings;

type SheetTab = {
  id: string;
  name: string;
  occupants: Occupant[];
  size: { w: number; h: number };
  past: HistoryStep[];
  future: HistoryStep[];
  base: PlanBase;
  adopted: AppliedMorph[];
  settings: SheetSettings;
};

let tabSeq = 0;
function makeTab(
  name: string,
  occupants: Occupant[],
  size: { w: number; h: number },
  base: PlanBase,
  adopted: AppliedMorph[],
  settings: SheetSettings
): SheetTab {
  return { id: `tab-${++tabSeq}`, name, occupants, size, past: [], future: [], base, adopted, settings };
}

/**
 * Single-cell edits keep the original morphs; anything wider becomes one
 * sheet.setCells step whose inverse frame is the previous occupant list
 * (the frame sheet.setCells' capture produces).
 */
function diffToMorph(prev: Occupant[], next: Occupant[]): AppliedMorph | null {
  const byId = (list: Occupant[]) => new Map(list.map(o => [o.id, o]));
  const p = byId(prev);
  const n = byId(next);
  const added = next.filter(o => !p.has(o.id));
  const removed = prev.filter(o => !n.has(o.id));
  const changed = next.filter(o => {
    const o0 = p.get(o.id);
    return o0 && JSON.stringify(o0) !== JSON.stringify(o);
  });
  const total = added.length + removed.length + changed.length;
  if (total === 0) return null;
  if (total > 1) {
    return {
      name: "sheet.setCells",
      params: { set: [...added, ...changed], clear: removed.map(o => o.id) },
      inverse: { prev },
    };
  }
  if (added.length === 1) {
    return { name: "sheet.setCell", params: { occ: added[0] }, inverse: { prev: null } };
  }
  if (removed.length === 1) {
    return { name: "sheet.clearCell", params: { id: removed[0].id }, inverse: { prev: removed[0] } };
  }
  return {
    name: "sheet.setCell",
    params: { occ: changed[0] },
    inverse: { prev: p.get(changed[0].id) ?? null },
  };
}

function cellName(q: number, r: number) {
  return `${colName(q)}${r + 1}`;
}

const fmtNum = (v: number) => {
  const s = Math.abs(v) >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(Math.round(v * 100) / 100);
  return s;
};

export default function App() {
  const [tabs, setTabs] = useState<SheetTab[]>(() => [
    makeTab(
      "Sheet 1",
      bootPlan?.occupants ?? seed.occupants,
      { w: (bootPlan?.width ?? seed.width) as number, h: (bootPlan?.height ?? seed.height) as number },
      bootBase,
      bootPlan?.morphs ?? [],
      bootSettings
    ),
  ]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [errors, setErrors] = useState<string[]>(() => bootErrors);
  const [notice, setNotice] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ q: number; r: number }>({ q: 0, r: 0 });
  const [selection, setSelection] = useState<GridSelection | null>(null);
  const [selectionVersion, setSelectionVersion] = useState(0);
  const [editingBar, setEditingBar] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [cfOn, setCfOn] = useState(false);
  const [cfThreshold, setCfThreshold] = useState(50);
  const [chartOn, setChartOn] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const csvRef = useRef<HTMLInputElement>(null);
  const clipboardOrigin = useRef<{ q: number; r: number } | null>(null);

  const tab = tabs[Math.min(activeIdx, tabs.length - 1)];
  const { occupants, size, settings, past, future } = tab;
  const gridConfig = settings.interpretation?.grid;

  const patchTab = (patch: Partial<SheetTab>) =>
    setTabs(ts => ts.map((t, i) => (i === activeIdx ? { ...t, ...patch } : t)));

  const stateOf = (t: SheetTab, list: Occupant[]) => ({ occupants: list, width: t.size.w, height: t.size.h });

  const push = (next: Occupant[]) => {
    if (next === occupants) return;
    patchTab({
      past: pushHistory(tab.past, stateOf(tab, occupants), diffToMorph(occupants, next)),
      future: [],
      occupants: next,
    });
  };

  /** Push an edit that also changes the grid dimensions (axis morphs). */
  const pushSized = (next: Occupant[], nextSize: { w: number; h: number }, morphName: string, at: number, count: number) => {
    const morph: AppliedMorph = {
      name: morphName,
      params: { at, count },
      inverse: { prev: { occupants, width: size.w, height: size.h } },
    };
    patchTab({
      past: pushHistory(tab.past, stateOf(tab, occupants), morph),
      future: [],
      occupants: next,
      size: nextSize,
    });
  };

  const commit = (q: number, r: number, text: string) => {
    if (!gridConfig) return;
    const next = commitCellText(occupants, q, r, text, gridConfig);
    if (next) push(next);
  };

  const { occupants: shown, errors: formulaErrors } = useMemo(
    () => derivePresentedCells(occupants, gridConfig),
    [occupants, gridConfig]
  );
  const formulaErrorIds = useMemo(() => errorIdsFor(formulaErrors), [formulaErrors]);
  const presentation = gridConfig?.cell;
  const headers = gridConfig?.headers;
  const tiling = useMemo(() => getTiling((settings.tilingId as any) ?? "square8"), [settings.tilingId]);
  const offToggles = useMemo(
    () => ({ gravity: false, diagonal: false, sliding: false, wrapping: false, chainCapture: false }),
    []
  );

  const bounds: RangeRect = useMemo(() => {
    if (selection && selection.ranges.length > 0) {
      return normalizeRange(selection.ranges[selection.activeRange]);
    }
    return { q0: focus.q, r0: focus.r, q1: focus.q, r1: focus.r };
  }, [selection, focus]);

  const aggregates = useMemo(() => {
    const nums: number[] = [];
    for (const o of shown) {
      if (o.anchor.q < bounds.q0 || o.anchor.q > bounds.q1 || o.anchor.r < bounds.r0 || o.anchor.r > bounds.r1) continue;
      const v = (o.data as any)?.computed ?? (o.data as any)?.value;
      if (typeof v === "number" && Number.isFinite(v)) nums.push(v);
    }
    if (nums.length === 0) return null;
    const sum = nums.reduce((a, b) => a + b, 0);
    return { sum, avg: sum / nums.length, count: nums.length, min: Math.min(...nums), max: Math.max(...nums) };
  }, [shown, bounds]);

  const focused = shown.find(o => o.anchor.q === focus.q && o.anchor.r === focus.r);
  const focusedFormula = presentation?.formula ? resolveBinding(focused, presentation.formula).value : undefined;
  const focusedValue = presentation ? resolveBinding(focused, presentation.value).value : undefined;
  const focusedText = focusedFormula != null && String(focusedFormula) !== "" ? String(focusedFormula) : focusedValue == null ? "" : String(focusedValue);
  const bar = editingBar ?? focusedText;
  const focusedStyle = (focused?.data as any)?.style as Record<string, unknown> | undefined;
  const focusedFormat = ((focused?.data as any)?.format as string | undefined) ?? "plain";
  const frozen = (gridConfig?.freeze?.rows ?? 0) > 0 || (gridConfig?.freeze?.cols ?? 0) > 0;

  const resetActive = (
    next: Occupant[],
    w: number,
    h: number,
    nextBase: PlanBase,
    morphs: AppliedMorph[],
    nextSettings: SheetSettings
  ) => {
    patchTab({
      occupants: next,
      size: { w, h },
      past: [],
      future: [],
      base: nextBase,
      adopted: morphs,
      settings: nextSettings,
    });
    setErrors([]);
    setNotice(null);
    setFocus({ q: 0, r: 0 });
    setSelection(null);
    setSelectionVersion(v => v + 1);
  };

  const undo = () => {
    const r = undoHistory(past, future, stateOf(tab, occupants));
    if (!r.undone) return;
    patchTab({ past: r.past, future: r.future, occupants: r.state.occupants, size: { w: r.state.width, h: r.state.height } });
  };

  const redo = () => {
    const r = redoHistory(past, future, stateOf(tab, occupants));
    if (!r.redone) return;
    patchTab({ past: r.past, future: r.future, occupants: r.state.occupants, size: { w: r.state.width, h: r.state.height } });
  };

  const reloadFile = () =>
    resetActive(bootPlan?.occupants ?? seed.occupants, (bootPlan?.width ?? seed.width) as number, (bootPlan?.height ?? seed.height) as number, bootBase, bootPlan?.morphs ?? [], bootSettings);

  const newSheetDocument = (value?: unknown) => {
    const params = value && typeof value === "object" ? (value as { width?: number; height?: number; formulas?: boolean }) : {};
    const result = planInventory.instantiate("spreadsheet", {
      width: params.width ?? 5,
      height: params.height ?? 4,
      formulas: params.formulas ?? true,
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    const p = result.plan;
    const fresh = makeTab("Sheet 1", p.occupants ?? [], { w: p.width, h: p.height }, p.base, p.morphs, {
      tilingId: p.tilingId ?? "square8",
      presetId: p.presetId,
      ruleSet: p.ruleSet,
      regions: p.regions ?? [],
      interpretation: p.interpretation,
    });
    setTabs([fresh]);
    setActiveIdx(0);
    setFocus({ q: 0, r: 0 });
    setSelection(null);
    setSelectionVersion(v => v + 1);
    setNotice("Created a new sheet from the spreadsheet recipe.");
  };

  const save = () => {
    const res = buildSheetSave({ settings, size, occupants, base: tab.base, adopted: tab.adopted, past });
    if (!res.ok) {
      setErrors(res.errors);
      return;
    }
    const { plan, checkpointed } = res;
    if (checkpointed) {
      patchTab({ base: plan.base, adopted: [], past: [], future: [] });
      setNotice("Saved as a snapshot checkpoint: the undo history exceeded what the chain could reconstruct, so it restarted from this file. Note: save covers the active sheet only.");
    } else {
      setNotice(tabs.length > 1 ? "Saved the active sheet (other tabs are not in the plan file yet)." : null);
    }
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "spreadsheet.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const openFile = async (f: File) => {
    try {
      const parsed = parsePlan(await f.text());
      if (parsed.errors.length > 0) {
        setErrors(parsed.errors);
        return;
      }
      const res = loadPlan({ data: parsed.data, errors: [] }, null, { width: size.w, height: size.h });
      if (!res.ok) {
        setErrors(res.errors);
        return;
      }
      resetActive(
        res.plan.occupants ?? [],
        res.plan.width,
        res.plan.height,
        res.plan.base,
        res.plan.morphs,
        {
          tilingId: res.plan.tilingId ?? seed.tilingId,
          presetId: res.plan.presetId,
          ruleSet: res.plan.ruleSet,
          regions: res.plan.regions ?? seed.regions,
          interpretation: res.plan.interpretation,
        }
      );
    } catch (e: any) {
      setErrors([`Open error: ${e?.message ?? e}`]);
    }
  };

  // ---------- Toolbar operations (all framework sheet-ops) ----------
  const gridState = { occupants, width: size.w, height: size.h };
  const axisOp = (kind: "insertRows" | "insertCols" | "deleteRows" | "deleteCols", at: number, count: number) => {
    const fn = { insertRows, insertCols, deleteRows, deleteCols }[kind];
    const morphName = { insertRows: "sheet.insertRows", insertCols: "sheet.insertCols", deleteRows: "sheet.deleteRows", deleteCols: "sheet.deleteCols" }[kind];
    const res = fn(at, count, gridState);
    if (res === gridState) return;
    pushSized(res.occupants, { w: res.width, h: res.height }, morphName, at, count);
  };
  const stylePatch = (patch: Record<string, unknown>) => {
    if (!gridConfig) return;
    push(applyRangeStyle(occupants, bounds, patch as any, gridConfig));
  };
  const fillDown = () => {
    if (bounds.r1 === bounds.r0) { setNotice("Fill down: select the source row plus the rows below it first."); return; }
    push(fillRange(occupants, { q0: bounds.q0, r0: bounds.r0, q1: bounds.q1, r1: bounds.r0 }, bounds));
  };
  const fillRight = () => {
    if (bounds.q1 === bounds.q0) { setNotice("Fill right: select the source column plus the columns to its right first."); return; }
    push(fillRange(occupants, { q0: bounds.q0, r0: bounds.r0, q1: bounds.q0, r1: bounds.r1 }, bounds));
  };
  const toggleFreeze = () => {
    if (!gridConfig) return;
    const nextSettings: SheetSettings = {
      ...settings,
      interpretation: {
        ...settings.interpretation,
        grid: { ...gridConfig, freeze: frozen ? { rows: 0, cols: 0 } : { rows: 1, cols: 1 } },
      },
    };
    patchTab({ settings: nextSettings });
  };

  // ---------- Clipboard ----------
  const copySelection = (cut: boolean) => {
    if (!gridConfig) return;
    const text = copyRangeToTSV(occupants, bounds, { mode: "formulas", config: gridConfig });
    clipboardOrigin.current = { q: bounds.q0, r: bounds.r0 };
    void navigator.clipboard?.writeText(text).catch(() => setNotice("Copy needs clipboard permission in this browser."));
    if (cut) push(clearRange(occupants, bounds));
  };
  const pasteClipboard = () => {
    if (!gridConfig) return;
    void navigator.clipboard?.readText()
      .then(text => {
        if (!text) return;
        const next = pasteTSV(occupants, text, { q: bounds.q0, r: bounds.r0 }, {
          config: gridConfig,
          width: size.w,
          height: size.h,
          origin: clipboardOrigin.current ?? undefined,
        });
        push(next);
      })
      .catch(() => setNotice("Paste needs clipboard permission in this browser."));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isFormField = !!target && (target.tagName === "TEXTAREA" || target.getAttribute("aria-label") === "Formula bar" || target.getAttribute("aria-label") === "Sheet tab name");
      if ((e.ctrlKey || e.metaKey) && !isFormField) {
        const k = e.key.toLowerCase();
        if (k === "c") { e.preventDefault(); copySelection(false); return; }
        if (k === "x") { e.preventDefault(); copySelection(true); return; }
        if (k === "v") { e.preventDefault(); pasteClipboard(); return; }
      }
      if ((e.key === "Delete" || e.key === "Backspace") && selection && selectedCellCount(selection, size.w, size.h) > 1) {
        e.preventDefault();
        push(clearRange(occupants, bounds));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // Handlers read the latest tab state each render; re-register per render.
  });

  // ---------- CSV ----------
  const exportCSV = () => {
    if (occupants.length === 0) { setNotice("Nothing to export."); return; }
    const used: RangeRect = {
      q0: Math.min(...occupants.map(o => o.anchor.q)),
      r0: Math.min(...occupants.map(o => o.anchor.r)),
      q1: Math.max(...occupants.map(o => o.anchor.q)),
      r1: Math.max(...occupants.map(o => o.anchor.r)),
    };
    const text = copyRangeToCSV(occupants, used, { mode: "values", config: gridConfig });
    const blob = new Blob([text], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${tab.name.replace(/[^\w-]+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importCSV = async (f: File) => {
    try {
      const text = await f.text();
      const rows = parseDelimited(text, ",");
      const h = Math.max(1, Math.min(64, rows.length));
      const w = Math.max(1, Math.min(64, Math.max(...rows.map(r => r.length))));
      const cfg = gridConfig ?? bootSettings.interpretation?.grid;
      if (!cfg) return;
      const imported = pasteTSV([], text, { q: 0, r: 0 }, { config: cfg, width: w, height: h, delimiter: "," });
      const name = f.name.replace(/\.csv$/i, "") || "Imported";
      const fresh = makeTab(name, imported, { w, h }, { occupants: [], width: w, height: h }, [], settings);
      setTabs(ts => [...ts, fresh]);
      setActiveIdx(tabs.length);
      setFocus({ q: 0, r: 0 });
      setSelection(null);
      setSelectionVersion(v => v + 1);
    } catch (e: any) {
      setErrors([`CSV import error: ${e?.message ?? e}`]);
    }
  };

  // ---------- Tabs ----------
  const switchTab = (i: number) => {
    setActiveIdx(i);
    setFocus({ q: 0, r: 0 });
    setSelection(null);
    setEditingBar(null);
    setSelectionVersion(v => v + 1);
  };
  const addTab = () => {
    const result = planInventory.instantiate("spreadsheet", { width: 8, height: 10, formulas: true });
    if (!result.ok) { setErrors(result.errors); return; }
    const p = result.plan;
    const fresh = makeTab(`Sheet ${tabs.length + 1}`, p.occupants ?? [], { w: p.width, h: p.height }, p.base, p.morphs, {
      tilingId: p.tilingId ?? "square8",
      presetId: p.presetId,
      ruleSet: p.ruleSet,
      regions: p.regions ?? [],
      interpretation: p.interpretation,
    });
    setTabs(ts => [...ts, fresh]);
    switchTab(tabs.length);
  };
  const duplicateTab = () => {
    const copy = makeTab(`${tab.name} copy`, JSON.parse(JSON.stringify(tab.occupants)), { ...tab.size }, tab.base, tab.adopted, tab.settings);
    setTabs(ts => [...ts, copy]);
    switchTab(tabs.length);
  };
  const deleteTab = () => {
    if (tabs.length <= 1) return;
    const next = tabs.filter((_, i) => i !== activeIdx);
    setTabs(next);
    setActiveIdx(Math.max(0, activeIdx - 1));
    setSelectionVersion(v => v + 1);
  };

  const formulasOn = editingPolicies(gridConfig).expressions === "formula";
  const selectCell = (q: number, r: number) => {
    setFocus({ q, r });
    setEditingBar(null);
  };

  const statusValues: Record<string, string> = {
    size: `${size.w} × ${size.h}`,
    cells: String(occupants.length),
    history: `${past.length} undo · ${future.length} redo`,
    errors: String(formulaErrors.length),
    ...(aggregates
      ? {
          sum: fmtNum(aggregates.sum),
          avg: fmtNum(aggregates.avg),
          count: String(aggregates.count),
          min: fmtNum(aggregates.min),
          max: fmtNum(aggregates.max),
        }
      : {}),
  };

  const btn = "px-2 py-1 bg-[var(--bg-3)] border border-[var(--border)] text-[10px] text-[var(--text)] disabled:opacity-40";
  const chartRows = useMemo(() => {
    const rows: { r: number; values: { q: number; v: number }[] }[] = [];
    for (let r = bounds.r0; r <= bounds.r1; r++) {
      const values: { q: number; v: number }[] = [];
      for (let q = bounds.q0; q <= bounds.q1; q++) {
        const o = shown.find(x => x.anchor.q === q && x.anchor.r === r);
        const v = (o?.data as any)?.computed ?? (o?.data as any)?.value;
        if (typeof v === "number" && Number.isFinite(v)) values.push({ q, v });
      }
      if (values.length > 0) rows.push({ r, values });
    }
    return rows;
  }, [shown, bounds]);
  const chartMax = Math.max(1, ...chartRows.flatMap(row => row.values.map(x => Math.abs(x.v))));

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        aria-label="Open sheet plan"
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) openFile(f);
          e.target.value = "";
        }}
      />
      <input
        ref={csvRef}
        type="file"
        accept="text/csv,.csv"
        className="hidden"
        aria-label="Import CSV"
        onChange={e => {
          const f = e.target.files?.[0];
          if (f) importCSV(f);
          e.target.value = "";
        }}
      />
      <AppShell
        plan={shell}
        availability={{ undo: past.length > 0, redo: future.length > 0 }}
        errors={errors}
        notices={notice ? [notice] : []}
        status={statusValues}
        context={{
          newDocument: (_target, value) => newSheetDocument(value),
          openDocument: () => fileRef.current?.click(),
          saveDocument: () => save(),
          reloadDocument: () => reloadFile(),
          undo,
          redo,
        }}
        slots={{
          inspector: (
            <div className="text-[10px] text-[var(--text-dim)]">
              <h2 className="text-[11px] font-bold text-[var(--text)] m-0">Sheet</h2>
              <p className="mt-2 mb-1">{size.w} columns × {size.h} rows · tab “{tab.name}”</p>
              <p className="m-0">Formulas {formulasOn ? "on" : "off"} · {occupants.length} occupied</p>
              <p className="mt-2 mb-1">Selected {cellName(focus.q, focus.r)}</p>
              <p className="m-0 break-all">{focusedText || "empty"}</p>
              {aggregates && (
                <p className="mt-2 mb-1">
                  Selection: Sum {fmtNum(aggregates.sum)} · Avg {fmtNum(aggregates.avg)} · Count {aggregates.count} · Min {fmtNum(aggregates.min)} · Max {fmtNum(aggregates.max)}
                </p>
              )}
              <div className="mt-3">
                <div className="font-bold text-[var(--text)]">Conditional format</div>
                <label className="flex items-center gap-2 mt-1">
                  <input type="checkbox" checked={cfOn} onChange={e => setCfOn(e.currentTarget.checked)} />
                  Highlight values ≥
                  <input
                    type="number"
                    value={cfThreshold}
                    onChange={e => setCfThreshold(Number(e.currentTarget.value))}
                    className="w-16 px-1 py-0.5 bg-[var(--bg-3)] border border-[var(--border)] text-[10px]"
                    aria-label="Conditional format threshold"
                  />
                </label>
              </div>
              <div className="mt-3">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={chartOn} onChange={e => setChartOn(e.currentTarget.checked)} />
                  <span className="font-bold text-[var(--text)]">Chart of selection</span>
                </label>
                {chartOn && (
                  chartRows.length === 0 ? (
                    <p className="mt-1 mb-0">Select numeric cells to chart them.</p>
                  ) : (
                    <svg viewBox="0 0 220 130" className="w-full mt-1" role="img" aria-label="Bar chart of the current selection">
                      {chartRows.flatMap((row, ri) =>
                        row.values.map((x, vi) => {
                          const bw = 200 / Math.max(1, chartRows.reduce((m, r2) => Math.max(m, r2.values.length), 0));
                          const h = (Math.abs(x.v) / chartMax) * 90;
                          const palette = ["#7dd87d", "#78b4ff", "#ffb86b", "#ff8a6b", "#c792ea", "#82aaff"];
                          return (
                            <g key={`${row.r}-${x.q}`}>
                              <rect x={10 + (ri * chartRows[0].values.length + vi) * bw} y={100 - h} width={Math.max(2, bw - 2)} height={h} fill={palette[ri % palette.length]} />
                              <text x={10 + (ri * chartRows[0].values.length + vi) * bw} y={112} fontSize={7} fill="var(--text-faint)">{cellName(x.q, row.r)}</text>
                            </g>
                          );
                        })
                      )}
                      <line x1={10} y1={100} x2={210} y2={100} stroke="var(--border)" />
                    </svg>
                  )
                )}
                {chartOn && chartRows.length > 0 && (
                  <p className="mt-1 mb-0">One colour per row in the selection.</p>
                )}
              </div>
              {formulaErrors.length > 0 && (
                <div className="mt-3">
                  <div className="font-bold text-[#ff8a6b]">Formula errors</div>
                  {formulaErrors.map((err, i) => (
                    <div key={i} className="mt-1">• {err}</div>
                  ))}
                </div>
              )}
            </div>
          ),
          sheet: presentation ? (
            <div>
              <div className="flex flex-wrap items-center gap-1 mb-2" role="toolbar" aria-label="Sheet tools">
                <button className={btn} onClick={() => axisOp("insertRows", bounds.r0, 1)}>Row ↑</button>
                <button className={btn} onClick={() => axisOp("insertRows", bounds.r1 + 1, 1)}>Row ↓</button>
                <button className={btn} onClick={() => axisOp("insertCols", bounds.q0, 1)}>Col ←</button>
                <button className={btn} onClick={() => axisOp("insertCols", bounds.q1 + 1, 1)}>Col →</button>
                <button className={btn} onClick={() => axisOp("deleteRows", bounds.r0, bounds.r1 - bounds.r0 + 1)}>Del rows</button>
                <button className={btn} onClick={() => axisOp("deleteCols", bounds.q0, bounds.q1 - bounds.q0 + 1)}>Del cols</button>
                <span className="mx-1 text-[var(--border)]">|</span>
                <button className={btn} aria-pressed={!!focusedStyle?.bold} onClick={() => stylePatch({ bold: !focusedStyle?.bold })}><b>B</b></button>
                <button className={btn} aria-pressed={!!focusedStyle?.italic} onClick={() => stylePatch({ italic: !focusedStyle?.italic })}><i>I</i></button>
                <button className={btn} aria-pressed={!!focusedStyle?.underline} onClick={() => stylePatch({ underline: !focusedStyle?.underline })}><u>U</u></button>
                <button className={btn} onClick={() => stylePatch({ align: "left" })}>⇤</button>
                <button className={btn} onClick={() => stylePatch({ align: "center" })}>⇔</button>
                <button className={btn} onClick={() => stylePatch({ align: "right" })}>⇥</button>
                <select
                  aria-label="Number format"
                  value={focusedFormat}
                  onChange={e => {
                    if (!gridConfig) return;
                    const v = e.currentTarget.value;
                    push(setRangeFormat(occupants, bounds, v === "plain" ? null : (v as NumberFormatKind), gridConfig));
                  }}
                  className="px-1 py-1 bg-[var(--bg-3)] border border-[var(--border)] text-[10px] text-[var(--text)]"
                >
                  <option value="plain">Plain</option>
                  <option value="fixed2">1,234.56</option>
                  <option value="int">1,235</option>
                  <option value="currency">$1,234.56</option>
                  <option value="percent">42.00%</option>
                  <option value="date">Date</option>
                </select>
                <span className="mx-1 text-[var(--border)]">|</span>
                <button className={btn} onClick={fillDown}>Fill ↓</button>
                <button className={btn} onClick={fillRight}>Fill →</button>
                <button className={btn} onClick={() => push(sortRange(occupants, bounds, "asc", gridConfig))}>Sort ↑</button>
                <button className={btn} onClick={() => push(sortRange(occupants, bounds, "desc", gridConfig))}>Sort ↓</button>
                <button className={btn} aria-pressed={frozen} onClick={toggleFreeze}>{frozen ? "Unfreeze" : "Freeze"}</button>
                <span className="mx-1 text-[var(--border)]">|</span>
                <button className={btn} onClick={() => copySelection(false)}>Copy</button>
                <button className={btn} onClick={() => copySelection(true)}>Cut</button>
                <button className={btn} onClick={pasteClipboard}>Paste</button>
                <button className={btn} onClick={() => push(clearRange(occupants, bounds))}>Clear</button>
                <span className="mx-1 text-[var(--border)]">|</span>
                <button className={btn} onClick={exportCSV}>Export CSV</button>
                <button className={btn} onClick={() => csvRef.current?.click()}>Import CSV</button>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] text-[var(--text-faint)] w-10">{cellName(focus.q, focus.r)}</span>
                <input
                  aria-label="Formula bar"
                  value={bar}
                  onChange={e => setEditingBar(e.currentTarget.value)}
                  onBlur={() => {
                    commit(focus.q, focus.r, bar);
                    setEditingBar(null);
                  }}
                  onKeyDown={e => {
                    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                    e.preventDefault();
                    (e.currentTarget as HTMLInputElement).blur();
                  }}
                  className="flex-1 px-2 py-1 bg-[var(--bg-3)] border border-[var(--border)] text-[11px] outline-none"
                />
              </div>
              <GridViewport
                key={selectionVersion}
                occupants={occupants}
                setOccupants={setOccupantsStateShim}
                tiling={tiling}
                ruleSet={settings.ruleSet}
                width={size.w}
                height={size.h}
                toggles={offToggles}
                selectedId={null}
                setSelectedId={() => {}}
                validMoves={[]}
                setValidMoves={() => {}}
                currentTurn=""
                setCurrentTurn={() => {}}
                outcome={null}
                setOutcome={() => {}}
                chainCaptureActive={false}
                setChainCaptureActive={() => {}}
                logicTriples={[]}
                showRegions={false}
                setShowRegions={() => {}}
                showSpan={false}
                knightDemo={false}
                setKnightDemo={() => {}}
                chrome={false}
                presentation={presentation}
                headers={headers}
                editing={gridConfig?.editing}
                selectionMode={gridConfig?.selection?.mode ?? "range"}
                freeze={gridConfig?.freeze}
                columnWidths={gridConfig?.columnWidths}
                styleForCell={(_occ, shownValue) =>
                  cfOn && typeof shownValue === "number" && shownValue >= cfThreshold
                    ? { backgroundColor: "rgba(255,138,107,0.35)" }
                    : undefined
                }
                derivedOccupants={shown}
                derivedErrorIds={formulaErrorIds}
                derivedErrors={formulaErrors}
                onCellCommit={(q, r, text) => {
                  selectCell(q, r);
                  commit(q, r, text);
                }}
                onCellFocus={selectCell}
                onSelectionChange={sel => {
                  setSelection(sel);
                  const range = sel.ranges[sel.activeRange];
                  if (range) setFocus(range.active);
                }}
                presentationHint={formulasOn ? "Type a number, text, or =formula." : "Type a number or text."}
              />
              <div className="flex flex-wrap items-center gap-1 mt-2" role="tablist" aria-label="Sheets">
                {tabs.map((t, i) =>
                  renaming === t.id ? (
                    <input
                      key={t.id}
                      aria-label="Sheet tab name"
                      defaultValue={t.name}
                      autoFocus
                      onBlur={e => {
                        const name = e.currentTarget.value.trim();
                        setTabs(ts => ts.map((x, xi) => (xi === i && name ? { ...x, name } : x)));
                        setRenaming(null);
                      }}
                      onKeyDown={e => {
                        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      className="px-2 py-1 bg-[var(--bg-3)] border border-[var(--accent)] text-[10px] outline-none"
                    />
                  ) : (
                    <button
                      key={t.id}
                      role="tab"
                      aria-selected={i === activeIdx}
                      className={btn}
                      style={i === activeIdx ? { backgroundColor: "var(--bg-4)", fontWeight: 700 } : undefined}
                      onClick={() => switchTab(i)}
                      onDoubleClick={() => setRenaming(t.id)}
                      title="Click to switch, double-click to rename"
                    >
                      {t.name}
                    </button>
                  )
                )}
                <button className={btn} onClick={addTab} aria-label="Add sheet">+</button>
                <button className={btn} onClick={duplicateTab}>Duplicate</button>
                <button className={btn} onClick={deleteTab} disabled={tabs.length <= 1}>Delete sheet</button>
              </div>
            </div>
          ) : (
            <div className="text-[11px] text-[#ff8a6b]">
              This plan carries no cell presentation (interpretation.grid). Open a plan that configures one.
            </div>
          ),
        }}
      />
    </>
  );

  // GridViewport's game path speaks setState dispatch; the presentation
  // path never calls it (commits arrive via onCellCommit), so a dispatch
  // that routes functional updates through push() is a safe shim.
  function setOccupantsStateShim(next: React.SetStateAction<Occupant[]>) {
    const value = typeof next === "function" ? (next as (p: Occupant[]) => Occupant[])(occupants) : next;
    push(value);
  }
}
