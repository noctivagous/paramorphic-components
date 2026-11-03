// Spreadsheet app shell: menubar, undo history, save/open as morph-plan
// files. The sheet itself is SpreadsheetView; plans enter and leave through
// loadPlan, so a corrupt file can never become a broken board.
import React, { useRef, useState } from "react";
import { SpreadsheetView } from "../../../src/views/SpreadsheetView";
import { loadPlan, parsePlan } from "../../../src/framework";
import type { Occupant } from "../../../src/framework";
import { PLANS } from "./plans";

const seed = PLANS[0].data as any;

export default function App() {
  const [occupants, setOccupantsState] = useState<Occupant[]>(() => seed.occupants);
  const [size, setSize] = useState({ w: seed.width as number, h: seed.height as number });
  const [errors, setErrors] = useState<string[]>([]);
  const [past, setPast] = useState<Occupant[][]>([]);
  const [future, setFuture] = useState<Occupant[][]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const push = (next: Occupant[]) => {
    setPast(p => [...p.slice(-49), occupants]);
    setFuture([]);
    setOccupantsState(next);
  };

  const reset = (next: Occupant[], w: number, h: number) => {
    setPast([]);
    setFuture([]);
    setOccupantsState(next);
    setSize({ w, h });
    setErrors([]);
  };

  const undo = () => {
    if (past.length === 0) return;
    setFuture(f => [occupants, ...f]);
    setOccupantsState(past[past.length - 1]);
    setPast(p => p.slice(0, -1));
  };

  const redo = () => {
    if (future.length === 0) return;
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
      reset(res.plan.occupants ?? [], res.plan.width, res.plan.height);
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
