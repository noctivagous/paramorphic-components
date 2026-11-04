// Keyboard app shell: layout editing, undo history, save/open as morph-plan
// files. Keys enter and leave through the key.* vocabulary and loadPlan, so a
// corrupt file can never become a broken board. Live presses are session
// state: they flash and sound but are never recorded, saved, or undone.
//
// The keyboard renders through the shared GridViewport — merged span boxes
// for wide keys, plan-driven row stagger, no game chrome — so the irregular
// geometry is shared-renderer behavior, not a custom view. Presses and layout
// edits arrive as tap overrides; game logic never runs (moves are neutered).
import React, { useMemo, useRef, useState } from "react";
import { GridViewport, getTiling, loadPlan, parsePlan, pushHistory, redoHistory, undoHistory } from "../../../src/framework";
import { createToneTrigger } from "../../../src/framework/adapters/audio";
import type { AppliedMorph, HistoryStep, Occupant, PlanBase, Pos } from "../../../src/framework";
import { PLANS } from "./plans";
import { buildKeyboardSave, type KeyboardSettings } from "./save";

const seed = PLANS[0].data as any;

const seedSettings: KeyboardSettings = {
  tilingId: seed.tilingId,
  presetId: seed.presetId,
  ruleSet: seed.ruleSet,
  regions: seed.regions,
  interpretation: seed.interpretation,
};

// Boot through the same validated replay path as file open, so startup
// constructs the keyboard from the stored base + morph chain — never by
// reading the cached snapshot directly.
const boot = loadPlan({ data: seed, errors: [] }, null);
const bootPlan = boot.ok ? boot.plan : null;
const bootErrors: string[] = boot.ok ? [] : boot.errors;
const bootBase: PlanBase = bootPlan?.base ?? {
  occupants: seed.occupants ?? [],
  width: seed.width as number,
  height: seed.height as number,
};
const bootSettings: KeyboardSettings = bootPlan
  ? {
      tilingId: bootPlan.tilingId ?? seed.tilingId,
      presetId: bootPlan.presetId,
      ruleSet: bootPlan.ruleSet,
      regions: bootPlan.regions ?? seed.regions,
      interpretation: bootPlan.interpretation,
    }
  : seedSettings;

/**
 * Describe one layout edit as the key morph that produced it, capturing the
 * prior key as the undo frame. Anything but a single-key change yields null
 * and the caller keeps the snapshot path for that step.
 */
function diffToKeyMorph(prev: Occupant[], next: Occupant[]): AppliedMorph | null {
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
    return { name: "key.define", params: { occ: added[0] }, inverse: { prev: null } };
  }
  if (removed.length === 1) {
    return { name: "key.remove", params: { id: removed[0].id }, inverse: { prev: removed[0] } };
  }
  return {
    name: "key.define",
    params: { occ: changed[0] },
    inverse: { prev: p.get(changed[0].id) ?? null },
  };
}

const OFF_TOGGLES = { gravity: false, diagonal: false, sliding: false, wrapping: false, chainCapture: false };

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
  // never the seed's, so an opened plan round-trips its rules and view.
  const [settings, setSettings] = useState<KeyboardSettings>(() => bootSettings);
  const [notice, setNotice] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);
  const [lastPress, setLastPress] = useState<string>("none yet — click a key");
  const fileRef = useRef<HTMLInputElement>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const trigRef = useRef<ReturnType<typeof createToneTrigger> | null>(null);

  // Shared-viewport shell state. Game logic never runs: moves are neutered
  // below and taps are overridden, so turns/outcome stay at their seeds.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [validMoves, setValidMoves] = useState<Pos[]>([]);
  const [currentTurn] = useState("typist");
  const [outcome, setOutcome] = useState<string | null>(null);
  const [chainCaptureActive, setChainCaptureActive] = useState(false);
  const [showRegions, setShowRegions] = useState(false);
  const [knightDemo, setKnightDemo] = useState(false);

  const tiling = useMemo(() => getTiling((settings.tilingId as any) ?? "square8"), [settings.tilingId]);
  // Neutered rules: no moves, so untapped empty cells only deselect.
  const viewRules = useMemo(() => ({ ...settings.ruleSet, moves: [] }), [settings.ruleSet]);
  const stagger = settings.interpretation?.keyboard?.stagger as number[] | undefined;

  const stateOf = (list: Occupant[]) => ({ occupants: list, width: size.w, height: size.h });

  const push = (next: Occupant[]) => {
    setPast(p => pushHistory(p, stateOf(occupants), diffToKeyMorph(occupants, next)));
    setFuture([]);
    setOccupantsState(next);
  };

  // GridViewport speaks setState dispatch; taps resolve against the current
  // render's occupants and record through the key.* history path.
  const dispatchOccupants: React.Dispatch<React.SetStateAction<Occupant[]>> = action => {
    const next = typeof action === "function" ? (action as (p: Occupant[]) => Occupant[])(occupants) : action;
    push(next);
  };

  const tone = (freq: number) => {
    try {
      if (!ctxRef.current) {
        ctxRef.current = new AudioContext();
        trigRef.current = createToneTrigger(ctxRef.current);
      }
      trigRef.current?.(freq, 0.15, 0.6);
    } catch {
      /* headless or blocked audio stays silent */
    }
  };

  const press = (o: Occupant) => {
    const n = Number((o.data as any)?.pitch);
    tone(Number.isFinite(n) ? 220 * Math.pow(2, n / 12) : 440);
    setSelectedId(o.id);
    setLastPress(`${(o.data as any)?.label ?? o.id}`);
  };

  const addKey = (pos: Pos) => {
    const id = `key-${pos.q}-${pos.r}`;
    if (occupants.some(o => o.id === id)) return;
    push([
      ...occupants,
      { id, anchor: { ...pos }, span: [], type: "key", data: { label: `K${pos.q},${pos.r}`, pitch: (pos.r * 2 + pos.q) % 12 }, tags: [] },
    ]);
  };

  const reset = (
    next: Occupant[],
    w: number,
    h: number,
    nextBase: PlanBase,
    morphs: AppliedMorph[],
    nextSettings: KeyboardSettings
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
    setSelectedId(null);
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

  const save = () => {
    // Settings come from the opened file; the chain is verified before
    // publishing, collapsing to an honest checkpoint when truncated.
    // An invalid current board is an error, never a file.
    const res = buildKeyboardSave({ settings, size, occupants, base, adopted, past });
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
    a.download = "keyboard.json";
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

  const wide = occupants.filter(o => o.span.length > 0).length;
  const btn =
    "px-3 py-1 rounded-full text-[10px] border bg-[var(--bg-3)] border-[var(--border)] disabled:opacity-40";
  return (
    <div className="min-h-screen w-full bg-[var(--bg)] text-[var(--text)] p-4">
      <div className="mb-1 text-[10px] tracking-[0.18em] text-[var(--text-faint)]">
        KEYBOARD — A PARAMORPHIC APP
      </div>
      <h1 className="text-[15px] font-bold">Keys from a morph-plan</h1>
      <div className="mt-1 text-[10px] text-[var(--text-faint)]">
        {occupants.length} keys • {wide} wide • {size.w}×{size.h} grid • shared GridViewport, stagger from plan
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
        <button
          className={btn}
          onClick={() => setEdit(v => !v)}
        >
          {edit ? "DONE EDITING" : "EDIT LAYOUT"}
        </button>
        <span className="text-[10px] text-[var(--text-faint)]">
          {edit ? "tap empty cell adds • tap key removes" : `last press: ${lastPress}`}
        </span>
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
        <GridViewport
          occupants={occupants}
          setOccupants={dispatchOccupants}
          tiling={tiling}
          ruleSet={viewRules}
          width={size.w}
          height={size.h}
          toggles={OFF_TOGGLES}
          selectedId={selectedId}
          setSelectedId={setSelectedId}
          validMoves={validMoves}
          setValidMoves={setValidMoves}
          currentTurn={currentTurn}
          setCurrentTurn={() => {}}
          outcome={outcome}
          setOutcome={setOutcome}
          chainCaptureActive={chainCaptureActive}
          setChainCaptureActive={setChainCaptureActive}
          logicTriples={[]}
          showRegions={showRegions}
          setShowRegions={setShowRegions}
          showSpan={false}
          knightDemo={knightDemo}
          setKnightDemo={setKnightDemo}
          mergeSpans
          stagger={stagger}
          chrome={false}
          onOccupantTap={edit ? o => push(occupants.filter(x => x.id !== o.id)) : press}
          onEmptyTap={edit ? addKey : undefined}
        />
      </div>
    </div>
  );
}
