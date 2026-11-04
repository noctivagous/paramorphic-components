// Spreadsheet app shell: menubar, undo history, save/open as morph-plan
// files. The sheet renders through the shared GridViewport, driven by the
// plan's cell presentation; plans enter and leave through loadPlan, so a
// corrupt file can never become a broken board.
import React, { useMemo, useRef, useState } from "react";
import { GridViewport } from "../../../src/framework/components/GridViewport";
import { commitCellText, derivePresentedCells, editingPolicies, errorIdsFor, getTiling } from "../../../src/framework";
import { loadPlan, parsePlan, planInventory, pushHistory, redoHistory, undoHistory } from "../../../src/framework";
import type { AppliedMorph, HistoryStep, Occupant, PlanBase } from "../../../src/framework";
import { PLANS } from "./plans";
import { buildSheetSave, type SheetSettings } from "./save";

const seed = PLANS[0].data as any;

const seedSettings: SheetSettings = {
  tilingId: seed.tilingId,
  presetId: seed.presetId,
  ruleSet: seed.ruleSet,
  regions: seed.regions,
  interpretation: seed.interpretation,
};

// Boot through the same validated replay path as file open, so startup
// constructs the sheet from the stored base + morph chain — never by
// reading the cached snapshot directly.
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

/**
 * Describe one view commit as the morph that produced it, capturing the
 * prior cell as the undo frame. The view only ever writes or clears a single
 * cell per commit, so a diff that is not exactly one occupant change yields
 * null and the caller keeps the snapshot path for that step.
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

export default function App() {
  const [occupants, setOccupantsState] = useState<Occupant[]>(() => bootPlan?.occupants ?? seed.occupants);
  const [size, setSize] = useState(() => ({
    w: (bootPlan?.width ?? seed.width) as number,
    h: (bootPlan?.height ?? seed.height) as number,
  }));
  const [errors, setErrors] = useState<string[]>(() => bootErrors);
  const [past, setPast] = useState<HistoryStep[]>([]);
  const [future, setFuture] = useState<HistoryStep[]>([]);
  // Base the adopted chain replays over, plus the adopted file chain itself:
  // both are written back out on save, but neither enters the undo stack, so
  // every undoable step carries its own snapshot and morph together.
  const [base, setBase] = useState<PlanBase>(() => bootBase);
  const [adopted, setAdopted] = useState<AppliedMorph[]>(() => bootPlan?.morphs ?? []);
  // The opened file's settings travel with the session: save writes these,
  // never the seed's, so an opened plan round-trips its rules, tiling and
  // interpretation.
  const [settings, setSettings] = useState<SheetSettings>(() => bootSettings);
  const [notice, setNotice] = useState<string | null>(null);
  const [newWidth, setNewWidth] = useState(5);
  const [newHeight, setNewHeight] = useState(4);
  const [newFormulas, setNewFormulas] = useState(true);
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

  const { occupants: shown, errors: formulaErrors } = useMemo(() => derivePresentedCells(occupants, settings.interpretation?.grid), [occupants, settings.interpretation]);
  const formulaErrorIds = useMemo(() => errorIdsFor(formulaErrors), [formulaErrors]);
  const presentation = settings.interpretation?.grid?.cell;
  const headers = settings.interpretation?.grid?.headers;
  const tiling = useMemo(() => getTiling((settings.tilingId as any) ?? "square8"), [settings.tilingId]);
  const offToggles = useMemo(
    () => ({ gravity: false, diagonal: false, sliding: false, wrapping: false, chainCapture: false }),
    []
  );

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

  const newSheet = () => {
    const result = planInventory.instantiate("spreadsheet", { width: newWidth, height: newHeight, formulas: newFormulas });
    if (!result.ok) { setErrors(result.errors); return; }
    const p = result.plan;
    reset(p.occupants ?? [], p.width, p.height, p.base, p.morphs, {
      tilingId: p.tilingId ?? "square8", presetId: p.presetId, ruleSet: p.ruleSet,
      regions: p.regions ?? [], interpretation: p.interpretation,
    });
    setNotice("Created a new sheet from the spreadsheet recipe.");
  };

  const save = () => {
    // Settings come from the opened file; the chain is verified before
    // publishing, collapsing to an honest checkpoint when truncated.
    // An invalid current board is an error, never a file.
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

  const btn =
    "px-3 py-1 rounded-full text-[10px] border bg-[var(--bg-3)] border-[var(--border)] disabled:opacity-40";
  return (
    <div className="min-h-screen w-full bg-[var(--bg)] text-[var(--text)] p-4">
      <div className="mb-1 text-[10px] tracking-[0.18em] text-[var(--text-faint)]">
        SPREADSHEET — A PARAMORPHIC APP
      </div>
      <h1 className="text-[15px] font-bold">Sheet from a morph-plan</h1>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
        <label>Columns <input aria-label="New sheet columns" type="number" min={1} max={64} value={newWidth} onChange={e => setNewWidth(e.currentTarget.valueAsNumber)} className="w-14 bg-[var(--bg-3)] border border-[var(--border)] rounded px-1" /></label>
        <label>Rows <input aria-label="New sheet rows" type="number" min={1} max={64} value={newHeight} onChange={e => setNewHeight(e.currentTarget.valueAsNumber)} className="w-14 bg-[var(--bg-3)] border border-[var(--border)] rounded px-1" /></label>
        <label><input type="checkbox" checked={newFormulas} onChange={e => setNewFormulas(e.currentTarget.checked)} /> Formulas</label>
        <button className={btn} onClick={newSheet}>NEW SHEET</button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <span className="text-[10px] text-[var(--text-faint)]">File</span>
        <button className={btn} onClick={save}>
          SAVE ↓
        </button>
        <button className={btn} onClick={() => fileRef.current?.click()}>
          OPEN…
        </button>
        <button className={btn} onClick={reloadFile}>
          RELOAD FILE
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={e => {
            const f = e.target.files?.[0];
            if (f) openFile(f);
            e.target.value = "";
          }}
        />
        <span className="ml-2 text-[10px] text-[var(--text-faint)]">Edit</span>
        <button className={btn} disabled={past.length === 0} onClick={undo}>
          UNDO
        </button>
        <button className={btn} disabled={future.length === 0} onClick={redo}>
          REDO
        </button>
      </div>
      {errors.length > 0 && (
        <div className="mt-2 p-2 rounded-[8px] bg-[rgba(255,90,60,0.12)] border border-[#ff5a3c] text-[9px] text-[#ff8a6b]">
          <div className="font-bold">PLAN ERRORS</div>
          {errors.map((err, i) => (
            <div key={i} className="mt-1">
              • {err}
            </div>
          ))}
        </div>
      )}
      {notice && (
        <div className="mt-2 p-2 rounded-[8px] bg-[var(--lime-bg)] border border-[var(--border)] text-[9px] text-[var(--text-dim)]">
          {notice}
        </div>
      )}
      <div className="mt-3">
        {presentation ? (
          <GridViewport
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
            derivedOccupants={shown}
            derivedErrorIds={formulaErrorIds}
            derivedErrors={formulaErrors}
            onCellCommit={commit}
            presentationHint={editingPolicies(settings.interpretation?.grid).expressions === "formula" ? "Type a number, text, or =formula." : "Type a number or text."}
          />
        ) : (
          <div className="text-[11px] text-[#ff8a6b]">
            This plan carries no cell presentation (interpretation.grid). Open a plan that configures one.
          </div>
        )}
      </div>
    </div>
  );
}
