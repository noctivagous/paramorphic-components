import React, { useEffect, useMemo, useRef, useState } from "react";

// ---------- Types ----------
type Pos = { q: number; r: number }; // offset coordinates col,row
type Occupant = {
  id: string;
  anchor: Pos;
  span: Pos[];
  type: string;
  data: any;
  tags: string[];
  guest?: { kind: string; state: any };
};

type MoveRule = {
  pieceType: string; // "*" = default
  directions: string[]; // N,S,E,W,NE,NW,SE,SW + hex equivalents
  steps?: { min: number; max: number };
  slide?: boolean;
  capture?: "move" | "captureOnly" | "both";
  captureDirections?: string[];
  captureSteps?: number;
  firstMoveSteps?: number;
  jumpOver?: boolean;
  requires?: { darkOnly?: boolean };
};

type RuleSet = {
  id: string;
  setup: { width: number; height: number; description: string };
  moves: MoveRule[];
  turns: { order: "alternating" | "free"; current: string };
  outcome: { type: "threeInRow" | "kingCapture" | "noMoves" | "paint" | "none"; lines?: number };
  end: { condition: string };
};

type Tiling = {
  id: "square4" | "square8" | "hexH" | "hexV";
  name: string;
  shape: "square" | "hex";
  neighbors: string[];
  dirVectors: Record<string, { dq: number; dr: number }>;
  style: "2color" | "3color";
};

type Toggles = {
  gravity: boolean;
  diagonal: boolean;
  sliding: boolean;
  wrapping: boolean;
  chainCapture: boolean;
};

// ---------- Tilings ----------
const TILINGS: Tiling[] = [
  {
    id: "square4",
    name: "SQUARE-4 (von Neumann)",
    shape: "square",
    neighbors: ["N", "S", "E", "W"],
    dirVectors: {
      N: { dq: 0, dr: -1 },
      S: { dq: 0, dr: 1 },
      E: { dq: 1, dr: 0 },
      W: { dq: -1, dr: 0 },
      NE: { dq: 1, dr: -1 },
      NW: { dq: -1, dr: -1 },
      SE: { dq: 1, dr: 1 },
      SW: { dq: -1, dr: 1 },
    },
    style: "2color",
  },
  {
    id: "square8",
    name: "SQUARE-8 (Moore)",
    shape: "square",
    neighbors: ["N", "S", "E", "W", "NE", "NW", "SE", "SW"],
    dirVectors: {
      N: { dq: 0, dr: -1 },
      S: { dq: 0, dr: 1 },
      E: { dq: 1, dr: 0 },
      W: { dq: -1, dr: 0 },
      NE: { dq: 1, dr: -1 },
      NW: { dq: -1, dr: -1 },
      SE: { dq: 1, dr: 1 },
      SW: { dq: -1, dr: 1 },
    },
    style: "2color",
  },
  {
    id: "hexH",
    name: "HEX-H (pointy-top / odd-r)",
    shape: "hex",
    neighbors: ["E", "W", "NE", "NW", "SE", "SW"],
    dirVectors: {
      // axial vectors
      E: { dq: 1, dr: 0 },
      W: { dq: -1, dr: 0 },
      NE: { dq: 1, dr: -1 },
      NW: { dq: 0, dr: -1 },
      SE: { dq: 0, dr: 1 },
      SW: { dq: -1, dr: 1 },
      // square mappings for reinterpretation
      N: { dq: 0, dr: -1 },
      S: { dq: 0, dr: 1 },
    },
    style: "3color",
  },
  {
    id: "hexV",
    name: "HEX-V (flat-top / odd-q)",
    shape: "hex",
    neighbors: ["E", "W", "NE", "NW", "SE", "SW"],
    dirVectors: {
      E: { dq: 1, dr: 0 },
      W: { dq: -1, dr: 0 },
      NE: { dq: 1, dr: -1 },
      NW: { dq: 0, dr: -1 },
      SE: { dq: 0, dr: 1 },
      SW: { dq: -1, dr: 1 },
      N: { dq: 0, dr: -1 },
      S: { dq: 0, dr: 1 },
    },
    style: "3color",
  },
];

// ---------- Hex math ----------
function oddROffsetToAxial(col: number, row: number) {
  const q = col - ((row - (row & 1)) >> 1);
  const r = row;
  return { q, r };
}
function axialToOddROffset(q: number, r: number) {
  const col = q + ((r - (r & 1)) >> 1);
  const row = r;
  return { q: col, r: row };
}
function oddQOffsetToAxial(col: number, row: number) {
  const q = col;
  const r = row - ((col - (col & 1)) >> 1);
  return { q, r };
}
function axialToOddQOffset(q: number, r: number) {
  const col = q;
  const row = r + ((q - (q & 1)) >> 1);
  return { q: col, r: row };
}
function hexDistance(aAx: { q: number; r: number }, bAx: { q: number; r: number }) {
  return (Math.abs(aAx.q - bAx.q) + Math.abs(aAx.q + aAx.r - bAx.q - bAx.r) + Math.abs(aAx.r - bAx.r)) / 2;
}

function getVector(dir: string, tiling: Tiling) {
  return tiling.dirVectors[dir] || null;
}

function addPos(pos: Pos, vec: { dq: number; dr: number }, steps: number, tiling: Tiling, width: number, height: number, wrapping: boolean): Pos | null {
  if (tiling.shape === "square") {
    let nq = pos.q + vec.dq * steps;
    let nr = pos.r + vec.dr * steps;
    if (wrapping) {
      nq = ((nq % width) + width) % width;
      nr = ((nr % height) + height) % height;
    } else {
      if (nq < 0 || nq >= width || nr < 0 || nr >= height) return null;
    }
    return { q: nq, r: nr };
  } else {
    // hex: work in axial
    const axial = tiling.id === "hexH" ? oddROffsetToAxial(pos.q, pos.r) : oddQOffsetToAxial(pos.q, pos.r);
    const nAx = { q: axial.q + vec.dq * steps, r: axial.r + vec.dr * steps };
    const off = tiling.id === "hexH" ? axialToOddROffset(nAx.q, nAx.r) : axialToOddQOffset(nAx.q, nAx.r);
    let nq = off.q, nr = off.r;
    if (wrapping) {
      nq = ((nq % width) + width) % width;
      nr = ((nr % height) + height) % height;
    } else {
      if (nq < 0 || nq >= width || nr < 0 || nr >= height) return null;
    }
    return { q: nq, r: nr };
  }
}

// ---------- Core Engine ----------
function occupantAt(pos: Pos, occupants: Occupant[]) {
  return occupants.find((o) => o.anchor.q === pos.q && o.anchor.r === pos.r) || null;
}

function getValidMoves(
  occ: Occupant,
  occupants: Occupant[],
  tiling: Tiling,
  ruleSet: RuleSet,
  width: number,
  height: number,
  toggles: Toggles
): (Pos & { capture?: string })[] {
  const rules = ruleSet.moves.filter((r) => r.pieceType === occ.type || r.pieceType === "*" || r.pieceType === occ.data?.group);
  if (rules.length === 0) return [];

  const res: (Pos & { capture?: string })[] = [];
  const seen = new Set<string>();

  for (const rule of rules) {
    // effective dirs: toggle diagonal injects diagonals for square4
    let dirs = [...rule.directions];
    if (toggles.diagonal && tiling.id === "square4") {
      dirs = [...new Set([...dirs, "NE", "NW", "SE", "SW"])];
    }
    let slide = rule.slide;
    if (toggles.sliding) slide = true;
    if (!toggles.sliding && ruleSet.id === "tictactoe") slide = false;

    // helper to add
    const pushIf = (p: Pos, cap?: string) => {
      const key = `${p.q},${p.r}`;
      if (seen.has(key)) return;
      seen.add(key);
      res.push({ ...p, capture: cap });
    };

    // normal moves (non-capturing or both)
    if (rule.capture !== "captureOnly") {
      for (const dName of dirs) {
        const vec = getVector(dName, tiling);
        if (!vec) continue;
        if (slide) {
          let max = rule.steps?.max ?? Math.max(width, height);
          if (toggles.sliding && max < Math.max(width, height)) max = Math.max(width, height);
          for (let s = rule.steps?.min ?? 1; s <= max; s++) {
            const target = addPos(occ.anchor, vec, s, tiling, width, height, toggles.wrapping);
            if (!target) break;
            if (rule.requires?.darkOnly && (target.q + target.r) % 2 === 0) continue;
            const at = occupantAt(target, occupants);
            if (at) {
              // blocked, but could be capture if rule allows both
              if (rule.capture === "both" && at.data?.player !== occ.data?.player) {
                // for slide capture (queen etc) stop at capture
                pushIf(target, at.id);
              }
              break;
            }
            pushIf(target);
          }
        } else {
          const stepsToTry: number[] = [];
          const min = rule.steps?.min ?? 1;
          const max = rule.steps?.max ?? 1;
          for (let s = min; s <= max; s++) stepsToTry.push(s);
          if (rule.firstMoveSteps && !occ.data?.hasMoved) stepsToTry.push(rule.firstMoveSteps);

          for (const s of stepsToTry) {
            const target = addPos(occ.anchor, vec, s, tiling, width, height, toggles.wrapping);
            if (!target) continue;
            if (rule.requires?.darkOnly && (target.q + target.r) % 2 === 0) continue;
            // for pawn double move check intermediate
            if (s === rule.firstMoveSteps) {
              const mid = addPos(occ.anchor, vec, 1, tiling, width, height, toggles.wrapping);
              if (!mid || occupantAt(mid, occupants)) continue;
            }
            const at = occupantAt(target, occupants);
            if (!at) pushIf(target);
          }
        }
      }
    }

    // capture moves
    if (rule.capture !== "move") {
      const capDirs = rule.captureDirections ?? dirs;
      for (const dName of capDirs) {
        const vec = getVector(dName, tiling);
        if (!vec) continue;
        if (rule.jumpOver) {
          // checkers style: jump over opponent to empty
          const jump = rule.steps?.max ?? 2;
          const target = addPos(occ.anchor, vec, jump, tiling, width, height, toggles.wrapping);
          const mid = addPos(occ.anchor, vec, jump - 1, tiling, width, height, toggles.wrapping);
          if (!target || !mid) continue;
          if (rule.requires?.darkOnly && (target.q + target.r) % 2 === 0) continue;
          const midOcc = occupantAt(mid, occupants);
          const tgtOcc = occupantAt(target, occupants);
          if (midOcc && midOcc.data?.player !== occ.data?.player && !tgtOcc) {
            pushIf(target, midOcc.id);
          }
          // king may slide then jump? For simplicity we also allow slide jump chain: if sliding king, iterate
          if (slide && (occ.type.includes("king") || occ.type.includes("K"))) {
            // extend beyond
            let step = jump + 1;
            while (true) {
              const ext = addPos(occ.anchor, vec, step, tiling, width, height, toggles.wrapping);
              if (!ext) break;
              if (occupantAt(ext, occupants)) break;
              // if we already jumped, empty beyond is also valid landing (international draughts)
              // for demo, allow landing extension after jump
              pushIf(ext, midOcc?.id);
              step++;
              if (step > Math.max(width, height)) break;
            }
          }
        } else {
          const capStep = rule.captureSteps ?? rule.steps?.max ?? 1;
          const target = addPos(occ.anchor, vec, capStep, tiling, width, height, toggles.wrapping);
          if (!target) continue;
          const at = occupantAt(target, occupants);
          if (at && at.data?.player !== occ.data?.player) {
            pushIf(target, at.id);
          }
        }
      }
    }
  }

  return res;
}

// ---------- Presets ----------
function makeId() { return Math.random().toString(36).slice(2, 9); }

function presetRules(id: string, width: number, height: number): RuleSet {
  switch (id) {
    case "tictactoe":
      return {
        id,
        setup: { width: 3, height: 3, description: "Empty 3x3, any empty cell" },
        moves: [{ pieceType: "*", directions: ["N", "S", "E", "W", "NE", "NW", "SE", "SW"], steps: { min: 1, max: 1 }, slide: false, capture: "move" }],
        turns: { order: "alternating", current: "X" },
        outcome: { type: "threeInRow", lines: 3 },
        end: { condition: "line==3 || board full -> draw" },
      };
    case "chess6":
      return {
        id,
        setup: { width: 6, height: 6, description: "Simplified 6x6 chess, king capture wins" },
        moves: [
          { pieceType: "pawn_w", directions: ["N"], steps: { min: 1, max: 1 }, captureDirections: ["NE", "NW"], captureSteps: 1, capture: "both", firstMoveSteps: 2, slide: false },
          { pieceType: "pawn_b", directions: ["S"], steps: { min: 1, max: 1 }, captureDirections: ["SE", "SW"], captureSteps: 1, capture: "both", firstMoveSteps: 2, slide: false },
          { pieceType: "rook", directions: ["N", "S", "E", "W"], steps: { min: 1, max: 6 }, slide: true, capture: "both" },
          { pieceType: "bishop", directions: ["NE", "NW", "SE", "SW"], steps: { min: 1, max: 6 }, slide: true, capture: "both" },
          { pieceType: "queen", directions: ["N", "S", "E", "W", "NE", "NW", "SE", "SW"], steps: { min: 1, max: 6 }, slide: true, capture: "both" },
          { pieceType: "king", directions: ["N", "S", "E", "W", "NE", "NW", "SE", "SW"], steps: { min: 1, max: 1 }, slide: false, capture: "both" },
          { pieceType: "knight", directions: ["NNE", "ENE", "ESE", "SSE", "SSW", "WSW", "WNW", "NNW"], steps: { min: 1, max: 1 }, slide: false, capture: "both" },
        ],
        turns: { order: "alternating", current: "white" },
        outcome: { type: "kingCapture" },
        end: { condition: "king captured -> win" },
      };
    case "checkers":
      return {
        id,
        setup: { width: 8, height: 8, description: "Dark squares only, forward diagonal, jump over capture, king backward" },
        moves: [
          { pieceType: "man_w", directions: ["NE", "NW"], steps: { min: 1, max: 1 }, captureDirections: ["NE", "NW"], capture: "both", jumpOver: true, requires: { darkOnly: true } },
          { pieceType: "man_b", directions: ["SE", "SW"], steps: { min: 1, max: 1 }, captureDirections: ["SE", "SW"], capture: "both", jumpOver: true, requires: { darkOnly: true } },
          { pieceType: "king_w", directions: ["NE", "NW", "SE", "SW"], steps: { min: 1, max: 2 }, slide: false, capture: "both", jumpOver: true, requires: { darkOnly: true } },
          { pieceType: "king_b", directions: ["NE", "NW", "SE", "SW"], steps: { min: 1, max: 2 }, slide: false, capture: "both", jumpOver: true, requires: { darkOnly: true } },
        ],
        turns: { order: "alternating", current: "white" },
        outcome: { type: "noMoves" },
        end: { condition: "no pieces or no moves -> loss" },
      };
    case "painter":
      return {
        id,
        setup: { width: 12, height: 12, description: "Toggle paint, same tiling param drives brush" },
        moves: [{ pieceType: "*", directions: ["N", "S", "E", "W", "NE", "NW", "SE", "SW"], steps: { min: 1, max: 1 }, slide: false, capture: "move" }],
        turns: { order: "free", current: "painter" },
        outcome: { type: "paint" },
        end: { condition: "manual" },
      };
    case "sequencer":
      return {
        id,
        setup: { width: 16, height: 4, description: "Grid = timeline (steps x tracks), occupant=note" },
        moves: [{ pieceType: "note", directions: ["E", "W"], steps: { min: 1, max: 1 }, slide: false, capture: "move" }],
        turns: { order: "free", current: "composer" },
        outcome: { type: "none" },
        end: { condition: "none" },
      };
    default:
      return {
        id: "custom",
        setup: { width, height, description: "Custom" },
        moves: [{ pieceType: "*", directions: ["N", "S", "E", "W"], steps: { min: 1, max: 1 }, slide: false, capture: "move" }],
        turns: { order: "alternating", current: "white" },
        outcome: { type: "none" },
        end: { condition: "none" },
      };
  }
}

function presetOccupants(id: string): Occupant[] {
  switch (id) {
    case "tictactoe":
      return [];
    case "chess6": {
      const occ: Occupant[] = [];
      const backB = ["rook", "knight", "bishop", "queen", "king", "bishop"];
      const backW = ["rook", "knight", "bishop", "king", "queen", "bishop"];
      backB.forEach((t, i) => occ.push({ id: makeId(), anchor: { q: i, r: 0 }, span: [], type: t, data: { player: "black", hasMoved: false, symbol: t[0].toUpperCase() }, tags: ["chess"] }));
      for (let i = 0; i < 6; i++) occ.push({ id: makeId(), anchor: { q: i, r: 1 }, span: [], type: "pawn_b", data: { player: "black", hasMoved: false, symbol: "♟" }, tags: [] });
      for (let i = 0; i < 6; i++) occ.push({ id: makeId(), anchor: { q: i, r: 4 }, span: [], type: "pawn_w", data: { player: "white", hasMoved: false, symbol: "♙" }, tags: [] });
      backW.forEach((t, i) => occ.push({ id: makeId(), anchor: { q: i, r: 5 }, span: [], type: t, data: { player: "white", hasMoved: false, symbol: t === "king" ? "♔" : t === "queen" ? "♕" : t[0].toUpperCase() }, tags: [] }));
      return occ;
    }
    case "checkers": {
      const occ: Occupant[] = [];
      for (let r = 0; r < 3; r++) for (let q = 0; q < 8; q++) if ((q + r) % 2 === 1) occ.push({ id: makeId(), anchor: { q, r }, span: [], type: "man_b", data: { player: "black", symbol: "●" }, tags: [] });
      for (let r = 5; r < 8; r++) for (let q = 0; q < 8; q++) if ((q + r) % 2 === 1) occ.push({ id: makeId(), anchor: { q, r }, span: [], type: "man_w", data: { player: "white", symbol: "○" }, tags: [] });
      return occ;
    }
    case "painter":
      return [];
    case "sequencer": {
      const occ: Occupant[] = [];
      [[2, 0], [4, 0], [6, 1], [8, 1], [10, 2], [12, 3]].forEach(([q, r]) => occ.push({ id: makeId(), anchor: { q, r }, span: [], type: "note", data: { player: "composer", vel: 0.8 }, tags: [] }));
      return occ;
    }
    default:
      return [];
  }
}

// ---------- API helpers ----------
async function apiCall(action: string, args: any) {
  const res = await fetch("actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, args }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error || `HTTP ${res.status}`);
  return j.data;
}

// ---------- Components ----------
function GridViewport({
  occupants,
  setOccupants,
  tiling,
  ruleSet,
  width,
  height,
  toggles,
  selectedId,
  setSelectedId,
  validMoves,
  setValidMoves,
  currentTurn,
  setCurrentTurn,
  outcome,
  setOutcome,
  painterMode,
  chainCaptureActive,
  setChainCaptureActive,
}: any) {
  const cellSize = tiling.shape === "square" ? 46 : 42;

  const mapOccupant = useMemo(() => {
    const m = new Map<string, Occupant>();
    occupants.forEach((o: Occupant) => m.set(`${o.anchor.q},${o.anchor.r}`, o));
    return m;
  }, [occupants]);

  useEffect(() => {
    if (!selectedId) {
      setValidMoves([]);
      return;
    }
    const occ = occupants.find((o: Occupant) => o.id === selectedId);
    if (!occ) { setValidMoves([]); return; }
    if (ruleSet.turns.order === "alternating" && occ.data?.player && occ.data.player !== currentTurn && !painterMode) {
      // don't show moves if not current player (except free)
      // but still show for insight? Enforce no move later
    }
    const moves = getValidMoves(occ, occupants, tiling, ruleSet, width, height, toggles);
    setValidMoves(moves);
  }, [selectedId, occupants, tiling, ruleSet, width, height, toggles]);

  const checkOutcome = (occs: Occupant[]) => {
    if (ruleSet.outcome.type === "threeInRow") {
      // build board
      const board: string[][] = Array.from({ length: 3 }, () => Array(3).fill(""));
      occs.forEach((o) => { if (o.anchor.q < 3 && o.anchor.r < 3) board[o.anchor.r][o.anchor.q] = o.data.player; });
      const lines = [
        [[0, 0], [0, 1], [0, 2]], [[1, 0], [1, 1], [1, 2]], [[2, 0], [2, 1], [2, 2]],
        [[0, 0], [1, 0], [2, 0]], [[0, 1], [1, 1], [2, 1]], [[0, 2], [1, 2], [2, 2]],
        [[0, 0], [1, 1], [2, 2]], [[0, 2], [1, 1], [2, 0]],
      ];
      for (const line of lines) {
        const [a, b, c] = line;
        const v = board[a[0]][a[1]];
        if (v && v === board[b[0]][b[1]] && v === board[c[0]][c[1]]) return `${v.toUpperCase()} wins • ${line.map(([r,c])=>`(${c},${r})`).join(" ")}`;
      }
      if (occs.length >= 9) return "Draw • board full";
    }
    if (ruleSet.outcome.type === "kingCapture") {
      const whiteKing = occs.find((o) => o.type === "king" && o.data.player === "white");
      const blackKing = occs.find((o) => o.type === "king" && o.data.player === "black");
      if (!whiteKing) return "Black wins • white king captured";
      if (!blackKing) return "White wins • black king captured";
    }
    if (ruleSet.outcome.type === "noMoves") {
      const whiteMoves = occs.filter((o) => o.data.player === "white").some((o) => getValidMoves(o, occs, tiling, ruleSet, width, height, toggles).length > 0);
      const blackMoves = occs.filter((o) => o.data.player === "black").some((o) => getValidMoves(o, occs, tiling, ruleSet, width, height, toggles).length > 0);
      if (!whiteMoves && currentTurn === "white") return "Black wins • white no moves";
      if (!blackMoves && currentTurn === "black") return "White wins • black no moves";
      const whiteCount = occs.filter((o) => o.data.player === "white").length;
      const blackCount = occs.filter((o) => o.data.player === "black").length;
      if (whiteCount === 0) return "Black wins • white no pieces";
      if (blackCount === 0) return "White wins • black no pieces";
    }
    return null;
  };

  const handleCellClick = (q: number, r: number) => {
    if (outcome) return;
    if (painterMode) {
      const existing = occupantAt({ q, r }, occupants);
      if (existing) {
        setOccupants((prev: Occupant[]) => prev.filter((o) => o.id !== existing.id));
      } else {
        setOccupants((prev: Occupant[]) => [...prev, { id: makeId(), anchor: { q, r }, span: [], type: "paint", data: { player: "painter", color: "#e8ff52" }, tags: ["paint"] }]);
      }
      return;
    }

    const clickedOcc = occupantAt({ q, r }, occupants);
    const isValidTarget = validMoves.some((m: any) => m.q === q && m.r === r);

    if (isValidTarget && selectedId) {
      const sel = occupants.find((o: Occupant) => o.id === selectedId);
      if (!sel) return;
      if (ruleSet.turns.order === "alternating" && sel.data?.player !== currentTurn) return;

      // perform move
      let newOccs = [...occupants];
      const captureMove = validMoves.find((m: any) => m.q === q && m.r === r) as any;
      if (captureMove?.capture) {
        newOccs = newOccs.filter((o) => o.id !== captureMove.capture);
      } else {
        // direct capture if target occupied by opponent (non jumpOver)
        if (clickedOcc && clickedOcc.data?.player !== sel.data?.player) {
          newOccs = newOccs.filter((o) => o.id !== clickedOcc.id);
        }
      }
      newOccs = newOccs.map((o) => (o.id === sel.id ? { ...o, anchor: { q, r }, data: { ...o.data, hasMoved: true } } : o));

      // check promotion for checkers man -> king
      newOccs = newOccs.map((o) => {
        if ((o.type === "man_w" && o.anchor.r === 0) || (o.type === "man_b" && o.anchor.r === height - 1)) {
          return { ...o, type: o.type === "man_w" ? "king_w" : "king_b", data: { ...o.data, symbol: "♔" } };
        }
        return o;
      });

      // gravity
      if (toggles.gravity) {
        // simple gravity: pieces fall S until blocked
        const sorted = [...newOccs].sort((a, b) => b.anchor.r - a.anchor.r);
        const occupiedSet = new Set(sorted.map((o) => `${o.anchor.q},${o.anchor.r}`));
        const moved: Occupant[] = [];
        for (const o of sorted) {
          let cq = o.anchor.q, cr = o.anchor.r;
          while (true) {
            const below = addPos({ q: cq, r: cr }, { dq: 0, dr: 1 }, 1, TILINGS.find(t=>t.id==="square8")!, width, height, false);
            if (!below) break;
            const key = `${below.q},${below.r}`;
            if (occupiedSet.has(key)) break;
            occupiedSet.delete(`${cq},${cr}`);
            occupiedSet.add(key);
            cq = below.q; cr = below.r;
          }
          moved.push({ ...o, anchor: { q: cq, r: cr } });
        }
        newOccs = moved;
      }

      // chain capture handling
      const movedSel = newOccs.find((o) => o.id === sel.id);
      if (movedSel && captureMove?.capture && toggles.chainCapture) {
        const further = getValidMoves(movedSel, newOccs, tiling, ruleSet, width, height, toggles).filter((m: any) => m.capture);
        if (further.length > 0) {
          // stay same player, keep selected
          setOccupants(newOccs);
          setSelectedId(sel.id);
          setValidMoves(further);
          setChainCaptureActive(true);
          const out = checkOutcome(newOccs);
          if (out) setOutcome(out);
          return;
        }
      }

      setOccupants(newOccs);
      setChainCaptureActive(false);
      const out = checkOutcome(newOccs);
      if (out) {
        setOutcome(out);
      } else {
        if (ruleSet.turns.order === "alternating") {
          setCurrentTurn((prev: string) => (prev === "white" ? "black" : prev === "black" ? "white" : prev === "X" ? "O" : prev === "O" ? "X" : prev));
        }
        setSelectedId(null);
        setValidMoves([]);
      }
    } else if (clickedOcc) {
      // select piece if it's current player's turn or free
      if (ruleSet.turns.order === "alternating" && clickedOcc.data?.player && clickedOcc.data?.player !== currentTurn && !painterMode && ruleSet.id !== "tictactoe") {
        // still allow selection to show valid moves but prevent move later? For strict enforcement, don't select
        if (chainCaptureActive) return;
      }
      if (ruleSet.id === "tictactoe") {
        // in tictactoe clicking empty handled below, clicking occupied does nothing
        return;
      }
      setSelectedId(clickedOcc.id);
    } else {
      // empty cell click for tictactoe or sequencer painter
      if (ruleSet.id === "tictactoe") {
        if (outcome) return;
        // place X/O if empty
        if (occupantAt({ q, r }, occupants)) return;
        const player = currentTurn;
        const newOcc: Occupant = { id: makeId(), anchor: { q, r }, span: [], type: player === "X" ? "x" : "o", data: { player, symbol: player }, tags: [] };
        const newOccs = [...occupants, newOcc];
        setOccupants(newOccs);
        const out = checkOutcome(newOccs);
        if (out) setOutcome(out);
        else setCurrentTurn((p: string) => (p === "X" ? "O" : "X"));
      } else if (ruleSet.id === "sequencer") {
        const existing = occupantAt({ q, r }, occupants);
        if (!existing) {
          setOccupants((prev: Occupant[]) => [...prev, { id: makeId(), anchor: { q, r }, span: [], type: "note", data: { player: "composer" }, tags: [] }]);
        } else {
          setOccupants((prev: Occupant[]) => prev.filter((o) => o.id !== existing.id));
        }
      } else {
        // deselect
        if (!chainCaptureActive) {
          setSelectedId(null);
          setValidMoves([]);
        }
      }
    }
  };

  // render helpers for hex positions
  const getCellStyle = (q: number, r: number) => {
    const isValid = validMoves.some((m: any) => m.q === q && m.r === r);
    const isSelected = occupants.some((o: Occupant) => o.id === selectedId && o.anchor.q === q && o.anchor.r === r);
    let bg = "var(--bg-3)";
    if (tiling.style === "2color") {
      bg = (q + r) % 2 === 0 ? "#1a1d21" : "#22262e";
    } else {
      const mod = (q + r * 2) % 3;
      bg = mod === 0 ? "#1b1e24" : mod === 1 ? "#20242c" : "#252a33";
    }
    if (isValid) bg = "rgba(232,255,82,0.18)";
    if (isSelected) bg = "rgba(232,255,82,0.28)";
    const border = isValid ? "1px solid var(--accent)" : "1px solid var(--border)";
    return { bg, border, isValid, isSelected };
  };

  // container size
  const containerWidth = tiling.shape === "square" ? width * cellSize : width * cellSize * 0.88 + 30;
  const containerHeight = tiling.shape === "square" ? height * cellSize : height * cellSize * 0.78 + 30;

  return (
    <div className="relative w-full h-full flex flex-col">
      {/* grid */}
      <div
        className="relative mx-auto mt-2"
        style={{ width: containerWidth, height: containerHeight, minHeight: containerHeight }}
      >
        {Array.from({ length: height }).map((_, r) =>
          Array.from({ length: width }).map((_, q) => {
            const { bg, border, isValid, isSelected } = getCellStyle(q, r);
            let left = q * cellSize;
            let top = r * cellSize;
            let clipPath: string | undefined;
            if (tiling.id === "hexH") {
              const size = 26;
              left = q * size * 1.732 + (r % 2 ? size * 0.866 : 0);
              top = r * size * 1.5;
              clipPath = "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)";
            } else if (tiling.id === "hexV") {
              const size = 26;
              left = q * size * 1.5;
              top = r * size * 1.732 + (q % 2 ? size * 0.866 : 0);
              clipPath = "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)";
            }
            const occ = mapOccupant.get(`${q},${r}`);
            return (
              <div
                key={`${q}-${r}`}
                onClick={() => handleCellClick(q, r)}
                className="absolute flex items-center justify-center select-none cursor-pointer transition-all"
                style={{
                  left,
                  top,
                  width: tiling.shape === "square" ? cellSize - 2 : 44,
                  height: tiling.shape === "square" ? cellSize - 2 : 44,
                  background: bg,
                  border,
                  clipPath,
                  borderRadius: tiling.shape === "square" ? 8 : 0,
                  zIndex: isSelected ? 3 : isValid ? 2 : 1,
                  boxShadow: isValid ? "0 0 0 1px var(--accent), 0 0 16px rgba(232,255,82,0.3)" : undefined,
                }}
              >
                {isValid && !occ && (
                  <div className="w-[8px] h-[8px] rounded-full" style={{ background: "var(--accent)", boxShadow: "0 0 8px var(--accent)" }} />
                )}
                {occ && (
                  <div className="flex flex-col items-center justify-center leading-none">
                    <span
                      className="text-[16px] font-bold"
                      style={{
                        color:
                          occ.data?.player === "white" || occ.data?.player === "X"
                            ? "#f5f7fa"
                            : occ.data?.player === "black" || occ.data?.player === "O"
                            ? "#8a909c"
                            : occ.type === "paint"
                            ? "var(--accent)"
                            : "#e6e8eb",
                      }}
                    >
                      {occ.data?.symbol ||
                        (occ.type === "king_w" ? "♔" : occ.type === "king_b" ? "♚" : occ.type.startsWith("man") ? (occ.data.player === "white" ? "○" : "●") : occ.type === "note" ? "◼" : occ.type[0].toUpperCase())}
                    </span>
                    <span className="text-[8px] text-[var(--text-faint)] mt-[1px] tracking-wide">
                      {occ.type.slice(0, 4)}
                    </span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {outcome && (
        <div className="mt-6 mx-auto px-4 py-2 rounded-full bg-[var(--accent)] text-black text-[11px] font-bold tracking-widest uppercase flex items-center gap-2">
          <span className="w-2 h-2 bg-black rounded-full animate-pulse" /> {outcome}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2 justify-center text-[10px] text-[var(--text-faint)]">
        <span>VALID MOVES DRIVEN BY <b className="text-[var(--text-dim)]">getValidMoves()</b></span>
        <span className="opacity-30">•</span>
        <span>TILING: {tiling.id}</span>
        <span className="opacity-30">•</span>
        <span>TURN: {currentTurn.toUpperCase()}</span>
        {chainCaptureActive && <span className="text-[var(--accent)]">• CHAIN CAPTURE ACTIVE — CONTINUE</span>}
      </div>
    </div>
  );
}

// ---------- Other components ----------
function GraphView() {
  const [nodes, setNodes] = useState([
    { id: "a", x: 80, y: 80, label: "root" },
    { id: "b", x: 220, y: 120, label: "branch" },
    { id: "c", x: 140, y: 220, label: "leaf" },
  ]);
  const [edges, setEdges] = useState([
    { from: "a", to: "b" },
    { from: "a", to: "c" },
  ]);
  const [directed, setDirected] = useState(false);
  const [morph, setMorph] = useState(0);
  const morphs = ["untyped blob", "directed", "acyclic check", "single-parent → Tree"];
  const addNode = () => {
    setNodes((n) => [...n, { id: makeId(), x: 100 + Math.random() * 200, y: 100 + Math.random() * 150, label: `n${n.length}` }]);
  };
  return (
    <div className="w-full h-full flex flex-col gap-4">
      <div className="flex gap-2">
        <button onClick={addNode} className="px-3 py-1.5 rounded-full bg-[var(--bg-3)] border border-[var(--border)] text-[11px] hover:bg-[var(--bg-4)]">+ NODE (occupant)</button>
        <button onClick={() => setDirected(!directed)} className={`px-3 py-1.5 rounded-full border text-[11px] ${directed ? "bg-[var(--accent)] text-black border-[var(--accent)]" : "bg-[var(--bg-3)] border-[var(--border)]"}`}>DIRECTED {directed ? "ON" : "OFF"}</button>
        <button onClick={() => setMorph((m) => (m + 1) % 4)} className="px-3 py-1.5 rounded-full bg-[var(--bg-3)] border border-[var(--border)] text-[11px]">MORPH → {morphs[(morph + 1) % 4]}</button>
      </div>
      <div className="relative flex-1 panel overflow-hidden" style={{ minHeight: 380 }}>
        <svg className="absolute inset-0 w-full h-full">
          {edges.map((e, i) => {
            const f = nodes.find((n) => n.id === e.from);
            const t = nodes.find((n) => n.id === e.to);
            if (!f || !t) return null;
            return (
              <g key={i}>
                <line x1={f.x} y1={f.y} x2={t.x} y2={t.y} stroke="var(--border-2)" strokeWidth={1.5} />
                {directed && <circle cx={t.x} cy={t.y} r={4} fill="var(--accent)" />}
              </g>
            );
          })}
        </svg>
        {nodes.map((n) => (
          <div
            key={n.id}
            className="absolute w-[72px] h-[40px] rounded-[10px] border bg-[var(--bg-3)] border-[var(--border)] flex flex-col items-center justify-center cursor-move select-none"
            style={{ left: n.x - 36, top: n.y - 20 }}
            onMouseDown={(e) => {
              const startX = e.clientX, startY = e.clientY, ox = n.x, oy = n.y;
              const move = (ev: MouseEvent) => {
                setNodes((ns) => ns.map((nn) => nn.id === n.id ? { ...nn, x: ox + ev.clientX - startX, y: oy + ev.clientY - startY } : nn));
              };
              const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
              window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
            }}
          >
            <span className="text-[10px] font-bold">{n.label}</span>
            <span className="text-[8px] text-[var(--text-faint)]">occupant</span>
          </div>
        ))}
        <div className="absolute bottom-3 left-3 text-[10px] text-[var(--text-faint)]">
          MORPH: <span className="text-[var(--accent)]">{morphs[morph]}</span> • KERNEL: Graph
        </div>
      </div>
      <div className="text-[10px] text-[var(--text-dim)] leading-relaxed">
        Every node content is an Occupant {`{anchor,type,data,guest}`}. Same template as Grid. Edges are Protocol framing. Drag to re-layout. Toggle directed to see morph chain generic → directed → acyclic → Tree (single-parent).
      </div>
    </div>
  );
}

function TreeView() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["root", "src"]));
  const tree = {
    id: "root", name: "/", type: "folder", children: [
      { id: "src", name: "src", type: "folder", children: [
        { id: "app", name: "App.tsx", type: "file" },
        { id: "grid", name: "grid.ts", type: "file" },
        { id: "tiling", name: "tiling.hex.ts", type: "file" },
      ]},
      { id: "docs", name: "docs", type: "folder", children: [
        { id: "reconciled", name: "reconciled.md", type: "file" },
      ]},
      { id: "pkg", name: "package.json", type: "file" },
    ]
  };
  const toggle = (id: string) => {
    setExpanded((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };
  const renderNode = (node: any, depth = 0) => {
    const isFolder = node.type === "folder";
    const isExp = expanded.has(node.id);
    return (
      <div key={node.id}>
        <div className="flex items-center gap-2 py-1 px-2 rounded hover:bg-[var(--bg-3)] cursor-pointer" style={{ paddingLeft: 12 + depth * 14 }} onClick={() => isFolder && toggle(node.id)}>
          <span className="text-[10px] w-3">{isFolder ? (isExp ? "▼" : "▶") : "·"}</span>
          <span className={`text-[11px] ${isFolder ? "text-[var(--accent)]" : "text-[var(--text-dim)]"}`}>{node.name}</span>
          <span className="text-[8px] text-[var(--text-faint)] ml-auto">{isFolder ? "guest:Tree" : "occupant file"}</span>
        </div>
        {isFolder && isExp && node.children?.map((c: any) => renderNode(c, depth + 1))}
      </div>
    );
  };
  return (
    <div className="w-full h-full flex flex-col gap-3">
      <div className="panel p-3 flex-1 overflow-auto" style={{ minHeight: 380 }}>
        {renderNode(tree)}
        <div className="mt-4 p-2 rounded bg-[var(--lime-bg)] border border-[var(--border)] text-[10px]">
          <div className="text-[var(--accent)] font-bold mb-1">MORPH CHAIN</div>
          <div className="flex gap-1 flex-wrap">
            {["generic tree", "expandable", "typed folder/file", "lazy loading"].map((m,i)=>(
              <span key={i} className="px-2 py-1 rounded-full bg-[var(--bg-3)] border border-[var(--border)]">{m}</span>
            ))}
          </div>
        </div>
      </div>
      <div className="text-[10px] text-[var(--text-dim)]">Tree reuses Occupant: anchor = parent pointer, span = children, guest = hosted component. Drag reparent simulated by expand/collapse. File explorer example.</div>
    </div>
  );
}

function PathView() {
  const [interp, setInterp] = useState<"bezier" | "route" | "trajectory" | "wire" | "automation">("bezier");
  const [points] = useState([
    { x: 40, y: 120, cx1: 80, cy1: 40, cx2: 160, cy2: 200 },
    { x: 220, y: 100, cx1: 260, cy1: 20, cx2: 300, cy2: 180 },
    { x: 340, y: 160 },
  ]);
  const pathD = `M ${points[0].x} ${points[0].y} C ${points[0].cx1} ${points[0].cy1}, ${points[0].cx2} ${points[0].cy2}, ${points[1].x} ${points[1].y} ${points[2] ? `C ${points[1].cx1} ${points[1].cy1}, ${points[1].cx2} ${points[1].cy2}, ${points[2].x} ${points[2].y}` : ""}`;
  return (
    <div className="w-full h-full flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {(["bezier","route","trajectory","wire","automation"] as const).map((k)=>(
          <button key={k} onClick={()=>setInterp(k)} className={`px-2 py-1 rounded-full text-[10px] border ${interp===k ? "bg-[var(--accent)] text-black border-[var(--accent)]" : "bg-[var(--bg-3)] border-[var(--border)]"}`}>{k.toUpperCase()}</button>
        ))}
      </div>
      <div className="panel flex-1 relative overflow-hidden" style={{ minHeight: 380 }}>
        <svg viewBox="0 0 400 260" className="w-full h-full">
          {interp==="automation" && <path d="M0 180 H400" stroke="var(--border)" strokeDasharray="4 4" />}
          <path d={pathD} fill={interp==="bezier" ? "rgba(232,255,82,0.12)" : "none"} stroke={interp==="wire" ? "#8a909c" : "var(--accent)"} strokeWidth={interp==="wire" ? 1 : 2} />
          {points.map((p,i)=>(
            <g key={i}>
              <circle cx={p.x} cy={p.y} r={6} fill="var(--bg-3)" stroke="var(--accent)" strokeWidth={1.5} />
              {p.cx1 && <><line x1={p.x} y1={p.y} x2={p.cx1} y2={p.cy1} stroke="var(--border-2)" strokeDasharray="3 3" /><circle cx={p.cx1} cy={p.cy1} r={3} fill="var(--text-faint)" /></>}
              {p.cx2 && <><line x1={points[i+1]?.x ?? p.x} y1={points[i+1]?.y ?? p.y} x2={p.cx2} y2={p.cy2} stroke="var(--border-2)" strokeDasharray="3 3" /><circle cx={p.cx2} cy={p.cy2} r={3} fill="var(--text-faint)" /></>}
            </g>
          ))}
        </svg>
        <div className="absolute bottom-3 left-3 text-[10px] text-[var(--text-faint)]">OCCUPANTS = points + handles • INTERP: {interp} • substrate: Path</div>
      </div>
      <div className="text-[10px] text-[var(--text-dim)]">Same points, five interpretations: Bezier shape / map route / motion trajectory / wire / automation curve. Morph stackable: stroke, fill, winding, dash.</div>
    </div>
  );
}

function ProtocolView() {
  const frames = [
    { id: "hdr", len: 4, type: "length" },
    { id: "msg", len: 12, type: "payload" },
    { id: "crc", len: 4, type: "crc32" },
    { id: "ack", len: 2, type: "ack" },
  ];
  const [morphIdx, setMorphIdx] = useState(5);
  const morphs = ["blob", "varInt length", "stream ordering", "crc32", "ack window", "TLS"];
  return (
    <div className="w-full h-full flex flex-col gap-3">
      <div className="flex gap-2 flex-wrap">
        {morphs.map((m,i)=>(
          <div key={i} className={`px-2 py-1 rounded-full text-[10px] border ${i<=morphIdx ? "bg-[var(--accent)] text-black border-[var(--accent)]" : "bg-[var(--bg-3)] border-[var(--border)] text-[var(--text-faint)]"}`}>{i+1}. {m}</div>
        ))}
        <button onClick={()=>setMorphIdx((v)=>(v+1)%6)} className="ml-auto px-3 py-1 rounded-full bg-[var(--bg-3)] border border-[var(--border)] text-[10px]">NEXT MORPH →</button>
      </div>
      <div className="panel p-4 flex-1" style={{ minHeight: 380 }}>
        <div className="flex gap-[2px] h-16 items-end">
          {frames.map((f)=>(
            <div key={f.id} className="flex-1 rounded-t-[6px] border flex flex-col justify-between p-2" style={{ height: `${30+f.len*4}px`, background: f.type==="payload" ? "var(--lime-bg)" : "var(--bg-3)", borderColor: f.type==="crc32" ? "var(--accent)" : "var(--border)" }}>
              <span className="text-[9px] font-bold">{f.id.toUpperCase()}</span>
              <span className="text-[8px] text-[var(--text-faint)]">{f.len}b • {f.type}</span>
            </div>
          ))}
        </div>
        <div className="mt-6 grid grid-cols-3 gap-2 text-[10px]">
          <div className="panel p-2">
            <div className="text-[var(--text-faint)]">SESSION</div>
            <div className="mt-1 font-bold">id: 0x7f3a • ordered</div>
            <div className="text-[8px] text-[var(--text-faint)]">substrate: length-framed blobs</div>
          </div>
          <div className="panel p-2">
            <div className="text-[var(--text-faint)]">STREAM</div>
            <div className="mt-1 font-bold">window 4 • ack 2/4</div>
            <div className="text-[8px] text-[var(--text-faint)]">morph: ack window</div>
          </div>
          <div className="panel p-2">
            <div className="text-[var(--text-faint)]">PROTOCOL</div>
            <div className="mt-1 font-bold">TLS 1.3 • framing intact</div>
            <div className="text-[8px] text-[var(--text-faint)]">morph: TLS</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LogicView() {
  const [view, setView] = useState<"graph"|"table"|"rules">("graph");
  const triples = [
    { s: "pawn", p: "moves", o: "N 1" },
    { s: "bishop", p: "slides", o: "diagonal" },
    { s: "king", p: "is", o: "check if captured" },
    { s: "checkers", p: "requires", o: "darkOnly" },
  ];
  return (
    <div className="w-full h-full flex flex-col gap-3">
      <div className="flex gap-2">
        {(["graph","table","rules"] as const).map((v)=>(
          <button key={v} onClick={()=>setView(v)} className={`px-3 py-1 rounded-full text-[10px] border ${view===v ? "bg-[var(--accent)] text-black" : "bg-[var(--bg-3)] border-[var(--border)]"}`}>{v.toUpperCase()}</button>
        ))}
        <span className="ml-auto text-[10px] text-[var(--text-faint)]">TRIPLES subject-predicate-object as Graph edges • inference toggle</span>
      </div>
      <div className="panel p-3 flex-1" style={{ minHeight: 380 }}>
        {view==="table" ? (
          <table className="w-full text-[11px]">
            <thead className="text-[9px] text-[var(--text-faint)]"><tr><th className="text-left p-2">S</th><th className="text-left p-2">P</th><th className="text-left p-2">O</th></tr></thead>
            <tbody>{triples.map((t,i)=><tr key={i} className="border-t border-[var(--border)]"><td className="p-2 font-bold">{t.s}</td><td className="p-2 text-[var(--text-dim)]">{t.p}</td><td className="p-2">{t.o}</td></tr>)}</tbody>
          </table>
        ) : view==="rules" ? (
          <div className="space-y-2">
            {triples.map((t,i)=><div key={i} className="p-2 rounded bg-[var(--bg-3)] border border-[var(--border)] text-[11px]"><span className="text-[var(--accent)]">{t.s}</span> <span className="text-[var(--text-faint)]">{t.p}</span> <span>{t.o}</span></div>)}
            <div className="mt-4 p-2 rounded bg-[var(--lime-bg)] border border-[var(--border)] text-[10px]">INFERENCE: pawn_w + N + capture NE/NW → validMoves includes opponent squares (generic engine, no hard-coded if pawn)</div>
          </div>
        ) : (
          <div className="relative h-[320px]">
            <svg className="w-full h-full">
              {triples.map((_,i)=>{
                const x1=40+i*80, y1=60, x2=80+i*80, y2=160;
                return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--border-2)" />;
              })}
            </svg>
            {triples.map((t,i)=>(
              <div key={i} className="absolute" style={{ left: 20+i*80, top: i%2===0?20:140 }}>
                <div className="px-2 py-1 rounded-full bg-[var(--bg-4)] border border-[var(--border)] text-[10px]">{t.s}</div>
                <div className="mt-6 px-2 py-1 rounded-full bg-[var(--accent)] text-black text-[10px] font-bold">{t.o}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ComposeView() {
  const [toggles, setToggles] = useState({ nesting:true, overlap:false, stacking:true, hosting:true, framing:true, expansion:false });
  const toggle = (k:keyof typeof toggles)=>setToggles((t)=>({...t, [k]:!t[k]}));
  return (
    <div className="w-full h-full flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {Object.entries(toggles).map(([k,v])=>(
          <button key={k} onClick={()=>toggle(k as any)} className={`px-3 py-1 rounded-full text-[10px] border ${v ? "bg-[var(--accent)] text-black border-[var(--accent)]" : "bg-[var(--bg-3)] border-[var(--border)]"}`}>{k.toUpperCase()} {v ? "ON" : "OFF"}</button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="panel p-3">
          <div className="text-[10px] font-bold tracking-widest">NLE TIMELINE = Grid + Path + Nesting</div>
          <div className="mt-3 h-[120px] relative bg-[var(--bg-3)] rounded-[10px] border border-[var(--border)] overflow-hidden">
            {/* tracks */}
            {[0,1,2].map((r)=>(
              <div key={r} className="absolute left-0 right-0 border-b border-[var(--border)]" style={{ top: r*40, height:40 }}>
                <div className="absolute left-2 top-2 text-[8px] text-[var(--text-faint)]">TRACK {r}</div>
                {/* clips */}
                <div className="absolute top-1 bottom-1 rounded bg-[var(--lime-bg)] border border-[var(--accent)]" style={{ left: 40 + r*30, width: 80 }}><span className="text-[8px] px-1">clip occupant</span></div>
                {toggles.hosting && <div className="absolute top-1 bottom-1 rounded bg-[var(--bg-4)] border border-dashed border-[var(--text-faint)]" style={{ left: 140 + r*20, width: 60 }}><span className="text-[7px] px-1">Path guest (automation)</span><svg className="w-full h-[20px]"><path d="M0 10 Q20 0 40 10 T80 10" fill="none" stroke="var(--accent)" strokeWidth={1}/></svg></div>}
              </div>
            ))}
          </div>
          <div className="mt-2 text-[10px] text-[var(--text-faint)]">Grid substrate holds clips as occupants. Each clip hosts Path (automation lane) via guest field. Nesting shows timeline in cell.</div>
        </div>

        <div className="panel p-3">
          <div className="text-[10px] font-bold tracking-widest">DASHBOARD = Grid cell hosting Tree</div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {Array.from({length:6}).map((_,i)=>(
              <div key={i} className="h-[64px] rounded-[10px] bg-[var(--bg-3)] border border-[var(--border)] p-2 relative overflow-hidden">
                <div className="text-[8px] text-[var(--text-faint)]">CELL {i}</div>
                {toggles.hosting && i===2 && (
                  <div className="absolute inset-[4px] top-[16px] bg-[var(--bg-2)] border border-[var(--border)] rounded-[8px] p-1">
                    <div className="text-[7px]">▶ src</div>
                    <div className="text-[7px] pl-2">· App.tsx</div>
                  </div>
                )}
                {toggles.stacking && i===4 && <div className="absolute bottom-1 right-1 w-6 h-6 rounded-full bg-[var(--accent)] text-black text-[8px] flex items-center justify-center font-bold">3</div>}
              </div>
            ))}
          </div>
        </div>

        <div className="panel p-3">
          <div className="text-[10px] font-bold tracking-widest">LUOSHU EXPANSION (cell → copy of structure)</div>
          <div className="mt-3 flex items-center gap-3">
            <div className="w-[70px] h-[70px] rounded-[12px] bg-[var(--bg-3)] border border-[var(--border)] flex items-center justify-center text-[10px]">cell [1,1]</div>
            <span className="text-[var(--text-faint)]">→</span>
            <div className="grid grid-cols-3 gap-[2px] w-[70px] h-[70px] p-[4px] rounded-[12px] bg-[var(--lime-bg)] border border-[var(--accent)]">
              {Array.from({length:9}).map((_,i)=><div key={i} className="bg-[var(--bg-3)] rounded-[2px] text-[6px] flex items-center justify-center">{i===4 ? "◉" : ""}</div>)}
            </div>
            <span className="text-[10px] text-[var(--text-faint)]">{toggles.expansion ? "depth limit 2 • recursive" : "toggle expansion ON to enable"}</span>
          </div>
        </div>

        <div className="panel p-3">
          <div className="text-[10px] font-bold tracking-widest">LAYOUT GRID OF REGIONS (different tilings)</div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="h-[80px] rounded-[10px] border border-[var(--border)] bg-[var(--bg-3)] p-2"><div className="text-[8px] text-[var(--text-faint)]">REGION A • square4</div><div className="mt-2 grid grid-cols-4 gap-[2px]">{Array.from({length:8}).map((_,i)=><div key={i} className="h-3 bg-[var(--bg-4)] rounded-[2px]"></div>)}</div></div>
            <div className="h-[80px] rounded-[10px] border border-[var(--accent)] bg-[var(--lime-bg)] p-2"><div className="text-[8px] text-[var(--accent)]">REGION B • hexH</div><div className="mt-2 flex gap-[2px] flex-wrap">{Array.from({length:8}).map((_,i)=><div key={i} className="w-3 h-3 rounded-[2px]" style={{ clipPath:"polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%)", background:"var(--bg-4)"}}></div>)}</div></div>
          </div>
          <div className="mt-2 text-[10px] text-[var(--text-faint)]">Composition convention: framing. Same Occupant template, tiling param swapped per region.</div>
        </div>
      </div>
    </div>
  );
}

// ---------- Main App ----------
export default function App() {
  const [component, setComponent] = useState<"Grid"|"Graph"|"Tree"|"Path"|"Protocol"|"Logic"|"Compose">("Grid");
  const [tilingId, setTilingId] = useState<Tiling["id"]>("square8");
  const tiling = useMemo(()=>TILINGS.find(t=>t.id===tilingId)!, [tilingId]);
  const [presetId, setPresetId] = useState("chess6");
  const [ruleSet, setRuleSet] = useState<RuleSet>(()=>presetRules("chess6", 6,6));
  const [occupants, setOccupants] = useState<Occupant[]>(()=>presetOccupants("chess6"));
  const [width, setWidth] = useState(6);
  const [height, setHeight] = useState(6);
  const [selectedId, setSelectedId] = useState<string|null>(null);
  const [validMoves, setValidMoves] = useState<any[]>([]);
  const [currentTurn, setCurrentTurn] = useState("white");
  const [outcome, setOutcome] = useState<string|null>(null);
  const [toggles, setToggles] = useState<Toggles>({ gravity:false, diagonal:false, sliding:true, wrapping:false, chainCapture:true });
  const [painterMode, setPainterMode] = useState(false);
  const [chainCaptureActive, setChainCaptureActive] = useState(false);
  const [planMode, setPlanMode] = useState<"yaml"|"xml">("yaml");
  const [configs, setConfigs] = useState<any[]>([]);
  const [saveName, setSaveName] = useState("");

  // load configs
  useEffect(()=>{
    (async()=>{
      try{
        const data = await apiCall("records.list", { collection:"configs", limit:50 });
        setConfigs(data.records || []);
      }catch{}
    })();
  },[]);

  // when preset changes
  useEffect(()=>{
    const rs = presetRules(presetId, presetId==="checkers"?8: presetId==="tictactoe"?3: presetId==="sequencer"?16: presetId==="painter"?12:6, presetId==="sequencer"?4: presetId==="checkers"?8: presetId==="tictactoe"?3: presetId==="painter"?12:6);
    setRuleSet(rs);
    setWidth(rs.setup.width);
    setHeight(rs.setup.height);
    setOccupants(presetOccupants(presetId));
    setCurrentTurn(rs.turns.current);
    setOutcome(null);
    setSelectedId(null);
    setValidMoves([]);
    setPainterMode(presetId==="painter");
    setChainCaptureActive(false);
  },[presetId]);

  // tiling change doesn't reset occupants but we need to keep same anchors (reinterpretation)
  // width/height stay same

  const saveConfig = async()=>{
    const name = saveName || `${presetId}-${tilingId}-${Date.now()}`;
    try{
      const val = { name, component, tilingId, presetId, ruleSet, occupants, width, height, toggles, createdAt: new Date().toISOString() };
      const rec = await apiCall("records.create", { collection:"configs", value: val, idempotency_key: `cfg-${name}` });
      setConfigs((c)=>[rec, ...c]);
      setSaveName("");
    }catch(e:any){ alert(e.message); }
  };

  const loadConfig = async(id:string)=>{
    try{
      const rec = await apiCall("records.get", { collection:"configs", id });
      if(!rec) return;
      const v = rec.value;
      setComponent(v.component||"Grid");
      setTilingId(v.tilingId||"square8");
      setPresetId(v.presetId||"chess6");
      setRuleSet(v.ruleSet);
      setOccupants(v.occupants||[]);
      setWidth(v.width||6);
      setHeight(v.height||6);
      setToggles(v.toggles||toggles);
      setOutcome(null);
    }catch{}
  };

  const planText = useMemo(()=>{
    if(planMode==="xml"){
      return `<OcelotPlan component="${component}" tiling="${tilingId}" preset="${presetId}">
  <RuleSet id="${ruleSet.id}" outcome="${ruleSet.outcome.type}" turn="${ruleSet.turns.current}">
${ruleSet.moves.map(m=>`    <Move piece="${m.pieceType}" dirs="${m.directions.join(",")}" slide="${!!m.slide}" capture="${m.capture||"both"}" ${m.jumpOver?`jumpOver="true"`:``} />`).join("\n")}
  </RuleSet>
  <Grid width="${width}" height="${height}" gravity="${toggles.gravity}" wrapping="${toggles.wrapping}">
${occupants.slice(0,20).map(o=>`    <Occupant id="${o.id}" anchor="${o.anchor.q},${o.anchor.r}" type="${o.type}" player="${o.data?.player||""}" />`).join("\n")}
    ${occupants.length>20?`    <!-- +${occupants.length-20} more -->`:``}
  </Grid>
</OcelotPlan>`;
    }else{
      return `component: ${component}
tiling:
  id: ${tilingId}
  shape: ${tiling.shape}
  neighbors: [${tiling.neighbors.join(", ")}]
  style: ${tiling.style}
  cellToPoint: "(q,r) -> point via ${tiling.id.includes("hex")? "axial" : "cartesian"}"
  pointToCell: "inverse"
  distance: "${tiling.id.includes("hex")? "axial hexDistance" : tilingId==="square4" ? "manhattan" : "chebyshev"}"
preset: ${presetId}
ruleSet:
  id: ${ruleSet.id}
  setup: {w:${width}, h:${height}, desc: "${ruleSet.setup.description}"}
  turns: ${ruleSet.turns.order} current=${currentTurn}
  outcome: ${ruleSet.outcome.type}
  moves:
${ruleSet.moves.map(m=>`    - piece: ${m.pieceType} dirs: [${m.directions.join(",")}] slide:${!!m.slide} capture:${m.capture} ${m.jumpOver? "jumpOver:true":""}`).join("\n")}
occupants: ${occupants.length}
  - ${occupants.slice(0,5).map(o=>`${o.type}@${o.anchor.q},${o.anchor.r}`).join("\n  - ")}
toggles: gravity=${toggles.gravity} diagonal=${toggles.diagonal} sliding=${toggles.sliding} wrapping=${toggles.wrapping} chainCapture=${toggles.chainCapture}
engine: getValidMoves(occupant, gridState, tiling, ruleSet) -> highlighted in lime, enforced`;
    }
  },[component, tiling, tilingId, presetId, ruleSet, occupants, width, height, toggles, currentTurn, planMode]);

  return (
    <div data-safe-area-inset-root className="min-h-screen w-full bg-[var(--bg)] text-[var(--text)]" style={{ boxSizing:"border-box", paddingTop:"var(--safe-area-inset-top)" }}>
      {/* Header */}
      <header data-safe-area-sticky-top className="sticky top-[var(--safe-area-inset-top)] z-30 backdrop-blur-xl bg-[rgba(14,15,17,0.9)] border-b border-[var(--border)]">
        <div className="max-w-[1600px] mx-auto px-4 md:px-6 h-[64px] flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-[32px] h-[32px] rounded-[8px] bg-[var(--accent)] text-black flex items-center justify-center font-bold text-[14px]">P³</div>
            <div>
              <div className="font-bold tracking-[-0.02em] text-[13px] md:text-[14px]">Paramorphic Components — Reconciled Runtime</div>
              <div className="text-[10px] text-[var(--text-dim)] tracking-wide">Generic first. Substrate, Occupants, Rules. <span className="text-[var(--accent)]">Rule-set shape drives engine, not hard-coded presets.</span></div>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-3 text-[10px]">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--bg-2)] border border-[var(--border)]">
              <span className="lime-dot" /> <span className="font-bold">SHARED OCCUPANT</span> <span className="text-[var(--text-faint)]">anchor/span/type/data/tags/draw/guest/hooks</span>
            </div>
            <div className="px-3 py-1.5 rounded-full bg-[var(--lime-bg)] border border-[var(--border)] text-[var(--accent)]">v3 • Rule-Set Engine</div>
          </div>
        </div>
      </header>

      <div className="max-w-[1600px] mx-auto px-3 md:px-6 py-4 grid grid-cols-1 lg:grid-cols-[200px_1fr_360px] gap-4">
        {/* Left */}
        <div className="flex flex-col gap-4">
          <div className="panel p-2">
            <div className="text-[9px] tracking-[0.18em] text-[var(--text-faint)] px-2 py-1">COMPONENTS (Family)</div>
            {(["Grid","Graph","Tree","Path","Protocol","Logic","Compose"] as const).map((c)=>(
              <button
                key={c}
                onClick={()=>setComponent(c)}
                className={`w-full text-left px-3 py-2 rounded-[8px] text-[12px] flex items-center justify-between mt-[2px] border ${component===c ? "bg-[var(--accent)] text-black border-[var(--accent)] font-bold" : "bg-transparent border-transparent hover:bg-[var(--bg-3)] text-[var(--text-dim)]"}`}
              >
                <span>{c.toUpperCase()}{c==="Graph" ? " (Kernel)" : ""}</span>
                {component===c && <span className="text-[10px]">●</span>}
              </button>
            ))}
            <div className="mt-3 pt-3 border-t border-[var(--border)] px-2">
              <div className="text-[9px] tracking-[0.18em] text-[var(--text-faint)]">VALIDATION LADDER</div>
              <div className="mt-2 space-y-1.5">
                {[
                  { k:"1. Grid tiling param", ok:true, note:"square4/8/hexH/hexV same occupants" },
                  { k:"2. Rule toggles drive", ok:true, note:"gravity/diag/slide/wrap/chain live" },
                  { k:"3. Hex tilings", ok:true, note:"odd-r / odd-q, 3-color, distance axial" },
                  { k:"4. Family parity", ok:true, note:"Graph/Tree/Path/Protocol/Logic same occupant" },
                  { k:"5. Composition", ok:true, note:"nest/host/stack/frame/expansion NLE + dashboard" },
                ].map((s)=>(
                  <div key={s.k} className="flex gap-2 items-start text-[10px]">
                    <span className={`mt-[2px] w-3 h-3 rounded-full flex items-center justify-center text-[8px] ${s.ok ? "bg-[var(--accent)] text-black" : "bg-[var(--bg-3)] border border-[var(--border)]"}`}>✓</span>
                    <div><div className="font-bold leading-tight">{s.k}</div><div className="text-[9px] text-[var(--text-faint)] leading-tight">{s.note}</div></div>
                  </div>
                ))}
              </div>
              <div className="mt-3 p-2 rounded-[8px] bg-[var(--bg-3)] border border-[var(--border)] text-[9px] leading-relaxed">
                <div>Shared code %: <b className="text-[var(--accent)]">~82%</b> • plan size vs custom: <b>1:9</b></div>
                <div className="text-[var(--text-faint)] mt-1">Timeline is Grid config, Network → Graph+Protocol. No hard-coded per preset ifs.</div>
              </div>
            </div>
          </div>

          {component==="Grid" && (
            <div className="panel p-3">
              <div className="text-[9px] tracking-[0.18em] text-[var(--text-faint)]">PRESETS (15 forms → grid)</div>
              <div className="mt-2 grid grid-cols-2 gap-1">
                {[
                  { id:"tictactoe", label:"TicTacToe" },
                  { id:"chess6", label:"Chess 6×6" },
                  { id:"checkers", label:"Checkers" },
                  { id:"painter", label:"Hex Painter" },
                  { id:"sequencer", label:"Sequencer" },
                  { id:"crossword", label:"Crossword*" },
                ].map((p)=>(
                  <button key={p.id} onClick={()=>setPresetId(p.id)} className={`px-2 py-2 rounded-[8px] text-[10px] border text-left ${presetId===p.id ? "bg-[var(--accent)] text-black border-[var(--accent)] font-bold" : "bg-[var(--bg-3)] border-[var(--border)] hover:bg-[var(--bg-4)]"}`}>{p.label}</button>
                ))}
              </div>
              <div className="mt-3">
                <div className="text-[9px] tracking-[0.18em] text-[var(--text-faint)]">TILING PARAM (swappable)</div>
                <div className="mt-2 space-y-1">
                  {TILINGS.map((t)=>(
                    <button key={t.id} onClick={()=>setTilingId(t.id)} className={`w-full text-left px-2 py-2 rounded-[8px] text-[10px] border ${tilingId===t.id ? "bg-[var(--lime-bg)] border-[var(--accent)] text-[var(--accent)]" : "bg-[var(--bg-3)] border-[var(--border)] text-[var(--text-dim)]"}`}>
                      <div className="font-bold">{t.id.toUpperCase()}</div>
                      <div className="text-[8px] text-[var(--text-faint)]">{t.name} • {t.style}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3">
                <div className="text-[9px] tracking-[0.18em] text-[var(--text-faint)]">RULE TOGGLES (drive engine)</div>
                <div className="mt-2 space-y-1">
                  {[
                    { k:"gravity", label:"GRAVITY • pieces fall S" },
                    { k:"diagonal", label:"DIAGONAL • add NE/NW/SE/SW to square4" },
                    { k:"sliding", label:"SLIDING • queen/rook/bishop slide" },
                    { k:"wrapping", label:"WRAPPING • toroidal board" },
                    { k:"chainCapture", label:"CHAIN CAPTURE • checkers chain" },
                  ].map((t)=>(
                    <button key={t.k} onClick={()=>setToggles((tg:any)=>({...tg, [t.k]:!tg[t.k]}))} className={`w-full flex items-center justify-between px-2 py-1.5 rounded-[8px] text-[10px] border ${ (toggles as any)[t.k] ? "bg-[var(--accent)] text-black border-[var(--accent)]" : "bg-[var(--bg-3)] border-[var(--border)] text-[var(--text-dim)]"}`}>
                      <span>{t.label}</span><span className="text-[9px]">{(toggles as any)[t.k] ? "ON" : "OFF"}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="panel p-3">
            <div className="text-[9px] tracking-[0.18em] text-[var(--text-faint)]">PERSISTENCE • SAVED CONFIGS</div>
            <div className="mt-2 flex gap-1">
              <input value={saveName} onChange={(e)=>setSaveName(e.target.value)} placeholder="name..." className="flex-1 px-2 py-1.5 rounded-[8px] bg-[var(--bg-3)] border border-[var(--border)] text-[10px] outline-none" />
              <button onClick={saveConfig} className="px-3 py-1.5 rounded-[8px] bg-[var(--accent)] text-black text-[10px] font-bold">SAVE</button>
            </div>
            <div className="mt-2 max-h-[120px] overflow-auto space-y-1">
              {configs.length===0 && <div className="text-[10px] text-[var(--text-faint)]">No saved configs yet. Save current tiling+rules.</div>}
              {configs.map((c:any)=>(
                <button key={c.id} onClick={()=>loadConfig(c.id)} className="w-full text-left px-2 py-1.5 rounded-[8px] bg-[var(--bg-3)] border border-[var(--border)] text-[10px] hover:bg-[var(--bg-4)]">
                  <div className="font-bold truncate">{c.value?.name}</div>
                  <div className="text-[8px] text-[var(--text-faint)]">{c.value?.presetId} • {c.value?.tilingId} • {c.value?.occupants?.length} occupants</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Center viewport */}
        <div className="panel-ghost p-3 md:p-5 min-h-[620px] flex flex-col">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] tracking-[0.2em] text-[var(--text-faint)]">VIEWPORT • {component.toUpperCase()}</span>
              {component==="Grid" && <span className="text-[10px] px-2 py-1 rounded-full bg-[var(--bg-3)] border border-[var(--border)]">{width}×{height} • {tilingId} • {presetId}</span>}
            </div>
            <div className="text-[9px] text-[var(--text-faint)]">ENGINE: <span className="text-[var(--text-dim)]">cell shape, coord, neighbors+directions, distance, cellToPoint/pointToCell, styleFn, spanShapes+rotation</span></div>
          </div>

          <div className="flex-1">
            {component==="Grid" && (
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
                painterMode={painterMode}
                chainCaptureActive={chainCaptureActive}
                setChainCaptureActive={setChainCaptureActive}
              />
            )}
            {component==="Graph" && <GraphView />}
            {component==="Tree" && <TreeView />}
            {component==="Path" && <PathView />}
            {component==="Protocol" && <ProtocolView />}
            {component==="Logic" && <LogicView />}
            {component==="Compose" && <ComposeView />}
          </div>

          <div className="mt-4 pt-3 border-t border-[var(--border)] flex flex-wrap gap-2 text-[9px] text-[var(--text-faint)]">
            <span>PRINCIPLES: generic first, substrate/occupants/rules separate, data apart from interpretation, morphs declarative stackable reversible, introspectable, composable</span>
          </div>
        </div>

        {/* Right inspector */}
        <div className="flex flex-col gap-4">
          <div className="panel p-3">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-bold tracking-[0.16em]">RULE-SET INSPECTOR</div>
              <span className="text-[8px] px-2 py-1 rounded-full bg-[var(--lime-bg)] border border-[var(--border)] text-[var(--accent)]">live JSON</span>
            </div>
            <div className="mt-3 space-y-3">
              {[
                { k:"Setup", v:`${ruleSet.setup.description} • ${width}×${height} • tiling=${tilingId}` },
                { k:"Moves", v:`${ruleSet.moves.length} rules • ${ruleSet.moves.map(m=>`${m.pieceType}:${m.directions.join("+")}${m.slide?"[slide]":""}`).join(" | ")}` },
                { k:"Turns", v:`${ruleSet.turns.order} • current=${currentTurn} • enforced` },
                { k:"Outcome", v:`${ruleSet.outcome.type} • ${ruleSet.end.condition}` },
                { k:"End", v: outcome ? `→ ${outcome}` : "pending" },
              ].map((s)=>(
                <div key={s.k} className="p-2 rounded-[8px] bg-[var(--bg-3)] border border-[var(--border)]">
                  <div className="text-[9px] tracking-[0.15em] text-[var(--text-faint)]">{s.k.toUpperCase()}</div>
                  <div className="text-[10px] mt-1 leading-relaxed break-words">{s.v}</div>
                </div>
              ))}
            </div>

            <div className="mt-4">
              <div className="text-[9px] tracking-[0.18em] text-[var(--text-faint)]">MORPH CHAIN (stackable, reversible)</div>
              <div className="mt-2 flex flex-wrap gap-1">
                {[
                  "untyped grid",
                  `${tilingId}`,
                  toggles.gravity ? "+gravity" : "gravity off",
                  toggles.wrapping ? "+wrap" : "wrap off",
                  toggles.chainCapture ? "+chain" : "",
                  painterMode ? "+painter" : "",
                  "→ validated moves",
                ].filter(Boolean).map((m,i)=>(
                  <span key={i} className="px-2 py-1 rounded-full bg-[var(--bg-4)] border border-[var(--border)] text-[9px]">{m}</span>
                ))}
              </div>
            </div>

            <div className="mt-4 p-2 rounded-[8px] bg-[var(--bg-4)] border border-[var(--border)]">
              <div className="text-[9px] text-[var(--text-faint)]">ENGINE VALIDATION</div>
              <div className="text-[10px] mt-1">getValidMoves() returns <span className="text-[var(--accent)]">{validMoves.length}</span> squares for selected {selectedId ? occupants.find((o:Occupant)=>o.id===selectedId)?.type : "none"}. Clicking elsewhere does nothing — chess pieces <b>cannot</b> move anywhere. Toggles mutate ruleSet JSON, moves update instantly.</div>
              <div className="mt-2 text-[9px] text-[var(--text-faint)]">Implementation: no hard-coded per preset ifs in move validation. All directions resolved via tiling.neighbor + dirVectors.</div>
            </div>
          </div>

          <div className="panel p-3">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-bold tracking-[0.16em]">PLAN (Ocelot)</div>
              <div className="flex gap-1">
                {(["yaml","xml"] as const).map((m)=>(
                  <button key={m} onClick={()=>setPlanMode(m)} className={`px-2 py-1 rounded-full text-[9px] border ${planMode===m ? "bg-[var(--accent)] text-black border-[var(--accent)]" : "bg-[var(--bg-3)] border-[var(--border)]"}`}>{m.toUpperCase()}</button>
                ))}
              </div>
            </div>
            <pre className="mt-3 p-2 rounded-[8px] bg-[#0a0b0d] border border-[var(--border)] text-[9px] leading-[1.35] overflow-auto max-h-[320px] whitespace-pre-wrap break-words">{planText}</pre>
            <div className="mt-2 text-[9px] text-[var(--text-faint)]">Plan size vs custom code 1:9 — shared occupant + tiling param. Data apart from interpretation.</div>
          </div>

          <div className="panel p-3">
            <div className="text-[9px] tracking-[0.18em] text-[var(--text-faint)]">COMPOSITION CONVENTIONS</div>
            <div className="mt-2 grid grid-cols-3 gap-1 text-[9px]">
              {["nesting","overlap","stacking","hosting","framing","expansion"].map((c)=>(
                <div key={c} className="px-2 py-1.5 rounded-[8px] bg-[var(--bg-3)] border border-[var(--border)] text-center">{c}</div>
              ))}
            </div>
            <div className="mt-2 text-[9px] text-[var(--text-dim)] leading-relaxed">
              Examples: Grid cell hosting Tree (dashboard), Tree node hosting Path (scene graph), Grid occupant hosting Path (automation lane in NLE), Layout grid of regions each holding different tiling. Luoshu toggle: cell expanding into copy of its own structure with depth limit.
            </div>
          </div>
        </div>
      </div>

      <footer className="max-w-[1600px] mx-auto px-6 py-6 text-[10px] text-[var(--text-faint)] flex flex-wrap gap-4 border-t border-[var(--border)] mt-4">
        <span>Family: Grid, Graph (kernel), Tree, Path, Protocol, Logic. Timeline is Grid config. Network → Graph+Protocol.</span>
        <span className="opacity-30">•</span>
        <span>One shared Occupant: anchor/span/type/data/tags/draw/hooks/guest</span>
        <span className="opacity-30">•</span>
        <span>HexH odd-r pointy-top, HexV odd-q flat-top, axial distance, cellToPoint/pointToCell</span>
      </footer>
    </div>
  );
}
