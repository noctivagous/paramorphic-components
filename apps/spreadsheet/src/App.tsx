// Spreadsheet app: GridViewport for cells, app-kit shell for the window.
// Menus, toolbar, dialogs, shortcuts, and status come from a replayed
// shell morph plan; the sheet itself still boots through loadPlan.
import React, { useMemo, useRef, useState } from "react";
import { GridViewport } from "../../../src/framework/components/GridViewport";
import {
  appKit,
  colName,
  commitCellText,
  derivePresentedCells,
  editingPolicies,
  errorIdsFor,
  getTiling,
  loadPlan,
  parsePlan,
  planInventory,
  pushHistory,
  redoHistory,
  resolveBinding,
  undoHistory,
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
  if (added.length + removed.length + changed.length !== 1) return null;
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

export default function App() {
  const [occupants, setOccupantsState] = useState<Occupant[]>(() => bootPlan?.occupants ?? seed.occupants);
  const [size, setSize] = useState(() => ({
    w: (bootPlan?.width ?? seed.width) as number,
    h: (bootPlan?.height ?? seed.height) as number,
  }));
  const [errors, setErrors] = useState<string[]>(() => bootErrors);
  const [past, setPast] = useState<HistoryStep[]>([]);
  const [future, setFuture] = useState<HistoryStep[]>([]);
  const [base, setBase] = useState<PlanBase>(() => bootBase);
  const [adopted, setAdopted] = useState<AppliedMorph[]>(() => bootPlan?.morphs ?? []);
  const [settings, setSettings] = useState<SheetSettings>(() => bootSettings);
  const [notice, setNotice] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ q: number; r: number }>({ q: 0, r: 0 });
  const [selectionVersion, setSelectionVersion] = useState(0);
  const [editingBar, setEditingBar] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const stateOf = (list: Occupant[]) => ({ occupants: list, width: size.w, height: size.h });

  const push = (next: Occupant[]) => {
    setPast(p => pushHistory(p, stateOf(occupants), diffToMorph(occupants, next)));
    setFuture([]);
    setOccupantsState(next);
  };

  const commit = (q: number, r: number, text: string) => {
    const config = settings.interpretation?.grid;
    if (!config) return;
    const next = commitCellText(occupants, q, r, text, config);
    if (next) push(next);
  };

  const { occupants: shown, errors: formulaErrors } = useMemo(
    () => derivePresentedCells(occupants, settings.interpretation?.grid),
    [occupants, settings.interpretation]
  );
  const formulaErrorIds = useMemo(() => errorIdsFor(formulaErrors), [formulaErrors]);
  const presentation = settings.interpretation?.grid?.cell;
  const headers = settings.interpretation?.grid?.headers;
  const tiling = useMemo(() => getTiling((settings.tilingId as any) ?? "square8"), [settings.tilingId]);
  const offToggles = useMemo(
    () => ({ gravity: false, diagonal: false, sliding: false, wrapping: false, chainCapture: false }),
    []
  );

  const focused = shown.find(o => o.anchor.q === focus.q && o.anchor.r === focus.r);
  const focusedFormula = presentation?.formula ? resolveBinding(focused, presentation.formula).value : undefined;
  const focusedValue = presentation ? resolveBinding(focused, presentation.value).value : undefined;
  const focusedText = focusedFormula != null && String(focusedFormula) !== "" ? String(focusedFormula) : focusedValue == null ? "" : String(focusedValue);
  const bar = editingBar ?? focusedText;

  const reset = (
    next: Occupant[],
    w: number,
    h: number,
    nextBase: PlanBase,
    morphs: AppliedMorph[],
    nextSettings: SheetSettings
  ) => {
    setPast([]);
    setFuture([]);
    setBase(nextBase);
    setAdopted(morphs);
    setSettings(nextSettings);
    setOccupantsState(next);
    setSize({ w, h });
    setErrors([]);
    setNotice(null);
    setFocus({ q: 0, r: 0 });
    setSelectionVersion(v => v + 1);
  };

  const undo = () => {
    const r = undoHistory(past, future, stateOf(occupants));
    if (!r.undone) return;
    setPast(r.past);
    setFuture(r.future);
    setOccupantsState(r.state.occupants);
  };

  const redo = () => {
    const r = redoHistory(past, future, stateOf(occupants));
    if (!r.redone) return;
    setPast(r.past);
    setFuture(r.future);
    setOccupantsState(r.state.occupants);
  };

  const reloadFile = () =>
    reset(bootPlan?.occupants ?? seed.occupants, (bootPlan?.width ?? seed.width) as number, (bootPlan?.height ?? seed.height) as number, bootBase, bootPlan?.morphs ?? [], bootSettings);

  const newSheet = (value?: unknown) => {
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
    reset(p.occupants ?? [], p.width, p.height, p.base, p.morphs, {
      tilingId: p.tilingId ?? "square8",
      presetId: p.presetId,
      ruleSet: p.ruleSet,
      regions: p.regions ?? [],
      interpretation: p.interpretation,
    });
    setNotice("Created a new sheet from the spreadsheet recipe.");
  };

  const save = () => {
    const res = buildSheetSave({ settings, size, occupants, base, adopted, past });
    if (!res.ok) {
      setErrors(res.errors);
      return;
    }
    const { plan, checkpointed } = res;
    if (checkpointed) {
      setBase(plan.base);
      setAdopted([]);
      setPast([]);
      setFuture([]);
      setNotice("Saved as a snapshot checkpoint: the undo history exceeded what the chain could reconstruct, so it restarted from this file.");
    } else {
      setNotice(null);
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
      reset(
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

  const formulasOn = editingPolicies(settings.interpretation?.grid).expressions === "formula";
  const selectCell = (q: number, r: number) => {
    setFocus({ q, r });
    setEditingBar(null);
  };

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
      <AppShell
        plan={shell}
        availability={{ undo: past.length > 0, redo: future.length > 0 }}
        errors={errors}
        notices={notice ? [notice] : []}
        status={{
          size: `${size.w} × ${size.h}`,
          cells: String(occupants.length),
          history: `${past.length} undo · ${future.length} redo`,
          errors: String(formulaErrors.length),
        }}
        context={{
          newDocument: (_target, value) => newSheet(value),
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
              <p className="mt-2 mb-1">{size.w} columns × {size.h} rows</p>
              <p className="m-0">Formulas {formulasOn ? "on" : "off"} · {occupants.length} occupied</p>
              <p className="mt-2 mb-1">Selected {cellName(focus.q, focus.r)}</p>
              <p className="m-0 break-all">{focusedText || "empty"}</p>
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
                setOccupants={setOccupantsState}
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
                editing={settings.interpretation?.grid?.editing}
                selectionMode={settings.interpretation?.grid?.selection?.mode ?? "range"}
                derivedOccupants={shown}
                derivedErrorIds={formulaErrorIds}
                derivedErrors={formulaErrors}
                onCellCommit={(q, r, text) => {
                  selectCell(q, r);
                  commit(q, r, text);
                }}
                onCellFocus={selectCell}
                presentationHint={formulasOn ? "Type a number, text, or =formula." : "Type a number or text."}
              />
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
}
