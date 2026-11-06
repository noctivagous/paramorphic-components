// Supershape app: a control grid generated from the supershape.polar
// def's ports (portsToSchemaFields -> the app-kit Inspector), one relation
// binding, and a preview occupant hosting a Path guest. The app itself is
// state + derivation + an SVG: slider edits are session state, the outline
// re-derives through evaluatePlanRelations on every change, and presets
// commit a whole value set in one step.
//
// Riding (R4): the sampled outline becomes a TraversalPath via
// cellsAlongPoints; a cursor walked by an interval (time lives in the app,
// per §8.3) drives the rider occupant's t; path.ride derives its position;
// gate occupants standing on the outline fire through collectTriggers.
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Inspector,
  advanceCursor,
  cellsAlongPoints,
  collectTriggers,
  createCursor,
  evaluatePlanRelations,
  getRelationDef,
  portsToSchemaFields,
  type TraversalCursor,
} from "../../../src/framework";
import {
  PRESETS, PREVIEW_ID, RIDER_ID, RIDE_BINDING, SUPERSHAPE_BINDING,
  gateOccupants, riderOccupant, supershapeOccupants, DEFAULT_VALUES,
  type SupershapeValues,
} from "./plans";
import { buildSupershapeSave, parseSupershapeSave } from "./save";

const SCHEMA = portsToSchemaFields(getRelationDef("supershape.polar")!);
const GRID = 24;

export default function App() {
  const [values, setValues] = useState<SupershapeValues>(DEFAULT_VALUES);
  const [notice, setNotice] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Shape derivation: ctl values -> preview Path guest points.
  const shapeDerived = useMemo(
    () => evaluatePlanRelations(supershapeOccupants(values), [SUPERSHAPE_BINDING]),
    [values]
  );
  const preview = shapeDerived.occupants.find(o => o.id === PREVIEW_ID);
  const points = preview?.guest?.kind === "Path" ? preview.guest.state.points : [];
  const quarantine = shapeDerived.quarantined.get(SUPERSHAPE_BINDING.id);

  // Riding: outline -> cells -> cursor. A new outline restarts the ride.
  const cells = useMemo(() => cellsAlongPoints(points, GRID), [points]);
  const gates = useMemo(() => gateOccupants(cells), [cells]);
  const cursorRef = useRef<TraversalCursor | null>(null);
  const [cursor, setCursor] = useState<TraversalCursor | null>(null);
  const [playing, setPlaying] = useState(false);
  const [hits, setHits] = useState<Record<string, number>>({});
  const [lastHit, setLastHit] = useState<string | null>(null);
  useEffect(() => {
    const c = cells.length > 0 ? createCursor({ cells }) : null;
    cursorRef.current = c;
    setCursor(c);
    setPlaying(false);
    setHits({});
    setLastHit(null);
  }, [cells]);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const prev = cursorRef.current;
      if (!prev || prev.finished) { setPlaying(false); return; }
      const { cursor: next, entered } = advanceCursor(prev);
      cursorRef.current = next;
      setCursor(next);
      if (entered.length > 0) {
        const fired = collectTriggers(gates, entered);
        if (fired.length > 0) {
          setHits(h => {
            const copy = { ...h };
            for (const f of fired) copy[f.occupantId] = (copy[f.occupantId] ?? 0) + 1;
            return copy;
          });
          setLastHit(fired[0].occupantId);
        }
      }
      if (next.finished) setPlaying(false);
    }, 90);
    return () => clearInterval(id);
  }, [playing, gates]);

  const t = cursor && cells.length > 1 ? Math.max(0, cursor.index) / (cells.length - 1) : 0;
  const rideDerived = useMemo(
    () => evaluatePlanRelations([...supershapeOccupants(values), riderOccupant(t)], [SUPERSHAPE_BINDING, RIDE_BINDING]),
    [values, t]
  );
  const rider = rideDerived.occupants.find(o => o.id === RIDER_ID);
  const riderPoint = (rider?.data as any)?.point as { x: number; y: number } | undefined;

  const view = useMemo(() => {
    if (points.length === 0) return null;
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const extent = Math.max(1e-9, ...points.map(p => Math.max(Math.abs(p.x), Math.abs(p.y))));
    const W = 320, PAD = 10;
    const sx = (x: number) => PAD + ((x - minX) / Math.max(1e-9, maxX - minX)) * (W - 2 * PAD);
    const sy = (y: number) => PAD + ((y - minY) / Math.max(1e-9, maxY - minY)) * (W - 2 * PAD);
    const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(2)} ${sy(p.y).toFixed(2)}`).join(" ") + " Z";
    const cellToPoint = (q: number) => ((q / (GRID - 1)) * 2 - 1) * extent;
    return { sx, sy, d, cellToPoint };
  }, [points]);

  const resetRide = () => {
    const c = cells.length > 0 ? createCursor({ cells }) : null;
    cursorRef.current = c;
    setCursor(c);
    setPlaying(false);
    setHits({});
    setLastHit(null);
  };

  const save = () => {
    const blob = new Blob([buildSupershapeSave(values)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "supershape.json";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const open = (file: File) => {
    file.text().then(text => {
      const res = parseSupershapeSave(text);
      if (res.ok) { setValues(res.values); setNotice(`Opened ${file.name}`); }
      else setNotice(`Open failed: ${res.errors.join("; ")}`);
    });
  };

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: 20, fontFamily: "inherit" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 18, margin: 0 }}>Supershape</h1>
        <span style={{ fontSize: 11, color: "var(--text-faint)" }}>
          sliders generated from the <code>supershape.polar</code> ports · one binding · preview is a Path guest · rider walks it via <code>path.ride</code>
        </span>
        <span style={{ flex: 1 }} />
        <button onClick={save}>Save plan</button>
        <button onClick={() => fileRef.current?.click()}>Open plan</button>
        <input ref={fileRef} type="file" accept="application/json" style={{ display: "none" }}
          onChange={e => { const f = e.target.files?.[0]; if (f) open(f); e.target.value = ""; }} />
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
        {PRESETS.map(p => (
          <button key={p.name} onClick={() => setValues(p.values)}>{p.name}</button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16, marginTop: 16 }}>
        <div className="panel" style={{ padding: 12 }}>
          <Inspector
            schema={SCHEMA}
            props={values as unknown as Record<string, unknown>}
            onChange={(key, v) => setValues(prev => ({ ...prev, [key]: v }))}
          />
          <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 10 }}>
            n1 ≤ 0 or a/b = 0 quarantines the outline instead of crashing — clear it by moving the slider back into range.
          </div>
        </div>
        <div className="panel" style={{ padding: 12, display: "flex", flexDirection: "column", alignItems: "center" }}>
          {points.length > 0 && view ? (
            <svg viewBox="0 0 320 320" style={{ width: "100%", maxWidth: 420, aspectRatio: "1" }}>
              <path d={view.d} fill="rgba(74,138,244,0.12)" stroke="var(--accent)" strokeWidth={1.6} />
              {gates.map(g => (
                <circle key={g.id}
                  cx={view.sx(view.cellToPoint(g.anchor.q))} cy={view.sy(view.cellToPoint(g.anchor.r))}
                  r={lastHit === g.id ? 5 : 3.5}
                  fill={lastHit === g.id ? "#e8ff52" : "var(--bg-4)"} stroke="var(--accent)" strokeWidth={1} />
              ))}
              {riderPoint && (
                <circle cx={view.sx(riderPoint.x)} cy={view.sy(riderPoint.y)} r={5} fill="#e8ff52" stroke="#12131a" strokeWidth={1.2} />
              )}
            </svg>
          ) : (
            <div style={{ padding: 40, fontSize: 12, color: "var(--text-faint)" }}>
              {quarantine ? `Quarantined: ${quarantine}` : "No outline."}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10, flexWrap: "wrap", justifyContent: "center" }}>
            <button disabled={cells.length === 0 || cursor?.finished} onClick={() => setPlaying(p => !p)}>
              {playing ? "Pause rider" : cursor && cursor.index >= 0 ? "Resume rider" : "Ride the outline"}
            </button>
            <button disabled={cells.length === 0} onClick={resetRide}>Reset ride</button>
            <span style={{ fontSize: 10, color: "var(--text-faint)" }}>
              {cells.length > 0
                ? `step ${Math.max(0, cursor?.index ?? 0) + (cursor && cursor.index >= 0 ? 1 : 0)}/${cells.length}${cursor?.finished ? " • finished" : ""} • gates: ${gates.map(g => `${g.id} ×${hits[g.id] ?? 0}`).join("  ")}`
                : "no ride"}
            </span>
          </div>
          <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 8 }}>
            {points.length} sampled points{quarantine ? ` • quarantined: ${quarantine}` : ""}{notice ? ` • ${notice}` : ""}
          </div>
        </div>
      </div>
    </div>
  );
}
