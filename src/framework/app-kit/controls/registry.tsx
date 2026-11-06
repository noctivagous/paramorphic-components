// ---------- Control registry: data + React components, joined ----------
// The interactive contract is documented in ./types.ts: values live in
// props, edits are onChange(patch), interactive=false renders inert for the
// design canvas. Styling uses the .gui-* classes in controls.css, whose
// tokens reconcile the three source artifacts' shared pro theme
// (#121214 base, panel gradient #2d2e30 -> #1e1f21, well #0f0f10, accent
// #4a8af4) with the repo's shell variables where they exist.
//
// Components are intentionally compact renderers over the prop contract —
// several audio-lab pieces (curve editors, sequencers) render their value
// from numeric/encoded props and edit through drag or click on the graphic
// itself; full per-control chrome from the lab is not reproduced.
import React, { useCallback, useRef } from "react";
import type { ControlComponent, ControlDef, ControlProps } from "./types";
import { CONTROL_DATA, getControlData, listControlData } from "./registry-data";

export { getControlData, listControlData };
export type { ControlData } from "./registry-data";

const s = (v: unknown, d = "") => typeof v === "string" ? v : d;
const n = (v: unknown, d = 0) => typeof v === "number" && Number.isFinite(v) ? v : d;
const b = (v: unknown) => v === true;
const list = (v: unknown): string[] => Array.isArray(v) ? v.filter(x => typeof x === "string") as string[] : [];
const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));

/** Shared drag-to-change hook (the audio lab's useDrag1D, generalised). */
export function useDragValue(onDrag: (delta01: number, start: number) => void, interactive: boolean) {
  const state = useRef<{ y: number; x: number; start: number } | null>(null);
  const onDown = useCallback((e: React.PointerEvent, start: number) => {
    if (!interactive) return;
    state.current = { y: e.clientY, x: e.clientX, start };
    const move = (ev: PointerEvent) => {
      if (!state.current) return;
      const dy = (state.current.y - ev.clientY) / 150;
      const dx = (ev.clientX - state.current.x) / 150;
      onDrag(Math.abs(dy) > Math.abs(dx) ? dy : dx, state.current.start);
    };
    const up = () => { state.current = null; window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    e.preventDefault();
  }, [onDrag, interactive]);
  return onDown;
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="gui-ctl-label">{children}</div>;
}

/** Vertical-or-horizontal 0..100 drag strip used by several range controls. */
function DragStrip({ value, vertical, onChange, interactive, tone }: { value: number; vertical?: boolean; onChange?: ControlProps["onChange"]; interactive: boolean; tone?: string }) {
  const down = useDragValue((d, start) => onChange?.({ value: clamp(start + d * 100) }), interactive);
  return <div className={`gui-strip ${vertical ? "gui-strip-v" : ""}`} style={tone ? { ["--gui-tone" as any]: tone } : undefined}
    onPointerDown={e => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); const f = vertical ? 1 - (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width; onChange?.({ value: clamp(f * 100) }); down(e, clamp(f * 100)); }}>
    <div className="gui-strip-fill" style={vertical ? { height: `${clamp(value)}%` } : { width: `${clamp(value)}%` }} />
  </div>;
}

function KnobFace({ value, variant, size = 44 }: { value: number; variant: string; size?: number }) {
  const v = clamp(value);
  const angle = variant === "bipolar" ? -135 + (v / 100) * 270 : -135 + (v / 100) * 270;
  return <svg width={size} height={size} viewBox="0 0 44 44" className="gui-knob">
    <circle cx="22" cy="22" r="19" className="gui-knob-body" />
    {variant === "detented" && Array.from({ length: 11 }, (_, i) => { const a = (-135 + i * 27) * Math.PI / 180; return <line key={i} x1={22 + 16 * Math.sin(a)} y1={22 - 16 * Math.cos(a)} x2={22 + 19 * Math.sin(a)} y2={22 - 19 * Math.cos(a)} className="gui-knob-tick" />; })}
    <line x1="22" y1="22" x2={22 + 13 * Math.sin(angle * Math.PI / 180)} y2={22 - 13 * Math.cos(angle * Math.PI / 180)} className="gui-knob-pointer" />
  </svg>;
}

const COMPONENTS: Record<string, ControlComponent> = {
  "pro-button": ({ props, onChange, interactive }) => <button type="button" className={`gui-btn ${s(props.styleVariant) === "blue" ? "gui-btn-blue" : ""} ${s(props.styleVariant) === "danger" ? "gui-btn-danger" : ""}`} style={{ borderRadius: n(props.radius, 14) }} disabled={!interactive} onClick={() => onChange?.({})}>{s(props.title, "Button")}</button>,
  "icon-button": ({ props, interactive }) => <button type="button" className="gui-btn gui-icon-btn" style={{ borderRadius: n(props.radius, 6) }} disabled={!interactive}>{s(props.title, "★")}</button>,
  "segmented-control": ({ props, onChange, interactive }) => {
    const segs = list(props.segments); const multi = b(props.multi);
    const sel = multi ? list(props.selectedList).map(Number) : [n(props.selectedSegment)];
    return <div className="gui-segmented">{segs.map((seg, i) => <button type="button" key={i} disabled={!interactive} className={sel.includes(i) ? "gui-seg-on" : ""} onClick={() => {
      if (!interactive) return;
      if (multi) { const cur = list(props.selectedList).map(Number); onChange?.({ selectedList: (cur.includes(i) ? cur.filter(x => x !== i) : [...cur, i]).map(String) }); }
      else onChange?.({ selectedSegment: i });
    }}>{seg}</button>)}</div>;
  },
  "slider": ({ props, onChange, interactive }) => <div className="gui-ctl">{s(props.title) && <Label>{s(props.title)}</Label>}<DragStrip value={n(props.value, 42)} onChange={onChange} interactive={!!interactive} /></div>,
  "knob": ({ props, onChange, interactive }) => {
    const down = useDragValue((d, start) => onChange?.({ value: clamp(start + d * 100) }), !!interactive);
    return <div className="gui-ctl gui-ctl-center" onPointerDown={e => down(e, n(props.value, 65))}><KnobFace value={n(props.value, 65)} variant={s(props.variant, "standard")} />{s(props.title) && <Label>{s(props.title)}</Label>}</div>;
  },
  "toggle": ({ props, onChange, interactive }) => <button type="button" className={`gui-toggle ${b(props.checked) ? "gui-toggle-on" : ""}`} disabled={!interactive} onClick={() => onChange?.({ checked: !b(props.checked) })} aria-pressed={b(props.checked)}><span /></button>,
  "progress": ({ props }) => <div className="gui-strip"><div className="gui-strip-fill" style={{ width: `${clamp(n(props.value, 68))}%` }} /></div>,
  "text-label": ({ props }) => <div className="gui-text-label">{s(props.title, "Label Text")}</div>,
  "input-field": ({ props, onChange, interactive }) => <input className="gui-input" value={s(props.title)} placeholder={s(props.placeholder, "Enter text")} disabled={!interactive} onChange={e => onChange?.({ title: e.target.value })} />,
  "text-area": ({ props, onChange, interactive }) => <textarea className="gui-input gui-textarea" value={s(props.title)} placeholder={s(props.placeholder)} disabled={!interactive} onChange={e => onChange?.({ title: e.target.value })} />,
  "checkbox": ({ props, onChange, interactive }) => <label className="gui-check"><input type="checkbox" checked={b(props.checked)} disabled={!interactive} onChange={e => onChange?.({ checked: e.target.checked })} /><span>{s(props.title, "Option")}</span></label>,
  "panel": ({ props }) => <div className="gui-panel" style={{ borderRadius: n(props.radius, 8), opacity: n(props.opacity, 1) }}><div className="gui-panel-title">{s(props.title, "Panel")}</div></div>,
  "stack": ({ props }) => <div className="gui-panel gui-container-mark"><div className="gui-panel-title">{s(props.title, "Stack")} · stack</div></div>,
  "grid-container": ({ props }) => <div className="gui-panel gui-container-mark"><div className="gui-panel-title">{s(props.title, "Grid")} · grid</div></div>,
  "tab-bar": ({ props, onChange, interactive }) => <div className="gui-segmented gui-tabbar">{list(props.tabs).map((t, i) => <button type="button" key={i} disabled={!interactive} className={n(props.selectedTab) === i ? "gui-seg-on" : ""} onClick={() => onChange?.({ selectedTab: i })}>{t}</button>)}</div>,
  "toolbar-strip": ({ props }) => <div className="gui-toolbar-strip"><span>{s(props.title, "Toolbar")}</span></div>,
  "list-box": ({ props, onChange, interactive }) => <div className="gui-listbox">{s(props.title) && <div className="gui-listbox-title">{s(props.title)}</div>}{list(props.rows).map((r, i) => <button type="button" key={i} disabled={!interactive} className={`gui-listrow ${n(props.selected) === i ? "gui-listrow-on" : ""}`} onClick={() => onChange?.({ selected: i })}>{r}</button>)}</div>,
  "image-well": ({ props }) => <div className="gui-image-well"><span>▧</span><span>{s(props.title, "Drop Image")}</span></div>,
  "separator": () => <div className="gui-separator" />,
  "tall-slider": ({ props, onChange, interactive }) => <div className="gui-ctl gui-ctl-center"><DragStrip vertical value={n(props.value, 55)} onChange={onChange} interactive={!!interactive} />{s(props.title) && <Label>{s(props.title)}</Label>}</div>,
  "dual-range": ({ props, onChange, interactive }) => {
    const low = n(props.low, 20), high = n(props.high, 80);
    return <div className="gui-ctl">{s(props.title) && <Label>{s(props.title)} {Math.round(low)}–{Math.round(high)}</Label>}
      <div className="gui-dual">{[["low", low], ["high", high]].map(([k, v]) => <input key={k as string} type="range" min={0} max={100} value={v as number} disabled={!interactive} onChange={e => onChange?.({ [k as string]: Number(e.target.value) })} />)}</div></div>;
  },
  "fader-bank": ({ props, onChange, interactive }) => {
    const vals = s(props.values, "70,55,80,40").split(",").map(x => clamp(Number(x) || 0));
    return <div className="gui-faderbank">{vals.map((v, i) => <div key={i} className="gui-fader"><DragStrip vertical value={v} interactive={!!interactive} onChange={interactive ? p => { const next = [...vals]; next[i] = n((p as any).value, v); onChange?.({ values: next.map(x => Math.round(x)).join(",") }); } : undefined} /><span>{Math.round(v)}</span></div>)}</div>;
  },
  "xy-pad": ({ props, onChange, interactive }) => {
    const x = clamp(n(props.x, 35)), y = clamp(n(props.y, 60));
    return <div className="gui-xypad" onPointerDown={e => { if (!interactive) return; const r = e.currentTarget.getBoundingClientRect(); onChange?.({ x: clamp((e.clientX - r.left) / r.width * 100), y: clamp(100 - (e.clientY - r.top) / r.height * 100) }); }}>
      <div className="gui-xy-dot" style={{ left: `${x}%`, bottom: `${y}%` }} /></div>;
  },
  "value-scrub": ({ props, onChange, interactive }) => {
    const down = useDragValue((d, start) => onChange?.({ value: Math.round(start + d * 50) }), !!interactive);
    return <div className="gui-scrub" onPointerDown={e => down(e, n(props.value, 120))}>{s(props.title)} <b>{n(props.value, 120)}</b></div>;
  },
  "jog-wheel": ({ props, onChange, interactive }) => {
    const down = useDragValue((d, start) => onChange?.({ value: Math.round(start + d * 24) }), !!interactive);
    return <div className="gui-ctl gui-ctl-center" onPointerDown={e => down(e, n(props.value))}><KnobFace value={((n(props.value) % 100) + 100) % 100} variant="endless" size={56} />{s(props.title) && <Label>{s(props.title)}</Label>}</div>;
  },
  "led-button": ({ props, onChange, interactive }) => <button type="button" className="gui-ledwrap" disabled={!interactive} onClick={() => onChange?.({ checked: !b(props.checked) })}><span className="gui-led" style={{ background: b(props.checked) ? s(props.color, "#4a8af4") : "#26282c", boxShadow: b(props.checked) ? `0 0 10px ${s(props.color, "#4a8af4")}` : "none" }} /><span>{s(props.title)}</span></button>,
  "drum-pad": ({ props, onChange, interactive }) => <button type="button" className="gui-drumpad" disabled={!interactive} onPointerDown={() => onChange?.({ velocity: 100 })} onPointerUp={() => onChange?.({ velocity: 0 })}>{s(props.title, "Pad")}</button>,
  "rocker-switch": ({ props, onChange, interactive }) => <button type="button" className={`gui-rocker ${b(props.checked) ? "gui-rocker-on" : ""}`} disabled={!interactive} onClick={() => onChange?.({ checked: !b(props.checked) })}>{b(props.checked) ? "I" : "O"}</button>,
  "radio-group": ({ props, onChange, interactive }) => <div className="gui-radio">{s(props.title) && <Label>{s(props.title)}</Label>}{list(props.options).map((o, i) => <label key={i} className="gui-check"><input type="radio" checked={n(props.selected) === i} disabled={!interactive} onChange={() => onChange?.({ selected: i })} /><span>{o}</span></label>)}</div>,
  "matrix-2d": ({ props, onChange, interactive }) => <ToggleGrid props={props} onChange={onChange} interactive={!!interactive} cols={4} rows={4} field="cells" />,
  "mod-matrix": ({ props, onChange, interactive }) => <ToggleGrid props={props} onChange={onChange} interactive={!!interactive} cols={4} rows={3} field="cells" />,
  "matrix-buttons": ({ props, onChange, interactive }) => <div className="gui-matrixbtns">{Array.from({ length: 16 }, (_, i) => <button type="button" key={i} disabled={!interactive} className={n(props.selected) === i ? "gui-seg-on" : ""} onClick={() => onChange?.({ selected: i })}>{i + 1}</button>)}</div>,
  "dropdown": ({ props, onChange, interactive }) => <select className="gui-input" value={n(props.selected)} disabled={!interactive} onChange={e => onChange?.({ selected: Number(e.target.value) })}>{list(props.options).map((o, i) => <option key={i} value={i}>{o}</option>)}</select>,
  "step-sequencer": ({ props, onChange, interactive }) => {
    const pat = s(props.pattern, "x...x...x...x...");
    return <div className="gui-steps">{pat.split("").map((c, i) => <button type="button" key={i} disabled={!interactive} className={c === "x" ? "gui-step-on" : ""} onClick={() => { const next = pat.split(""); next[i] = c === "x" ? "." : "x"; onChange?.({ pattern: next.join("") }); }} />)}</div>;
  },
  "piano-roll": ({ props, onChange, interactive }) => <NoteGrid props={props} onChange={onChange} interactive={!!interactive} />,
  "clip-launcher": ({ props, onChange, interactive }) => <div className="gui-listbox">{list(props.rows).map((r, i) => <button type="button" key={i} disabled={!interactive} className={`gui-listrow ${n(props.playing) === i ? "gui-listrow-on" : ""}`} onClick={() => onChange?.({ playing: i })}>▶ {r}</button>)}</div>,
  "mini-piano": ({ props, onChange, interactive }) => {
    const whites = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 20];
    return <div className="gui-piano">{whites.map((note, i) => <button type="button" key={i} disabled={!interactive} className={`gui-key ${n(props.note) === note ? "gui-key-on" : ""}`} onPointerDown={() => onChange?.({ note })} />)}</div>;
  },
  "adsr-editor": ({ props }) => <Curve points={[[0, 100], [n(props.attack, 20) * 0.3, 0], [n(props.attack, 20) * 0.3 + n(props.decay, 30) * 0.3, 100 - n(props.sustain, 60)], [70, 100 - n(props.sustain, 60)], [70 + n(props.release, 40) * 0.3, 100]]} />,
  "eq-curve": ({ props }) => <Curve points={[[0, 100 - n(props.low, 55)], [33, 100 - n(props.mid, 70)], [66, 100 - n(props.high, 45)], [100, 100 - n(props.high, 45)]]} smooth />,
  "automation-curve": ({ props }) => <Curve points={[[0, 100 - n(props.p1, 20)], [33, 100 - n(props.p2, 70)], [66, 100 - n(props.p3, 40)], [100, 100 - n(props.p4, 85)]]} />,
  "lfo-editor": ({ props }) => <Lfo rate={n(props.rate, 30)} depth={n(props.depth, 65)} shape={s(props.shape, "sine")} />,
  "vu-meter": ({ props }) => <Meter value={n(props.value, 62)} vertical />,
  "bar-meter": ({ props }) => <Meter value={n(props.value, 45)} />,
  "wave-scrubber": ({ props, onChange, interactive }) => <Wave position={n(props.position, 25)} onChange={onChange} interactive={!!interactive} />,
};

function ToggleGrid({ props, onChange, interactive, cols, rows, field }: { props: Record<string, unknown>; onChange?: ControlProps["onChange"]; interactive: boolean; cols: number; rows: number; field: string }) {
  const cells = new Set(s(props[field]).split(";").map(x => x.trim()).filter(Boolean));
  return <div className="gui-togglegrid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>{Array.from({ length: cols * rows }, (_, i) => { const x = i % cols, y = Math.floor(i / cols); const key = `${x},${y}`; return <button type="button" key={i} disabled={!interactive} className={cells.has(key) ? "gui-cell-on" : ""} onClick={() => { const next = new Set(cells); if (next.has(key)) next.delete(key); else next.add(key); onChange?.({ [field]: [...next].join(";") }); }} />; })}</div>;
}

function NoteGrid({ props, onChange, interactive }: { props: Record<string, unknown>; onChange?: ControlProps["onChange"]; interactive: boolean }) {
  const notes = new Set(s(props.notes).split(";").map(x => x.trim()).filter(Boolean));
  return <div className="gui-togglegrid gui-notes" style={{ gridTemplateColumns: "repeat(8, 1fr)" }}>{Array.from({ length: 64 }, (_, i) => { const step = i % 8, row = Math.floor(i / 8); const key = `${step},${row}`; return <button type="button" key={i} disabled={!interactive} className={notes.has(key) ? "gui-cell-on" : ""} onClick={() => { const next = new Set(notes); if (next.has(key)) next.delete(key); else next.add(key); onChange?.({ notes: [...next].join(";") }); }} />; })}</div>;
}

function Curve({ points, smooth }: { points: Array<[number, number]>; smooth?: boolean }) {
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${p[0]},${clamp(p[1])}`).join(" ");
  return <svg className="gui-curve" viewBox="0 0 100 100" preserveAspectRatio="none"><path d={d} fill="none" className="gui-curve-line" />{points.map((p, i) => <circle key={i} cx={p[0]} cy={clamp(p[1])} r="2.4" className="gui-curve-dot" />)}</svg>;
}

function Lfo({ rate, depth, shape }: { rate: number; depth: number; shape: string }) {
  const pts: Array<[number, number]> = [];
  for (let x = 0; x <= 100; x += 4) {
    const t = x / 100 * Math.PI * (1 + rate / 12);
    let v = Math.sin(t);
    if (shape === "triangle") v = Math.asin(Math.sin(t)) * 2 / Math.PI;
    if (shape === "square") v = Math.sign(Math.sin(t));
    if (shape === "saw") v = ((t / Math.PI) % 2 + 2) % 2 - 1;
    pts.push([x, 50 - v * depth / 2]);
  }
  return <Curve points={pts} smooth />;
}

function Meter({ value, vertical }: { value: number; vertical?: boolean }) {
  const segs = 18; const lit = Math.round(clamp(value) / 100 * segs);
  return <div className={`gui-meter ${vertical ? "gui-meter-v" : ""}`}>{Array.from({ length: segs }, (_, i) => { const idx = vertical ? segs - 1 - i : i; return <span key={i} className={idx < lit ? (idx > segs * 0.8 ? "gui-seg-hot" : "gui-seg-lit") : ""} />; })}</div>;
}

function Wave({ position, onChange, interactive }: { position: number; onChange?: ControlProps["onChange"]; interactive: boolean }) {
  const bars = Array.from({ length: 40 }, (_, i) => 20 + 60 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6)));
  return <div className="gui-wave" onPointerDown={e => { if (!interactive) return; const r = e.currentTarget.getBoundingClientRect(); onChange?.({ position: clamp((e.clientX - r.left) / r.width * 100) }); }}>
    {bars.map((h, i) => <span key={i} style={{ height: `${h}%` }} className={i / 40 * 100 <= position ? "gui-wave-on" : ""} />)}
    <div className="gui-wave-head" style={{ left: `${clamp(position)}%` }} /></div>;
}

/** The full registry: data joined with components. A type missing either
    half is not registered (verify:gui enforces completeness both ways). */
export const CONTROL_REGISTRY: ControlDef[] = listControlData()
  .filter(d => COMPONENTS[d.type])
  .map(d => ({ ...d, component: COMPONENTS[d.type] }));

const registryByType = new Map(CONTROL_REGISTRY.map(d => [d.type, d]));
export function getControlDef(type: string): ControlDef | undefined { return registryByType.get(type); }
export function listControlDefs(): ControlDef[] { return CONTROL_REGISTRY; }
export function missingComponents(): string[] { return listControlData().filter(d => !COMPONENTS[d.type]).map(d => d.type); }
