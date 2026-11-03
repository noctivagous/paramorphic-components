// Spreadsheet app shell: menubar, undo history, save/open as morph-plan
// files. The sheet itself is SpreadsheetView; plans enter and leave through
// loadPlan, so a corrupt file can never become a broken board.
import React, { useRef, useState } from "react";
import { SpreadsheetView } from "../../../src/views/SpreadsheetView";
import { loadPlan, parsePlan, pushHistory, redoHistory, undoHistory } from "../../../src/framework";
import type { AppliedMorph, HistoryStep, Occupant } from "../../../src/framework";
import { PLANS } from "./plans";

const seed = PLANS[0].data as any;

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
  const [occupants, setOccupantsState] = useState<Occupant[]>(() => seed.occupants);
  const [size, setSize] = useState({ w: seed.width as number, h: seed.height as number });
  const [errors, setErrors] = useState<string[]>([]);
  const [past, setPast] = useState<HistoryStep[]>([]);
  const [future, setFuture] = useState<HistoryStep[]>([]);
  // Adopted file chain: written back out on save, but never enters the undo
  // stack, so every undoable step carries its own snapshot and morph together.
  const [adopted, setAdopted] = useState<AppliedMorph[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const dims = { width: size.w, height: size.h };

  const push = (next: Occupant[]) => {
    setPast(p => pushHistory(p, occupants, diffToMorph(occupants, next)));
    setFuture([]);
    setOccupantsState(next);
  };

  const reset = (next: Occupant[], w: number, h: number, morphs?: AppliedMorph[]) => {
    setPast([]);
    setFuture([]);
    setAdopted(morphs ?? []);
    setOccupantsState(next);
    setSize({ w, h });
    setErrors([]);
  };

  const undo = () => {
    const r = undoHistory(past, future, occupants, dims);
    if (!r.undone) return;
    setPast(r.past);
    setFuture(r.future);
    setOccupantsState(r.occupants);
  };

  const redo = () => {
    const r = redoHistory(past, future, occupants, dims);
    if (!r.redone) return;
    setPast(r.past);
    setFuture(r.future);
    setOccupantsState(r.occupants);
  };

  const reloadFile = () => reset(seed.occupants, seed.width, seed.height);

  const save = () => {
    const plan = {
      $schema: "paramorphic-plan/1",
      component: "Grid",
      tilingId: seed.tilingId,
      presetId: seed.presetId,
      width: size.w,
      height: size.h,
      ruleSet: seed.ruleSet,
      occupants,
      regions: seed.regions,
      turns: seed.ruleSet.turns,
      outcomes: seed.ruleSet.outcomes,
      interpretation: seed.interpretation,
      ...(() => {
        const stepped = past.map(e => e.morph).filter((m): m is AppliedMorph => m !== null);
        const morphs = [...adopted, ...stepped];
        return morphs.length > 0 ? { morphs } : {};
      })(),
    };
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
      reset(res.plan.occupants ?? [], res.plan.width, res.plan.height, res.plan.morphs);
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
      <div className="mt-3">
        <SpreadsheetView occupants={occupants} setOccupants={push} width={size.w} height={size.h} />
      </div>
    </div>
  );
}
