import type { Guest, Occupant, Pos, Region, RuleSet } from "./types";
import { makeEdgeRegions, makeSudokuRegions, makeTrackRegions } from "./occupancy";
import { makeId } from "./tilings";

// ---------- Presets (15) ----------
export function presetData(presetId: string): { ruleSet: RuleSet; occupants: Occupant[]; width: number; height: number; regions: Region[] } {
  const edge = (w: number, h: number) => makeEdgeRegions(w, h);
  const mkOcc = (q: number, r: number, type: string, player?: string, symbol?: string, span: Pos[] = [], guest?: Guest): Occupant => ({
    id: makeId(), anchor: { q, r }, span, type, data: { player, symbol, hasMoved: false }, tags: [], guest
  });

  switch (presetId) {
    case "tictactoe": {
      const w = 3, h = 3;
      return {
        width: w, height: h, regions: [],
        occupants: [],
        ruleSet: {
          id: "tictactoe",
          setup: { width: w, height: h, description: "Placement, line 3 wins, works on any tiling via line()" },
          moves: [{ pieceType: "*", moves: [{ type: "place", anywhere: true }], capture: "move" }],
          turns: { type: "alternating", order: ["X", "O"], first: "X" },
          outcomes: [
            { kind: "line", player: "any", count: 3, directions: "any", regions: "all" },
            { kind: "boardFull", draw: true }
          ],
          end: { condition: "anyOutcome", action: "stop" },
          regions: []
        }
      };
    }
    case "checkers": {
      const w = 8, h = 8;
      const regions = [...edge(w, h), { id: "promotion-white", cells: Array.from({ length: w }, (_, q) => ({ q, r: 0 })), type: "edge" as const }, { id: "promotion-black", cells: Array.from({ length: w }, (_, q) => ({ q, r: h - 1 })), type: "edge" as const }];
      const occs: Occupant[] = [];
      for (let r = 0; r < 3; r++) for (let q = 0; q < w; q++) if ((q + r) % 2 === 1) occs.push(mkOcc(q, r, "man_b", "black", "●"));
      for (let r = 5; r < h; r++) for (let q = 0; q < w; q++) if ((q + r) % 2 === 1) occs.push(mkOcc(q, r, "man_w", "white", "○"));
      return {
        width: w, height: h, regions,
        occupants: occs,
        ruleSet: {
          id: "checkers",
          setup: { width: w, height: h, description: "Dark only, leap capture, chain, promotion via region" },
          moves: [
            { pieceType: "man_w", moves: [{ type: "step", dir: "NE" }, { type: "step", dir: "NW" }, { type: "leap", offsets: [{ dq: 2, dr: -2, axial: { q: 2, r: -2 } }, { dq: -2, dr: -2, axial: { q: -2, r: 0 } }] }], capture: "both", jumpOver: true, requires: { darkOnly: true }, onCapture: { chain: true }, onMove: { promoteTo: ["king_w"], ifInRegion: "promotion-white" } },
            { pieceType: "man_b", moves: [{ type: "step", dir: "SE" }, { type: "step", dir: "SW" }, { type: "leap", offsets: [{ dq: 2, dr: 2, axial: { q: 0, r: 2 } }, { dq: -2, dr: 2, axial: { q: -2, r: 2 } }] }], capture: "both", jumpOver: true, requires: { darkOnly: true }, onCapture: { chain: true }, onMove: { promoteTo: ["king_b"], ifInRegion: "promotion-black" } },
            { pieceType: "king_w", moves: [{ type: "step", dir: "NE" }, { type: "step", dir: "NW" }, { type: "step", dir: "SE" }, { type: "step", dir: "SW" }, { type: "slide", dir: "NE", min: 1, max: 2 }, { type: "slide", dir: "NW", min: 1, max: 2 }, { type: "slide", dir: "SE", min: 1, max: 2 }, { type: "slide", dir: "SW", min: 1, max: 2 }, { type: "leap", offsets: [{ dq: 2, dr: -2, axial: { q: 2, r: -2 } }, { dq: -2, dr: -2, axial: { q: -2, r: 0 } }, { dq: 2, dr: 2, axial: { q: 0, r: 2 } }, { dq: -2, dr: 2, axial: { q: -2, r: 2 } }] }], capture: "both", jumpOver: true, requires: { darkOnly: true }, onCapture: { chain: true } },
            { pieceType: "king_b", moves: [{ type: "step", dir: "NE" }, { type: "step", dir: "NW" }, { type: "step", dir: "SE" }, { type: "step", dir: "SW" }, { type: "slide", dir: "NE", min: 1, max: 2 }, { type: "slide", dir: "NW", min: 1, max: 2 }, { type: "slide", dir: "SE", min: 1, max: 2 }, { type: "slide", dir: "SW", min: 1, max: 2 }, { type: "leap", offsets: [{ dq: 2, dr: -2, axial: { q: 2, r: -2 } }, { dq: -2, dr: -2, axial: { q: -2, r: 0 } }, { dq: 2, dr: 2, axial: { q: 0, r: 2 } }, { dq: -2, dr: 2, axial: { q: -2, r: 2 } }] }], capture: "both", jumpOver: true, requires: { darkOnly: true }, onCapture: { chain: true } },
          ],
          turns: { type: "samePlayerIfCapture", order: ["white", "black"], first: "white" },
          outcomes: [
            { kind: "captureAll", player: "black" },
            { kind: "captureAll", player: "white" },
            { kind: "noMoves", player: "opponent" }
          ],
          end: { condition: "anyOutcome", action: "stop" },
          regions
        }
      };
    }
    case "chess6": {
      const w = 6, h = 6;
      const regions = [...edge(w, h), { id: "promotion-white", cells: Array.from({ length: w }, (_, q) => ({ q, r: 0 })), type: "edge" as const }, { id: "promotion-black", cells: Array.from({ length: w }, (_, q) => ({ q, r: h - 1 })), type: "edge" as const }];
      const occs: Occupant[] = [];
      const backB = ["rook", "knight", "bishop", "queen", "king", "bishop"];
      const backW = ["rook", "knight", "bishop", "king", "queen", "bishop"];
      backB.forEach((t, i) => occs.push(mkOcc(i, 0, t, "black", t[0].toUpperCase())));
      for (let i = 0; i < 6; i++) occs.push(mkOcc(i, 1, "pawn_b", "black", "♟"));
      for (let i = 0; i < 6; i++) occs.push(mkOcc(i, 4, "pawn_w", "white", "♙"));
      backW.forEach((t, i) => occs.push(mkOcc(i, 5, t, "white", t === "king" ? "♔" : t === "queen" ? "♕" : t[0].toUpperCase())));
      return {
        width: w, height: h, regions,
        occupants: occs,
        ruleSet: {
          id: "chess6",
          setup: { width: w, height: h, description: "Mini chess, knight uses leap offsets (not direction names), promotion via region" },
          moves: [
            { pieceType: "pawn_w", moves: [{ type: "pawn", forward: "N", captureDirs: ["NE", "NW"], firstDouble: true }], capture: "both", onMove: { promoteTo: ["queen", "rook"], ifInRegion: "promotion-white" } },
            { pieceType: "pawn_b", moves: [{ type: "pawn", forward: "S", captureDirs: ["SE", "SW"], firstDouble: true }], capture: "both", onMove: { promoteTo: ["queen", "rook"], ifInRegion: "promotion-black" } },
            { pieceType: "rook", moves: [{ type: "slide", dir: "N" }, { type: "slide", dir: "S" }, { type: "slide", dir: "E" }, { type: "slide", dir: "W" }], capture: "both" },
            { pieceType: "bishop", moves: [{ type: "slide", dir: "NE" }, { type: "slide", dir: "NW" }, { type: "slide", dir: "SE" }, { type: "slide", dir: "SW" }], capture: "both" },
            { pieceType: "queen", moves: [{ type: "slide", dir: "N" }, { type: "slide", dir: "S" }, { type: "slide", dir: "E" }, { type: "slide", dir: "W" }, { type: "slide", dir: "NE" }, { type: "slide", dir: "NW" }, { type: "slide", dir: "SE" }, { type: "slide", dir: "SW" }], capture: "both" },
            { pieceType: "king", moves: [{ type: "step", dir: "N" }, { type: "step", dir: "S" }, { type: "step", dir: "E" }, { type: "step", dir: "W" }, { type: "step", dir: "NE" }, { type: "step", dir: "NW" }, { type: "step", dir: "SE" }, { type: "step", dir: "SW" }], capture: "both" },
            { pieceType: "knight", moves: [{ type: "leapRef", ref: "knight" }], capture: "both" },
          ],
          turns: { type: "alternating", order: ["white", "black"], first: "white" },
          outcomes: [
            { kind: "kingCaptured", player: "white" },
            { kind: "kingCaptured", player: "black" },
            { kind: "noMoves", player: "opponent" }
          ],
          end: { condition: "anyOutcome", action: "stop" },
          regions
        }
      };
    }
    case "chess8": {
      const base = presetData("chess6");
      const w = 8, h = 8;
      const regions = [...edge(w, h), { id: "promotion-white", cells: Array.from({ length: w }, (_, q) => ({ q, r: 0 })), type: "edge" as const }, { id: "promotion-black", cells: Array.from({ length: w }, (_, q) => ({ q, r: h - 1 })), type: "edge" as const }];
      const occs: Occupant[] = [];
      const back = ["rook", "knight", "bishop", "queen", "king", "bishop", "knight", "rook"];
      back.forEach((t, i) => occs.push(mkOcc(i, 0, t, "black", t[0].toUpperCase())));
      for (let i = 0; i < 8; i++) occs.push(mkOcc(i, 1, "pawn_b", "black", "♟"));
      for (let i = 0; i < 8; i++) occs.push(mkOcc(i, 6, "pawn_w", "white", "♙"));
      back.forEach((t, i) => occs.push(mkOcc(i, 7, t, "white", t === "king" ? "♔" : t === "queen" ? "♕" : t[0].toUpperCase())));
      return {
        width: w, height: h, regions,
        occupants: occs,
        ruleSet: {
          ...base.ruleSet,
          id: "chess8",
          setup: { width: w, height: h, description: "Full 8x8, same engine, leap knight works on any tiling" },
          regions
        }
      };
    }
    case "hexChess": {
      const w = 6, h = 6;
      const regions = [...edge(w, h), { id: "promotion-white", cells: Array.from({ length: w }, (_, q) => ({ q, r: 0 })), type: "edge" as const }, { id: "promotion-black", cells: Array.from({ length: w }, (_, q) => ({ q, r: h - 1 })), type: "edge" as const }];
      const occs: Occupant[] = [];
      const backB = ["rook", "knight", "bishop", "queen", "king", "bishop"];
      const backW = ["rook", "knight", "bishop", "king", "queen", "bishop"];
      backB.forEach((t, i) => occs.push(mkOcc(i, 0, t, "black", t[0].toUpperCase())));
      for (let i = 0; i < 6; i++) occs.push(mkOcc(i, 1, "pawn_b", "black", "♟"));
      for (let i = 0; i < 6; i++) occs.push(mkOcc(i, 4, "pawn_w", "white", "♙"));
      backW.forEach((t, i) => occs.push(mkOcc(i, 5, t, "white", t[0].toUpperCase())));
      return {
        width: w, height: h, regions,
        occupants: occs,
        ruleSet: {
          id: "hexChess",
          setup: { width: w, height: h, description: "Hex chess on hexH — uses hex directions E,W,NE,NW,SE,SW (no N/S reuse)" },
          moves: [
            { pieceType: "pawn_w", moves: [{ type: "step", dir: "NE" }, { type: "step", dir: "NW" }, { type: "step", dir: "E", }, { type: "step", dir: "W" }], capture: "both", onMove: { promoteTo: ["queen"], ifInRegion: "promotion-white" } },
            { pieceType: "pawn_b", moves: [{ type: "step", dir: "SE" }, { type: "step", dir: "SW" }, { type: "step", dir: "E" }, { type: "step", dir: "W" }], capture: "both", onMove: { promoteTo: ["queen"], ifInRegion: "promotion-black" } },
            { pieceType: "rook", moves: [{ type: "slide", dir: "E" }, { type: "slide", dir: "W" }, { type: "slide", dir: "NE" }, { type: "slide", dir: "NW" }, { type: "slide", dir: "SE" }, { type: "slide", dir: "SW" }], capture: "both" },
            { pieceType: "bishop", moves: [{ type: "slide", dir: "NE" }, { type: "slide", dir: "NW" }, { type: "slide", dir: "SE" }, { type: "slide", dir: "SW" }], capture: "both" },
            { pieceType: "queen", moves: [{ type: "slide", dir: "E" }, { type: "slide", dir: "W" }, { type: "slide", dir: "NE" }, { type: "slide", dir: "NW" }, { type: "slide", dir: "SE" }, { type: "slide", dir: "SW" }], capture: "both" },
            { pieceType: "king", moves: [{ type: "step", dir: "E" }, { type: "step", dir: "W" }, { type: "step", dir: "NE" }, { type: "step", dir: "NW" }, { type: "step", dir: "SE" }, { type: "step", dir: "SW" }], capture: "both" },
            { pieceType: "knight", moves: [{ type: "leapRef", ref: "knight" }], capture: "both" },
          ],
          turns: { type: "alternating", order: ["white", "black"], first: "white" },
          outcomes: [
            { kind: "kingCaptured", player: "white" },
            { kind: "kingCaptured", player: "black" },
          ],
          end: { condition: "anyOutcome", action: "stop" },
          regions
        }
      };
    }
    case "painter": {
      const w = 12, h = 12;
      return {
        width: w, height: h, regions: [],
        occupants: [],
        ruleSet: {
          id: "painter",
          setup: { width: w, height: h, description: "Toggle paint, span 1, uses tiling style 3color" },
          moves: [{ pieceType: "*", moves: [{ type: "place", anywhere: true }], capture: "move" }],
          turns: { type: "free", order: [], first: "painter" } as any,
          outcomes: [],
          end: { condition: "manual", action: "none" },
          regions: []
        }
      };
    }
    case "sequencer": {
      const w = 16, h = 4;
      const occs: Occupant[] = [
        { id: makeId(), anchor: { q: 2, r: 0 }, span: [{ q: 1, r: 0 }, { q: 2, r: 0 }], type: "note", data: { player: "composer", vel: 0.8 }, tags: [], guest: { kind: "Path", state: { points: [{ x: 0, y: 10 }, { x: 20, y: 0 }, { x: 40, y: 10 }] } } },
        { id: makeId(), anchor: { q: 6, r: 1 }, span: [{ q: 1, r: 0 }], type: "note", data: { player: "composer" }, tags: [], guest: { kind: "Path", state: { points: [{ x: 0, y: 5 }, { x: 30, y: 15 }] } } },
        { id: makeId(), anchor: { q: 10, r: 2 }, span: [{ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }], type: "clip", data: { player: "composer" }, tags: [], guest: { kind: "Grid", state: { occupants: [], width: 3, height: 1 } } },
      ];
      return {
        width: w, height: h,
        regions: makeTrackRegions(w, h),
        occupants: occs,
        ruleSet: {
          id: "sequencer",
          setup: { width: w, height: h, description: "Grid=timeline steps×tracks, occupant span=duration, guest=Path automation" },
          moves: [
            { pieceType: "note", moves: [{ type: "slide", dir: "E", min: 1, max: 1 }, { type: "slide", dir: "W", min: 1, max: 1 }], capture: "move" },
            { pieceType: "clip", moves: [{ type: "slide", dir: "E" }, { type: "slide", dir: "W" }], capture: "move" },
            { pieceType: "*", moves: [{ type: "place", anywhere: true }], capture: "move" }
          ],
          turns: { type: "free", order: [], first: "composer" } as any,
          outcomes: [],
          end: { condition: "none", action: "none" },
          regions: makeTrackRegions(w, h)
        }
      };
    }
    case "tetris": {
      const w = 10, h = 16;
      const shapes: Record<string, Pos[]> = {
        O: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }, { q: 1, r: 1 }],
        I: [{ q: -1, r: 0 }, { q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }],
        T: [{ q: -1, r: 0 }, { q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }],
        L: [{ q: -1, r: 0 }, { q: 0, r: 0 }, { q: 1, r: 0 }, { q: 1, r: 1 }],
      };
      const occs: Occupant[] = [
        { id: makeId(), anchor: { q: 4, r: 2 }, span: shapes.T.slice(1), type: "tetromino", data: { player: "player", shape: "T" }, tags: ["falling"] },
        { id: makeId(), anchor: { q: 2, r: 12 }, span: shapes.O.slice(1), type: "locked", data: { player: "board" }, tags: [] },
        { id: makeId(), anchor: { q: 6, r: 13 }, span: shapes.I.slice(1), type: "locked", data: { player: "board" }, tags: [] },
      ];
      return {
        width: w, height: h, regions: edge(w, h),
        occupants: occs,
        ruleSet: {
          id: "tetris",
          setup: { width: w, height: h, description: "Multi-cell tetrominoes span, rotation via tiling.rotateSpan, gravity turn effect" },
          moves: [
            { pieceType: "tetromino", moves: [{ type: "step", dir: "E" }, { type: "step", dir: "W" }, { type: "step", dir: "S" }], capture: "move" }
          ],
          turns: { type: "alternating", order: ["player", "gravity"], first: "player" },
          outcomes: [{ kind: "topReached", row: 0 }],
          end: { condition: "anyOutcome", action: "stop" },
          regions: edge(w, h),
          gravity: { direction: "S", after: "move" }
        }
      };
    }
    case "timeline": {
      const w = 20, h = 4;
      const occs: Occupant[] = [
        { id: makeId(), anchor: { q: 1, r: 0 }, span: [{ q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 }], type: "clip", data: { player: "editor", label: "A-cam" }, tags: [], guest: { kind: "Path", state: { points: [{ x: 0, y: 10 }, { x: 30, y: 0 }] } }, z: 1 },
        { id: makeId(), anchor: { q: 6, r: 0 }, span: [{ q: 1, r: 0 }, { q: 2, r: 0 }], type: "clip", data: { player: "editor", label: "B-cam" }, tags: [], guest: { kind: "Path", state: { points: [{ x: 0, y: 5 }, { x: 20, y: 15 }] } }, z: 2 },
        { id: makeId(), anchor: { q: 4, r: 0 }, span: [{ q: 1, r: 0 }], type: "transition", data: { player: "editor", label: "x-fade" }, tags: ["overlap"], z: 3 },
      ];
      return {
        width: w, height: h, regions: makeTrackRegions(w, h),
        occupants: occs,
        ruleSet: {
          id: "timeline",
          setup: { width: w, height: h, description: "NLE: Grid time×tracks, clips span=duration, guest=Path, stacking/overlap for transitions" },
          moves: [
            { pieceType: "clip", moves: [{ type: "slide", dir: "E" }, { type: "slide", dir: "W" }], capture: "move" },
            { pieceType: "transition", moves: [{ type: "slide", dir: "E" }, { type: "slide", dir: "W" }], capture: "move" },
            { pieceType: "*", moves: [{ type: "place" }], capture: "move" }
          ],
          turns: { type: "free", order: [], first: "editor" } as any,
          outcomes: [],
          end: { condition: "none", action: "none" },
          regions: makeTrackRegions(w, h)
        }
      };
    }
    case "crossword": {
      const w = 8, h = 8;
      const blocked: Pos[] = [{ q: 2, r: 2 }, { q: 5, r: 2 }, { q: 2, r: 5 }, { q: 5, r: 5 }];
      const occs: Occupant[] = blocked.map(p => ({ id: makeId(), anchor: p, span: [], type: "block", data: { player: "board", symbol: "█" }, tags: [] }));
      occs.push({ id: makeId(), anchor: { q: 0, r: 0 }, span: [], type: "letter", data: { player: "solver", symbol: "C" }, tags: [] });
      occs.push({ id: makeId(), anchor: { q: 1, r: 0 }, span: [], type: "letter", data: { player: "solver", symbol: "A" }, tags: [] });
      occs.push({ id: makeId(), anchor: { q: 3, r: 0 }, span: [], type: "letter", data: { player: "solver", symbol: "T" }, tags: [] });
      // regions = words (horizontal sequences without block)
      const regions: Region[] = [];
      // simple: rows split by blocks
      for (let r = 0; r < h; r++) {
        let start = 0;
        for (let q = 0; q <= w; q++) {
          const isBlock = q === w || blocked.some(b => b.q === q && b.r === r);
          if (isBlock) {
            if (q - start >= 2) regions.push({ id: `word-h-${r}-${start}`, cells: Array.from({ length: q - start }, (_, i) => ({ q: start + i, r })), type: "word" });
            start = q + 1;
          }
        }
      }
      for (let q = 0; q < w; q++) {
        let start = 0;
        for (let r = 0; r <= h; r++) {
          const isBlock = r === h || blocked.some(b => b.q === q && b.r === r);
          if (isBlock) {
            if (r - start >= 2) regions.push({ id: `word-v-${q}-${start}`, cells: Array.from({ length: r - start }, (_, i) => ({ q, r: start + i })), type: "word" });
            start = r + 1;
          }
        }
      }
      return {
        width: w, height: h, regions,
        occupants: occs,
        ruleSet: {
          id: "crossword",
          setup: { width: w, height: h, description: "Blocked cells as occupants type block, letters as occupants, regions=words" },
          moves: [{ pieceType: "letter", moves: [{ type: "place" }], capture: "move" }],
          turns: { type: "free", order: [], first: "solver" } as any,
          outcomes: [],
          end: { condition: "none", action: "none" },
          regions
        }
      };
    }
    case "connectFour": {
      const w = 7, h = 6;
      return {
        width: w, height: h, regions: [],
        occupants: [],
        ruleSet: {
          id: "connectFour",
          setup: { width: w, height: h, description: "Gravity S, line 4 wins — uses executable line outcome" },
          moves: [{ pieceType: "*", moves: [{ type: "place", anywhere: true }], capture: "move" }],
          turns: { type: "alternating", order: ["R", "Y"], first: "R" },
          outcomes: [
            { kind: "line", player: "any", count: 4, directions: "any", regions: "all" },
            { kind: "boardFull", draw: true }
          ],
          end: { condition: "anyOutcome", action: "stop" },
          regions: [],
          gravity: { direction: "S", after: "always" }
        }
      };
    }
    case "go": {
      const w = 9, h = 9;
      const occs: Occupant[] = [
        mkOcc(2, 2, "stone", "black", "●"),
        mkOcc(3, 2, "stone", "white", "○"),
        mkOcc(2, 3, "stone", "white", "○"),
      ];
      return {
        width: w, height: h, regions: [],
        occupants: occs,
        ruleSet: {
          id: "go",
          setup: { width: w, height: h, description: "Placement only, capture via surrounding liberties (group capture)" },
          moves: [{ pieceType: "*", moves: [{ type: "place" }], capture: "move", onPlace: { captureSurrounded: true } }],
          turns: { type: "alternating", order: ["black", "white"], first: "black" },
          outcomes: [{ kind: "captureAll", player: "white" }, { kind: "captureAll", player: "black" }],
          end: { condition: "anyOutcome", action: "stop" },
          regions: []
        }
      };
    }
    case "breakout": {
      const w = 10, h = 12;
      const occs: Occupant[] = [];
      for (let r = 0; r < 3; r++) for (let q = 0; q < w; q++) occs.push(mkOcc(q, r, "brick", "board", "■"));
      occs.push(mkOcc(5, 10, "paddle", "player", "═", [{ q: 1, r: 0 }, { q: -1, r: 0 }]));
      occs.push(mkOcc(5, 8, "ball", "player", "●"));
      return {
        width: w, height: h, regions: edge(w, h),
        occupants: occs,
        ruleSet: {
          id: "breakout",
          setup: { width: w, height: h, description: "Bricks as occupants, ball slide diagonal, paddle span 3, captureAll bricks win" },
          moves: [
            { pieceType: "ball", moves: [{ type: "slide", dir: "NE", min: 1, max: 1 }, { type: "slide", dir: "NW", min: 1, max: 1 }, { type: "slide", dir: "SE", min: 1, max: 1 }, { type: "slide", dir: "SW", min: 1, max: 1 }], capture: "both" },
            { pieceType: "paddle", moves: [{ type: "slide", dir: "E" }, { type: "slide", dir: "W" }], capture: "move" },
          ],
          turns: { type: "alternating", order: ["player", "ball"], first: "player" },
          outcomes: [{ kind: "captureAll", player: "board" }],
          end: { condition: "anyOutcome", action: "stop" },
          regions: edge(w, h)
        }
      };
    }
    case "drumPad": {
      const w = 4, h = 4;
      const occs: Occupant[] = [];
      const notes = ["C1", "D1", "E1", "F1", "G1", "A1", "B1", "C2", "D2", "E2", "F2", "G2", "A2", "B2", "C3", "D3"];
      for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
        const idx = r * w + q;
        occs.push({
          id: makeId(), anchor: { q, r }, span: [], type: "pad",
          data: { player: "drummer", label: notes[idx] },
          tags: [],
          guest: { kind: "Logic", state: { triples: [{ id: makeId(), s: "pad", p: "triggers", o: notes[idx] }] } }
        });
      }
      return {
        width: w, height: h, regions: [],
        occupants: occs,
        ruleSet: {
          id: "drumPad",
          setup: { width: w, height: h, description: "Single cell pads, guest=Logic triple for MIDI mapping" },
          moves: [{ pieceType: "pad", moves: [{ type: "step", dir: "N" }, { type: "step", dir: "S" }], capture: "move" }],
          turns: { type: "free", order: [], first: "drummer" } as any,
          outcomes: [],
          end: { condition: "none", action: "none" },
          regions: []
        }
      };
    }
    case "sudoku": {
      const w = 9, h = 9;
      const regions = makeSudokuRegions();
      const occs: Occupant[] = [
        mkOcc(0, 0, "num", "given", "5"), mkOcc(1, 0, "num", "given", "3"), mkOcc(4, 0, "num", "given", "7"),
        mkOcc(0, 1, "num", "given", "6"), mkOcc(3, 1, "num", "given", "1"), mkOcc(4, 1, "num", "given", "9"), mkOcc(5, 1, "num", "given", "5"),
        mkOcc(1, 2, "num", "given", "9"), mkOcc(2, 2, "num", "given", "8"),
      ].map(o => ({ ...o, data: { ...o.data, value: o.data.symbol } }));
      return {
        width: w, height: h, regions,
        occupants: occs,
        ruleSet: {
          id: "sudoku",
          setup: { width: w, height: h, description: "Regions for validation, occupants with numbers, fillRegions outcome" },
          moves: [{ pieceType: "*", moves: [{ type: "place" }], capture: "move" }],
          turns: { type: "free", order: [], first: "solver" } as any,
          outcomes: [{ kind: "fillRegions", constraint: "sudokuValid" }],
          end: { condition: "anyOutcome", action: "stop" },
          regions
        }
      };
    }
    default: {
      const w = 6, h = 6;
      return {
        width: w, height: h, regions: edge(w, h),
        occupants: [],
        ruleSet: {
          id: "custom",
          setup: { width: w, height: h, description: "Custom" },
          moves: [{ pieceType: "*", moves: [{ type: "step", dir: "N" }], capture: "move" }],
          turns: { type: "alternating", order: ["white", "black"], first: "white" },
          outcomes: [],
          end: { condition: "none", action: "none" },
          regions: edge(w, h)
        }
      };
    }
  }
}
