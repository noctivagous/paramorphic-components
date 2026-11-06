// GUI Builder app: AppShell window (palette / canvas / inspector slots from
// the gui-builder shell recipe), framework pieces for everything else —
// the control registry drives the palette and the canvas renderers, the
// schema Inspector edits props, gui.* morphs + the generic history factory
// provide undo/redo and the replayable save chain, and the layout
// resolvers position every node (canvas AND preview share them).
//
// Canvas interaction choice (mirrors the source builder): dragging a node
// by its body moves it; controls render inert (interactive=false) on the
// design canvas so drags never fight control gestures. Preview mode flips
// the same document to live controls through GuiRenderer.
// Persistence: Save/Open use the plan file (save.ts); the working document
// also autosaves to localStorage. The source artifact's records-API save
// has no counterpart in this repo and is not reproduced.
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  appKit,
  applyGuiMorph,
  applySpringsStruts,
  getControlDef,
  guiChildren,
  guiHistory,
  GuiRenderer,
  Inspector,
  listControlDefs,
  loadGuiDocument,
  resolvedRects,
  subtreeIds,
  type Device,
  type GuiDocument,
  type GuiHistoryStep,
  type GuiNode,
  type LayoutRect,
  type ScopedAppliedMorph,
} from "../../../src/framework";
import { AppShell } from "../../../src/framework/app-kit/Chrome";
import "../../../src/framework/app-kit/controls/controls.css";
import { buildGuiSave, exportSourceJson, parseGuiSave } from "./save";
import { starterDocument } from "./starter";

const shellRecipe = appKit.instantiate("gui-builder", { title: "GUI Builder" });
if (!shellRecipe.ok) throw new Error(shellRecipe.errors.join("; "));
const shell = shellRecipe.plan;

const LS_KEY = "paramorphic-gui-builder-doc";
const DEVICE_W: Record<Device, number> = { desktop: 960, tablet: 768, phone: 390 };
let idSeq = 0;
const genId = () => `n${Date.now().toString(36)}${(idSeq++).toString(36)}`;
const clone = (d: GuiDocument): GuiDocument => JSON.parse(JSON.stringify(d));

function bootDocument(): GuiDocument {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) { const loaded = loadGuiDocument(JSON.parse(raw)); if (loaded.ok) return loaded.doc; }
  } catch { /* starter below */ }
  return starterDocument();
}

type DragState = {
  id: string; mode: "move" | "resize"; startX: number; startY: number;
  orig: LayoutRect; parentStart: { w: number; h: number } | null; cur: LayoutRect;
};

export default function App() {
  const [doc, setDoc] = useState<GuiDocument>(bootDocument);
  const [base, setBase] = useState<GuiDocument>(() => clone(doc));
  const [chain, setChain] = useState<ScopedAppliedMorph[]>([]);
  const [past, setPast] = useState<GuiHistoryStep[]>([]);
  const [future, setFuture] = useState<GuiHistoryStep[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>(doc.device);
  const [preview, setPreview] = useState(false);
  const [snap, setSnap] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [previewValues, setPreviewValues] = useState<Record<string, Record<string, unknown>>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(doc)); } catch { /* storage full/blocked */ } }, [doc]);

  const selected = doc.nodes.find(n => n.id === selectedId) ?? null;
  const rects = useMemo(() => resolvedRects(doc, device), [doc, device]);
  const extent = useMemo(() => {
    let w = DEVICE_W[device], h = 560;
    for (const n of doc.nodes) { const r = rects.get(n.id); if (r) { w = Math.max(w, r.absX + r.w); h = Math.max(h, r.absY + r.h); } }
    return { w, h };
  }, [rects, doc, device]);

  /** Run morphs as ONE history step; append the applied morphs to the save chain. */
  const commit = (morphs: ScopedAppliedMorph[]) => {
    let cur = doc; const applied: ScopedAppliedMorph[] = [];
    for (const m of morphs) {
      const res = applyGuiMorph(cur, m);
      if (!res.ok) { setErrors(res.errors); return; }
      cur = res.doc; applied.push(res.applied);
    }
    setPast(p => guiHistory.push(p, clone(doc), applied.length === 1 ? applied[0] : null));
    setFuture([]); setChain(c => [...c, ...applied]); setDoc(cur); setErrors([]);
  };
  const commitDoc = (next: GuiDocument, morphs: ScopedAppliedMorph[]) => { // doc-level fields ride setDocument morphs
    setPast(p => guiHistory.push(p, clone(doc), morphs.length === 1 ? morphs[0] : null));
    setFuture([]); setChain(c => [...c, ...morphs]); setDoc(next); setErrors([]);
  };

  const undo = () => { const r = guiHistory.undo(past, future, doc); if (!r.undone) return; setPast(r.past); setFuture(r.future); setDoc(r.state); };
  const redo = () => { const r = guiHistory.redo(past, future, doc); if (!r.redone) return; setPast(r.past); setFuture(r.future); setDoc(r.state); };

  const resetTo = (next: GuiDocument, nextBase: GuiDocument, nextChain: ScopedAppliedMorph[]) => {
    setDoc(next); setBase(nextBase); setChain(nextChain); setPast([]); setFuture([]); setSelectedId(null); setDevice(next.device); setErrors([]);
  };

  const addNode = (type: string, at?: { x: number; y: number }) => {
    const def = getControlDef(type); if (!def) return;
    const parent = selected && getControlDef(selected.type)?.container ? selected : null;
    const rect: LayoutRect = { x: at ? Math.round(at.x) : parent ? 16 : 40, y: at ? Math.round(at.y) : parent ? 32 : 120, w: def.defaultSize.w, h: def.defaultSize.h };
    const layouts = { desktop: rect, tablet: { ...rect }, phone: { ...rect, w: Math.min(rect.w, 350) } };
    const node: GuiNode = {
      id: genId(), type, parentId: parent?.id ?? null, props: { ...def.defaultProps }, layouts,
      ...(def.container ? { layoutMode: "absolute" as const } : {}),
      ...(type === "stack" ? { layoutMode: "stack" as const, stack: { direction: "vertical" as const, spacing: 8, distribution: "leading" as const, alignment: "top" as const } } : {}),
      ...(type === "grid-container" ? { layoutMode: "grid" as const, gridCfg: { columns: 6, gutter: 8, rowHeight: 32, rowGutter: 8, baselineUnit: 8 } } : {}),
    };
    commit([{ name: "gui.addNode", params: { node } }]);
    setSelectedId(node.id);
  };

  const deleteSelected = () => { if (!selected) return; commit([{ name: "gui.removeNodes", params: { ids: subtreeIds(doc, selected.id) } }]); setSelectedId(null); };
  const duplicateSelected = () => {
    if (!selected) return;
    const ids = subtreeIds(doc, selected.id); const idMap = new Map<string, string>();
    const morphs: ScopedAppliedMorph[] = [];
    for (const id of ids) {
      const src = doc.nodes.find(n => n.id === id)!; const nid = genId(); idMap.set(id, nid);
      const copy: GuiNode = JSON.parse(JSON.stringify(src));
      copy.id = nid; copy.parentId = src.parentId ? (idMap.get(src.parentId) ?? src.parentId) : src.parentId;
      if (src.id === selected.id) for (const d of ["desktop", "tablet", "phone"] as Device[]) { copy.layouts[d] = { ...copy.layouts[d], x: copy.layouts[d].x + 16, y: copy.layouts[d].y + 16 }; }
      morphs.push({ name: "gui.addNode", params: { node: copy } });
    }
    commit(morphs); setSelectedId(idMap.get(selected.id) ?? null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedId) { e.preventDefault(); deleteSelected(); }
      if ((e.key === "d" || e.key === "D") && (e.metaKey || e.ctrlKey) && selectedId) { e.preventDefault(); duplicateSelected(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const save = () => {
    const plan = buildGuiSave({ base, chain, current: doc });
    if (plan.checkpointed) setNotice("Saved as a snapshot checkpoint: the morph chain could not reconstruct this document, so it restarts from the snapshot.");
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "gui-document.json"; a.click(); URL.revokeObjectURL(a.href);
  };
  const openFile = async (f: File) => {
    const res = parseGuiSave(await f.text());
    if (!res.ok) { setErrors(res.errors); return; }
    resetTo(res.doc, res.base, res.chain);
    setNotice(res.checkpointed ? "Opened a checkpointed plan (snapshot base)." : "Opened a replayable GUI plan.");
  };
  const exportJson = () => {
    const blob = new Blob([exportSourceJson(doc)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "gui-export.json"; a.click(); URL.revokeObjectURL(a.href);
  };

  // ----- canvas drag -----
  const canvasPoint = (e: React.PointerEvent | React.DragEvent) => {
    const box = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - box.left) / zoom, y: (e.clientY - box.top) / zoom };
  };
  const beginDrag = (e: React.PointerEvent, node: GuiNode, mode: "move" | "resize") => {
    if (preview || node.locked) return;
    e.stopPropagation(); setSelectedId(node.id);
    const parent = node.parentId ? doc.nodes.find(n => n.id === node.parentId) : null;
    const pr = parent ? rects.get(parent.id) : null;
    setDrag({ id: node.id, mode, startX: e.clientX, startY: e.clientY, orig: { ...node.layouts[device] }, parentStart: pr ? { w: pr.w, h: pr.h } : null, cur: { ...node.layouts[device] } });
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const moveDrag = (e: React.PointerEvent) => {
    if (!drag) return;
    const dx = (e.clientX - drag.startX) / zoom, dy = (e.clientY - drag.startY) / zoom;
    let cur: LayoutRect;
    if (drag.mode === "move") cur = { ...drag.orig, x: Math.round(drag.orig.x + dx), y: Math.round(drag.orig.y + dy) };
    else cur = { ...drag.orig, w: Math.max(8, Math.round(drag.orig.w + dx)), h: Math.max(8, Math.round(drag.orig.h + dy)) };
    if (snap) { cur.x = Math.round(cur.x / 8) * 8; cur.y = Math.round(cur.y / 8) * 8; }
    setDrag({ ...drag, cur });
  };
  const endDrag = (e: React.PointerEvent) => {
    if (!drag) return;
    const node = doc.nodes.find(n => n.id === drag.id); const finished = drag; setDrag(null);
    if (!node) return;
    const morphs: ScopedAppliedMorph[] = [{ name: "gui.setLayout", params: { id: node.id, device, rect: finished.cur, separate: doc.separateLayouts } }];
    if (finished.mode === "resize" && getControlDef(node.type)?.container && (node.layoutMode ?? "absolute") === "absolute") {
      for (const child of guiChildren(doc, node.id)) {
        if (!child.struts) continue;
        const next = applySpringsStruts(child.layouts[device], { w: finished.orig.w, h: finished.orig.h }, { w: finished.cur.w, h: finished.cur.h }, child.struts);
        if (JSON.stringify(next) !== JSON.stringify(child.layouts[device])) morphs.push({ name: "gui.setLayout", params: { id: child.id, device, rect: next, separate: doc.separateLayouts } });
      }
    }
    if (finished.mode === "move") {
      // Drop onto a container (smallest one under the node's centre that is
      // not the node itself, its descendant, or its current parent) parents it.
      const centre = { x: (rects.get(node.id)?.absX ?? 0) + finished.cur.x - node.layouts[device].x + finished.cur.w / 2, y: (rects.get(node.id)?.absY ?? 0) + finished.cur.y - node.layouts[device].y + finished.cur.h / 2 };
      const descendants = new Set(subtreeIds(doc, node.id));
      const candidates = doc.nodes.filter(n => getControlDef(n.type)?.container && !descendants.has(n.id) && n.id !== node.parentId)
        .map(n => ({ n, r: rects.get(n.id)! })).filter(({ r }) => r && centre.x >= r.absX && centre.x <= r.absX + r.w && centre.y >= r.absY && centre.y <= r.absY + r.h)
        .sort((a, b2) => a.r.w * a.r.h - b2.r.w * b2.r.h);
      const target = candidates[0];
      if (target) {
        const rel: LayoutRect = { ...finished.cur, x: Math.round(centre.x - target.r.absX - finished.cur.w / 2), y: Math.round(centre.y - target.r.absY - finished.cur.h / 2) };
        morphs[0] = { name: "gui.setLayout", params: { id: node.id, device, rect: rel, separate: doc.separateLayouts } };
        morphs.push({ name: "gui.reparent", params: { id: node.id, parentId: target.n.id } });
      }
    }
    if (morphs.length === 1 && JSON.stringify(finished.cur) === JSON.stringify(node.layouts[device]) && drag.mode !== "move") return;
    commit(morphs);
  };

  const renderNode = (node: GuiNode): React.ReactNode => {
    const r = rects.get(node.id); const def = getControlDef(node.type);
    if (!r || !def) return null;
    const Comp = def.component;
    const dragRect = drag && drag.id === node.id ? drag.cur : null;
    const absX = r.absX + (dragRect ? dragRect.x - node.layouts[device].x : 0);
    const absY = r.absY + (dragRect ? dragRect.y - node.layouts[device].y : 0);
    const w = dragRect ? dragRect.w : r.w, h = dragRect ? dragRect.h : r.h;
    return <div key={node.id} data-node={node.id}
      onPointerDown={e => beginDrag(e, node, "move")}
      style={{ position: "absolute", left: absX, top: absY, width: w, height: h, outline: selectedId === node.id ? "2px solid #4a8af4" : "1px solid rgba(255,255,255,0.08)", outlineOffset: 1, cursor: "move", opacity: node.visible === false ? 0.35 : 1 }}>
      <div style={{ width: "100%", height: "100%", pointerEvents: "none" }}>
        <Comp props={node.props} interactive={false} />
      </div>
      {selectedId === node.id && <div onPointerDown={e => beginDrag(e, node, "resize")} style={{ position: "absolute", right: -6, bottom: -6, width: 12, height: 12, background: "#4a8af4", borderRadius: 3, cursor: "nwse-resize", pointerEvents: "auto" }} />}
    </div>;
  };

  const families = useMemo(() => {
    const map = new Map<string, ReturnType<typeof listControlDefs>>();
    for (const d of listControlDefs()) { if (!map.has(d.family)) map.set(d.family, []); map.get(d.family)!.push(d); }
    return [...map.entries()];
  }, []);

  const patchNode = (patch: Partial<GuiNode>) => { if (selected) commit([{ name: "gui.setNode", params: { node: { ...selected, ...patch } } }]); };
  const layoutField = (key: keyof LayoutRect) => (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selected) return;
    const rect = { ...selected.layouts[device], [key]: Number(e.target.value) || 0 };
    commit([{ name: "gui.setLayout", params: { id: selected.id, device, rect, separate: doc.separateLayouts } }]);
  };

  return <>
    <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" aria-label="Open GUI plan" onChange={e => { const f = e.target.files?.[0]; if (f) void openFile(f); e.target.value = ""; }} />
    <AppShell plan={shell}
      availability={{ undo: past.length > 0, redo: future.length > 0 }}
      errors={errors} notices={notice ? [notice] : []}
      status={{ nodes: String(doc.nodes.length), selected: selected ? `${selected.type} (${selected.id})` : "—", device, history: `${past.length} undo · ${future.length} redo`, errors: String(errors.length) }}
      context={{
        newDocument: () => resetTo({ schema: "paramorphic-gui/1", device: "desktop", separateLayouts: true, nodes: [] }, { schema: "paramorphic-gui/1", device: "desktop", separateLayouts: true, nodes: [] }, []),
        openDocument: () => fileRef.current?.click(),
        saveDocument: () => save(),
        reloadDocument: () => { const s = starterDocument(); resetTo(s, clone(s), []); },
        undo, redo,
        setState: (target) => { if (target === "export") exportJson(); },
      }}
      slots={{
        palette: <div>
          <h2 style={{ fontSize: 11, margin: "0 0 6px" }}>Controls</h2>
          {families.map(([family, defs]) => <div key={family} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 9, letterSpacing: "0.14em", color: "var(--text-faint)", marginBottom: 4 }}>{family.toUpperCase()}</div>
            {defs.map(d => <button key={d.type} type="button" draggable
              onDragStart={e => e.dataTransfer.setData("text/gui-type", d.type)}
              onClick={() => addNode(d.type)}
              style={{ display: "flex", width: "100%", gap: 6, alignItems: "center", textAlign: "left", padding: "4px 6px", marginBottom: 3, background: "var(--bg-3)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", fontSize: 10, cursor: "pointer" }}>
              <span style={{ width: 16, textAlign: "center" }}>{d.icon ?? "▢"}</span>{d.label}</button>)}
          </div>)}
        </div>,
        canvas: <div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 8, fontSize: 10 }}>
            {(["desktop", "tablet", "phone"] as Device[]).map(d => <button key={d} type="button" onClick={() => { setDevice(d); commitDoc({ ...doc, device: d }, [{ name: "gui.setDocument", params: { device: d } }]); }} style={{ padding: "3px 10px", borderRadius: 999, border: "1px solid var(--border)", background: device === d ? "#24365a" : "var(--bg-3)", color: "var(--text)" }}>{d}</button>)}
            <label><input type="checkbox" checked={doc.separateLayouts} onChange={e => commitDoc({ ...doc, separateLayouts: e.target.checked }, [{ name: "gui.setDocument", params: { separateLayouts: e.target.checked } }])} /> Separate layouts</label>
            <label><input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)} /> Snap 8px</label>
            <label><input type="checkbox" checked={showGrid} onChange={e => setShowGrid(e.target.checked)} /> Grid</label>
            <label>Zoom <input type="range" min={0.4} max={1.6} step={0.1} value={zoom} onChange={e => setZoom(Number(e.target.value))} style={{ width: 70 }} /></label>
            <button type="button" onClick={() => setPreview(p => !p)} style={{ padding: "3px 10px", borderRadius: 999, border: "1px solid var(--border)", background: preview ? "#24365a" : "var(--bg-3)", color: "var(--text)" }}>{preview ? "Exit preview" : "Preview"}</button>
            <button type="button" disabled={!selected} onClick={duplicateSelected} style={{ padding: "3px 10px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--bg-3)", color: "var(--text)" }}>Duplicate</button>
            <button type="button" disabled={!selected} onClick={deleteSelected} style={{ padding: "3px 10px", borderRadius: 999, border: "1px solid var(--border)", background: "var(--bg-3)", color: "var(--text)" }}>Delete</button>
          </div>
          {preview
            ? <div style={{ background: "#121214", border: "1px solid var(--border)", borderRadius: 8, overflow: "auto" }}>
                <GuiRenderer document={doc} device={device} values={previewValues} onValueChange={(id, patch) => setPreviewValues(v => ({ ...v, [id]: { ...(v[id] ?? {}), ...patch } }))} />
              </div>
            : <div ref={canvasRef} role="application" aria-label="Design canvas"
                onPointerMove={moveDrag} onPointerUp={endDrag}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const t = e.dataTransfer.getData("text/gui-type"); if (t) { const p = canvasPoint(e); addNode(t, p); } }}
                onPointerDown={e => { if (e.target === e.currentTarget) setSelectedId(null); }}
                style={{ position: "relative", width: extent.w * zoom, height: extent.h * zoom, background: "#1a1a1c", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden",
                  backgroundImage: showGrid ? "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)" : undefined, backgroundSize: `${8 * zoom}px ${8 * zoom}px` }}>
                <div style={{ position: "absolute", inset: 0, transform: `scale(${zoom})`, transformOrigin: "0 0", width: extent.w, height: extent.h }}>
                  {doc.nodes.filter(n => n.visible !== false || true).map(n => renderNode(n))}
                </div>
              </div>}
        </div>,
        inspector: <div style={{ fontSize: 11 }}>
          <h2 style={{ fontSize: 11, margin: "0 0 6px" }}>Inspector</h2>
          {!selected && <p style={{ color: "var(--text-faint)" }}>Select a node on the canvas, or click a control in the palette to add one.</p>}
          {selected && <>
            <div style={{ marginBottom: 8 }}><b>{getControlDef(selected.type)?.label ?? selected.type}</b><div style={{ color: "var(--text-faint)", fontSize: 9 }}>{selected.id} · parent: {selected.parentId ?? "root"}</div></div>
            <Inspector schema={getControlDef(selected.type)?.propSchema ?? []} props={selected.props}
              onChange={(key, value) => commit([{ name: "gui.setProps", params: { id: selected.id, props: { [key]: value } } }])} />
            <h3 style={{ fontSize: 10, margin: "12px 0 4px" }}>Layout · {device}</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {(["x", "y", "w", "h"] as const).map(k => <label key={k} style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 10, color: "var(--text-dim)" }}>{k}
                <input type="number" value={Math.round(selected.layouts[device][k])} onChange={layoutField(k)} style={{ background: "var(--bg-3)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", padding: "3px 6px" }} /></label>)}
            </div>
            {selected.parentId && doc.nodes.find(n => n.id === selected.parentId)?.layoutMode === "grid" && <>
              <h3 style={{ fontSize: 10, margin: "12px 0 4px" }}>Grid placement</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {(["colStart", "colSpan", "rowStart", "rowSpan"] as const).map(k => <label key={k} style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 10, color: "var(--text-dim)" }}>{k}
                  <input type="number" value={selected.grid?.[k] ?? 0} onChange={e => patchNode({ grid: { colStart: 0, colSpan: 1, rowStart: 0, rowSpan: 1, ...(selected.grid ?? {}), [k]: Number(e.target.value) || 0 } })} style={{ background: "var(--bg-3)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", padding: "3px 6px" }} /></label>)}
              </div>
            </>}
            {getControlDef(selected.type)?.container && <>
              <h3 style={{ fontSize: 10, margin: "12px 0 4px" }}>Container layout</h3>
              <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 10, color: "var(--text-dim)" }}>Mode
                <select value={selected.layoutMode ?? "absolute"} onChange={e => patchNode({ layoutMode: e.target.value as GuiNode["layoutMode"] })} style={{ background: "var(--bg-3)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", padding: "3px 6px" }}>
                  <option value="absolute">absolute</option><option value="stack">stack</option><option value="grid">grid</option>
                </select></label>
              {(selected.layoutMode === "stack") && <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
                <label style={{ fontSize: 10, color: "var(--text-dim)" }}>Direction <select value={selected.stack?.direction ?? "vertical"} onChange={e => patchNode({ stack: { direction: e.target.value as "vertical" | "horizontal", spacing: 8, distribution: "leading", alignment: "top", ...(selected.stack ?? {}) } })} style={{ background: "var(--bg-3)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)" }}><option value="vertical">vertical</option><option value="horizontal">horizontal</option></select></label>
                <label style={{ fontSize: 10, color: "var(--text-dim)" }}>Distribution <select value={selected.stack?.distribution ?? "leading"} onChange={e => patchNode({ stack: { direction: "vertical", spacing: 8, alignment: "top", ...(selected.stack ?? {}), distribution: e.target.value as NonNullable<GuiNode["stack"]>["distribution"] } })} style={{ background: "var(--bg-3)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)" }}>{["leading", "center", "trailing", "spaceBetween", "fill"].map(o => <option key={o} value={o}>{o}</option>)}</select></label>
                <label style={{ fontSize: 10, color: "var(--text-dim)" }}>Spacing <input type="number" value={selected.stack?.spacing ?? 8} onChange={e => patchNode({ stack: { direction: "vertical", distribution: "leading", alignment: "top", ...(selected.stack ?? {}), spacing: Number(e.target.value) || 0 } })} style={{ background: "var(--bg-3)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", padding: "3px 6px", width: "100%" }} /></label>
                <label style={{ fontSize: 10, color: "var(--text-dim)" }}><input type="checkbox" checked={!!selected.stack?.spacingBaselineUnits} onChange={e => patchNode({ stack: { direction: "vertical", spacing: 8, distribution: "leading", alignment: "top", ...(selected.stack ?? {}), spacingBaselineUnits: e.target.checked } })} /> Spacing in baseline units</label>
              </div>}
              {(selected.layoutMode === "grid") && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 6 }}>
                {(["columns", "gutter", "rowHeight", "rowGutter"] as const).map(k => <label key={k} style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 10, color: "var(--text-dim)" }}>{k}
                  <input type="number" value={selected.gridCfg?.[k] ?? (k === "columns" ? 6 : 8)} onChange={e => patchNode({ gridCfg: { columns: 6, gutter: 8, rowHeight: 32, rowGutter: 8, baselineUnit: 8, ...(selected.gridCfg ?? {}), [k]: Number(e.target.value) || 0 } })} style={{ background: "var(--bg-3)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", padding: "3px 6px" }} /></label>)}
              </div>}
            </>}
            <h3 style={{ fontSize: 10, margin: "12px 0 4px" }}>Springs & struts</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, fontSize: 10 }}>
              {(["top", "bottom", "left", "right", "hSpring", "vSpring"] as const).map(k => <label key={k}><input type="checkbox" checked={!!selected.struts?.[k]}
                onChange={e => patchNode({ struts: { top: false, bottom: false, left: false, right: false, hSpring: false, vSpring: false, ...(selected.struts ?? {}), [k]: e.target.checked } })} /> {k}</label>)}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 10, fontSize: 10 }}>
              <label><input type="checkbox" checked={selected.visible !== false} onChange={e => patchNode({ visible: e.target.checked })} /> Visible</label>
              <label><input type="checkbox" checked={!!selected.locked} onChange={e => patchNode({ locked: e.target.checked })} /> Locked</label>
              {selected.parentId && <button type="button" onClick={() => commit([{ name: "gui.reparent", params: { id: selected.id, parentId: null } }])} style={{ background: "var(--bg-3)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text)", padding: "2px 8px" }}>Unparent</button>}
            </div>
          </>}
        </div>,
      }} />
  </>;
}
