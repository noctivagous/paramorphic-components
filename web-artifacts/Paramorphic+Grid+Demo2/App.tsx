import { useEffect, useMemo, useRef, useState } from "react";

type Alt = "none" | "checker" | "stripes" | "dots" | "boxes" | "lines";
type Aspect = "square" | "wide" | "tall";
type OccupantMode = "none" | "single" | "multi" | "toggled" | "numeric" | "data";

type Rules = { gravity: boolean; snapping: boolean; diagonal: boolean; wrap: boolean; resizeable: boolean; };

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
  type: string;
  data?: string;
  color?: string;
  active?: boolean;
};

type PresetKey =
  | "chess" | "checkers" | "go" | "spreadsheet" | "calendar" | "sequencer" | "tetris" | "keyboard" | "connect4" | "sudoku"
  | "nle" | "drum" | "crossword" | "piano" | "breakout";

type PresetMeta = { label: string; desc: string; icon?: string; config: Config };

const TRACK_LABELS = ["V1", "V2", "A1", "A2", "SFX", "Music"];
const PIANO_KEYS = ["B", "A#", "A", "G#", "G", "F#", "F", "E", "D#", "D", "C#", "C"];
const DRUM_BANKS = {
  A: {
    names: ["Kick", "Snare", "HiHat", "Clap", "Tom Lo", "Tom Hi", "Crash", "Ride", "Shaker", "Cowbell", "Clav", "Rim", "Kick2", "Perc1", "Perc2", "Vox"],
    colors: ["#ff4d4d", "#ff8a5b", "#e8ff52", "#7afcff", "#8b8eff", "#ff8a5b", "#e8ff52", "#7afcff", "#ff4d4d", "#8b8eff", "#e8ff52", "#ff8a5b", "#ff4d4d", "#7afcff", "#8b8eff", "#e8ff52"],
  },
  B: {
    names: ["808 Kick", "808 Snr", "OHat", "CHat", "Tom1", "Tom2", "Tom3", "Conga", "Bongo", "Clave", "Marac", "Tamb", "Zap", "Vox2", "FX1", "FX2"],
    colors: ["#2a3340", "#3a4558", "#e8ff52", "#7afcff", "#ff8a5b", "#ff4d4d", "#8b8eff", "#e8ff52", "#7afcff", "#ff8a5b", "#ff4d4d", "#8b8eff", "#e8ff52", "#7afcff", "#ff4d4d", "#ff8a5b"],
  },
};

function uid() { return Math.random().toString(36).slice(2, 9); }

const TETROMINOS: { name: string; shape: [number, number][]; color: string }[] = [
  { name: "T", shape: [[0, -1], [0, 0], [0, 1], [1, 0]], color: "#e8ff52" },
  { name: "L", shape: [[0, 0], [1, 0], [2, 0], [2, 1]], color: "#7afcff" },
  { name: "O", shape: [[0, 0], [0, 1], [1, 0], [1, 1]], color: "#ff8a5b" },
  { name: "I", shape: [[0, 0], [1, 0], [2, 0], [3, 0]], color: "#8b8eff" },
];

function getNLEOccupants(rows: number, cols: number): Occupant[] {
  const occ: Occupant[] = [];
  let clipId = 0;
  for (let r = 0; r < rows; r++) {
    let c = 0;
    while (c < cols - 1) {
      if (Math.random() < 0.32) { c++; continue; }
      let len = 2 + Math.floor(Math.random() * 4);
      if (c + len > cols) len = cols - c;
      if (len < 2) { c++; continue; }
      const label = `${TRACK_LABELS[r]} ${["Take", "Cut", "Sync", "Raw", "Alt"][Math.floor(Math.random() * 5)]} ${clipId + 1}`;
      occ.push({ id: `clip-${clipId}`, r, c, spanW: len, spanH: 1, type: "clip", data: label, color: ["#2a3340", "#3a4558", "#2e3a4a", "#343f55", "#283040", "#2f3a4e"][r % 6] });
      if (Math.random() < 0.28 && c + len < cols) {
        occ.push({ id: `trans-${clipId}`, r, c: c + len - 1, spanW: 1, spanH: 1, type: "transition", data: "x", color: "#e8ff52" });
      }
      clipId++;
      c += len + (Math.random() < 0.5 ? 1 : 0);
    }
  }
  for (let i = 0; i < 4; i++) occ.push({ id: `marker-${i}`, r: 0, c: Math.floor(Math.random() * cols), spanW: 1, spanH: 1, type: "marker", data: "◆", color: "#e8ff52" });
  return occ;
}

function getDrumOccupants(bank: "A" | "B"): Occupant[] {
  const b = DRUM_BANKS[bank];
  const occ: Occupant[] = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    const idx = r * 4 + c;
    occ.push({ id: `pad-${bank}-${idx}`, r, c, spanW: 1, spanH: 1, type: "pad", data: b.names[idx], color: b.colors[idx] });
  }
  return occ;
}

function genCrosswordData(rows = 15, cols = 15) {
  const blocked = new Set<string>();
  for (let r = 0; r < Math.ceil(rows / 2); r++) {
    for (let c = 0; c < cols; c++) {
      if (Math.random() < 0.13) {
        const key = `${r}-${c}`;
        const sym = `${rows - 1 - r}-${cols - 1 - c}`;
        if (blocked.has(key) || blocked.has(sym)) continue;
        let adj = 0;
        [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([dr, dc]) => {
          if (blocked.has(`${r + dr}-${c + dc}`)) adj++;
        });
        if (adj >= 2) continue;
        if (r === 0 && c < 3) continue;
        if (r === rows - 1 && c > cols - 4) continue;
        blocked.add(key); blocked.add(sym);
      }
    }
  }
  const blockOccupants: Occupant[] = [];
  blocked.forEach(k => {
    const [r, c] = k.split("-").map(Number);
    if (r >= 0 && r < rows && c >= 0 && c < cols) blockOccupants.push({ id: `block-${r}-${c}`, r, c, spanW: 1, spanH: 1, type: "block", data: "", color: "#0e0f11" });
  });
  const numbers = new Map<string, number>();
  let num = 1;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const key = `${r}-${c}`;
    if (blocked.has(key)) continue;
    const leftBlocked = c === 0 || blocked.has(`${r}-${c - 1}`);
    const rightNotBlocked = c + 1 < cols && !blocked.has(`${r}-${c + 1}`);
    const topBlocked = r === 0 || blocked.has(`${r - 1}-${c}`);
    const bottomNotBlocked = r + 1 < rows && !blocked.has(`${r + 1}-${c}`);
    if ((leftBlocked && rightNotBlocked) || (topBlocked && bottomNotBlocked)) numbers.set(key, num++);
  }
  return { blocked, numbers, blockOccupants };
}

function getPianoOccupants(rows: number, cols: number): Occupant[] {
  const occ: Occupant[] = [];
  for (let i = 0; i < 16; i++) {
    const r = Math.floor(Math.random() * rows);
    const c = Math.floor(Math.random() * (cols - 4));
    const len = 1 + Math.floor(Math.random() * 5);
    occ.push({ id: `note-${i}`, r, c, spanW: Math.min(len, cols - c), spanH: 1, type: "note", data: `v${60 + Math.floor(Math.random() * 50)}`, color: r % 2 === 0 ? "#e8ff52" : "#7afcff" });
  }
  return occ;
}

function getBreakoutOccupants(rows: number, cols: number): Occupant[] {
  const occ: Occupant[] = [];
  const rowColors = ["#ff4d4d", "#ff8a5b", "#e8ff52", "#7afcff", "#8b8eff"];
  for (let r = 0; r < 5; r++) for (let c = 0; c < cols; c++) {
    if (r === 2 && c % 3 === 0) continue;
    occ.push({ id: `brick-${r}-${c}`, r, c, spanW: 1, spanH: 1, type: "brick", data: "", color: rowColors[r] });
  }
  return occ;
}

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
    return [
      { id: "b1", r: 3, c: 3, spanW: 1, spanH: 1, type: "stone", data: "●", color: "#f1f2ee" },
      { id: "w1", r: 3, c: 15, spanW: 1, spanH: 1, type: "stone", data: "●", color: "#0e0f11" },
      { id: "b2", r: 9, c: 9, spanW: 1, spanH: 1, type: "stone", data: "●", color: "#f1f2ee" },
      { id: "w2", r: 15, c: 3, spanW: 1, spanH: 1, type: "stone", data: "●", color: "#0e0f11" },
      { id: "b3", r: 15, c: 15, spanW: 1, spanH: 1, type: "stone", data: "●", color: "#f1f2ee" },
    ];
  }
  if (preset === "spreadsheet") {
    const occ: Occupant[] = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) occ.push({ id: `s-${r}-${c}`, r, c, spanW: 1, spanH: 1, type: "data", data: r === 0 ? String.fromCharCode(65 + c) : (c === 0 ? `${r}` : `${Math.floor(Math.random() * 90 + 10)}`), color: "" });
    return occ;
  }
  if (preset === "calendar") {
    const occ: Occupant[] = []; let d = 1;
    for (let r = 0; r < 5; r++) for (let c = 0; c < 7; c++) { if (d <= 31) { occ.push({ id: `d-${d}`, r, c, spanW: 1, spanH: 1, type: "date", data: `${d}`, color: c >= 5 ? "#e8ff52" : "" }); d++; } }
    return occ;
  }
  if (preset === "sequencer") {
    const occ: Occupant[] = [];
    for (let i = 0; i < 18; i++) {
      const r = Math.floor(Math.random() * rows); const c = Math.floor(Math.random() * cols);
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
  if (preset === "nle") return getNLEOccupants(rows, cols);
  if (preset === "drum") return getDrumOccupants("A");
  if (preset === "crossword") return genCrosswordData(rows, cols).blockOccupants;
  if (preset === "piano") return getPianoOccupants(rows, cols);
  if (preset === "breakout") return getBreakoutOccupants(rows, cols);
  return [];
}

const PRESETS: Record<PresetKey, PresetMeta> = {
  chess: { label: "Chess", desc: "8×8 checker, single occupants, diagonal rules", icon: "♞", config: { rows: 8, cols: 8, gap: 2, radius: 4, alternating: "checker", aspect: "square", occupantMode: "single", rules: { gravity: false, snapping: true, diagonal: true, wrap: false, resizeable: false }, cellPrimary: "#1e2024", cellSecondary: "#2b2f37" } },
  checkers: { label: "Checkers", desc: "8×8 red/black, snapping, gravity off", icon: "●", config: { rows: 8, cols: 8, gap: 2, radius: 20, alternating: "checker", aspect: "square", occupantMode: "single", rules: { gravity: false, snapping: true, diagonal: true, wrap: false, resizeable: false }, cellPrimary: "#1d2026", cellSecondary: "#2e333e" } },
  go: { label: "Go", desc: "19×19 intersections, dots, stone occupants", icon: "◍", config: { rows: 19, cols: 19, gap: 0, radius: 24, alternating: "dots", aspect: "square", occupantMode: "single", rules: { gravity: false, snapping: true, diagonal: false, wrap: false, resizeable: false }, cellPrimary: "#1a1d21", cellSecondary: "#1a1d21" } },
  spreadsheet: { label: "Spreadsheet", desc: "10×12 data cells, stripe rows, editable", icon: "▦", config: { rows: 12, cols: 10, gap: 1, radius: 2, alternating: "stripes", aspect: "wide", occupantMode: "data", rules: { gravity: false, snapping: false, diagonal: false, wrap: false, resizeable: true }, cellPrimary: "#191c20", cellSecondary: "#1f242b" } },
  calendar: { label: "Calendar", desc: "7×5 month, weekend shading, numeric", icon: "📅", config: { rows: 5, cols: 7, gap: 8, radius: 12, alternating: "none", aspect: "square", occupantMode: "numeric", rules: { gravity: false, snapping: false, diagonal: false, wrap: false, resizeable: false }, cellPrimary: "#1a1d21", cellSecondary: "#22262e" } },
  sequencer: { label: "Sequencer", desc: "16×8 toggled notes, playhead, no gravity", icon: "🎛", config: { rows: 8, cols: 16, gap: 4, radius: 6, alternating: "stripes", aspect: "square", occupantMode: "toggled", rules: { gravity: false, snapping: false, diagonal: false, wrap: true, resizeable: false }, cellPrimary: "#181b1f", cellSecondary: "#21262e" } },
  tetris: { label: "Tetris", desc: "10×20 multi-cell, gravity on, resizeable", icon: "🧩", config: { rows: 20, cols: 10, gap: 2, radius: 4, alternating: "none", aspect: "square", occupantMode: "multi", rules: { gravity: true, snapping: false, diagonal: false, wrap: false, resizeable: true }, cellPrimary: "#161a1e", cellSecondary: "#1e242c" } },
  keyboard: { label: "Keyboard", desc: "10×4 offset rows, QWERTY single occupants", icon: "⌨", config: { rows: 4, cols: 10, gap: 6, radius: 10, alternating: "none", aspect: "wide", occupantMode: "single", rules: { gravity: false, snapping: false, diagonal: false, wrap: false, resizeable: false }, cellPrimary: "#1c1f24", cellSecondary: "#252b33" } },
  connect4: { label: "Connect 4", desc: "7×6 gravity drop, single occupants", icon: "🔴", config: { rows: 6, cols: 7, gap: 6, radius: 24, alternating: "none", aspect: "square", occupantMode: "single", rules: { gravity: true, snapping: false, diagonal: true, wrap: false, resizeable: false }, cellPrimary: "#171b20", cellSecondary: "#1e252e" } },
  sudoku: { label: "Sudoku", desc: "9×9 box outlines, numeric, box rules", icon: "🔢", config: { rows: 9, cols: 9, gap: 2, radius: 6, alternating: "boxes", aspect: "square", occupantMode: "numeric", rules: { gravity: false, snapping: false, diagonal: false, wrap: false, resizeable: false }, cellPrimary: "#1b1f25", cellSecondary: "#232a33" } },
  nle: { label: "NLE", desc: "24 cols time × 6 tracks V1 V2 A1 A2 SFX Music, clip + transition + marker + playhead", icon: "🎬", config: { rows: 6, cols: 24, gap: 4, radius: 8, alternating: "stripes", aspect: "wide", occupantMode: "multi", rules: { gravity: false, snapping: true, diagonal: false, wrap: false, resizeable: true }, cellPrimary: "#1b1e22", cellSecondary: "#232830" } },
  drum: { label: "Drum", desc: "4×4 pads, velocity look, Bank A/B, MIDI hint", icon: "🥁", config: { rows: 4, cols: 4, gap: 14, radius: 18, alternating: "none", aspect: "square", occupantMode: "single", rules: { gravity: false, snapping: false, diagonal: false, wrap: false, resizeable: false }, cellPrimary: "#1e2126", cellSecondary: "#252a33" } },
  crossword: { label: "Crossword", desc: "15×15 blocked cells, numbered clues, letter input, across/down toggle", icon: "🔤", config: { rows: 15, cols: 15, gap: 1, radius: 3, alternating: "none", aspect: "square", occupantMode: "single", rules: { gravity: false, snapping: false, diagonal: false, wrap: false, resizeable: false }, cellPrimary: "#f7f5ef", cellSecondary: "#f7f5ef" } },
  piano: { label: "Piano Roll", desc: "32 cols time × 12 pitch octave, note duration w, velocity, piano gutter", icon: "🎹", config: { rows: 12, cols: 32, gap: 2, radius: 4, alternating: "stripes", aspect: "wide", occupantMode: "multi", rules: { gravity: false, snapping: true, diagonal: false, wrap: false, resizeable: true }, cellPrimary: "#191c20", cellSecondary: "#1f242b" } },
  breakout: { label: "Breakout", desc: "13×16 bricks top 5 rows, paddle w=3 bottom, ball bounces, destructible", icon: "🧱", config: { rows: 16, cols: 13, gap: 4, radius: 6, alternating: "none", aspect: "square", occupantMode: "single", rules: { gravity: false, snapping: false, diagonal: true, wrap: false, resizeable: false }, cellPrimary: "#171b20", cellSecondary: "#1e252e" } },
};

const CATEGORIES: Record<string, PresetKey[]> = {
  "Board Games": ["chess", "checkers", "go", "connect4", "crossword", "breakout"],
  "Data": ["spreadsheet", "calendar", "sudoku"],
  "Music": ["sequencer", "drum", "piano"],
  "Media": ["nle", "tetris"],
  "Input": ["keyboard"],
};

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

  // new states
  const [drumBank, setDrumBank] = useState<"A" | "B">("A");
  const [drumHits, setDrumHits] = useState<Record<string, number>>({});
  const [crosswordBlocked, setCrosswordBlocked] = useState<Set<string>>(new Set());
  const [crosswordNumbers, setCrosswordNumbers] = useState<Map<string, number>>(new Map());
  const [crosswordLetters, setCrosswordLetters] = useState<Record<string, string>>({});
  const [crosswordSelected, setCrosswordSelected] = useState<{ r: number; c: number } | null>({ r: 0, c: 0 });
  const [crosswordDir, setCrosswordDir] = useState<"across" | "down">("across");
  const [paddleC, setPaddleC] = useState(5);
  const [ball, setBall] = useState<{ r: number; c: number; dr: number; dc: number; active: boolean }>({ r: 12, c: 6, dr: -1, dc: 1, active: false });
  const [breakoutScore, setBreakoutScore] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "records.list", args: { collection: "grids", limit: 20 } }) });
        const j = await res.json();
        if (j.data) setSavedGrids(j.data.records || []);
      } catch { }
    })();
  }, []);

  useEffect(() => {
    if (!play) return;
    const id = setInterval(() => {
      if (preset === "sequencer" || preset === "nle" || preset === "piano") setPlayhead(p => (p + 1) % config.cols);
      if (preset === "tetris" || (config.rules.gravity && preset === "connect4")) {
        if (preset === "tetris") {
          setTetroPos(p => {
            const nextR = p.r + 1;
            if (nextR > config.rows - 4) return { r: 0, c: Math.floor(Math.random() * (config.cols - 2)) + 1 };
            return { r: nextR, c: p.c };
          });
        }
      }
    }, preset === "sequencer" ? 180 : preset === "nle" ? 320 : preset === "piano" ? 220 : 520);
    return () => clearInterval(id);
  }, [play, preset, config.cols, config.rows, config.rules.gravity]);

  // breakout physics
  useEffect(() => {
    if (!play || preset !== "breakout") return;
    const id = setInterval(() => {
      setBall(b => {
        if (!b.active) return b;
        let nr = b.r + b.dr * 0.75;
        let nc = b.c + b.dc * 0.75;
        if (nc < 0 || nc >= config.cols) {
          return { ...b, dc: -b.dc, c: Math.max(0, Math.min(config.cols - 1, b.c)) };
        }
        if (nr < 0) return { ...b, dr: -b.dr, r: 0 };
        if (nr >= config.rows - 2 && nr < config.rows && nc >= paddleC && nc < paddleC + 3) {
          const hitPos = (nc - paddleC) / 3;
          const newDc = (hitPos - 0.5) * 2.2;
          return { r: config.rows - 3, c: nc, dr: -Math.abs(b.dr), dc: newDc || b.dc, active: true };
        }
        const roundedR = Math.round(nr); const roundedC = Math.round(nc);
        const brick = occupants.find(o => o.type === "brick" && o.r === roundedR && o.c === roundedC);
        if (brick) {
          setOccupants(prev => prev.filter(o => o.id !== brick.id));
          setBreakoutScore(s => s + 10);
          return { ...b, dr: -b.dr, r: b.r, c: b.c };
        }
        if (nr >= config.rows) {
          return { r: config.rows - 2, c: paddleC + 1, dr: -1, dc: (Math.random() - 0.5) * 1.4, active: false };
        }
        return { ...b, r: nr, c: nc };
      });
    }, 92);
    return () => clearInterval(id);
  }, [play, preset, config.cols, config.rows, occupants, paddleC]);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toUpperCase();
      setLitKey(k);
      setTimeout(() => setLitKey(null), 220);

      if (preset === "crossword" && crosswordSelected) {
        if (/^[A-Z]$/.test(e.key.toUpperCase())) {
          const key = `${crosswordSelected.r}-${crosswordSelected.c}`;
          if (!crosswordBlocked.has(key)) {
            setCrosswordLetters(prev => ({ ...prev, [key]: e.key.toUpperCase() }));
            let nr = crosswordSelected.r; let nc = crosswordSelected.c;
            if (crosswordDir === "across") nc++; else nr++;
            while (nr < 15 && nc < 15 && crosswordBlocked.has(`${nr}-${nc}`)) { if (crosswordDir === "across") nc++; else nr++; }
            if (nr < 15 && nc < 15) setCrosswordSelected({ r: nr, c: nc });
          }
        } else if (e.key === "Backspace") {
          const key = `${crosswordSelected.r}-${crosswordSelected.c}`;
          setCrosswordLetters(prev => { const n = { ...prev }; delete n[key]; return n; });
        } else if (e.key.startsWith("Arrow")) {
          e.preventDefault();
          let { r, c } = crosswordSelected;
          if (e.key === "ArrowRight") c = Math.min(14, c + 1);
          if (e.key === "ArrowLeft") c = Math.max(0, c - 1);
          if (e.key === "ArrowDown") r = Math.min(14, r + 1);
          if (e.key === "ArrowUp") r = Math.max(0, r - 1);
          if (!crosswordBlocked.has(`${r}-${c}`)) setCrosswordSelected({ r, c });
        } else if (e.key === " ") {
          setCrosswordDir(d => d === "across" ? "down" : "across");
        }
      }

      if (preset === "breakout") {
        if (e.key === "ArrowLeft") setPaddleC(p => Math.max(0, p - 1));
        if (e.key === "ArrowRight") setPaddleC(p => Math.min(config.cols - 3, p + 1));
        if (e.key === " ") setBall(b => ({ ...b, active: true, dr: -1, dc: (Math.random() - 0.5) }));
      }

      if (preset === "drum") {
        const map: Record<string, number> = { Q: 0, W: 1, E: 2, R: 3, A: 4, S: 5, D: 6, F: 7, Z: 8, X: 9, C: 10, V: 11, U: 12, I: 13, O: 14, P: 15 };
        const idx = map[e.key.toUpperCase()];
        if (idx !== undefined) {
          const occ = occupants[idx];
          if (occ) setDrumHits(h => ({ ...h, [occ.id]: Date.now() }));
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preset, crosswordSelected, crosswordBlocked, crosswordDir, config.cols, occupants, paddleC]);

  useEffect(() => {
    if (preset === "drum") {
      setOccupants(getDrumOccupants(drumBank));
    }
  }, [drumBank]);

  const applyPreset = (k: PresetKey) => {
    const meta = PRESETS[k];
    setPreset(k);
    setConfig(meta.config);
    setSelectedId(null);
    setTetroIndex(0);
    setPlayhead(0);
    setPlay(k === "sequencer" || k === "nle" || k === "piano" ? true : k === "breakout" ? false : true);
    setTetroPos({ r: 0, c: Math.floor(meta.config.cols / 2) });

    if (k === "crossword") {
      const { blocked, numbers, blockOccupants } = genCrosswordData(meta.config.rows, meta.config.cols);
      setCrosswordBlocked(blocked); setCrosswordNumbers(numbers); setCrosswordLetters({});
      setCrosswordSelected({ r: 0, c: 0 }); setCrosswordDir("across");
      setOccupants(blockOccupants); return;
    }
    if (k === "drum") { setDrumBank("A"); setDrumHits({}); setOccupants(getDrumOccupants("A")); return; }
    if (k === "nle") { setOccupants(getNLEOccupants(meta.config.rows, meta.config.cols)); return; }
    if (k === "piano") { setOccupants(getPianoOccupants(meta.config.rows, meta.config.cols)); return; }
    if (k === "breakout") {
      setOccupants(getBreakoutOccupants(meta.config.rows, meta.config.cols));
      setPaddleC(5); setBall({ r: 12, c: 6, dr: -1, dc: 1, active: false }); setBreakoutScore(0); setPlay(false); return;
    }
    setOccupants(makeOccupants(k, meta.config.rows, meta.config.cols));
  };

  const updateConfig = (patch: Partial<Config>) => setConfig(c => ({ ...c, ...patch }));
  const updateRules = (patch: Partial<Rules>) => setConfig(c => ({ ...c, rules: { ...c.rules, ...patch } }));

  const applyGravity = () => {
    if (preset !== "tetris" && preset !== "connect4") return;
    setOccupants(prev => {
      const colsMap: Record<number, Occupant[]> = {};
      prev.forEach(o => { if (o.type === "floor") return; if (!colsMap[o.c]) colsMap[o.c] = []; colsMap[o.c].push(o); });
      const next: Occupant[] = prev.filter(o => o.type === "floor");
      Object.entries(colsMap).forEach(([colStr, list]) => {
        const sorted = [...list].sort((a, b) => b.r - a.r);
        let r = config.rows - 1;
        if (preset === "tetris" && prev.find(f => f.type === "floor")) r = config.rows - 2;
        sorted.forEach(o => { next.push({ ...o, r }); r--; });
      });
      return next;
    });
  };

  const handleCellClick = (r: number, c: number) => {
    const occAt = occupants.find(o => o.r === r && o.c === c);
    if (preset === "sequencer") {
      if (occAt) setOccupants(prev => prev.filter(o => !(o.r === r && o.c === c)));
      else setOccupants(prev => [...prev, { id: uid(), r, c, spanW: 1, spanH: 1, type: "note", data: "♪", active: true, color: "#e8ff52" }]);
      return;
    }
    if (preset === "connect4") {
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
        setOccupants(prev => [...prev, { id: uid(), r, c, spanW: 1, spanH: 1, type: "stone", data: "●", color: color === "#0e0f11" ? "#0e0f11" : color }]);
      }
      return;
    }
    if (preset === "chess" || preset === "checkers") {
      if (occAt) setSelectedId(occAt.id);
      else if (selectedId) {
        const sel = occupants.find(o => o.id === selectedId);
        if (sel) { setOccupants(prev => prev.map(o => o.id === selectedId ? { ...o, r, c } : o)); setSelectedId(null); }
      }
      return;
    }
    if (preset === "keyboard") {
      const k = occupants.find(o => o.r === r && o.c === c);
      if (k) { setLitKey(k.data || null); setTimeout(() => setLitKey(null), 250); }
      return;
    }
    if (preset === "sudoku" || preset === "spreadsheet") {
      if (!occAt) setOccupants(prev => [...prev, { id: uid(), r, c, spanW: 1, spanH: 1, type: preset === "sudoku" ? "num" : "data", data: preset === "sudoku" ? "5" : "42" }]);
      else setSelectedId(occAt.id);
      return;
    }
    if (preset === "nle") {
      const clipAt = occupants.find(o => o.type === "clip" && o.r === r && c >= o.c && c < o.c + o.spanW);
      if (clipAt) { setSelectedId(clipAt.id); return; }
      if (selectedId) {
        const sel = occupants.find(o => o.id === selectedId && o.type === "clip");
        if (sel) { setOccupants(prev => prev.map(o => o.id === selectedId ? { ...o, r, c: Math.max(0, Math.min(c, config.cols - o.spanW)) } : o)); return; }
      }
      const newClip: Occupant = { id: uid(), r, c, spanW: 3, spanH: 1, type: "clip", data: `${TRACK_LABELS[r]} Take ${Math.floor(Math.random() * 90 + 10)}`, color: "#2a3340" };
      setOccupants(prev => [...prev, newClip]); setSelectedId(newClip.id); return;
    }
    if (preset === "drum") {
      if (occAt) { setDrumHits(h => ({ ...h, [occAt.id]: Date.now() })); setLitKey(occAt.data || null); setTimeout(() => setLitKey(null), 200); }
      return;
    }
    if (preset === "crossword") {
      const key = `${r}-${c}`; if (crosswordBlocked.has(key)) return;
      if (crosswordSelected && crosswordSelected.r === r && crosswordSelected.c === c) setCrosswordDir(d => d === "across" ? "down" : "across");
      else setCrosswordSelected({ r, c });
      return;
    }
    if (preset === "piano") {
      const noteAt = occupants.find(o => o.type === "note" && o.r === r && c >= o.c && c < o.c + o.spanW);
      if (noteAt) { setOccupants(prev => prev.filter(o => o.id !== noteAt.id)); return; }
      const newNote: Occupant = { id: uid(), r, c, spanW: 2 + Math.floor(Math.random() * 3), spanH: 1, type: "note", data: `v${60 + Math.floor(Math.random() * 40)}`, color: r % 2 === 0 ? "#e8ff52" : "#7afcff" };
      setOccupants(prev => [...prev, newNote]); return;
    }
    if (preset === "breakout") {
      if (occAt && occAt.type === "brick") { setOccupants(prev => prev.filter(o => o.id !== occAt.id)); setBreakoutScore(s => s + 10); return; }
      if (r >= config.rows - 2) setPaddleC(Math.max(0, Math.min(config.cols - 3, c - 1)));
      return;
    }
  };

  const rotateTetro = () => setTetroIndex(i => (i + 1) % TETROMINOS.length);
  const currentTetro = TETROMINOS[tetroIndex];

  const xmlString = useMemo(() => {
    const alt = config.alternating;
    const tagFor = (t: string) => {
      const map: Record<string, string> = { clip: "Clip", transition: "Transition", marker: "Marker", pad: "Pad", block: "Block", brick: "Brick", paddle: "Paddle", ball: "Ball", note: "Note", letter: "Letter", disc: "Disc", stone: "Stone", checker: "Checker", piece: "Piece", pawn: "Pawn", data: "Data", date: "Date", num: "Num", key: "Key", floor: "Floor" };
      const base = map[t] || (t.charAt(0).toUpperCase() + t.slice(1));
      return `${base}Occupant`;
    };
    const occXml = occupants.slice(0, 12).map(o => {
      const tag = tagFor(o.type);
      const span = o.spanW > 1 || o.spanH > 1 ? ` span="${o.spanW}x${o.spanH}"` : "";
      const dataAttr = o.data ? ` data="${(o.data || "").replace(/"/g, "'")}"` : "";
      const colorAttr = o.color ? ` color="${o.color}"` : "";
      const extra = o.type === "clip" ? ` src="clip_${o.id}.mp4" duration="${o.spanW * 0.5}s"` : o.type === "note" && preset === "piano" ? ` velocity="${o.data}" duration="${o.spanW}"` : o.type === "pad" ? ` midi="${60 + (o.r * 4 + o.c)}" bank="${drumBank}"` : "";
      return `  <${tag} id="${o.id}" r="${o.r}" c="${o.c}"${span}${dataAttr}${colorAttr}${extra} />`;
    }).join("\n");
    const more = occupants.length > 12 ? `\n  <!-- +${occupants.length - 12} more -->` : "";
    return `<ParamorphicGrid rows="${config.rows}" cols="${config.cols}" gap="${config.gap}px" radius="${config.radius}px" alternating="${alt}" aspect="${config.aspect}" occupantMode="${config.occupantMode}">
  <Rules gravity="${config.rules.gravity}" snapping="${config.rules.snapping}" diagonal="${config.rules.diagonal}" wrap="${config.rules.wrap}" resizeable="${config.rules.resizeable}" />
  <Style primary="${config.cellPrimary}" secondary="${config.cellSecondary}" />
  <Occupants count="${occupants.length}">
${occXml}${more}
  </Occupants>
</ParamorphicGrid>`;
  }, [config, occupants, drumBank, preset]);

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
      if (j.data) setSavedGrids(s => [j.data, ...s]);
    } catch { }
    setBusy(false);
  };

  const getWordRange = (sel: { r: number; c: number } | null, dir: "across" | "down", blocked: Set<string>) => {
    if (!sel) return [];
    const range: string[] = [];
    if (dir === "across") {
      let c = sel.c; while (c >= 0 && !blocked.has(`${sel.r}-${c}`)) c--; c++;
      while (c < 15 && !blocked.has(`${sel.r}-${c}`)) { range.push(`${sel.r}-${c}`); c++; }
    } else {
      let r = sel.r; while (r >= 0 && !blocked.has(`${r}-${sel.c}`)) r--; r++;
      while (r < 15 && !blocked.has(`${r}-${sel.c}`)) { range.push(`${r}-${sel.c}`); r++; }
    }
    return range;
  };
  const wordRange = preset === "crossword" ? getWordRange(crosswordSelected, crosswordDir, crosswordBlocked) : [];

  return (
    <div data-safe-area-inset-root style={{ boxSizing: "border-box", paddingTop: "var(--safe-area-inset-top)", minHeight: "100vh", background: "var(--bg)", overflowX: "clip" }}>
      <header data-safe-area-sticky-top style={{ top: "var(--safe-area-inset-top)", position: "sticky", zIndex: 20, background: "rgba(14,15,17,0.92)", backdropFilter: "blur(16px)", borderBottom: "1px solid var(--border)" }}>
        <div style={{ maxWidth: 1440, margin: "0 auto", padding: "18px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: 28, letterSpacing: -0.5, lineHeight: 1, fontWeight: 400 }}>
              Paramorphic Grid — <span style={{ fontStyle: "italic", opacity: 0.9 }}>One Component, Many Forms</span>
            </h1>
            <p className="mono" style={{ fontSize: 11, color: "var(--muted)", marginTop: 6, letterSpacing: 0.4 }}>
              A SINGLE GRID SUBSTRATE MORPHED VIA PARAMS INTO DIVERSE APPS · ROWS/COLS/CELLS + ALTERNATING + OCCUPANTS + RULES · 15 PRESETS
            </p>
          </div>
          <div className="mono" style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11 }}>
            <span style={{ color: "var(--muted)" }}>LAB INSTRUMENT v0.2 · {preset.toUpperCase()}</span>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--accent)", boxShadow: "0 0 8px var(--accent)" }} />
          </div>
        </div>
      </header>

      <div style={{ maxWidth: 1440, margin: "0 auto", display: "grid", gridTemplateColumns: "360px 1fr", minHeight: "calc(100vh - 73px)" }}>
        <aside style={{ borderRight: "1px solid var(--border)", background: "var(--surface)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: 18, borderBottom: "1px solid var(--border)", background: "var(--surface-2)", maxHeight: 420, overflowY: "auto" }}>
            <div className="mono" style={{ fontSize: 10, letterSpacing: 1, color: "var(--muted)", marginBottom: 12 }}>PRESETS — CLICK TO MORPH</div>
            {Object.entries(CATEGORIES).map(([cat, keys]) => (
              <div key={cat} style={{ marginBottom: 14 }}>
                <div className="mono" style={{ fontSize: 9, letterSpacing: 0.9, color: "var(--muted-2)", marginBottom: 6 }}>{cat.toUpperCase()}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {keys.map(k => {
                    const meta = PRESETS[k];
                    return (
                      <button key={k} onClick={() => applyPreset(k)} className="mono" style={{
                        padding: "6px 10px", borderRadius: "var(--radius-pill)", border: preset === k ? "1px solid var(--accent)" : "1px solid var(--border-2)",
                        background: preset === k ? "var(--accent)" : "var(--surface-3)", color: preset === k ? "var(--accent-ink)" : "var(--text)",
                        fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 4
                      }}>
                        <span>{meta.icon}</span><span>{meta.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="mono" style={{ marginTop: 8, fontSize: 10, color: "var(--muted-2)", lineHeight: 1.4 }}>{PRESETS[preset].desc}</div>
          </div>

          <div style={{ padding: 18, overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 18 }}>
            {[
              { label: "Rows", key: "rows", min: 3, max: 24, val: config.rows },
              { label: "Cols", key: "cols", min: 3, max: 32, val: config.cols },
              { label: "Cell Gap", key: "gap", min: 0, max: 14, val: config.gap },
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

            {/* Preset-specific controls */}
            {preset === "drum" && (
              <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface-2)" }}>
                <div className="mono" style={{ fontSize: 10, color: "var(--muted)", marginBottom: 8 }}>BANK SWITCH</div>
                <div style={{ display: "flex", gap: 8 }}>
                  {(["A", "B"] as const).map(b => (
                    <button key={b} onClick={() => setDrumBank(b)} className="mono" style={{ flex: 1, padding: "8px", borderRadius: 8, border: drumBank === b ? "1px solid var(--accent)" : "1px solid var(--border)", background: drumBank === b ? "var(--accent)" : "var(--surface-3)", color: drumBank === b ? "var(--accent-ink)" : "var(--text)", fontSize: 11, cursor: "pointer" }}>Bank {b}</button>
                  ))}
                </div>
                <div className="mono" style={{ fontSize: 9, color: "var(--muted-2)", marginTop: 8 }}>QWER ASDF ZXCV UIOP = pads · Visual MIDI: C2–G3</div>
              </div>
            )}

            {preset === "crossword" && (
              <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface-2)" }}>
                <div className="mono" style={{ fontSize: 10, color: "var(--muted)", marginBottom: 8 }}>CROSSWORD TOOLS</div>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <button onClick={() => setCrosswordDir(d => d === "across" ? "down" : "across")} className="mono" style={{ flex: 1, padding: "8px", borderRadius: 8, border: "1px solid var(--border-2)", background: "var(--surface-3)", color: "var(--text)", fontSize: 11, cursor: "pointer" }}>{crosswordDir.toUpperCase()} ↻</button>
                  <button onClick={() => setCrosswordLetters({})} className="mono" style={{ flex: 1, padding: "8px", borderRadius: 8, border: "1px solid var(--border-2)", background: "var(--surface-3)", color: "var(--text)", fontSize: 11, cursor: "pointer" }}>Clear</button>
                </div>
                <div className="mono" style={{ fontSize: 9, color: "var(--muted-2)" }}>Click cell to select · Space toggles dir · Type letters · Selected: {crosswordSelected ? `${crosswordSelected.r},${crosswordSelected.c}` : "none"}</div>
                <div className="mono" style={{ fontSize: 9, color: "var(--muted-2)", marginTop: 4 }}>Clues auto-numbered: {crosswordNumbers.size} starts · {Object.keys(crosswordLetters).length} letters</div>
              </div>
            )}

            {preset === "breakout" && (
              <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface-2)" }}>
                <div className="mono" style={{ fontSize: 10, color: "var(--muted)", marginBottom: 8 }}>BREAKOUT CONTROLS</div>
                <div className="mono" style={{ fontSize: 11, marginBottom: 8 }}>Score: <span style={{ color: "var(--accent)" }}>{breakoutScore}</span> · Bricks: {occupants.filter(o => o.type === "brick").length}</div>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <button onClick={() => setPaddleC(p => Math.max(0, p - 1))} className="mono" style={{ flex: 1, padding: "8px", borderRadius: 8, border: "1px solid var(--border-2)", background: "var(--surface-3)", color: "var(--text)", cursor: "pointer" }}>◀</button>
                  <button onClick={() => { setBall(b => ({ ...b, active: true, dr: -1, dc: (Math.random() - 0.5) * 1.2 })); setPlay(true); }} className="mono" style={{ flex: 1, padding: "8px", borderRadius: 8, border: "1px solid var(--accent)", background: "var(--accent)", color: "var(--accent-ink)", cursor: "pointer" }}>LAUNCH ●</button>
                  <button onClick={() => setPaddleC(p => Math.min(config.cols - 3, p + 1))} className="mono" style={{ flex: 1, padding: "8px", borderRadius: 8, border: "1px solid var(--border-2)", background: "var(--surface-3)", color: "var(--text)", cursor: "pointer" }}>▶</button>
                </div>
                <div className="mono" style={{ fontSize: 9, color: "var(--muted-2)" }}>← → move paddle · Space launch · Ball bounces diagonal true · Click brick to test</div>
              </div>
            )}

            {preset === "nle" && (
              <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface-2)" }}>
                <div className="mono" style={{ fontSize: 10, color: "var(--muted)", marginBottom: 8 }}>NLE TOOLS</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button onClick={() => { const r = Math.floor(Math.random() * config.rows); const c = Math.floor(Math.random() * (config.cols - 3)); const nc: Occupant = { id: uid(), r, c, spanW: 2 + Math.floor(Math.random() * 4), spanH: 1, type: "clip", data: `${TRACK_LABELS[r]} New ${Math.floor(Math.random() * 100)}`, color: "#2a3340" }; setOccupants(p => [...p, nc]); }} className="mono" style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border-2)", background: "var(--surface-3)", color: "var(--text)", fontSize: 10, cursor: "pointer" }}>+ Clip</button>
                  {selectedId && (
                    <>
                      <button onClick={() => setOccupants(prev => prev.map(o => o.id === selectedId ? { ...o, spanW: Math.max(1, o.spanW - 1) } : o))} className="mono" style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border-2)", background: "var(--surface-3)", color: "var(--text)", fontSize: 10, cursor: "pointer" }}>Trim ◀</button>
                      <button onClick={() => setOccupants(prev => prev.map(o => o.id === selectedId ? { ...o, spanW: Math.min(config.cols - o.c, o.spanW + 1) } : o))} className="mono" style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border-2)", background: "var(--surface-3)", color: "var(--text)", fontSize: 10, cursor: "pointer" }}>Extend ▶</button>
                      <button onClick={() => setOccupants(prev => prev.filter(o => o.id !== selectedId))} className="mono" style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #ff4d4d", background: "rgba(255,77,77,0.12)", color: "#ff8a8a", fontSize: 10, cursor: "pointer" }}>Delete</button>
                    </>
                  )}
                </div>
                <div className="mono" style={{ fontSize: 9, color: "var(--muted-2)", marginTop: 8 }}>Click clip to select · Click empty track to place · Drag to move · Playhead snaps to FPS</div>
              </div>
            )}

            {preset === "piano" && (
              <div style={{ border: "1px solid var(--border)", borderRadius: 12, padding: 12, background: "var(--surface-2)" }}>
                <div className="mono" style={{ fontSize: 10, color: "var(--muted)", marginBottom: 8 }}>PIANO ROLL TOOLS</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => { const r = Math.floor(Math.random() * config.rows); const c = Math.floor(Math.random() * (config.cols - 3)); setOccupants(p => [...p, { id: uid(), r, c, spanW: 3, spanH: 1, type: "note", data: `v${70 + Math.floor(Math.random() * 30)}`, color: "#e8ff52" }]); }} className="mono" style={{ flex: 1, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border-2)", background: "var(--surface-3)", color: "var(--text)", fontSize: 10, cursor: "pointer" }}>+ Note</button>
                  <button onClick={() => setOccupants([])} className="mono" style={{ flex: 1, padding: "6px 10px", borderRadius: 8, border: "1px solid var(--border-2)", background: "var(--surface-3)", color: "var(--text)", fontSize: 10, cursor: "pointer" }}>Clear</button>
                </div>
                <div className="mono" style={{ fontSize: 9, color: "var(--muted-2)", marginTop: 8 }}>Click empty to draw · Click note to erase · Drag to change pitch/duration · Playhead loops</div>
              </div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={applyGravity} className="mono" style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid var(--border-2)", background: "var(--surface-3)", color: "var(--text)", fontSize: 11, cursor: "pointer" }}>Apply Gravity ↓</button>
              {preset === "tetris" && <button onClick={rotateTetro} className="mono" style={{ flex: 1, padding: "10px", borderRadius: 10, border: "1px solid var(--accent)", background: "var(--accent)", color: "var(--accent-ink)", fontSize: 11, cursor: "pointer" }}>Rotate ↻</button>}
            </div>

            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 14 }}>
              <div className="mono" style={{ fontSize: 10, color: "var(--muted)", marginBottom: 10, letterSpacing: 0.8 }}>LEGEND</div>
              <div className="mono" style={{ fontSize: 10, lineHeight: 1.6, color: "var(--muted-2)" }}>
                <div><span style={{ color: "var(--accent)" }}>Paramorphic Grid</span> = rows/cols/cells + alternating + occupants + rules.</div>
                <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
                  <div>• ClipOccupant = src + duration w + track r</div>
                  <div>• PadOccupant = midi + velocity flash</div>
                  <div>• BlockOccupant = blocked cell + clue number</div>
                  <div>• NoteOccupant = pitch r + duration w + velocity</div>
                  <div>• Brick/Paddle/Ball = breakout physics</div>
                </div>
              </div>
            </div>

            <div style={{ marginTop: "auto", paddingTop: 12, borderTop: "1px solid var(--border)" }}>
              <button onClick={saveGrid} disabled={busy} className="mono" style={{ width: "100%", padding: "11px", borderRadius: 12, border: "1px solid var(--border-2)", background: "var(--surface-3)", color: "var(--text)", fontSize: 11, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
                {busy ? "Saving…" : "Save Current Grid → Records"}
              </button>
              {savedGrids.length > 0 && <div className="mono" style={{ marginTop: 10, fontSize: 10, color: "var(--muted)" }}>Saved: {savedGrids.length} grids</div>}
            </div>
          </div>
        </aside>

        <main style={{ display: "flex", flexDirection: "column", minWidth: 0, background: "var(--bg)" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, background: "var(--surface)", flexWrap: "wrap" }}>
            <div className="mono" style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 11, flexWrap: "wrap" }}>
              <span style={{ color: "var(--muted)" }}>VIEWPORT</span>
              <span style={{ padding: "3px 8px", borderRadius: 999, background: "var(--accent-dim)", border: "1px solid rgba(232,255,82,0.2)", color: "var(--accent)" }}>{preset.toUpperCase()} · {config.rows}×{config.cols} · {config.occupantMode.toUpperCase()}</span>
              {(preset === "sequencer" || preset === "tetris" || preset === "nle" || preset === "piano" || preset === "breakout") && (
                <button onClick={() => setPlay(p => !p)} className="mono" style={{ padding: "4px 10px", borderRadius: 999, border: "1px solid var(--border-2)", background: play ? "var(--accent)" : "var(--surface-3)", color: play ? "var(--accent-ink)" : "var(--text)", cursor: "pointer", fontSize: 10 }}>{play ? "❚❚ PAUSE" : "▶ PLAY"}</button>
              )}
            </div>
            <div className="mono" style={{ fontSize: 10, color: "var(--muted-2)", display: "flex", gap: 12 }}>
              <span>HOVER → COORDS</span><span>CLICK → ACT</span><span style={{ color: "var(--accent)" }}>● LIVE</span>
            </div>
          </div>

          <div style={{ flex: 1, padding: 18, overflow: "auto", display: "flex", justifyContent: "center", alignItems: "flex-start" }}>
            {/* NLE */}
            {preset === "nle" ? (
              <div style={{ width: "100%", maxWidth: 1100, display: "flex", flexDirection: "column", gap: 0 }}>
                <div style={{ display: "flex", gap: 0, marginBottom: 6 }}>
                  <div style={{ width: 60, flexShrink: 0 }} />
                  <div style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${config.cols}, minmax(0,1fr))`, gap: config.gap }}>
                    {Array.from({ length: config.cols }).map((_, c) => (
                      <div key={c} className="mono" style={{ fontSize: 9, color: c % 4 === 0 ? "var(--text)" : "var(--muted-2)" }}>
                        <div>{c % 2 === 0 ? `${String(Math.floor(c / 4)).padStart(2, "0")}:${String((c % 4) * 15).padStart(2, "0")}` : ""}</div>
                        <div style={{ height: 8, marginTop: 2, display: "flex", alignItems: "flex-end" }}>
                          <div style={{ width: "100%", height: c % 4 === 0 ? 6 : c % 2 === 0 ? 4 : 2, background: c % 4 === 0 ? "var(--text)" : "var(--border)", borderRadius: 1 }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 0 }}>
                  <div style={{ width: 60, display: "flex", flexDirection: "column", gap: config.gap, flexShrink: 0 }}>
                    {TRACK_LABELS.map((label, r) => (
                      <div key={r} className="mono" style={{ height: 64, display: "flex", alignItems: "center", justifyContent: "flex-end", paddingRight: 10, fontSize: 10, color: r < 2 ? "#7afcff" : r < 4 ? "#e8ff52" : "#ff8a5b", background: r % 2 === 0 ? "var(--surface-2)" : "var(--surface)", borderRadius: 6, border: "1px solid var(--border)" }}>{label}</div>
                    ))}
                  </div>
                  <div style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${config.cols}, minmax(0,1fr))`, gridTemplateRows: `repeat(${config.rows}, 64px)`, gap: config.gap, position: "relative", background: "var(--surface)", padding: 8, borderRadius: 12, border: "1px solid var(--border)" }}>
                    {Array.from({ length: config.rows }).flatMap((_, r) => Array.from({ length: config.cols }).map((_, c) => (
                      <div key={`${r}-${c}`} onClick={() => handleCellClick(r, c)} style={{ background: r % 2 === 0 ? config.cellPrimary : config.cellSecondary, borderRadius: config.radius, border: "1px solid var(--border)", opacity: 0.5, cursor: "pointer" }} />
                    )))}
                    {occupants.filter(o => o.type === "clip").map(o => (
                      <div key={o.id} onClick={e => { e.stopPropagation(); setSelectedId(o.id); }} onMouseDown={() => setDragId(o.id)} onMouseUp={() => { if (dragId === o.id) { setDragId(null); } }}
                        style={{
                          gridRow: o.r + 1, gridColumn: `${o.c + 1} / span ${o.spanW}`,
                          background: selectedId === o.id ? "var(--accent)" : o.color || "#2a3340",
                          borderRadius: 8, border: selectedId === o.id ? "1.5px solid var(--accent)" : "1px solid var(--border-2)",
                          display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "6px 8px", cursor: "pointer", overflow: "hidden", zIndex: 1,
                          color: selectedId === o.id ? "var(--accent-ink)" : "var(--text)", boxShadow: selectedId === o.id ? "0 0 0 2px var(--accent-dim)" : "none"
                        }}>
                        <div className="mono" style={{ fontSize: 9, display: "flex", justifyContent: "space-between", gap: 4 }}><span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{o.data}</span><span>{(o.spanW * 0.5).toFixed(1)}s</span></div>
                        <div style={{ height: 18, background: `linear-gradient(90deg, ${o.color || "#3a4558"} 0%, rgba(0,0,0,0.35) 100%)`, borderRadius: 4, marginTop: 4, opacity: 0.9, position: "relative" }}>
                          <div style={{ position: "absolute", inset: 2, background: `repeating-linear-gradient(90deg, rgba(255,255,255,0.12) 0 8px, transparent 8px 16px)`, borderRadius: 2 }} />
                        </div>
                        <div className="mono" style={{ fontSize: 8, opacity: 0.6, marginTop: 2 }}>◼ waveform · {o.spanW * 12} fps</div>
                      </div>
                    ))}
                    {occupants.filter(o => o.type === "transition").map(o => (
                      <div key={o.id} style={{ gridRow: o.r + 1, gridColumn: o.c + 1, width: 22, height: "58%", alignSelf: "center", justifySelf: "center", background: "repeating-linear-gradient(45deg, var(--accent) 0 4px, transparent 4px 8px)", borderRadius: 2, zIndex: 2, border: "1px solid var(--accent)" }} title="Transition overlap" />
                    ))}
                    {occupants.filter(o => o.type === "marker").map(o => (
                      <div key={o.id} style={{ gridRow: 1, gridColumn: o.c + 1, width: 0, height: 0, borderLeft: "7px solid transparent", borderRight: "7px solid transparent", borderBottom: `11px solid ${o.color || "var(--accent)"}`, justifySelf: "center", alignSelf: "start", marginTop: -3, zIndex: 3, filter: "drop-shadow(0 0 6px var(--accent))" }} />
                    ))}
                    <div style={{ position: "absolute", left: `${(playhead / config.cols) * 100}%`, top: 8, bottom: 8, width: 2, background: "var(--accent)", zIndex: 10, pointerEvents: "none", boxShadow: "0 0 12px var(--accent)", transition: play ? "left 0.32s linear" : "none" }}>
                      <div style={{ width: 10, height: 10, background: "var(--accent)", transform: "rotate(45deg)", marginLeft: -4, marginTop: -5 }} />
                    </div>
                  </div>
                </div>
              </div>
            ) : preset === "drum" ? (
              <div style={{ width: "100%", maxWidth: 560, display: "flex", flexDirection: "column", gap: 14, alignItems: "center" }}>
                <div className="mono" style={{ fontSize: 10, color: "var(--muted)", letterSpacing: 1 }}>DRUM PAD · BANK {drumBank} · VELOCITY SENSITIVE</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: config.gap, width: "100%" }}>
                  {occupants.map(o => {
                    const hit = drumHits[o.id] && Date.now() - drumHits[o.id] < 280;
                    return (
                      <div key={o.id} onClick={() => { setDrumHits(h => ({ ...h, [o.id]: Date.now() })); setLitKey(o.data || null); setTimeout(() => setLitKey(null), 200); }}
                        style={{
                          aspectRatio: "1", borderRadius: config.radius, background: hit ? "var(--accent)" : o.color || "#242a33",
                          border: hit ? "2px solid var(--accent)" : "1px solid var(--border-2)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                          cursor: "pointer", transform: hit ? "scale(0.94)" : "scale(1)", boxShadow: hit ? "0 0 28px rgba(232,255,82,0.6), inset 0 -4px 0 rgba(0,0,0,0.2)" : "0 6px 18px rgba(0,0,0,0.35), inset 0 -3px 0 rgba(0,0,0,0.25)", transition: "all 0.12s", position: "relative", overflow: "hidden"
                        }}>
                        <span className="mono" style={{ fontSize: 13, fontWeight: 700, color: hit ? "var(--accent-ink)" : "var(--text)" }}>{o.data}</span>
                        <span className="mono" style={{ fontSize: 9, color: hit ? "var(--accent-ink)" : "var(--muted)", marginTop: 4, opacity: 0.9 }}>MIDI {60 + (o.r * 4 + o.c)} · {hit ? "127" : `${70 + (o.r * 4 + o.c)}`}</span>
                        {hit && <div style={{ position: "absolute", inset: -20, background: "radial-gradient(circle at center, rgba(232,255,82,0.45) 0%, transparent 65%)", pointerEvents: "none" }} />}
                        <div style={{ position: "absolute", bottom: 8, left: 8, right: 8, height: 4, background: "rgba(0,0,0,0.25)", borderRadius: 999, overflow: "hidden" }}>
                          <div style={{ width: hit ? "100%" : "42%", height: "100%", background: hit ? "var(--accent-ink)" : "var(--muted)", transition: "width 0.12s" }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="mono" style={{ fontSize: 9, color: "var(--muted-2)", display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
                  <span>CLICK = HIT</span><span>HOLD = AFTERTOUCH</span><span>QWER ASDF ZXCV UIOP = KEYS</span><span style={{ color: "var(--accent)" }}>● {Object.keys(drumHits).length} hits</span>
                </div>
              </div>
            ) : preset === "crossword" ? (
              <div style={{ width: "100%", maxWidth: 620, display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
                <div className="mono" style={{ fontSize: 10, color: "var(--muted)", letterSpacing: 1 }}>CROSSWORD · {crosswordDir.toUpperCase()} · {wordRange.length} CELLS IN WORD</div>
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${config.cols}, minmax(0,1fr))`, gap: config.gap, width: "100%", background: "#0e0f11", padding: 6, borderRadius: 12, border: "1px solid var(--border)" }}>
                  {Array.from({ length: config.rows }).flatMap((_, r) => Array.from({ length: config.cols }).map((_, c) => {
                    const key = `${r}-${c}`; const isBlocked = crosswordBlocked.has(key); const number = crosswordNumbers.get(key); const letter = crosswordLetters[key];
                    const isSelected = crosswordSelected && crosswordSelected.r === r && crosswordSelected.c === c;
                    const inWord = wordRange.includes(key);
                    return (
                      <div key={key} onClick={() => handleCellClick(r, c)}
                        style={{
                          aspectRatio: "1", borderRadius: 2, background: isBlocked ? "#0e0f11" : inWord ? "#fffbe0" : isSelected ? "#e8ff52" : "#f7f5ef",
                          border: isSelected ? "2px solid var(--accent)" : "1px solid #d6d2c7", position: "relative", display: "flex", alignItems: "center", justifyContent: "center",
                          cursor: isBlocked ? "default" : "pointer", transition: "all 0.12s", boxShadow: isSelected ? "0 0 0 3px rgba(232,255,82,0.35)" : "none"
                        }}>
                        {!isBlocked && number && <div className="mono" style={{ position: "absolute", top: 1, left: 2, fontSize: 7, fontWeight: 700, color: "#5a5752" }}>{number}</div>}
                        {!isBlocked && letter && <div className="mono" style={{ fontSize: 16, fontWeight: 800, color: "#0e0f11" }}>{letter}</div>}
                        {isBlocked && <div style={{ width: "100%", height: "100%", background: "repeating-linear-gradient(45deg, #1a1d21 0 4px, #0e0f11 4px 8px)" }} />}
                      </div>
                    );
                  }))}
                </div>
                <div className="mono" style={{ fontSize: 10, color: "var(--muted-2)", textAlign: "center" }}>
                  Type to fill · {Object.keys(crosswordLetters).length} letters · {crosswordBlocked.size} blocked · Auto-numbered clues
                </div>
              </div>
            ) : preset === "piano" ? (
              <div style={{ width: "100%", maxWidth: 1080, display: "flex", flexDirection: "column", gap: 0 }}>
                <div className="mono" style={{ fontSize: 10, color: "var(--muted)", marginBottom: 8, letterSpacing: 1 }}>PIANO ROLL · C5–C4 · TIME {playhead}/{config.cols} · DRAG TO EDIT PITCH/DURATION</div>
                <div style={{ display: "flex", gap: 0 }}>
                  <div style={{ width: 64, display: "flex", flexDirection: "column", gap: config.gap, flexShrink: 0 }}>
                    {PIANO_KEYS.map((k, idx) => {
                      const isBlack = k.includes("#");
                      return (
                        <div key={idx} className="mono" style={{
                          height: 32, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 8px", fontSize: 10, fontWeight: isBlack ? 400 : 700,
                          background: isBlack ? "#0e0f11" : "#f1f2ee", color: isBlack ? "#f1f2ee" : "#0e0f11",
                          border: "1px solid var(--border)", borderRadius: 6, marginLeft: isBlack ? 10 : 0, opacity: isBlack ? 0.9 : 1
                        }}>
                          <span>{k}</span><span style={{ fontSize: 8, opacity: 0.6 }}>{isBlack ? "■" : "□"}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ flex: 1, display: "grid", gridTemplateColumns: `repeat(${config.cols}, minmax(0,1fr))`, gridTemplateRows: `repeat(${config.rows}, 32px)`, gap: config.gap, position: "relative", background: "var(--surface)", padding: 8, borderRadius: 12, border: "1px solid var(--border)" }}>
                    {Array.from({ length: config.rows }).flatMap((_, r) => Array.from({ length: config.cols }).map((_, c) => {
                      const isBlack = PIANO_KEYS[r].includes("#");
                      return <div key={`${r}-${c}`} onClick={() => handleCellClick(r, c)} style={{ background: isBlack ? "#232830" : r % 2 === 0 ? config.cellPrimary : config.cellSecondary, borderRadius: config.radius, border: "1px solid var(--border)", opacity: c % 4 === 0 ? 1 : 0.6, cursor: "pointer" }} />;
                    }))}
                    {occupants.filter(o => o.type === "note").map(o => (
                      <div key={o.id} onClick={e => { e.stopPropagation(); setOccupants(prev => prev.filter(p => p.id !== o.id)); }}
                        style={{
                          gridRow: o.r + 1, gridColumn: `${o.c + 1} / span ${o.spanW}`,
                          background: o.color || "#e8ff52", borderRadius: 6, border: "1px solid rgba(0,0,0,0.2)", display: "flex", alignItems: "center", padding: "0 6px",
                          cursor: "pointer", zIndex: 1, boxShadow: "0 2px 8px rgba(0,0,0,0.25), inset 0 -2px 0 rgba(0,0,0,0.15)", overflow: "hidden"
                        }}>
                        <span className="mono" style={{ fontSize: 9, fontWeight: 700, color: "#0e0f11", whiteSpace: "nowrap" }}>{PIANO_KEYS[o.r]} · {o.data}</span>
                        <div style={{ marginLeft: "auto", width: 12, height: 12, borderRadius: 999, background: "rgba(0,0,0,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 8 }}>⋮⋮</div>
                      </div>
                    ))}
                    <div style={{ position: "absolute", left: `${(playhead / config.cols) * 100}%`, top: 8, bottom: 8, width: 2, background: "var(--accent)", zIndex: 10, pointerEvents: "none", boxShadow: "0 0 12px var(--accent)", transition: play ? "left 0.22s linear" : "none" }} />
                  </div>
                </div>
              </div>
            ) : preset === "breakout" ? (
              <div style={{ width: "100%", maxWidth: 520, display: "flex", flexDirection: "column", gap: 12, alignItems: "center" }}>
                <div className="mono" style={{ fontSize: 10, color: "var(--muted)", letterSpacing: 1 }}>BREAKOUT · {breakoutScore} PTS · {occupants.filter(o => o.type === "brick").length} BRICKS LEFT · {ball.active ? "BALL ACTIVE" : "READY"}</div>
                <div style={{ display: "grid", gridTemplateColumns: `repeat(${config.cols}, minmax(0,1fr))`, gridTemplateRows: `repeat(${config.rows}, minmax(0,1fr))`, gap: config.gap, width: "100%", aspectRatio: `${config.cols}/${config.rows}`, background: "var(--surface)", padding: 8, borderRadius: 12, border: "1px solid var(--border)", position: "relative" }}>
                  {Array.from({ length: config.rows }).flatMap((_, r) => Array.from({ length: config.cols }).map((_, c) => (
                    <div key={`${r}-${c}`} onClick={() => handleCellClick(r, c)} style={{ background: r < 5 ? "transparent" : config.cellPrimary, borderRadius: config.radius, border: r < 5 ? "1px dashed var(--border)" : "1px solid var(--border)", opacity: r < 5 ? 0.15 : 0.5 }} />
                  )))}
                  {occupants.filter(o => o.type === "brick").map(o => (
                    <div key={o.id} style={{ gridRow: o.r + 1, gridColumn: o.c + 1, background: o.color || "#ff4d4d", borderRadius: 4, border: "1px solid rgba(0,0,0,0.2)", boxShadow: "inset 0 -3px 0 rgba(0,0,0,0.2), 0 2px 6px rgba(0,0,0,0.2)", zIndex: 1 }} />
                  ))}
                  <div style={{ gridRow: config.rows, gridColumn: `${paddleC + 1} / span 3`, background: "#f1f2ee", borderRadius: 8, border: "1px solid var(--border-2)", boxShadow: "0 4px 12px rgba(0,0,0,0.3), inset 0 -3px 0 rgba(0,0,0,0.2)", zIndex: 2, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div style={{ width: "60%", height: 4, background: "var(--border-2)", borderRadius: 999 }} />
                  </div>
                  <div style={{
                    gridRow: Math.max(1, Math.min(config.rows, Math.round(ball.r) + 1)),
                    gridColumn: Math.max(1, Math.min(config.cols, Math.round(ball.c) + 1)),
                    background: "#e8ff52", borderRadius: 999, width: "62%", height: "62%", alignSelf: "center", justifySelf: "center",
                    boxShadow: "0 0 14px var(--accent), inset 0 -2px 0 rgba(0,0,0,0.2)", zIndex: 3, border: "1px solid var(--accent)"
                  }} />
                </div>
              </div>
            ) : (
              // generic presets
              <div style={{
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
              }}>
                {preset === "keyboard" ? (
                  Array.from({ length: config.rows }).map((_, r) => (
                    <div key={r} style={{ display: "flex", gap: config.gap, marginLeft: r === 1 ? 24 : r === 2 ? 48 : r === 3 ? 12 : 0, transition: "margin 0.3s" }}>
                      {Array.from({ length: config.cols }).map((_, c) => {
                        const occ = occupants.find(o => o.r === r && o.c === c);
                        if (!occ) return <div key={`${r}-${c}`} style={{ flex: 1 }} />;
                        const isLit = litKey && occ.data?.toUpperCase().includes(litKey) || litKey === occ.data;
                        return (
                          <div key={`${r}-${c}`} onClick={() => handleCellClick(r, c)} className="mono"
                            style={{
                              flex: occ.spanW > 1 ? occ.spanW : 1, aspectRatio: cellAspectStyle(config.aspect), borderRadius: config.radius,
                              background: isLit ? "var(--accent)" : getCellBg(r, c), border: isLit ? "1px solid var(--accent)" : "1px solid var(--border)",
                              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600,
                              color: isLit ? "var(--accent-ink)" : "var(--text)", cursor: "pointer", transition: "all 0.18s",
                              transform: isLit ? "translateY(-1px)" : "none", boxShadow: isLit ? "0 6px 20px rgba(232,255,82,0.3)" : "none"
                            }}>{occ.data}</div>
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
                      const isGo = preset === "go";
                      const isWeekend = preset === "calendar" && (c === 5 || c === 6);
                      const isHeader = preset === "spreadsheet" && (r === 0 || c === 0);
                      return (
                        <div key={`${r}-${c}`} onClick={() => handleCellClick(r, c)} onMouseDown={() => { if (occ) setDragId(occ.id); }} onMouseUp={() => { if (dragId && dragId !== occ?.id) { const d = occupants.find(o => o.id === dragId); if (d) setOccupants(prev => prev.map(o => o.id === dragId ? { ...o, r, c } : o)); } setDragId(null); }}
                          title={`${r},${c}`}
                          style={{
                            aspectRatio: cellAspectStyle(config.aspect), borderRadius: config.radius,
                            background: isTetroCell ? currentTetro.color : isHeader ? "#232a33" : isWeekend ? "#22262e" : getCellBg(r, c),
                            border: isSelected ? "1.5px solid var(--accent)" : isGo ? "none" : isPlayhead ? "1px solid rgba(232,255,82,0.6)" : `1px solid ${config.alternating === "dots" ? "transparent" : "var(--border)"}`,
                            position: "relative", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.2s ease", overflow: "hidden",
                            boxShadow: isSelected ? "0 0 0 2px var(--accent-dim)" : isTetroCell ? "0 0 12px rgba(232,255,82,0.4)" : "none",
                            ...(preset === "sudoku" ? { borderRight: (c + 1) % 3 === 0 && c !== config.cols - 1 ? "2px solid var(--border-2)" : undefined, borderBottom: (r + 1) % 3 === 0 && r !== config.rows - 1 ? "2px solid var(--border-2)" : undefined } : {}),
                          }}>
                          {isGo && (
                            <>
                              <div style={{ position: "absolute", left: c === 0 ? "50%" : 0, right: c === config.cols - 1 ? "50%" : 0, top: "50%", height: 1, background: "#2a2e36" }} />
                              <div style={{ position: "absolute", top: r === 0 ? "50%" : 0, bottom: r === config.rows - 1 ? "50%" : 0, left: "50%", width: 1, background: "#2a2e36" }} />
                              {((r === 3 || r === 9 || r === 15) && (c === 3 || c === 9 || c === 15)) && <div style={{ width: 6, height: 6, borderRadius: 999, background: "#3a404d", position: "absolute" }} />}
                            </>
                          )}
                          {isHeader && <div style={{ position: "absolute", inset: 0, background: "rgba(232,255,82,0.06)" }} />}
                          {isPlayhead && preset === "sequencer" && <div style={{ position: "absolute", inset: 0, background: "rgba(232,255,82,0.08)", pointerEvents: "none" }} />}
                          {occ && (
                            <div className="mono" style={{
                              fontSize: preset === "chess" || preset === "checkers" ? 22 : preset === "go" || preset === "connect4" ? 28 : preset === "calendar" ? 11 : 12,
                              fontWeight: preset === "chess" ? 400 : 600,
                              color: occ.color || (preset === "sequencer" && occ.active ? "var(--accent-ink)" : "var(--text)"),
                              background: preset === "sequencer" && occ.active ? "var(--accent)" : preset === "go" ? occ.color === "#0e0f11" ? "#f1f2ee" : "#0e0f11" : preset === "connect4" ? occ.color : undefined,
                              width: preset === "go" || preset === "connect4" || preset === "checkers" || (preset === "sequencer" && occ.active) ? 32 : undefined,
                              height: preset === "go" || preset === "connect4" || preset === "checkers" || (preset === "sequencer" && occ.active) ? 32 : undefined,
                              borderRadius: preset === "go" || preset === "connect4" || preset === "checkers" || preset === "sequencer" ? 999 : undefined,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              border: preset === "go" && occ.color === "#0e0f11" ? "1px solid #2a2e36" : preset === "connect4" ? "2px solid rgba(0,0,0,0.2)" : undefined,
                              boxShadow: preset === "go" ? "0 2px 8px rgba(0,0,0,0.5)" : preset === "connect4" ? "inset 0 -3px 0 rgba(0,0,0,0.2)" : undefined,
                              transition: "all 0.2s", zIndex: 1,
                            }}>{occ.data}</div>
                          )}
                          {isTetroCell && !occ && <div style={{ width: 12, height: 12, borderRadius: 4, background: currentTetro.color, opacity: 0.9, boxShadow: "0 0 10px currentColor" }} />}
                        </div>
                      );
                    })
                  )
                )}
              </div>
            )}
          </div>

          <div style={{ borderTop: "1px solid var(--border)", background: "var(--surface)", display: "flex", flexDirection: "column", maxHeight: 300 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid var(--border)", background: "var(--surface-2)" }}>
              <div className="mono" style={{ fontSize: 10, color: "var(--muted)", letterSpacing: 1 }}>OCELOT / XML — {preset.toUpperCase()} · {occupants.length} OCCUPANTS · {Object.keys(PRESETS).length} PRESETS</div>
              <button onClick={() => { if (xmlRef.current) { const t = xmlRef.current.innerText; const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); } }} className="mono" style={{ padding: "5px 10px", borderRadius: 999, border: "1px solid var(--border-2)", background: "var(--surface-3)", color: "var(--text)", fontSize: 10, cursor: "pointer" }}>COPY XML</button>
            </div>
            <pre ref={xmlRef} className="mono" style={{ margin: 0, padding: "14px 16px", overflow: "auto", fontSize: 11, lineHeight: 1.6, color: "#c8d0dc", background: "#0e0f11" }}>{xmlString}</pre>
          </div>
        </main>
      </div>

      <style>{`@media (max-width: 860px){ div[style*="grid-template-columns: 360px 1fr"]{grid-template-columns:1fr !important;} aside{border-right:none !important; border-bottom:1px solid var(--border);} }`}</style>

      <footer className="mono" style={{ maxWidth: 1440, margin: "0 auto", padding: "14px 24px", borderTop: "1px solid var(--border)", fontSize: 10, color: "var(--muted-2)", display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <span>Paramorphic: grid as substrate, occupants as polymorphism — now 15 forms: board games, data, music, media, input.</span>
        <span style={{ color: "var(--muted)" }}>{config.rows * config.cols} cells · {occupants.length} occupants · Bank {drumBank} · Score {breakoutScore}</span>
      </footer>
    </div>
  );
}
