// Spreadsheet app shell: menubar, undo history, save/open as morph-plan
// files. The sheet itself is SpreadsheetView; plans enter and leave through
// loadPlan, so a corrupt file can never become a broken board.
import React, { useRef, useState } from "react";
import { SpreadsheetView } from "../../../src/views/SpreadsheetView";
import { applyMorph, invertMorph, loadPlan, parsePlan } from "../../../src/framework";
import type { AppliedMorph, Occupant } from "../../../src/framework";
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
  const [past, setPast] = useState<Occupant[][]>([]);
  const [future, setFuture] = useState<Occupant[][]>([]);
  // The morph chain is the principled history; past/future snapshots stay as
  // the fallback for steps no morph covers (open, reload, unrecognized diffs).
  const [chain, setChain] = useState<AppliedMorph[]>(() => (seed.morphs as AppliedMorph[]) ?? []);
  const [redoChain, setRedoChain] = useState<AppliedMorph[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const push = (next: Occupant[]) => {
    const morph = diffToMorph(occupants, next);
    setPast(p => [...p.slice(-49), occupants]);
    if (morph) {
      setChain(c => [...c.slice(-49), morph]);
      setRedoChain([]);
    }
    setFuture([]);
    setOccupantsState(next);
  };

  const reset = (next: Occupant[], w: number, h: number, morphs?: AppliedMorph[]) => {
    setPast([]);
    setFuture([]);
    // Adopted chains travel with undo frames (see save); entries without an
    // undo frame still replay, but undo of a frameless setCell removes the cell.
    setChain(morphs ?? []);
    setRedoChain([]);
    setOccupantsState(next);
    setSize({ w, h });
    setErrors([]);
  };

  const undo = () => {
    if (past.length === 0) return;
    const top = chain[chain.length - 1];
    if (top) {
      const inverted = invertMorph({ occupants, width: size.w, height: size.h }, top);
      if (inverted) {
        setFuture(f => [occupants, ...f]);
        setRedoChain(r => [top, ...r]);
        setOccupantsState(inverted.occupants);
        setPast(p => p.slice(0, -1));
        setChain(c => c.slice(0, -1));
        return;
      }
      // Known morph but not invertible here: keep chain aligned, restore snapshot.
      setRedoChain(r => [top, ...r]);
      setChain(c => c.slice(0, -1));
    }
    setFuture(f => [occupants, ...f]);
    setOccupantsState(past[past.length - 1]);
    setPast(p => p.slice(0, -1));
  };

  const redo = () => {
    if (future.length === 0) return;
    const [top, ...restRedo] = redoChain;
    if (top) {
      const res = applyMorph({ occupants, width: size.w, height: size.h }, top);
      if (res.ok) {
        setPast(p => [...p, occupants]);
        setChain(c => [...c, top]);
        setRedoChain(restRedo);
        setFuture(f => f.slice(1));
        setOccupantsState(res.state.occupants);
        return;
      }
      setRedoChain(restRedo);
    }
    const [next, ...rest] = future;
    setPast(p => [...p, occupants]);
    setFuture(rest);
    setOccupantsState(next);
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
      ...(chain.length > 0 ? { morphs: chain } : {}),
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
