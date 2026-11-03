import { useEffect, useMemo, useRef, useState } from "react";

// Types
type Alt = "none" | "checker" | "stripes" | "dots" | "boxes" | "lines";
type Aspect = "square" | "wide" | "tall";
type OccupantMode = "none" | "single" | "multi" | "toggled" | "numeric" | "data";

type Rules = {
  gravity: boolean;
  snapping: boolean;
  diagonal: boolean;
  wrap: boolean;
  resizeable: boolean;
};

type Config = {
  rows: number;
  cols: number;
  gap: number;
  radius: number;
  alternating: Alt;
  aspect: Aspect;
  occupantMode: OccupantMode;
  rules: Rules;
  cellPrimary: string;
  cellSecondary: string;
};

type Occupant = {
  id: string;
  r: number;
  c: number;
  spanW: number;
  spanH: number;
  type: string; // e.g. "king", "stone", "note", "tetro", "key", "date"
  data?: string; // unicode, number, char, etc
  color?: string;
  active?: boolean;
};

type PresetKey =
  | "chess"
  | "checkers"
  | "go"
  | "spreadsheet"
  | "calendar"
  | "sequencer"
  | "tetris"
  | "keyboard"
  | "connect4"
  | "sudoku";

const PRESETS: Record<PresetKey, { label: string; desc: string; config: Config }> = {
  chess: {
    label: "Chess",
    desc: "8×8 checker, single occupants, diagonal rules",
    config: {
      rows: 8, cols: 8, gap: 2, radius: 4,
      alternating: "checker", aspect: "square",
      occupantMode: "single",
      rules: { gravity: false, snapping: true, diagonal: true, wrap: false, resizeable: false },
      cellPrimary: "#1e2024", cellSecondary: "#2b2f37"
    }
  },
  checkers: {
    label: "Checkers",
    desc: "8×8 red/black, snapping, gravity off",
    config: {
      rows: 8, cols: 8, gap: 2, radius: 20,
      alternating: "checker", aspect: "square",
      occupantMode: "single",
      rules: { gravity: false, snapping: true, diagonal: true, wrap: false, resizeable: false },
      cellPrimary: "#1d2026", cellSecondary: "#2e333e"
    }
  },
  go: {
    label: "Go",
    desc: "19×19 intersections, dots, stone occupants",
    config: {
      rows: 19, cols: 19, gap: 0, radius: 24,
      alternating: "dots", aspect: "square",
      occupantMode: "single",
      rules: { gravity: false, snapping: true, diagonal: false, wrap: false, resizeable: false },
      cellPrimary: "#1a1d21", cellSecondary: "#1a1d21"
    }
  },
  spreadsheet: {
    label: "Spreadsheet",
    desc: "10×12 data cells, stripe rows, editable",
    config: {
      rows: 12, cols: 10, gap: 1, radius: 2,
      alternating: "stripes", aspect: "wide",
      occupantMode: "data",
      rules: { gravity: false, snapping: false, diagonal: false, wrap: false, resizeable: true },
      cellPrimary: "#191c20", cellSecondary: "#1f242b"
    }
  },
  calendar: {
    label: "Calendar",
    desc: "7×5 month, weekend shading, numeric",
    config: {
      rows: 5, cols: 7, gap: 8, radius: 12,
      alternating: "none", aspect: "square",
      occupantMode: "numeric",
      rules: { gravity: false, snapping: false, diagonal: false, wrap: false, resizeable: false },
      cellPrimary: "#1a1d21", cellSecondary: "#22262e"
    }
  },
  sequencer: {
    label: "Sequencer",
    desc: "16×8 toggled notes, playhead, no gravity",
    config: {
      rows: 8, cols: 16, gap: 4, radius: 6,
      alternating: "stripes", aspect: "square",
      occupantMode: "toggled",
      rules: { gravity: false, snapping: false, diagonal: false, wrap: true, resizeable: false },
      cellPrimary: "#181b1f", cellSecondary: "#21262e"
    }
  },
  tetris: {
    label: "Tetris",
    desc: "10×20 multi-cell, gravity on, resizeable",
    config: {
      rows: 20, cols: 10, gap: 2, radius: 4,
      alternating: "none", aspect: "square",
      occupantMode: "multi",
      rules: { gravity: true, snapping: false, diagonal: false, wrap: false, resizeable: true },
      cellPrimary: "#161a1e", cellSecondary: "#1e242c"
    }
  },
  keyboard: {
    label: "Keyboard",
    desc: "10×4 offset rows, QWERTY single occupants",
    config: {
      rows: 4, cols: 10, gap: 6, radius: 10,
      alternating: "none", aspect: "wide",
      occupantMode: "single",
      rules: { gravity: false, snapping: false, diagonal: false, wrap: false, resizeable: false },
      cellPrimary: "#1c1f24", cellSecondary: "#252b33"
    }
  },
  connect4: {
    label: "Connect Four",
    desc: "7×6 gravity drop, single occupants",
    config: {
      rows: 6, cols: 7, gap: 6, radius: 24,
      alternating: "none", aspect: "square",
      occupantMode: "single",
      rules: { gravity: true, snapping: false, diagonal: true, wrap: false, resizeable: false },
      cellPrimary: "#171b20", cellSecondary: "#1e252e"
    }
  },
  sudoku: {
    label: "Sudoku",
    desc: "9×9 box outlines, numeric, box rules",
    config: {
      rows: 9, cols: 9, gap: 2, radius: 6,
      alternating: "boxes", aspect: "square",
      occupantMode: "numeric",
      rules: { gravity: false, snapping: false, diagonal: false, wrap: false, resizeable: false },
      cellPrimary: "#1b1f25", cellSecondary: "#232a33"
    }
  }
};

// Occupant generators
function uid() { return Math.random().toString(36).slice(2, 9); }

function makeOccupants(preset: PresetKey, rows: number, cols: number): Occupant[] {
  if (preset === "chess") {
    const back = ["♜", "♞", "♝", "♛", "♚", "♝", "♞", "♜"];
    const occ: Occupant[] = [];
    for (let c = 0; c < 8; c++) {
      occ.push({ id: `b-back-${c}`, r: 0, c, spanW: 1, spanH: 1, type: "piece", data: back[c], color: "#f1f2ee" });
      occ.push({ id: `b-pawn-${c}`, r: 1, c, spanW: 1, spanH: 1, type: "pawn", data: "♟", color: "#f1f2ee" });
      occ.push({ id: `w-pawn-${c}`, r: 6, c, spanW: 1, spanH: 1, type: "pawn", data: "♙", color: "#e8ff52" });
    }
    const wback = ["♖", "♘", "♗", "♕", "♔", "♗", "♘", "♖"];
    for (let c = 0; c < 8; c++) occ.push({ id: `w-back-${c}`, r: 7, c, spanW: 1, spanH: 1, type: "piece", data: wback[c], color: "#e8ff52" });
    return occ;
  }
  if (preset === "checkers") {
    const occ: Occupant[] = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) occ.push({ id: `b-${r}-${c}`, r, c, spanW: 1, spanH: 1, type: "checker", data: "●", color: "#ff4d4d" });
    for (let r = 5; r < 8; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) occ.push({ id: `w-${r}-${c}`, r, c, spanW: 1, spanH: 1, type: "checker", data: "●", color: "#f1f2ee" });
    return occ;
  }
  if (preset === "go") {
    const occ: Occupant[] = [
      { id: "b1", r: 3, c: 3, spanW: 1, spanH: 1, type: "stone", data: "●", color: "#f1f2ee" },
      { id: "w1", r: 3, c: 15, spanW: 1, spanH: 1, type: "stone", data: "●", color: "#0e0f11" },
      { id: "b2", r: 9, c: 9, spanW: 1, spanH: 1, type: "stone", data: "●", color: "#f1f2ee" },
      { id: "w2", r: 15, c: 3, spanW: 1, spanH: 1, type: "stone", data: "●", color: "#0e0f11" },
      { id: "b3", r: 15, c: 15, spanW: 1, spanH: 1, type: "stone", data: "●", color: "#f1f2ee" },
    ];
    return occ;
  }
  if (preset === "spreadsheet") {
    const occ: Occupant[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) occ.push({ id: `s-${r}-${c}`, r, c, spanW: 1, spanH: 1, type: "data", data: r === 0 ? String.fromCharCode(65 + c) : (c === 0 ? `${r}` : `${Math.floor(Math.random() * 90 + 10)}`), color: "" });
    return occ;
  }
  if (preset === "calendar") {
    const occ: Occupant[] = [];
    let d = 1;
    for (let r = 0; r < 5; r++) for (let c = 0; c < 7; c++) { if (d <= 31) { occ.push({ id: `d-${d}`, r, c, spanW: 1, spanH: 1, type: "date", data: `${d}`, color: c >= 5 ? "#e8ff52" : "" }); d++; } }
    return occ;
  }
  if (preset === "sequencer") {
    const occ: Occupant[] = [];
    for (let i = 0; i < 18; i++) {
      const r = Math.floor(Math.random() * rows);
      const c = Math.floor(Math.random() * cols);
      occ.push({ id: `n-${i}`, r, c, spanW: 1, spanH: 1, type: "note", data: "♪", active: true, color: "#e8ff52" });
    }
    return occ;
  }
  if (preset === "tetris") {
    return [
      { id: "floor", r: rows - 1, c: 0, spanW: cols, spanH: 1, type: "floor", data: "", color: "#1e242c" },
      { id: "stack-1", r: rows - 2, c: 2, spanW: 3, spanH: 1, type: "block", data: "", color: "#2a3340" },
    ];
  }
  if (preset === "keyboard") {
    const qwerty = [
      ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
      ["A", "S", "D", "F", "G", "H", "J", "K", "L", ";"],
      ["Z", "X", "C", "V", "B", "N", "M", ",", ".", "/"],
      ["Ctrl", "Alt", "Space", "Space", "Space", "Space", "Alt", "Ctrl", "<", ">"]
    ];
    const occ: Occupant[] = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 10; c++) occ.push({ id: `k-${r}-${c}`, r, c, spanW: qwerty[r][c] === "Space" ? 2 : 1, spanH: 1, type: "key", data: qwerty[r][c], color: "" });
    return occ;
  }
  if (preset === "connect4") {
    return [
      { id: "cf-1", r: 5, c: 0, spanW: 1, spanH: 1, type: "disc", data: "●", color: "#ff4d4d" },
      { id: "cf-2", r: 5, c: 1, spanW: 1, spanH: 1, type: "disc", data: "●", color: "#e8ff52" },
      { id: "cf-3", r: 5, c: 2, spanW: 1, spanH: 1, type: "disc", data: "●", color: "#ff4d4d" },
    ];
  }
  if (preset === "sudoku") {
    const puzzle = [
      [5, 3, 0, 0, 7, 0, 0, 0, 0],
      [6, 0, 0, 1, 9, 5, 0, 0, 0],
      [0, 9, 8, 0, 0, 0, 0, 6, 0],
      [8, 0, 0, 0, 6, 0, 0, 0, 3],
      [4, 0, 0, 8, 0, 3, 0, 0, 1],
      [7, 0, 0, 0, 2, 0, 0, 0, 6],
      [0, 6, 0, 0, 0, 0, 2, 8, 0],
      [0, 0, 0, 4, 1, 9, 0, 0, 5],
      [0, 0, 0, 0, 8, 0, 0, 7, 9],
    ];
    const occ: Occupant[] = [];
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) if (puzzle[r][c]) occ.push({ id: `su-${r}-${c}`, r, c, spanW: 1, spanH: 1, type: "num", data: `${puzzle[r][c]}`, color: "" });
    return occ;
  }
  return [];
}

// Tetromino shapes
const TETROMINOS: { name: string; shape: [number, number][]; color: string }[] = [
  { name: "T", shape: [[0, -1], [0, 0], [0, 1], [1, 0]], color: "#e8ff52" },
  { name: "L", shape: [[0, 0], [1, 0], [2, 0], [2, 1]], color: "#7afcff" },
  { name: "O", shape: [[0, 0], [0, 1], [1, 0], [1, 1]], color: "#ff8a5b" },
  { name: "I", shape: [[0, 0], [1, 0], [2, 0], [3, 0]], color: "#8b8eff" },
];

export default function App() {
  const [preset, setPreset] = useState<PresetKey>("chess");
  const [config, setConfig] = useState<Config>(PRESETS.chess.config);
  const [occupants, setOccupants] = useState<Occupant[]>(() => makeOccupants("chess", 8, 8));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [play, setPlay] = useState(true);
  const [playhead, setPlayhead] = useState(0);
  const [tetroIndex, setTetroIndex] = useState(0);
  const [tetroPos, setTetroPos] = useState<{ r: number; c: number }>({ r: 0, c: 4 });
  const [dragId, setDragId] = useState<string | null>(null);
  const [litKey, setLitKey] = useState<string | null>(null);
  const [savedGrids, setSavedGrids] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const xmlRef = useRef<HTMLPreElement>(null);

  // load saved grids
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "records.list", args: { collection: "grids", limit: 20 } }) });
        const j = await res.json();
        if (j.data) setSavedGrids(j.data.records || []);
      } catch { }
    })();
  }, []);

  // sequencer playhead + tetris gravity
  useEffect(() => {
    if (!play) return;
    const id = setInterval(() => {
      if (preset === "sequencer") setPlayhead(p => (p + 1) % config.cols);
      if (preset === "tetris" || (config.rules.gravity && (preset === "connect4"))) {
        if (preset === "tetris") {
          setTetroPos(p => {
            const nextR = p.r + 1;
            if (nextR > config.rows - 4) return { r: 0, c: Math.floor(Math.random() * (config.cols - 2)) + 1 };
            return { r: nextR, c: p.c };
          });
        }
      }
    }, preset === "sequencer" ? 180 : 520);
    return () => clearInterval(id);
  }, [play, preset, config.cols, config.rows, config.rules.gravity]);

  // keyboard lighting
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toUpperCase();
      setLitKey(k);
      setTimeout(() => setLitKey(null), 220);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const applyPreset = (k: PresetKey) => {
    setPreset(k);
    setConfig(PRESETS[k].config);
    setOccupants(makeOccupants(k, PRESETS[k].config.rows, PRESETS[k].config.cols));
    setTetroPos({ r: 0, c: Math.floor(PRESETS[k].config.cols / 2) });
    setPlayhead(0);
    setSelectedId(null);
    setTetroIndex(0);
  };

  const updateConfig = (patch: Partial<Config>) => {
    setConfig(c => ({ ...c, ...patch }));
  };

  const updateRules = (patch: Partial<Rules>) => {
    setConfig(c => ({ ...c, rules: { ...c.rules, ...patch } }));
  };

  // gravity apply
  const applyGravity = () => {
    if (preset !== "tetris" && preset !== "connect4") return;
    setOccupants(prev => {
      // simple column drop for connect4/tetris stack
      const colsMap: Record<number, Occupant[]> = {};
      prev.forEach(o => {
        if (o.type === "floor") return;
        if (!colsMap[o.c]) colsMap[o.c] = [];
        colsMap[o.c].push(o);
      });
      const next: Occupant[] = prev.filter(o => o.type === "floor");
      Object.entries(colsMap).forEach(([colStr, list]) => {
        const col = parseInt(colStr);
        const sorted = [...list].sort((a, b) => b.r - a.r);
        let r = config.rows - 1;
        if (preset === "tetris" && prev.find(f => f.type === "floor")) r = config.rows - 2;
        sorted.forEach(o => {
          next.push({ ...o, r });
          r--;
        });
      });
      return next;
    });
  };

  // handle cell click
  const handleCellClick = (r: number, c: number) => {
    const occAt = occupants.find(o => o.r === r && o.c === c);
    if (preset === "sequencer") {
      if (occAt) setOccupants(prev => prev.filter(o => !(o.r === r && o.c === c)));
      else setOccupants(prev => [...prev, { id: uid(), r, c, spanW: 1, spanH: 1, type: "note", data: "♪", active: true, color: "#e8ff52" }]);
      return;
    }
    if (preset === "connect4") {
      // drop in column c
      let lowest = config.rows - 1;
      for (let rr = config.rows - 1; rr >= 0; rr--) if (!occupants.find(o => o.r === rr && o.c === c)) { lowest = rr; break; }
      const color = occupants.filter(o => o.type === "disc").length % 2 === 0 ? "#ff4d4d" : "#e8ff52";
      setOccupants(prev => [...prev, { id: uid(), r: lowest, c, spanW: 1, spanH: 1, type: "disc", data: "●", color }]);
      return;
    }
    if (preset === "go") {
      if (occAt) setOccupants(prev => prev.filter(o => o.id !== occAt.id));
      else {
        const color = occupants.length % 2 === 0 ? "#f1f2ee" : "#0e0f11";
        const border = color === "#0e0f11" ? "#f1f2ee" : "";
        setOccupants(prev => [...prev, { id: uid(), r, c, spanW: 1, spanH: 1, type: "stone", data: "●", color: border ? "#0e0f11" : color }]);
      }
      return;
    }
    if (preset === "chess" || preset === "checkers") {
      if (occAt) setSelectedId(occAt.id);
      else if (selectedId) {
        const sel = occupants.find(o => o.id === selectedId);
        if (sel) {
          // move if diagonal rule? simple
          setOccupants(prev => prev.map(o => o.id === selectedId ? { ...o, r, c } : o));
          setSelectedId(null);
        }
      }
      return;
    }
    if (preset === "keyboard") {
      const k = occupants.find(o => o.r === r && o.c === c);
      if (k) { setLitKey(k.data || null); setTimeout(() => setLitKey(null), 250); }
      return;
    }
    if (preset === "sudoku" || preset === "spreadsheet") {
      if (!occAt) {
        setOccupants(prev => [...prev, { id: uid(), r, c, spanW: 1, spanH: 1, type: preset === "sudoku" ? "num" : "data", data: preset === "sudoku" ? "5" : "42" }]);
      } else setSelectedId(occAt.id);
    }
  };

  const rotateTetro = () => {
    setTetroIndex(i => (i + 1) % TETROMINOS.length);
  };

  const currentTetro = TETROMINOS[tetroIndex];

  // xml live representation
  const xmlString = useMemo(() => {
    const alt = config.alternating;
    const occXml = occupants.slice(0, 12).map(o => `  <Occupant id="${o.id}" r="${o.r}" c="${o.c}" span="${o.spanW}x${o.spanH}" type="${o.type}" data="${(o.data || "").replace(/"/g, "'")}" />`).join("\n");
    const more = occupants.length > 12 ? `\n  <!-- +${occupants.length - 12} more occupants -->` : "";
    return `<ParamorphicGrid
  rows="${config.rows}" cols="${config.cols}"
  gap="${config.gap}px" radius="${config.radius}px"
  alternating="${alt}" aspect="${config.aspect}"
  occupantMode="${config.occupantMode}"
>
  <Rules gravity="${config.rules.gravity}" snapping="${config.rules.snapping}" diagonal="${config.rules.diagonal}" wrap="${config.rules.wrap}" resizeable="${config.rules.resizeable}" />
  <Style primary="${config.cellPrimary}" secondary="${config.cellSecondary}" />
  <Occupants count="${occupants.length}">
${occXml}${more}
  </Occupants>
</ParamorphicGrid>`;
  }, [config, occupants]);

  const cellAspectStyle = (aspect: Aspect) => {
    if (aspect === "square") return "1 / 1";
    if (aspect === "wide") return "1.7 / 1";
    return "1 / 1.5";
  };

  const getCellBg = (r: number, c: number) => {
    if (config.alternating === "checker") return (r + c) % 2 === 0 ? config.cellPrimary : config.cellSecondary;
    if (config.alternating === "stripes") return r % 2 === 0 ? config.cellPrimary : config.cellSecondary;
    if (config.alternating === "boxes" && preset === "sudoku") {
      const boxR = Math.floor(r / 3), boxC = Math.floor(c / 3);
      return (boxR + boxC) % 2 === 0 ? config.cellPrimary : config.cellSecondary;
    }
    return config.cellPrimary;
  };

  const saveGrid = async () => {
    setBusy(true);
    try {
      const res = await fetch("actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "records.create", args: { collection: "grids", value: { preset, config, occupants: occupants.slice(0, 80), created: Date.now() } } }) });
      const j = await res.json();
      if (j.data) {
        setSavedGrids(s => [j.data, ...s]);
      }
    } catch { }
    setBusy(false);
  };

  // layout
  return (
    <div data-safe-area-inset-root style={{ boxSizing: "border-box", paddingTop: "var(--safe-area-inset-top)", minHeight: "100vh", background: "var(--bg)", overflowX: "clip" }}>
      {/* Header */}
      <header data-safe-area-sticky-top style={{ top: "var(--safe-area-inset-top)", position: "sticky", zIndex: 20, background: "rgba(14,15,17,0.92)", backdropFilter: "blur(16px)", borderBottom: "1px solid var(--border)" }}>
        <div style={{ maxWidth: 1440, margin: "0 auto", padding: "18px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: 28, letterSpacing: -0.5, lineHeight: 1, fontWeight: 400 }}>
              Paramorphic Grid — <span style={{ fontStyle: "italic", opacity: 0.9 }}>One Component, Many Forms</span>
            </h1>
            <p className="mono" style={{ fontSize: 11, color: "var(--muted)", marginTop: 6, letterSpacing: 0.4 }}>
              A SINGLE GRID SUBSTRATE MORPHED VIA PARAMS INTO DIVERSE APPS · ROWS/COLS/CELLS + ALTERNATING + OCCUPANTS + RULES
            </p>
          </div>
          <div className="mono" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11 }}>
            <span style={{ color: "var(--muted)" }}>LAB INSTRUMENT v0.1</span>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--accent)", boxShadow: "0 0 8px var(--accent)" }} />
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1440, margin: "0 auto", display: "grid", gridTemplateColumns: "340px 1fr", minHeight: "calc(100vh - 73px)" }}>
        {/* Left Control Panel */}
        <aside style={{ borderRight: "1px solid var(--border)", background: "var(--surface)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: 18, borderBottom: "1px solid var(--border)", background: "var(--surface-2)" }}>
            <div className="mono" style={{ fontSize: 10, letterSpacing: 1, color: "var(--muted)", marginBottom: 10 }}>PRESETS — CLICK TO MORPH</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {(Object.keys(PRESETS) as PresetKey[]).map(k => (
                <button
                  key={k}
                  onClick={() => applyPreset(k)}
                  className="mono"
                  style={{
                    padding: "7px 12px",
                    borderRadius: "var(--radius-pill)",
                    border: preset === k ? "1px solid var(--accent)" : "1px solid var(--border-2)",
                    background: preset === k ? "var(--accent)" : "var(--surface-3)",
                    color: preset === k ? "var(--accent-ink)" : "var(--text)",
                    fontSize: 11,
                    letterSpacing: 0.2,
                    transition: "all 0.22s",
                    cursor: "pointer"
                  }}
                >
                  {PRESETS[k].label}
                </button>
              ))}
            </div>
            <div className="mono" style={{ marginTop: 12, fontSize: 10, color: "var(--muted-2)", lineHeight: 1.4 }}>{PRESETS[preset].desc}</div>
          </div>

          <div style={{ padding: 18, overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 20 }}>
            {/* Sliders */}
            {[
              { label: "Rows", key: "rows", min: 3, max: 19, val: config.rows },
              { label: "Cols", key: "cols", min: 3, max: 19, val: config.cols },
              { label: "Cell Gap", key: "gap", min: 0, max: 12, val: config.gap },
              { label: "Border Radius", key: "radius", min: 0, max: 24, val: config.radius },
            ].map(s => (
              <div key={s.key}>
                <div className="mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 8 }}>
                  <span style={{ color: "var(--muted)", letterSpacing: 0.5 }}>{s.label.toUpperCase()}</span>
                  <span style={{ color: "var(--text)" }}>{s.val}{s.key === "gap" || s.key === "radius" ? "px" : ""}</span>
                </div>
                <input type="range" min={s.min} max={s.max} value={s.val} onChange={e => {
                  const v = parseInt(e.target.value);
                  if (s.key === "rows" || s.key === "cols" || s.key === "gap" || s.key === "radius") updateConfig({ [s.key]: v } as any);
                }} style={{ width: "100%" }} />
              </div>
            ))}

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div>
                <div className="mono" style={{ fontSize: 10, color: "var(--muted)", marginBottom: 6 }}>ALTERNATING</div>
                <select value={config.alternating} onChange={e => updateConfig({ alternating: e.target.value as Alt })} className="mono" style={{ width: "100%", background: "var(--surface-3)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontSize: 11 }}>
                  <option value="none">none</option><option value="checker">checker</option><option value="stripes">stripes</option><option value="dots">dots</option><option value="boxes">boxes</option><option value="lines">lines</option>
                </select>
              </div>
              <div>
                <div className="mono" style={{ fontSize: 10, color: "var(--muted)", marginBottom: 6 }}>ASPECT</div>
                <select value={config.aspect} onChange={e => updateConfig({ aspect: e.target.value as Aspect })} className="mono" style={{ width: "100%", background: "var(--surface-3)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", color: "var(--text)", fontSize: 11 }}>
                  <option value="square">square</option><option value="wide">wide</option><option value="tall">tall</option>
                </select>
              </div>
            </div>

            <div>
              <div className="mono" style={{ fontSize: 10, color: "var(--muted)", marginBottom: 6 }}>OCCUPANT MODE</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {(["none", "single", "multi", "toggled", "numeric", "data"] as OccupantMode[]).map(m => (
                  <button key={m} onClick={() => updateConfig({ occupantMode: m })} className="mono" style={{ padding: "5px 10px", borderRadius: 999, border: config.occupantMode === m ? "1px solid var(--accent)" : "1px solid var(--border)", background: config.occupantMode === m ? "var(--accent-dim)" : "transparent", color: config.occupantMode === m ? "var(--accent)" : "var(--muted)", fontSize: 10, cursor: "pointer" }}>{m}</button>
                ))}
              </div>
            </div>

            <div>
              <div className="mono" style={{ fontSize: 10, color: "var(--muted)", marginBottom: 10 }}>RULES</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {(Object.keys(config.rules) as (keyof Rules)[]).map(rk => (
                  <label key={rk} className="mono" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--surface-3)", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 12px", fontSize: 11, cursor: "pointer" }}>
                    <span style={{ color: config.rules[rk] ? "var(--text)" : "var(--muted)" }}>{rk}</span>
                    <input type="checkbox" checked={config.rules[rk]} onChange={e => updateRules({ [rk]: e.target.checked } as any)} style={{ accentColor: "var(--accent)" }} />
                  </label>
                ))}
              </div>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={applyGravity} className="mono" style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid var(--border-2)", background: "var(--surface-3)", color: "var(--text)", fontSize: 11, cursor: "pointer" }}>Apply Gravity ↓</button>
              {preset === "tetris" && <button onClick={rotateTetro} className="mono" style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid var(--accent)", background: "var(--accent)", color: "var(--accent-ink)", fontSize: 11, cursor: "pointer" }}>Rotate ↻</button>}
            </div>

            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
              <div className="mono" style={{ fontSize: 10, color: "var(--muted)", marginBottom: 10, letterSpacing: 0.8 }}>LEGEND</div>
              <div className="mono" style={{ fontSize: 10, lineHeight: 1.6, color: "var(--muted-2)" }}>
                <div><span style={{ color: "var(--accent)" }}>Paramorphic Grid</span> = rows/cols/cells + alternating style + occupants + rules.</div>
                <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
                  <div>• <b style={{ color: "var(--text)" }}>Occupant</b> = &#123; id, type, span w×h, gravity, draggable, data &#125;</div>
                  <div>• Gravity stacks occupants to bottom edge.</div>
                  <div>• Checker alternates primary/secondary.</div>
                  <div>• Single vs Multi vs Toggled defines interaction.</div>
                </div>
              </div>
            </div>

            <div style={{ marginTop: "auto", paddingTop: 12, borderTop: "1px solid var(--border)" }}>
              <button onClick={saveGrid} disabled={busy} className="mono" style={{ width: "100%", padding: "11px", borderRadius: 12, border: "1px solid var(--border-2)", background: busy ? "var(--surface-3)" : "var(--surface-3)", color: "var(--text)", fontSize: 11, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
                {busy ? "Saving…" : "Save Current Grid → Records"}
              </button>
              {savedGrids.length > 0 && (
                <div className="mono" style={{ marginTop: 10, fontSize: 10, color: "var(--muted)" }}>
                  Saved: {savedGrids.length} grids
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* Right viewport */}
        <main style={{ display: "flex", flexDirection: "column", minWidth: 0, background: "var(--bg)" }}>
          {/* Grid Toolbar */}
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, background: "var(--surface)", flexWrap: "wrap" }}>
            <div className="mono" style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 11 }}>
              <span style={{ color: "var(--muted)" }}>VIEWPORT</span>
              <span style={{ padding: "3px 8px", borderRadius: 999, background: "var(--accent-dim)", border: "1px solid rgba(232,255,82,0.2)", color: "var(--accent)" }}>{preset.toUpperCase()} · {config.rows}×{config.cols} · {config.occupantMode.toUpperCase()}</span>
              {(preset === "sequencer" || preset === "tetris") && (
                <button onClick={() => setPlay(p => !p)} className="mono" style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid var(--border-2)", background: play ? "var(--accent)" : "var(--surface-3)", color: play ? "var(--accent-ink)" : "var(--text)", cursor: "pointer", fontSize: 10 }}>{play ? "❚❚ PAUSE" : "▶ PLAY"}</button>
              )}
            </div>
            <div className="mono" style={{ fontSize: 10, color: "var(--muted-2)", display: "flex", gap: 12 }}>
              <span>HOVER → COORDS</span>
              <span>CLICK → ACT</span>
              <span style={{ color: "var(--accent)" }}>● LIVE</span>
            </div>
          </div>

          {/* Grid Canvas */}
          <div style={{ flex: 1, padding: 18, overflow: "auto", display: "flex", justifyContent: "center", alignItems: "flex-start" }}>
            <div
              style={{
                display: preset === "keyboard" ? "flex" : "grid",
                flexDirection: preset === "keyboard" ? "column" as any : undefined,
                gridTemplateColumns: preset !== "keyboard" ? `repeat(${config.cols}, minmax(0,1fr))` : undefined,
                gap: `${config.gap}px`,
                width: "100%",
                maxWidth: preset === "go" ? 640 : preset === "tetris" ? 360 : preset === "keyboard" ? 720 : 760,
                transition: "all 0.35s ease",
                position: "relative",
                background: preset === "go" ? "#15171a" : "transparent",
                padding: preset === "go" ? 16 : 0,
                borderRadius: 16,
                border: preset === "go" ? "1px solid var(--border)" : "none",
              }}
            >
              {/* Render cells */}
              {preset === "keyboard" ? (
                // Keyboard special rows
                Array.from({ length: config.rows }).map((_, r) => (
                  <div key={r} style={{ display: "flex", gap: config.gap, marginLeft: r === 1 ? 24 : r === 2 ? 48 : r === 3 ? 12 : 0, transition: "margin 0.3s" }}>
                    {Array.from({ length: config.cols }).map((_, c) => {
                      const occ = occupants.find(o => o.r === r && o.c === c);
                      if (!occ) return <div key={`${r}-${c}`} style={{ flex: 1 }} />;
                      const isLit = litKey && occ.data?.toUpperCase().includes(litKey) || litKey === occ.data;
                      return (
                        <div
                          key={`${r}-${c}`}
                          onClick={() => handleCellClick(r, c)}
                          className="mono"
                          style={{
                            flex: occ.spanW > 1 ? occ.spanW : 1,
                            aspectRatio: cellAspectStyle(config.aspect),
                            borderRadius: config.radius,
                            background: isLit ? "var(--accent)" : getCellBg(r, c),
                            border: isLit ? "1px solid var(--accent)" : "1px solid var(--border)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            fontSize: 13, fontWeight: 600,
                            color: isLit ? "var(--accent-ink)" : "var(--text)",
                            cursor: "pointer",
                            transition: "all 0.18s",
                            transform: isLit ? "translateY(-1px)" : "none",
                            boxShadow: isLit ? "0 6px 20px rgba(232,255,82,0.3)" : "none"
                          }}
                        >
                          {occ.data}
                        </div>
                      );
                    })}
                  </div>
                ))
              ) : (
                Array.from({ length: config.rows }).map((_, r) =>
                  Array.from({ length: config.cols }).map((_, c) => {
                    const occ = occupants.find(o => o.r === r && o.c === c);
                    const isSelected = occ && selectedId === occ.id;
                    const isPlayhead = preset === "sequencer" && c === playhead;
                    const isTetroCell = preset === "tetris" && currentTetro.shape.some(([dr, dc]) => tetroPos.r + dr === r && tetroPos.c + dc === c);
                    // go lines
                    const isGo = preset === "go";
                    const isWeekend = preset === "calendar" && (c === 5 || c === 6);
                    const isHeader = preset === "spreadsheet" && (r === 0 || c === 0);
                    return (
                      <div
                        key={`${r}-${c}`}
                        onClick={() => handleCellClick(r, c)}
                        onMouseEnter={() => {
                          // could set hover coord
                        }}
                        onMouseDown={() => { if (occ) setDragId(occ.id); }}
                        onMouseUp={() => { if (dragId && dragId !== occ?.id) { const d = occupants.find(o => o.id === dragId); if (d) setOccupants(prev => prev.map(o => o.id === dragId ? { ...o, r, c } : o)); } setDragId(null); }}
                        title={`${r},${c}`}
                        style={{
                          aspectRatio: cellAspectStyle(config.aspect),
                          borderRadius: config.radius,
                          background: isTetroCell ? currentTetro.color : isHeader ? "#232a33" : isWeekend ? "#22262e" : getCellBg(r, c),
                          border: isSelected ? "1.5px solid var(--accent)" : isGo ? "none" : isPlayhead ? "1px solid rgba(232,255,82,0.6)" : `1px solid ${config.alternating === "dots" ? "transparent" : "var(--border)"}`,
                          position: "relative",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          transition: "all 0.2s ease",
                          overflow: "hidden",
                          boxShadow: isSelected ? "0 0 0 2px var(--accent-dim)" : isTetroCell ? "0 0 12px rgba(232,255,82,0.4)" : "none",
                          // sudoku thick borders
                          ...(preset === "sudoku" ? {
                            borderRight: (c + 1) % 3 === 0 && c !== config.cols - 1 ? "2px solid var(--border-2)" : undefined,
                            borderBottom: (r + 1) % 3 === 0 && r !== config.rows - 1 ? "2px solid var(--border-2)" : undefined,
                          } : {}),
                        }}
                      >
                        {/* Go board lines */}
                        {isGo && (
                          <>
                            <div style={{ position: "absolute", left: c === 0 ? "50%" : 0, right: c === config.cols - 1 ? "50%" : 0, top: "50%", height: 1, background: "#2a2e36" }} />
                            <div style={{ position: "absolute", top: r === 0 ? "50%" : 0, bottom: r === config.rows - 1 ? "50%" : 0, left: "50%", width: 1, background: "#2a2e36" }} />
                            {((r === 3 || r === 9 || r === 15) && (c === 3 || c === 9 || c === 15)) && <div style={{ width: 6, height: 6, borderRadius: 999, background: "#3a404d", position: "absolute" }} />}
                          </>
                        )}

                        {/* Spreadsheet header shading */}
                        {isHeader && <div style={{ position: "absolute", inset: 0, background: "rgba(232,255,82,0.06)" }} />}

                        {/* Playhead column wash */}
                        {isPlayhead && preset === "sequencer" && <div style={{ position: "absolute", inset: 0, background: "rgba(232,255,82,0.08)", pointerEvents: "none" }} />}

                        {/* Occupant rendering */}
                        {occ && (
                          <div
                            className="mono"
                            style={{
                              fontSize: preset === "chess" || preset === "checkers" ? 22 : preset === "go" || preset === "connect4" ? 28 : preset === "calendar" ? 11 : 12,
                              fontWeight: preset === "chess" ? 400 : 600,
                              color: occ.color || (preset === "sequencer" && occ.active ? "var(--accent-ink)" : "var(--text)"),
                              background: preset === "sequencer" && occ.active ? "var(--accent)" : preset === "go" ? occ.color === "#0e0f11" ? "#f1f2ee" : "#0e0f11" : preset === "connect4" ? occ.color : preset === "spreadsheet" ? "transparent" : undefined,
                              width: preset === "go" || preset === "connect4" || preset === "checkers" || (preset === "sequencer" && occ.active) ? 32 : undefined,
                              height: preset === "go" || preset === "connect4" || preset === "checkers" || (preset === "sequencer" && occ.active) ? 32 : undefined,
                              borderRadius: preset === "go" || preset === "connect4" || preset === "checkers" || preset === "sequencer" ? 999 : undefined,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              border: preset === "go" && occ.color === "#0e0f11" ? "1px solid #2a2e36" : preset === "connect4" ? "2px solid rgba(0,0,0,0.2)" : undefined,
                              boxShadow: preset === "go" ? "0 2px 8px rgba(0,0,0,0.5)" : preset === "connect4" ? "inset 0 -3px 0 rgba(0,0,0,0.2)" : undefined,
                              transition: "all 0.2s",
                              zIndex: 1,
                            }}
                          >
                            {preset === "spreadsheet" && r === 0 ? occ.data : preset === "spreadsheet" && c === 0 ? occ.data : occ.data}
                          </div>
                        )}

                        {/* Empty tetro ghost */}
                        {isTetroCell && !occ && (
                          <div style={{ width: 12, height: 12, borderRadius: 4, background: currentTetro.color, opacity: 0.9, boxShadow: "0 0 10px currentColor" }} />
                        )}

                        {/* Calendar date number when no occupant? already occupant */}
                        {/* Sudoku faint numbers handled via occ */}

                        {/* Hover coord hint */}
                        <div className="mono" style={{ position: "absolute", bottom: 2, right: 4, fontSize: 7, color: "var(--muted-2)", opacity: 0, pointerEvents: "none" }} className="coord">{r},{c}</div>
                      </div>
                    );
                  })
                )
              )}
            </div>
          </div>

          {/* Bottom XML panel */}
          <div style={{ borderTop: "1px solid var(--border)", background: "var(--surface)", display: "flex", flexDirection: "column", maxHeight: 280 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid var(--border)", background: "var(--surface-2)" }}>
              <div className="mono" style={{ fontSize: 10, color: "var(--muted)", letterSpacing: 1 }}>OCELOT / XML REPRESENTATION — LIVE SUBSTRATE (ONLY PARAMS CHANGE BETWEEN CHESS & CHECKERS)</div>
              <button
                onClick={() => { if (xmlRef.current) { const t = xmlRef.current.innerText; const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); } }}
                className="mono"
                style={{ padding: "5px 10px", borderRadius: 999, border: "1px solid var(--border-2)", background: "var(--surface-3)", color: "var(--text)", fontSize: 10, cursor: "pointer" }}
              >
                COPY XML
              </button>
            </div>
            <pre ref={xmlRef} className="mono" style={{ margin: 0, padding: "14px 16px", overflow: "auto", fontSize: 11, lineHeight: 1.6, color: "#c8d0dc", background: "#0e0f11" }}>
              {xmlString}
            </pre>
          </div>
        </main>
      </div>

      {/* Responsive: stack on mobile via style tag */}
      <style>{`
        @media (max-width: 860px) {
          div[style*="grid-template-columns: 340px 1fr"] {
            grid-template-columns: 1fr !important;
          }
          aside { border-right: none !important; border-bottom: 1px solid var(--border); }
        }
        div:hover > .coord { opacity: 1 !important; }
      `}</style>

      <footer className="mono" style={{ maxWidth: 1440, margin: "0 auto", padding: "14px 24px", borderTop: "1px solid var(--border)", fontSize: 10, color: "var(--muted-2)", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span>Concept from Paramorphic Components text — grid as substrate, occupants as polymorphism.</span>
        <span style={{ color: "var(--muted)" }}>Built as lab instrument · CSS grid, not canvas · {config.rows * config.cols} cells · {occupants.length} occupants</span>
      </footer>
    </div>
  );
}
