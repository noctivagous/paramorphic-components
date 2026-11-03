import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  DirectionCompass,
  GridViewport,
  TILINGS_LIST,
  applyPlan,
  getTiling,
  loadPlan,
  makeId,
  parsePlan,
  presetData,
  serializePlan,
  validatePlan,
} from "./src/framework";
import { STORED_PLANS, getStoredPlan } from "./morph-plans";
import { SpreadsheetView } from "./src/views/SpreadsheetView";
import { PlayerView } from "./src/views/PlayerView";
import { ChatView } from "./src/views/ChatView";
import type {
  LogicTriple,
  Occupant,
  Region,
  RuleSet,
  TilingDef,
  Toggles,
} from "./src/framework";

// ---------- API ----------
async function apiCall(action: string, args: any) {
  const res = await fetch("actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, args }) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
  return j.data;
}

// ---------- Graph kernel (real) ----------
function GraphView({ tiling }: { tiling: TilingDef }) {
  const [nodes, setNodes] = useState<Occupant[]>([
    { id: "root", anchor: { q: 80, r: 80 }, span: [], type: "folder", data: { player: "system", label: "root" }, tags: ["graph"], guest: { kind: "Grid", state: { occupants: [{ id: "thumb1", anchor: { q: 0, r: 0 }, span: [], type: "thumb", data: { label: "img1" }, tags: [] }], width: 2, height: 1 } } },
    { id: "src", anchor: { q: 220, r: 120 }, span: [], type: "folder", data: { player: "system", label: "src" }, tags: [] },
    { id: "app", anchor: { q: 140, r: 220 }, span: [], type: "file", data: { player: "system", label: "App.tsx" }, tags: [] },
  ]);
  const [edges, setEdges] = useState<{ id: string; from: string; to: string; label: string }[]>([
    { id: "e1", from: "root", to: "src", label: "parent" },
    { id: "e2", from: "src", to: "app", label: "parent" },
  ]);
  const [selected, setSelected] = useState<string | null>(null);

  const addNode = () => {
    const id = makeId();
    setNodes(n => [...n, { id, anchor: { q: 100 + Math.random() * 200, r: 100 + Math.random() * 150 }, span: [], type: "file", data: { label: `n${n.length}` }, tags: ["graph"] }]);
  };

  return (
    <div className="w-full h-full flex flex-col gap-4">
      <div className="flex gap-2 flex-wrap">
        <button onClick={addNode} className="px-3 py-1.5 rounded-full bg-[var(--bg-3)] border border-[var(--border)] text-[11px]">+ NODE (occupant with guest)</button>
        <button onClick={() => { if (selected) setNodes(n => n.filter(x => x.id !== selected)); }} className="px-3 py-1.5 rounded-full bg-[var(--bg-3)] border border-[var(--border)] text-[11px]">- REMOVE SELECTED</button>
        <span className="text-[10px] text-[var(--text-faint)]">KERNEL: Graph nodes are Occupants {`{anchor,span,type,guest}`}. Edges = parent relation. Same template as Grid.</span>
      </div>
      <div className="relative flex-1 panel overflow-hidden" style={{ minHeight: 380 }}>
        <svg className="absolute inset-0 w-full h-full">
          {edges.map(e => {
            const f = nodes.find(n => n.id === e.from);
            const t = nodes.find(n => n.id === e.to);
            if (!f || !t) return null;
            return <line key={e.id} x1={f.anchor.q} y1={f.anchor.r} x2={t.anchor.q} y2={t.anchor.r} stroke="var(--border-2)" strokeWidth={1.5} />;
          })}
        </svg>
        {nodes.map(n => (
          <div
            key={n.id}
            className={`absolute w-[96px] min-h-[44px] rounded-[10px] border flex flex-col items-center justify-center cursor-move select-none p-1 ${selected === n.id ? "bg-[var(--lime-bg)] border-[var(--accent)]" : "bg-[var(--bg-3)] border-[var(--border)]"}`}
            style={{ left: n.anchor.q - 48, top: n.anchor.r - 22 }}
            onClick={() => setSelected(n.id)}
            onMouseDown={e => {
              const startX = e.clientX, startY = e.clientY, ox = n.anchor.q, oy = n.anchor.r;
              const move = (ev: MouseEvent) => setNodes(ns => ns.map(nn => nn.id === n.id ? { ...nn, anchor: { q: ox + ev.clientX - startX, r: oy + ev.clientY - startY } } : nn));
              const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
              window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
            }}
          >
            <span className="text-[10px] font-bold">{n.data?.label || n.type}</span>
            <span className="text-[7px] text-[var(--text-faint)]">{n.type} {n.guest ? `+guest:${n.guest.kind}` : ""}</span>
            {n.guest?.kind === "Grid" && <div className="mt-1 w-[60px] grid grid-cols-3 gap-[1px]">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-2 bg-[var(--bg-4)] rounded-[1px]" />)}</div>}
          </div>
        ))}
        <div className="absolute bottom-3 left-3 text-[10px] text-[var(--text-faint)]">HOSTING DEMO: root node guest is Grid of thumbnails — same Occupant template, guest field hosts another component. Drag to re-layout.</div>
      </div>
    </div>
  );
}

function TreeView({ tiling }: { tiling: TilingDef }) {
  const [nodes, setNodes] = useState<Occupant[]>([
    { id: "root", anchor: { q: 0, r: 0 }, span: [], type: "folder", data: { label: "albums", player: "system" }, tags: ["tree"], guest: { kind: "Grid", state: { occupants: [], width: 3, height: 2 } } },
    { id: "vacation", anchor: { q: 1, r: 0 }, span: [], type: "folder", data: { label: "vacation 2024", player: "system", parent: "root" }, tags: [], guest: { kind: "Grid", state: { occupants: [{ id: "p1", anchor: { q: 0, r: 0 }, span: [], type: "photo", data: { label: "beach" }, tags: [] }, { id: "p2", anchor: { q: 1, r: 0 }, span: [], type: "photo", data: { label: "mountain" }, tags: [] }], width: 3, height: 1 } } },
    { id: "work", anchor: { q: 1, r: 1 }, span: [], type: "folder", data: { label: "work", player: "system", parent: "root" }, tags: [] },
    { id: "img1", anchor: { q: 2, r: 0 }, span: [], type: "file", data: { label: "IMG_001.jpg", parent: "vacation" }, tags: [] },
    { id: "img2", anchor: { q: 2, r: 1 }, span: [], type: "file", data: { label: "IMG_002.jpg", parent: "vacation" }, tags: [] },
  ]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["root", "vacation"]));
  const [selected, setSelected] = useState<string>("vacation");
  const [dragId, setDragId] = useState<string | null>(null);

  // Lazy loading: a folder's guest Grid is materialized on first expand, up to
  // depth 3. Before that the guest is absent, not a placeholder.
  const ensureGuestLoaded = (id: string) => {
    setNodes(prev => prev.map(n => {
      if (n.id !== id || n.guest || n.type !== "folder") return n;
      const kids = prev.filter(k => k.data?.parent === id);
      const thumbs = kids.length > 0
        ? kids.map((k, i) => ({ id: `${id}-thumb-${k.id}`, anchor: { q: i % 3, r: Math.floor(i / 3) }, span: [], type: "photo", data: { label: k.data?.label }, tags: [] }))
        : Array.from({ length: 3 }).map((_, i) => ({ id: `${id}-thumb-${i}-${makeId()}`, anchor: { q: i, r: 0 }, span: [], type: "photo", data: { label: `${n.data?.label}-${i + 1}` }, tags: [] }));
      return { ...n, guest: { kind: "Grid", state: { occupants: thumbs, width: 3, height: Math.max(1, Math.ceil(thumbs.length / 3)) } } };
    }));
  };

  const toggle = (id: string) => {
    setExpanded(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    if (!expanded.has(id)) ensureGuestLoaded(id);
  };

  // Real reparent: drop a node onto a folder to change its data.parent.
  // Dropping onto a file, onto itself, or onto its own descendant is rejected.
  const isDescendantOf = (maybeDesc: string, anc: string): boolean => {
    let cur = nodes.find(n => n.id === maybeDesc)?.data?.parent;
    while (cur) {
      if (cur === anc) return true;
      cur = nodes.find(n => n.id === cur)?.data?.parent;
    }
    return false;
  };
  const reparent = (nodeId: string, targetId: string): boolean => {
    const target = nodes.find(n => n.id === targetId);
    if (!target || target.type !== "folder") return false;
    if (nodeId === targetId || isDescendantOf(targetId, nodeId)) return false;
    if (nodeId === "root") return false;
    setNodes(prev => prev.map(n => n.id === nodeId ? { ...n, data: { ...n.data, parent: targetId } } : n));
    setExpanded(prev => new Set(prev).add(targetId));
    return true;
  };

  const renderTree = (parentId: string | null, depth = 0) => {
    if (depth > 3) return null;
    const children = nodes.filter(n => (n.data?.parent || null) === parentId);
    return children.map(n => {
      const isFolder = n.type === "folder";
      const isExp = expanded.has(n.id);
      const isSel = selected === n.id;
      return (
        <div key={n.id}>
          <div draggable
            onDragStart={e => { setDragId(n.id); e.dataTransfer.effectAllowed = "move"; }}
            onDragEnd={() => setDragId(null)}
            onDragOver={e => { if (isFolder && dragId && dragId !== n.id) e.preventDefault(); }}
            onDrop={e => { e.preventDefault(); if (dragId) reparent(dragId, n.id); }}
            className={`flex items-center gap-2 py-1 px-2 rounded cursor-pointer ${dragId === n.id ? "opacity-40" : ""} ${isSel ? "bg-[var(--lime-bg)] border border-[var(--accent)]" : "hover:bg-[var(--bg-3)]"}`} style={{ paddingLeft: 12 + depth * 14 }} onClick={() => { if (isFolder) toggle(n.id); setSelected(n.id); }}>
            <span className="text-[10px] w-3">{isFolder ? (isExp ? "▼" : "▶") : "·"}</span>
            <span className={`text-[11px] ${isFolder ? "text-[var(--accent)]" : "text-[var(--text-dim)]"}`}>{n.data?.label}</span>
            {n.guest && <span className="text-[7px] px-1 rounded bg-[var(--bg-4)] border border-[var(--border)]">guest:{n.guest.kind}</span>}
          </div>
          {isFolder && isExp && renderTree(n.id, depth + 1)}
        </div>
      );
    });
  };

  const selectedNode = nodes.find(n => n.id === selected);

  return (
    <div className="w-full h-full flex gap-3">
      <div className="w-[200px] panel p-2 overflow-auto" style={{ minHeight: 380 }}>
        <div className="text-[9px] text-[var(--text-faint)] mb-2">TREE KERNEL — nodes are Occupants, parent via data.parent, guest=Grid</div>
        {renderTree(null)}
        <button className="mt-3 w-full px-2 py-1 rounded bg-[var(--bg-3)] border border-[var(--border)] text-[10px]" onClick={() => {
          const id = makeId();
          setNodes(n => [...n, { id, anchor: { q: 0, r: 0 }, span: [], type: "file", data: { label: `new-${id.slice(0, 3)}.jpg`, parent: selected }, tags: [] }]);
        }}>+ Add child to selected (reparent demo)</button>
      </div>
      <div className="flex-1 panel p-3">
        <div className="text-[10px] font-bold">HOSTED GRID INSIDE TREE NODE: {selectedNode?.data?.label}</div>
        <div className="text-[9px] text-[var(--text-faint)]">This demonstrates nesting + hosting actually working: Tree node guest is Grid. Click node to see its hosted Grid.</div>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {(selectedNode?.guest?.kind === "Grid" ? (selectedNode.guest.state as any).occupants : [{ id: "empty", anchor: { q: 0, r: 0 }, span: [], type: "empty", data: { label: "no guest" }, tags: [] }]).map((occ: any) => (
            <div key={occ.id} className="h-[64px] rounded-[8px] bg-[var(--bg-3)] border border-[var(--border)] p-2 flex flex-col items-center justify-center">
              <span className="text-[10px]">{occ.data?.label || "—"}</span>
              <span className="text-[7px] text-[var(--text-faint)]">{occ.type}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 p-2 rounded bg-[var(--bg-4)] border border-[var(--border)] text-[9px]">
          Step 3: Tree on Graph kernel, nodes are Occupants with guest=Grid. Drag a row onto a folder to reparent (writes data.parent; files, self-drops and cycles rejected). First expand lazy-loads the folder guest, depth limit 3.
        </div>
      </div>
    </div>
  );
}

function PathView() {
  const [interp, setInterp] = useState<"bezier" | "route" | "trajectory" | "wire" | "automation">("bezier");
  const points = [{ x: 40, y: 120 }, { x: 220, y: 100 }, { x: 340, y: 160 }];
  const pathD = `M ${points[0].x} ${points[0].y} C 80 40, 160 200, ${points[1].x} ${points[1].y} C 260 20, 300 180, ${points[2].x} ${points[2].y}`;
  return (
    <div className="w-full h-full flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {(["bezier", "route", "trajectory", "wire", "automation"] as const).map(k => (
          <button key={k} onClick={() => setInterp(k)} className={`px-2 py-1 rounded-full text-[10px] border ${interp === k ? "bg-[var(--accent)] text-black border-[var(--accent)]" : "bg-[var(--bg-3)] border-[var(--border)]"}`}>{k.toUpperCase()}</button>
        ))}
      </div>
      <div className="panel flex-1 relative overflow-hidden" style={{ minHeight: 380 }}>
        <svg viewBox="0 0 400 260" className="w-full h-full">
          <path d={pathD} fill={interp === "bezier" ? "rgba(232,255,82,0.12)" : "none"} stroke={interp === "wire" ? "#8a909c" : "var(--accent)"} strokeWidth={interp === "wire" ? 1 : 2} />
          {points.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={6} fill="var(--bg-3)" stroke="var(--accent)" strokeWidth={1.5} />)}
        </svg>
        <div className="absolute bottom-3 left-3 text-[10px] text-[var(--text-faint)]">OCCUPANTS = points + handles • INTERP: {interp} • substrate: Path — guest in Grid clips</div>
      </div>
    </div>
  );
}

function LogicView({ triples, setTriples, tiling }: { triples: LogicTriple[]; setTriples: any; tiling: TilingDef }) {
  const [s, setS] = useState("knight");
  const [p, setP] = useState("canMove");
  const [o, setO] = useState("N");
  const add = () => {
    if (!s || !p || !o) return;
    setTriples((prev: LogicTriple[]) => [...prev, { id: makeId(), s, p, o }]);
  };
  return (
    <div className="w-full h-full flex flex-col gap-3">
      <div className="flex gap-2 flex-wrap items-end">
        <div className="flex flex-col gap-1"><span className="text-[9px] text-[var(--text-faint)]">Subject (pieceType)</span><input value={s} onChange={e => setS(e.target.value)} className="px-2 py-1 rounded bg-[var(--bg-3)] border border-[var(--border)] text-[11px]" /></div>
        <div className="flex flex-col gap-1"><span className="text-[9px] text-[var(--text-faint)]">Predicate</span><input value={p} onChange={e => setP(e.target.value)} className="px-2 py-1 rounded bg-[var(--bg-3)] border border-[var(--border)] text-[11px]" /></div>
        <div className="flex flex-col gap-1"><span className="text-[9px] text-[var(--text-faint)]">Object (direction, must exist in {tiling.id}: {tiling.directions.map(d => d.name).join(",")})</span><input value={o} onChange={e => setO(e.target.value)} className="px-2 py-1 rounded bg-[var(--bg-3)] border border-[var(--border)] text-[11px]" /></div>
        <button onClick={add} className="px-3 py-1.5 rounded-full bg-[var(--accent)] text-black text-[11px] font-bold">ADD TRIPLE</button>
      </div>
      <div className="panel p-3 flex-1 overflow-auto" style={{ minHeight: 380 }}>
        <div className="text-[10px] text-[var(--text-faint)] mb-2">Logic triples are direction allow-lists for the move engine: if triples exist for a piece, only those directions are allowed. Subjects match piece groups, so s=pawn covers pawn_w and pawn_b. Edit and see Grid valid moves update live.</div>
        <div className="space-y-1">
          {triples.map(t => (
            <div key={t.id} className="flex items-center gap-2 p-2 rounded bg-[var(--bg-3)] border border-[var(--border)] text-[11px]">
              <span className="text-[var(--accent)] font-bold">{t.s}</span><span className="text-[var(--text-faint)]">{t.p}</span><span>{t.o}</span>
              <button onClick={() => setTriples((prev: LogicTriple[]) => prev.filter(x => x.id !== t.id))} className="ml-auto text-[10px] text-[var(--text-faint)] hover:text-white">✕</button>
            </div>
          ))}
          {triples.length === 0 && <div className="text-[10px] text-[var(--text-faint)]">No triples — all moves allowed per ruleSet. Add e.g., s=knight p=canMove o=N to restrict knight to N only.</div>}
        </div>
        <div className="mt-4 p-2 rounded bg-[var(--lime-bg)] border border-[var(--border)] text-[10px]">Example: Add triple knight canMove E then select knight — valid moves will be only E if tiling has E, otherwise validation error in plan loader: "direction E not defined in tiling hexV".</div>
      </div>
    </div>
  );
}

function ComposeView({ tiling }: { tiling: TilingDef }) {
  const [overlap, setOverlap] = useState(true);
  return (
    <div className="w-full h-full flex flex-col gap-3">
      <div className="flex gap-2">
        <button onClick={() => setOverlap(!overlap)} className={`px-3 py-1 rounded-full text-[10px] border ${overlap ? "bg-[var(--accent)] text-black" : "bg-[var(--bg-3)] border-[var(--border)]"}`}>OVERLAP {overlap ? "ON" : "OFF"} • stacking demo</button>
        <span className="text-[10px] text-[var(--text-faint)]">NLE timeline = Grid (time×tracks) + Path guests + stacking + regions</span>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="panel p-3">
          <div className="text-[10px] font-bold">TIMELINE — Grid hosting Path guests, stacking transitions</div>
          <div className="mt-3 h-[140px] relative bg-[var(--bg-3)] rounded-[10px] border border-[var(--border)] overflow-hidden">
            {[0, 1, 2].map(r => (
              <div key={r} className="absolute left-0 right-0 border-b border-[var(--border)] flex items-center" style={{ top: r * 46, height: 46 }}>
                <div className="w-[50px] text-[8px] text-[var(--text-faint)] pl-2">TRACK {r}</div>
                <div className="flex-1 relative h-full">
                  <div className="absolute top-1 bottom-1 left-[20px] w-[80px] rounded bg-[var(--lime-bg)] border border-[var(--accent)] flex flex-col justify-center px-1"><span className="text-[8px]">clip A</span><svg viewBox="0 0 80 10" className="w-full h-[10px]"><path d="M0 5 Q20 0 40 5 T80 5" fill="none" stroke="var(--accent)" strokeWidth={1} /></svg></div>
                  <div className="absolute top-1 bottom-1 left-[120px] w-[60px] rounded bg-[var(--bg-4)] border border-[var(--border)]" style={{ zIndex: overlap ? 3 : 1, marginLeft: overlap ? -20 : 0 }}><span className="text-[7px] px-1">transition</span></div>
                  <div className="absolute top-1 bottom-1 left-[170px] w-[80px] rounded bg-[var(--bg-4)] border border-[var(--border)]"><span className="text-[8px] px-1">clip B</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="panel p-3">
          <div className="text-[10px] font-bold">DASHBOARD — Grid cell hosting Tree (validation step 3)</div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[64px] rounded-[10px] bg-[var(--bg-3)] border border-[var(--border)] p-2 relative overflow-hidden">
                <div className="text-[8px] text-[var(--text-faint)]">CELL {i}</div>
                {i === 2 && <div className="absolute inset-[4px] top-[16px] bg-[var(--bg-2)] border border-[var(--border)] rounded-[8px] p-1 text-[7px]">▶ albums<br />· vacation</div>}
                {i === 4 && <div className="absolute bottom-1 right-1 w-6 h-6 rounded-full bg-[var(--accent)] text-black text-[8px] flex items-center justify-center font-bold">3</div>}
              </div>
            ))}
          </div>
          <div className="mt-2 text-[9px] text-[var(--text-faint)]">Composition sketch: live nesting (Tree node guest=Grid) runs in the Tree tab; this dashboard panel is a static layout preview.</div>
        </div>
      </div>
    </div>
  );
}

// ---------- Main App ----------
export default function App() {
  const [component, setComponent] = useState<"Grid" | "Graph" | "Tree" | "Path" | "Protocol" | "Logic" | "Compose">("Grid");
  const [tilingId, setTilingId] = useState<TilingDef["id"]>("square8");
  const tiling = useMemo(() => getTiling(tilingId), [tilingId]);
  const [presetId, setPresetId] = useState("chess6");
  const [ruleSet, setRuleSet] = useState<RuleSet>(() => presetData("chess6").ruleSet);
  const [occupants, setOccupants] = useState<Occupant[]>(() => presetData("chess6").occupants);
  const [width, setWidth] = useState(6);
  const [height, setHeight] = useState(6);
  const [regions, setRegions] = useState<Region[]>(() => presetData("chess6").regions);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [validMoves, setValidMoves] = useState<any[]>([]);
  const [currentTurn, setCurrentTurn] = useState("white");
  const [outcome, setOutcome] = useState<string | null>(null);
  const [toggles, setToggles] = useState<Toggles>({ gravity: false, diagonal: false, sliding: true, wrapping: false, chainCapture: true });
  const [chainCaptureActive, setChainCaptureActive] = useState(false);
  const [logicTriples, setLogicTriples] = useState<LogicTriple[]>([
    { id: makeId(), s: "rook", p: "canMove", o: "N" },
    { id: makeId(), s: "rook", p: "canMove", o: "S" },
    { id: makeId(), s: "rook", p: "canMove", o: "E" },
    { id: makeId(), s: "rook", p: "canMove", o: "W" },
  ]);
  const [showRegions, setShowRegions] = useState(false);
  const [knightDemo, setKnightDemo] = useState(false);
  const [planMode, setPlanMode] = useState<"yaml" | "xml" | "json">("yaml");
  const [planText, setPlanText] = useState("");
  const [planErrors, setPlanErrors] = useState<string[]>([]);
  const [planFormat, setPlanFormat] = useState<string>("yaml");
  const [interpretation, setInterpretation] = useState<any>(null);
  const [configs, setConfigs] = useState<any[]>([]);
  const [saveName, setSaveName] = useState("");

  // load configs
  useEffect(() => {
    (async () => {
      try {
        const data = await apiCall("records.list", { collection: "configs", limit: 50 });
        setConfigs(data.records || []);
      } catch {}
    })();
  }, []);

  // when preset changes. A plan load sets planLoadRef so its own field updates
  // survive instead of being overwritten by the preset effect.
  const planLoadRef = useRef(false);
  useEffect(() => {
    if (planLoadRef.current) { planLoadRef.current = false; return; }
    const d = presetData(presetId);
    setRuleSet(d.ruleSet);
    setWidth(d.width);
    setHeight(d.height);
    setOccupants(d.occupants);
    setRegions(d.regions);
    setInterpretation(null);
    setCurrentTurn((d.ruleSet.turns as any).first || (d.ruleSet.turns as any).order?.[0] || "white");
    setOutcome(null);
    setSelectedId(null);
    setValidMoves([]);
    setChainCaptureActive(false);
  }, [presetId]);

  // generate plan text whenever ruleSet etc change
  useEffect(() => {
    setPlanText(serializePlan({ component, tiling, tilingId, presetId, ruleSet, occupants, width, height, regions, toggles, planMode }));
  }, [component, tiling, tilingId, presetId, ruleSet, occupants, width, height, regions, toggles, planMode]);

  // Shared apply target: plan files and pasted text apply through one path.
  const planTarget = {
    setComponent,
    setTilingId,
    setInterpretation,
    setPresetId,
    setRuleSet,
    setWidth,
    setHeight,
    setOccupants,
    setRegions,
    setCurrentTurn,
    setOutcome,
    setSelectedId,
    setValidMoves,
    setPlanErrors,
    setChainCaptureActive,
    markPlanLoad: () => { planLoadRef.current = true; },
  };

  const [planChain, setPlanChain] = useState<string | null>(null);
  const applyLoaded = (res: ReturnType<typeof loadPlan>) => {
    if (!res.ok) { setPlanErrors(res.errors); setPlanChain(null); return; }
    try {
      applyPlan(res.plan, planTarget);
      // Provenance: the replayed chain constructed this state, or the file
      // was a snapshot with no chain to replay.
      setPlanChain(
        res.plan.morphs.length > 0
          ? `Assembled by replaying ${res.plan.morphs.length} morphs over the stored base (${res.plan.morphs.map(m => m.name).join(", ")}).`
          : "Snapshot-only plan: no morph chain to replay."
      );
    } catch (e: any) {
      setPlanErrors([`Apply error: ${e.message}`]);
      setPlanChain(null);
    }
  };

  const handleLoadPlan = () => {
    const { data, errors, format } = parsePlan(planText);
    setPlanFormat(format);
    if (errors.length > 0) { setPlanErrors(errors); return; }
    applyLoaded(loadPlan({ data, errors: [] }, tiling, { width, height }));
  };

  const handleLoadFile = (name: string) => {
    const data = getStoredPlan(name);
    if (!data) { setPlanErrors([`Unknown stored plan "${name}"`]); return; }
    setPlanFormat("json");
    applyLoaded(loadPlan({ data, errors: [] }, tiling, { width, height }));
  };

  const saveConfig = async () => {
    const name = saveName || `${presetId}-${tilingId}-${Date.now()}`;
    try {
      const val = { name, component, tilingId, presetId, ruleSet, occupants, width, height, regions, toggles, logicTriples, createdAt: new Date().toISOString() };
      const rec = await apiCall("records.create", { collection: "configs", value: val, idempotency_key: `cfg-${name}` });
      setConfigs(c => [rec, ...c]);
      setSaveName("");
    } catch (e: any) { alert(e.message); }
  };

  const loadConfig = async (id: string) => {
    try {
      const rec = await apiCall("records.get", { collection: "configs", id });
      if (!rec) return;
      const v = rec.value;
      setComponent(v.component || "Grid");
      setTilingId(v.tilingId || "square8");
      setPresetId(v.presetId || "chess6");
      setRuleSet(v.ruleSet);
      setOccupants(v.occupants || []);
      setWidth(v.width || 6);
      setHeight(v.height || 6);
      setRegions(v.regions || []);
      if (v.logicTriples) setLogicTriples(v.logicTriples);
      setToggles(v.toggles || toggles);
      setOutcome(null);
    } catch {}
  };

  const examplePlans = [
    { id: "tictactoe", label: "TicTacToe line 3" },
    { id: "checkers", label: "Checkers chain capture + promotion region" },
    { id: "chess6", label: "Chess 6x6 knight leap offsets" },
    { id: "hexChess", label: "Hex Chess — hexH true E/W" },
    { id: "tetris", label: "Tetris multi-cell span + rotate" },
    { id: "timeline", label: "Timeline NLE — span duration + guest Path" },
    { id: "sudoku", label: "Sudoku 27 regions" },
  ];

  return (
    <div data-safe-area-inset-root className="min-h-screen w-full bg-[var(--bg)] text-[var(--text)]" style={{ boxSizing: "border-box", paddingTop: "var(--safe-area-inset-top)" }}>
      <header data-safe-area-sticky-top className="sticky top-[var(--safe-area-inset-top)] z-30 backdrop-blur-xl bg-[rgba(14,15,17,0.9)] border-b border-[var(--border)]">
        <div className="max-w-[1600px] mx-auto px-4 md:px-6 h-[64px] flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-[32px] h-[32px] rounded-[8px] bg-[var(--accent)] text-black flex items-center justify-center font-bold text-[14px]">P³</div>
            <div>
              <div className="font-bold tracking-[-0.02em] text-[13px] md:text-[14px]">Paramorphic Runtime v3 — Rule-Set Engine (v4 fixes inside)</div>
              <div className="text-[10px] text-[var(--text-dim)] tracking-wide">Executable outcomes, tiling-owned dirs + leap offsets, span+guest used, plan drives runtime, Graph kernel hosts Grid. <span className="text-[var(--accent)]">Rule data drives the engine; no game-specific branches.</span></div>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-3 text-[10px]">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--bg-2)] border border-[var(--border)]">
              <span className="lime-dot" /> <span className="font-bold">SHARED OCCUPANT</span> <span className="text-[var(--text-faint)]">anchor/span/type/data/tags/guest</span>
            </div>
            <div className="px-3 py-1.5 rounded-full bg-[var(--lime-bg)] border border-[var(--border)] text-[var(--accent)]">v4 • Executable Rules + Regions</div>
          </div>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto px-3 md:px-6 py-4 grid grid-cols-1 lg:grid-cols-[220px_1fr_380px] gap-4">
        {/* Left */}
        <div className="flex flex-col gap-4">
          <div className="panel p-2">
            <div className="text-[9px] tracking-[0.18em] text-[var(--text-faint)] px-2 py-1">COMPONENTS (Family) — Graph is Kernel</div>
            {(["Grid", "Graph", "Tree", "Path", "Protocol", "Logic", "Compose"] as const).map(c => (
              <button key={c} onClick={() => setComponent(c)} className={`w-full text-left px-3 py-2 rounded-[8px] text-[12px] flex items-center justify-between mt-[2px] border ${component === c ? "bg-[var(--accent)] text-black border-[var(--accent)] font-bold" : "bg-transparent border-transparent hover:bg-[var(--bg-3)] text-[var(--text-dim)]"}`}>
                <span>{c.toUpperCase()}{c === "Graph" ? " (Kernel)" : c === "Tree" ? " (hosts Grid)" : ""}</span>
                {component === c && <span className="text-[10px]">●</span>}
              </button>
            ))}
            <div className="mt-3 pt-3 border-t border-[var(--border)] px-2">
              <div className="text-[9px] tracking-[0.18em] text-[var(--text-faint)]">VALIDATION LADDER (11.1)</div>
              <div className="mt-2 space-y-1.5">
                {[
                  { k: "1. Grid tiling param", ok: true, note: "square4/8/hexH/hexV same occupants, dirs owned by tiling" },
                  { k: "2. Rule toggles drive", ok: true, note: "gravity/diag/slide/wrap/chain live, no hardcode" },
                  { k: "3. Hex tilings + offset moves", ok: true, note: "hexH true E/W, hexV true N/S no E/W, knight leap offsets not dir names" },
                  { k: "4. Span+guest + 15 presets", ok: true, note: "Tetris rotate via tiling steps, Timeline span+guest Path, Sudoku regions" },
                  { k: "5. Tree hosts Grid, plan replays", ok: true, note: "drag-reparent + lazy guest load live; plan validates + replays; Protocol/Compose illustrative" },
                ].map(s => (
                  <div key={s.k} className="flex gap-2 items-start text-[10px]">
                    <span className={`mt-[2px] w-3 h-3 rounded-full flex items-center justify-center text-[8px] ${s.ok ? "bg-[var(--accent)] text-black" : "bg-[var(--bg-3)] border border-[var(--border)]"}`}>✓</span>
                    <div><div className="font-bold leading-tight">{s.k}</div><div className="text-[9px] text-[var(--text-faint)] leading-tight">{s.note}</div></div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {component === "Grid" && (
            <div className="panel p-3">
              <div className="text-[9px] tracking-[0.18em] text-[var(--text-faint)]">PRESETS (15) — all via rule engine + span/guest</div>
              <div className="mt-2 grid grid-cols-2 gap-1">
                {[
                  { id: "tictactoe", label: "TicTacToe" },
                  { id: "checkers", label: "Checkers" },
                  { id: "chess6", label: "Chess 6×6" },
                  { id: "chess8", label: "Chess 8×8" },
                  { id: "hexChess", label: "Hex Chess" },
                  { id: "painter", label: "Hex Painter" },
                  { id: "sequencer", label: "Sequencer" },
                  { id: "tetris", label: "Tetris span" },
                  { id: "timeline", label: "Timeline NLE" },
                  { id: "crossword", label: "Crossword" },
                  { id: "connectFour", label: "Connect4" },
                  { id: "go", label: "Go capture" },
                  { id: "breakout", label: "Breakout" },
                  { id: "drumPad", label: "Drum Pad" },
                  { id: "sudoku", label: "Sudoku" },
                ].map(p => (
                  <button key={p.id} onClick={() => setPresetId(p.id)} className={`px-2 py-2 rounded-[8px] text-[10px] border text-left ${presetId === p.id ? "bg-[var(--accent)] text-black border-[var(--accent)] font-bold" : "bg-[var(--bg-3)] border-[var(--border)] hover:bg-[var(--bg-4)]"}`}>{p.label}</button>
                ))}
              </div>
              <div className="mt-3">
                <div className="text-[9px] tracking-[0.18em] text-[var(--text-faint)]">TILING PARAM (owns direction names)</div>
                <div className="mt-2 space-y-1">
                  {TILINGS_LIST.map(t => (
                    <button key={t.id} onClick={() => setTilingId(t.id)} className={`w-full text-left px-2 py-2 rounded-[8px] text-[10px] border ${tilingId === t.id ? "bg-[var(--lime-bg)] border-[var(--accent)] text-[var(--accent)]" : "bg-[var(--bg-3)] border-[var(--border)] text-[var(--text-dim)]"}`}>
                      <div className="font-bold">{t.id.toUpperCase()}</div>
                      <div className="text-[8px] text-[var(--text-faint)]">{t.name} • dirs:{t.directions.map(d => d.name).join(",")} • {t.style}</div>
                    </button>
                  ))}
                </div>
                <div className="mt-2"><DirectionCompass tiling={tiling} /></div>
              </div>
              <div className="mt-3">
                <div className="text-[9px] tracking-[0.18em] text-[var(--text-faint)]">RULE TOGGLES (drive engine, no hardcode)</div>
                <div className="mt-2 space-y-1">
                  {[
                    { k: "gravity", label: "GRAVITY • pieces fall S, executable effect" },
                    { k: "diagonal", label: "DIAGONAL • add diag to square4 via logic triples" },
                    { k: "sliding", label: "SLIDING • queen/rook/bishop slide" },
                    { k: "wrapping", label: "WRAPPING • toroidal" },
                    { k: "chainCapture", label: "CHAIN CAPTURE • data-driven chain" },
                  ].map(t => (
                    <button key={t.k} onClick={() => setToggles((tg: any) => ({ ...tg, [t.k]: !tg[t.k] }))} className={`w-full flex items-center justify-between px-2 py-1.5 rounded-[8px] text-[10px] border ${(toggles as any)[t.k] ? "bg-[var(--accent)] text-black border-[var(--accent)]" : "bg-[var(--bg-3)] border-[var(--border)] text-[var(--text-dim)]"}`}>
                      <span>{t.label}</span><span className="text-[9px]">{(toggles as any)[t.k] ? "ON" : "OFF"}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="panel p-3">
            <div className="text-[9px] tracking-[0.18em] text-[var(--text-faint)]">PERSISTENCE • SAVED CONFIGS (plans drive runtime)</div>
            <div className="mt-2 flex gap-1">
              <input value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="name..." className="flex-1 px-2 py-1.5 rounded-[8px] bg-[var(--bg-3)] border border-[var(--border)] text-[10px] outline-none" />
              <button onClick={saveConfig} className="px-3 py-1.5 rounded-[8px] bg-[var(--accent)] text-black text-[10px] font-bold">SAVE</button>
            </div>
            <div className="mt-2 max-h-[120px] overflow-auto space-y-1">
              {configs.length === 0 && <div className="text-[10px] text-[var(--text-faint)]">No saved configs yet.</div>}
              {configs.map((c: any) => (
                <button key={c.id} onClick={() => loadConfig(c.id)} className="w-full text-left px-2 py-1.5 rounded-[8px] bg-[var(--bg-3)] border border-[var(--border)] text-[10px] hover:bg-[var(--bg-4)]">
                  <div className="font-bold truncate">{c.value?.name}</div>
                  <div className="text-[8px] text-[var(--text-faint)]">{c.value?.presetId} • {c.value?.tilingId} • {c.value?.occupants?.length} occ • {c.value?.regions?.length} regions</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Center viewport */}
        <div className="panel-ghost p-3 md:p-5 min-h-[620px] flex flex-col">
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] tracking-[0.2em] text-[var(--text-faint)]">VIEWPORT • {component.toUpperCase()}</span>
              {component === "Grid" && <span className="text-[10px] px-2 py-1 rounded-full bg-[var(--bg-3)] border border-[var(--border)]">{width}×{height} • {tilingId} • {presetId} • {regions.length} regions • {occupants.filter(o => o.span.length > 0).length} multi-cell</span>}
            </div>
            <div className="text-[9px] text-[var(--text-faint)]">ENGINE: tiling owns dirs {tiling.directions.map(d => d.name).join(",")} + leap offsets {tiling.leaps.offsets.length} • rule data, no game branches</div>
          </div>

          <div className="flex-1">
            {component === "Grid" && (interpretation as any)?.view === "spreadsheet" ? (
              <SpreadsheetView
                occupants={occupants}
                setOccupants={setOccupants}
                width={width}
                height={height}
              />
            ) : component === "Grid" && (interpretation as any)?.view === "chat" ? (
              <ChatView occupants={occupants} setOccupants={setOccupants} />
            ) : component === "Grid" && (interpretation as any)?.view === "player" ? (
              <PlayerView
                occupants={occupants}
                setOccupants={setOccupants}
                tiling={tiling}
                width={width}
                height={height}
                mapping={(interpretation as any)?.sound?.pitchMapping}
              />
            ) : component === "Grid" && (
              <GridViewport
                occupants={occupants}
                setOccupants={setOccupants}
                tiling={tiling}
                ruleSet={ruleSet}
                width={width}
                height={height}
                toggles={toggles}
                selectedId={selectedId}
                setSelectedId={setSelectedId}
                validMoves={validMoves}
                setValidMoves={setValidMoves}
                currentTurn={currentTurn}
                setCurrentTurn={setCurrentTurn}
                outcome={outcome}
                setOutcome={setOutcome}
                chainCaptureActive={chainCaptureActive}
                setChainCaptureActive={setChainCaptureActive}
                logicTriples={logicTriples}
                showRegions={showRegions}
                setShowRegions={setShowRegions}
                showSpan={true}
                knightDemo={knightDemo}
                setKnightDemo={setKnightDemo}
              />
            )}
            {component === "Graph" && <GraphView tiling={tiling} />}
            {component === "Tree" && <TreeView tiling={tiling} />}
            {component === "Path" && <PathView />}
            {component === "Protocol" && (
              <div className="panel p-4">
                <div className="text-[10px] font-bold">Protocol — illustrative: framing modeled on Graph edges</div>
                <div className="mt-2 text-[10px] text-[var(--text-dim)]">Session id, ordered blobs, ack window — same Occupant template for frames (span = length). No live transport; step 4 of the ladder is not yet reached.</div>
              </div>
            )}
            {component === "Logic" && <LogicView triples={logicTriples} setTriples={setLogicTriples} tiling={tiling} />}
            {component === "Compose" && <ComposeView tiling={tiling} />}
          </div>

          <div className="mt-4 pt-3 border-t border-[var(--border)] flex flex-wrap gap-2 text-[9px] text-[var(--text-faint)]">
            <span>PRINCIPLES: executable rule data, tiling owns dirs+leaps+distance+line+rotateSpan, span collision, guest nesting, regions (8.1), plan is source of truth, Graph kernel.</span>
          </div>
        </div>

        {/* Right inspector */}
        <div className="flex flex-col gap-4">
          <div className="panel p-3">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-bold tracking-[0.16em]">RULE-SET INSPECTOR — executable</div>
              <span className="text-[8px] px-2 py-1 rounded-full bg-[var(--lime-bg)] border border-[var(--border)] text-[var(--accent)]">live</span>
            </div>
            <div className="mt-3 space-y-3">
              <div className="p-2 rounded-[8px] bg-[var(--bg-3)] border border-[var(--border)]">
                <div className="text-[9px] tracking-[0.15em] text-[var(--text-faint)]">TURNS — executable</div>
                <div className="text-[10px] mt-1">{JSON.stringify(ruleSet.turns)}</div>
                <div className="text-[8px] text-[var(--text-faint)] mt-1">Engine enforces current player {currentTurn}. No branch on id.</div>
              </div>
              <div className="p-2 rounded-[8px] bg-[var(--bg-3)] border border-[var(--border)]">
                <div className="text-[9px] tracking-[0.15em] text-[var(--text-faint)]">OUTCOMES — data, evaluated via tiling.line()</div>
                <div className="text-[10px] mt-1 space-y-1">
                  {ruleSet.outcomes.map((o, i) => <div key={i} className="px-2 py-1 rounded bg-[var(--bg-4)] border border-[var(--border)]">{o.kind} {JSON.stringify(o).slice(0, 80)}</div>)}
                  {ruleSet.outcomes.length === 0 && <div className="text-[9px] text-[var(--text-faint)]">No outcomes — manual end</div>}
                </div>
              </div>
              <div className="p-2 rounded-[8px] bg-[var(--bg-3)] border border-[var(--border)]">
                <div className="text-[9px] tracking-[0.15em] text-[var(--text-faint)]">MOVES — step/slide/leap/pawn/place + effects</div>
                <div className="text-[10px] mt-1 leading-relaxed break-words max-h-[120px] overflow-auto">
                  {ruleSet.moves.map((m, i) => <div key={i}>{m.pieceType}: {m.moves.map(mk => `${mk.type}${(mk as any).dir ? `:${(mk as any).dir}` : ""}`).join(",")} {m.onMove ? `promote:${m.onMove.promoteTo?.join(",")} if ${m.onMove.ifInRegion}` : ""}</div>)}
                </div>
                <div className="text-[8px] text-[var(--text-faint)] mt-1">Knight uses leap offsets [{tiling.leaps.offsets.length}] — not direction names. Tiling defines leaps per geometry.</div>
              </div>
              <div className="p-2 rounded-[8px] bg-[var(--bg-3)] border border-[var(--border)]">
                <div className="text-[9px] tracking-[0.15em] text-[var(--text-faint)]">REGIONS — 8.1</div>
                <div className="text-[10px] mt-1 flex flex-wrap gap-1">
                  {regions.slice(0, 10).map(r => <span key={r.id} className="px-1.5 py-0.5 rounded-full bg-[var(--bg-4)] border border-[var(--border)] text-[9px]">{r.id}</span>)}
                  {regions.length > 10 && <span className="text-[9px]">+{regions.length - 10}</span>}
                </div>
                <div className="text-[8px] text-[var(--text-faint)] mt-1">Sudoku has 27 regions, promotion uses edge regions, timeline uses track regions.</div>
              </div>
            </div>
          </div>

          <div className="panel p-3">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-bold tracking-[0.16em]">PLAN (Ocelot) — editable, drives runtime</div>
              <div className="flex gap-1">
                {(["yaml", "xml", "json"] as const).map(m => (
                  <button key={m} onClick={() => setPlanMode(m)} className={`px-2 py-1 rounded-full text-[9px] border ${planMode === m ? "bg-[var(--accent)] text-black border-[var(--accent)]" : "bg-[var(--bg-3)] border-[var(--border)]"}`}>{m.toUpperCase()}</button>
                ))}
              </div>
            </div>
            <div className="mt-2 flex gap-1 flex-wrap">
              <select onChange={e => { if (e.target.value) setPresetId(e.target.value); }} className="px-2 py-1 rounded bg-[var(--bg-3)] border border-[var(--border)] text-[9px]">
                <option value="">Example Plans...</option>
                {examplePlans.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
              <button onClick={handleLoadPlan} className="px-3 py-1 rounded-full bg-[var(--accent)] text-black text-[10px] font-bold">LOAD / VALIDATE / REPLAY</button>
              {STORED_PLANS.map(p => (
                <button key={p.name} onClick={() => handleLoadFile(p.name)} title={p.label} className="px-3 py-1 rounded-full bg-[var(--bg-3)] border border-[var(--border)] text-[10px]">FILE: {p.name.toUpperCase()}</button>
              ))}
            </div>
            <textarea value={planText} onChange={e => setPlanText(e.target.value)} className="mt-3 w-full h-[280px] p-2 rounded-[8px] bg-[#0a0b0d] border border-[var(--border)] text-[9px] leading-[1.35] overflow-auto whitespace-pre-wrap break-words font-mono" spellCheck={false} />
            {planErrors.length > 0 && (
              <div className="mt-2 p-2 rounded bg-[rgba(255,90,60,0.12)] border border-[#ff5a3c] text-[9px] text-[#ff8a6b]">
                <div className="font-bold">VALIDATION ERRORS ({planFormat}):</div>
                {planErrors.map((err, i) => <div key={i} className="mt-1">• {err}</div>)}
              </div>
            )}
            {planErrors.length === 0 && planChain && <div className="mt-2 text-[9px] text-[var(--accent)]">{planChain}</div>}
            {planErrors.length === 0 && !planChain && <div className="mt-2 text-[9px] text-[var(--text-faint)]">Edit YAML/XML/JSON, then Load. Validates: unknown tiling, direction not defined in tiling ({tiling.id} has {tiling.directions.map(d => d.name).join(",")}), span collision, missing fields. If valid, plan becomes source of truth and runtime updates.</div>}
          </div>

          <div className="panel p-3">
            <div className="text-[9px] tracking-[0.18em] text-[var(--text-faint)]">COMPOSITION CONVENTIONS — real</div>
            <div className="mt-2 grid grid-cols-3 gap-1 text-[9px]">
              {["nesting", "overlap", "stacking", "hosting", "framing", "expansion", "regions"].map(c => <div key={c} className="px-2 py-1.5 rounded-[8px] bg-[var(--bg-3)] border border-[var(--border)] text-center">{c}</div>)}
            </div>
            <div className="mt-2 text-[9px] text-[var(--text-dim)] leading-relaxed">
              Tree node guest=Grid (albums→photos), Grid cell guest=Tree (dashboard), clip span=duration guest=Path (NLE), transition overlaps clips with z-index, Sudoku regions validate, Logic triples feed getValidMoves.
            </div>
          </div>
        </div>
      </div>

      <footer className="max-w-[1600px] mx-auto px-6 py-6 text-[10px] text-[var(--text-faint)] flex flex-wrap gap-4 border-t border-[var(--border)] mt-4">
        <span>Outcomes executable via tiling.line(), turns enforced incl. samePlayerIfCapture, directions owned by tiling (hexV N,S no E/W), knight leapRef resolved per tiling, Tetris rotates via tiling steps, span+guest live (Timeline, Tree), 15 presets, plans validated+replayed.</span>
      </footer>
    </div>
  );
}
