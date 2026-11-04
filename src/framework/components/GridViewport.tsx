import React, { useEffect, useMemo } from "react";
import type { Axial, LogicTriple, MoveRule, Occupant, Pos, Region, RuleSet, TilingDef, TilingDir, Toggles } from "../types";
import { addPosByDir, applyOffset, rotateSpan } from "../tilings";
import { buildOccupancyMap, getOccupiedCells, isCellOccupied, isPosInRegion, occupantAtCell, pieceMatchesRule } from "../occupancy";
import { makeId } from "../tilings";
import { applySurroundCapture, endAction, evaluateOutcomes, getValidMoves, isAutoEnd, ruleHasSurroundCapture } from "../engine";
import { colName, resolveBinding, type CellPresentation, type GridHeaders } from "../presentations";

export type KeySlot = { q: number; key: Occupant | null; covered: boolean };

/**
 * Slot-accurate row layout shared by every Grid renderer: every column
 * 0..width-1 appears, so empty positions between wide keys hold their place
 * instead of collapsing. Covered span cells are marked, not duplicated.
 */
export function slotsForRow(occupants: Occupant[], width: number, r: number): KeySlot[] {
  const byCell = new Map<string, Occupant>();
  for (const o of occupants) for (const c of getOccupiedCells(o)) byCell.set(`${c.q},${c.r}`, o);
  return Array.from({ length: width }, (_, q) => {
    const occ = byCell.get(`${q},${r}`) ?? null;
    if (!occ) return { q, key: null, covered: false };
    const isAnchor = occ.anchor.q === q && occ.anchor.r === r;
    return { q, key: occ, covered: !isAnchor };
  });
}

/** Row offset in px, read from the plan (`interpretation.keyboard.stagger`). */
export function staggerForRow(r: number, stagger: number[] | undefined): number {
  if (!Array.isArray(stagger) || stagger.length === 0) return 0;
  return stagger[Math.min(r, stagger.length - 1)] ?? 0;
}

/** Merged box for a multi-cell occupant at a square cell size. Null when single-cell. */
export function mergedBox(
  occ: Occupant,
  cellSize: number
): { w: number; h: number; minQ: number; minR: number } | null {
  if (occ.span.length === 0) return null;
  const cells = getOccupiedCells(occ);
  const qs = cells.map(c => c.q);
  const rs = cells.map(c => c.r);
  return {
    w: (Math.max(...qs) - Math.min(...qs) + 1) * cellSize - 2,
    h: (Math.max(...rs) - Math.min(...rs) + 1) * cellSize - 2,
    minQ: Math.min(...qs),
    minR: Math.min(...rs),
  };
}

export type GridViewportProps = {
  occupants: Occupant[];
  setOccupants: React.Dispatch<React.SetStateAction<Occupant[]>>;
  /** Merge multi-cell occupants into one box (wide keys); covered cells skip. */
  mergeSpans?: boolean;
  /** Per-row px offsets; extras reuse the last entry. */
  stagger?: number[];
  /** Hide the game toolbar and status footer (keyboard-style guests). */
  chrome?: boolean;
  /** Tap overrides: when set, bypass game logic for that cell. */
  onOccupantTap?: (occ: Occupant) => void;
  onEmptyTap?: (pos: Pos) => void;
  /** Plan-configured cell presentation (editable sheet, event cards, ...). */
  presentation?: CellPresentation;
  headers?: GridHeaders;
  /** Derived display state (e.g. recomputed formulas); falls back to occupants. */
  derivedOccupants?: Occupant[];
  derivedErrorIds?: string[];
  derivedErrors?: string[];
  /** Text commit from a presentation cell; shell maps it to occupant edits. */
  onCellCommit?: (q: number, r: number, text: string) => void;
  /** Help line under a presentation table. */
  presentationHint?: string;
  tiling: TilingDef;
  ruleSet: RuleSet;
  width: number;
  height: number;
  toggles: Toggles;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  validMoves: (Pos & { capture?: string; via?: string })[];
  setValidMoves: (m: (Pos & { capture?: string; via?: string })[]) => void;
  currentTurn: string;
  setCurrentTurn: (t: string) => void;
  outcome: string | null;
  setOutcome: (o: string | null) => void;
  chainCaptureActive: boolean;
  setChainCaptureActive: (b: boolean) => void;
  logicTriples: LogicTriple[];
  showRegions: boolean;
  setShowRegions: (b: boolean) => void;
  showSpan: boolean;
  knightDemo: boolean;
  setKnightDemo: (b: boolean) => void;
};

// ---------- Components ----------
export function DirectionCompass({ tiling }: { tiling: TilingDef }) {
  return (
    <div className="flex flex-wrap gap-1">
      {tiling.directions.map(d => (
        <div key={d.name} className="px-2 py-1 rounded-full bg-[var(--bg-3)] border border-[var(--border)] text-[9px] flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-[var(--accent)]" style={{ transform: `rotate(${d.angle}deg)` }} />
          {d.name}
          <span className="text-[7px] text-[var(--text-faint)]">{d.dq},{d.dr}</span>
        </div>
      ))}
      <div className="px-2 py-1 rounded-full bg-[var(--lime-bg)] border border-[var(--accent)] text-[9px] text-[var(--accent)]">
        {tiling.id} • {tiling.shape} • {tiling.style}
      </div>
    </div>
  );
}

export function GridViewport({
  occupants, setOccupants, tiling, ruleSet, width, height, toggles, selectedId, setSelectedId, validMoves, setValidMoves,
  currentTurn, setCurrentTurn, outcome, setOutcome, chainCaptureActive, setChainCaptureActive, logicTriples, showRegions, setShowRegions, showSpan, knightDemo, setKnightDemo,
  mergeSpans, stagger, chrome = true, onOccupantTap, onEmptyTap,
  presentation, headers, derivedOccupants, derivedErrorIds, derivedErrors, onCellCommit, presentationHint
}: GridViewportProps) {
  const cellSize = tiling.shape === "square" ? 44 : 40;

  const mapOccupant = useMemo(() => {
    const m = new Map<string, Occupant>();
    occupants.forEach((o: Occupant) => {
      getOccupiedCells(o).forEach(c => m.set(`${c.q},${c.r}`, o));
    });
    return m;
  }, [occupants]);

  // compute valid moves when selection changes
  useEffect(() => {
    if (!selectedId) { setValidMoves([]); return; }
    const occ = occupants.find((o: Occupant) => o.id === selectedId);
    if (!occ) { setValidMoves([]); return; }
    const moves = getValidMoves(occ, occupants, tiling, ruleSet, width, height, toggles, logicTriples);
    setValidMoves(moves);
  }, [selectedId, occupants, tiling, ruleSet, width, height, toggles, logicTriples]);

  // check outcome generic; end.condition manual/none never auto-stops (plan data).
  const checkOutcome = (occs: Occupant[], turn: string) => {
    const fn = (o: Occupant, all: Occupant[]) => getValidMoves(o, all, tiling, ruleSet, width, height, toggles, logicTriples);
    const out = evaluateOutcomes(occs, tiling, ruleSet, turn, width, height, fn);
    if (!out) return null;
    if (!isAutoEnd(ruleSet) || endAction(ruleSet) === "none") return null;
    return out;
  };

  const applyGravity = (occs: Occupant[]): Occupant[] => {
    if (!toggles.gravity && !ruleSet.gravity) return occs;
    const dirName = ruleSet.gravity?.direction || "S";
    const dir = tiling.directionMap[dirName];
    if (!dir) return occs;
    // sort by opposite of gravity to avoid collisions
    const sorted = [...occs].sort((a, b) => {
      if (dirName === "S") return b.anchor.r - a.anchor.r;
      if (dirName === "N") return a.anchor.r - b.anchor.r;
      if (dirName === "E") return b.anchor.q - a.anchor.q;
      return a.anchor.q - b.anchor.q;
    });
    const occupiedSet = new Set<string>();
    sorted.forEach(o => getOccupiedCells(o).forEach(c => occupiedSet.add(`${c.q},${c.r}`)));
    const result: Occupant[] = [];
    for (const o of sorted) {
      // remove self from set
      getOccupiedCells(o).forEach(c => occupiedSet.delete(`${c.q},${c.r}`));
      let cur = o.anchor;
      while (true) {
        const nxt = addPosByDir(cur, dirName, 1, tiling, width, height, false);
        if (!nxt) break;
        const cells = [nxt, ...o.span.map(s => ({ q: nxt.q + s.q, r: nxt.r + s.r }))];
        const collides = cells.some(c => c.q < 0 || c.q >= width || c.r < 0 || c.r >= height || occupiedSet.has(`${c.q},${c.r}`));
        if (collides) break;
        cur = nxt;
      }
      const newOcc = { ...o, anchor: cur };
      getOccupiedCells(newOcc).forEach(c => occupiedSet.add(`${c.q},${c.r}`));
      result.push(newOcc);
    }
    return result;
  };

  // Rotate the selected multi-cell occupant via the tiling's own rotation steps
  // (90 deg on squares, 60 deg on hexes). Rejected on collision or out of bounds.
  const rotateSelected = () => {
    if (outcome || !selectedId) return;
    const sel = occupants.find((o: Occupant) => o.id === selectedId);
    if (!sel || sel.span.length === 0) return;
    const steps = 1;
    const rotated = rotateSpan(sel.span, steps, tiling);
    const occMap = buildOccupancyMap(occupants.filter((o: Occupant) => o.id !== sel.id));
    const cells = [sel.anchor, ...rotated.map(s => ({ q: sel.anchor.q + s.q, r: sel.anchor.r + s.r }))];
    const blocked = cells.some(c => c.q < 0 || c.q >= width || c.r < 0 || c.r >= height || occMap.has(`${c.q},${c.r}`));
    if (blocked) return;
    setOccupants(occupants.map((o: Occupant) => o.id === sel.id ? { ...o, span: rotated } : o));
  };

  const handleCellClick = (q: number, r: number) => {
    if (outcome) return;
    const clickedOcc = mapOccupant.get(`${q},${r}`) || null;
    // Explicit tap overrides bypass game logic (keyboard presses and layout
    // edits). Covered span cells map to their anchor occupant, so tapping
    // anywhere on a wide key presses the whole key.
    if (clickedOcc && onOccupantTap) {
      onOccupantTap(clickedOcc);
      return;
    }
    if (!clickedOcc && onEmptyTap) {
      onEmptyTap({ q, r });
      return;
    }
    const isValidTarget = validMoves.some((m: any) => m.q === q && m.r === r);

    // painter mode or free placement
    const isPlaceRule = ruleSet.moves.some((mr: MoveRule) => mr.moves.some(mk => mk.type === "place"));
    const isFreePlace = ruleSet.turns.type === "free" && isPlaceRule;

    if (isFreePlace && !selectedId) {
      if (clickedOcc) {
        setOccupants((prev: Occupant[]) => prev.filter(o => o.id !== clickedOcc.id));
      } else {
        // check if ConnectFour gravity: find lowest empty
        let target: Pos = { q, r };
        if (ruleSet.gravity?.direction === "S" || toggles.gravity) {
          // find lowest empty in column
          for (let rr = height - 1; rr >= 0; rr--) {
            const test = { q, r: rr };
            if (!mapOccupant.has(`${q},${rr}`)) { target = test; break; }
          }
        }
        const player = currentTurn;
        const sym = player === "R" ? "🔴" : player === "Y" ? "🟡" : player === "X" ? "X" : player === "O" ? "O" : "●";
        const newOcc: Occupant = { id: makeId(), anchor: target, span: [], type: player === "R" || player === "Y" ? "disc" : "mark", data: { player, symbol: sym, hasMoved: true }, tags: [] };
        let newOccs = [...occupants, newOcc];
        if (toggles.gravity || ruleSet.gravity) newOccs = applyGravity(newOccs);
        if (ruleHasSurroundCapture(ruleSet)) newOccs = applySurroundCapture(newOccs, player, tiling, width, height);
        setOccupants(newOccs);
        const out = checkOutcome(newOccs, player);
        if (out) setOutcome(out);
        else if (ruleSet.turns.type === "alternating") {
          const order = (ruleSet.turns as any).order;
          const idx = order.indexOf(player);
          const next = order[(idx + 1) % order.length];
          setCurrentTurn(next);
        }
      }
      return;
    }

    if (isValidTarget && selectedId) {
      const sel = occupants.find((o: Occupant) => o.id === selectedId);
      if (!sel) return;
      // Turn ownership under both alternating and samePlayerIfCapture: a side
      // may only move its own pieces. Either side moving any piece was the bug.
      if (ruleSet.turns.type === "alternating" || ruleSet.turns.type === "samePlayerIfCapture") {
        const order = (ruleSet.turns as any).order;
        if (sel.data?.player && order.includes(sel.data.player) && sel.data.player !== currentTurn) return;
      }

      let newOccs = [...occupants];
      const capMove = validMoves.find((m: any) => m.q === q && m.r === r) as any;
      if (capMove?.capture) newOccs = newOccs.filter(o => o.id !== capMove.capture);
      else if (clickedOcc && clickedOcc.data?.player !== sel.data?.player) newOccs = newOccs.filter(o => o.id !== clickedOcc.id);

      newOccs = newOccs.map(o => o.id === sel.id ? { ...o, anchor: { q, r }, data: { ...o.data, hasMoved: true } } : o);

      // promotion via region
      const matchingRule = ruleSet.moves.find((mr: MoveRule) => pieceMatchesRule(mr.pieceType, sel));
      if (matchingRule?.onMove?.ifInRegion) {
        const region = ruleSet.regions.find((rg: Region) => rg.id === matchingRule.onMove!.ifInRegion);
        if (region && isPosInRegion({ q, r }, region)) {
          const promoteTo = matchingRule.onMove!.promoteTo?.[0];
          if (promoteTo) newOccs = newOccs.map(o => o.id === sel.id ? { ...o, type: promoteTo, data: { ...o.data, symbol: promoteTo === "queen" ? "♕" : promoteTo === "king_w" ? "♔" : "♚" } } : o);
        }
      }

      if (toggles.gravity || ruleSet.gravity) newOccs = applyGravity(newOccs);

      // chain capture
      const movedSel = newOccs.find((o: Occupant) => o.id === sel.id);
      if (movedSel && capMove?.capture && (toggles.chainCapture || ruleSet.moves.some((m: MoveRule) => m.onCapture?.chain))) {
        const further = getValidMoves(movedSel, newOccs, tiling, ruleSet, width, height, toggles, logicTriples).filter((m: any) => m.capture);
        if (further.length > 0) {
          setOccupants(newOccs);
          setSelectedId(sel.id);
          setValidMoves(further);
          setChainCaptureActive(true);
          const out = checkOutcome(newOccs, currentTurn);
          if (out) setOutcome(out);
          return;
        }
      }

      setOccupants(newOccs);
      setChainCaptureActive(false);
      const out = checkOutcome(newOccs, currentTurn);
      if (out) setOutcome(out);
      else {
        if (ruleSet.turns.type === "alternating") {
          const order = (ruleSet.turns as any).order;
          const idx = order.indexOf(currentTurn);
          const next = order[(idx + 1) % order.length] || currentTurn;
          // samePlayerIfCapture handled above
          setCurrentTurn(next);
        } else if (ruleSet.turns.type === "samePlayerIfCapture") {
          if (!capMove?.capture) {
            const order = (ruleSet.turns as any).order;
            const idx = order.indexOf(currentTurn);
            setCurrentTurn(order[(idx + 1) % order.length]);
          }
        }
        setSelectedId(null);
        setValidMoves([]);
      }
    } else if (clickedOcc) {
      // Ownership gate for both turn disciplines; during an active chain only
      // the chaining piece may be touched.
      if ((ruleSet.turns.type === "alternating" || ruleSet.turns.type === "samePlayerIfCapture") && clickedOcc.data?.player && clickedOcc.data?.player !== currentTurn) {
        if (chainCaptureActive) return;
        // Pure placement games have no selectable pieces: ignore occupant taps.
        if (isPlaceRule && !selectedId) return;
        return;
      }
      if (isPlaceRule && !selectedId) return;
      setSelectedId(clickedOcc.id);
    } else {
      // empty cell, maybe place for place rules
      if (isPlaceRule && !selectedId) {
        let target: Pos = { q, r };
        if (ruleSet.gravity?.direction === "S" || toggles.gravity) {
          for (let rr = height - 1; rr >= 0; rr--) if (!mapOccupant.has(`${q},${rr}`)) { target = { q, r: rr }; break; }
        }
        const player = currentTurn;
        const sym = player === "R" ? "🔴" : player === "Y" ? "🟡" : player === "X" ? "X" : player === "O" ? "O" : "●";
        const newOcc: Occupant = { id: makeId(), anchor: target, span: [], type: player === "R" || player === "Y" ? "disc" : "mark", data: { player, symbol: sym, hasMoved: true }, tags: [] };
        let newOccs = [...occupants, newOcc];
        if (toggles.gravity || ruleSet.gravity) newOccs = applyGravity(newOccs);
        if (ruleHasSurroundCapture(ruleSet)) newOccs = applySurroundCapture(newOccs, player, tiling, width, height);
        setOccupants(newOccs);
        const out = checkOutcome(newOccs, player);
        if (out) setOutcome(out);
        else if (ruleSet.turns.type === "alternating") {
          const order = (ruleSet.turns as any).order;
          const idx = order.indexOf(player);
          setCurrentTurn(order[(idx + 1) % order.length]);
        }
      } else {
        if (!chainCaptureActive) { setSelectedId(null); setValidMoves([]); }
      }
    }
  };

  // knight demo leaps
  const knightLeaps = useMemo(() => {
    if (!knightDemo || !selectedId) return [];
    const sel = occupants.find((o: Occupant) => o.id === selectedId);
    if (!sel) return [];
    const offs = tiling.leaps.offsets;
    return offs.map((off: { dq: number; dr: number; axial?: Axial }) => applyOffset(sel.anchor, off, tiling, width, height, false)).filter(Boolean) as Pos[];
  }, [knightDemo, selectedId, occupants, tiling, width, height]);

  const getCellStyle = (q: number, r: number) => {
    const isValid = validMoves.some((m: any) => m.q === q && m.r === r);
    const isSelected = occupants.some((o: Occupant) => o.id === selectedId && getOccupiedCells(o).some(c => c.q === q && c.r === r));
    const isKnightLeap = knightLeaps.some((p: Pos) => p.q === q && p.r === r);
    let bg = "var(--bg-3)";
    if (tiling.style === "2color") bg = (q + r) % 2 === 0 ? "#1a1d21" : "#22262e";
    else {
      const mod = (q + r * 2) % 3;
      bg = mod === 0 ? "#1b1e24" : mod === 1 ? "#20242c" : "#252a33";
    }
    if (isValid) bg = "rgba(232,255,82,0.22)";
    if (isSelected) bg = "rgba(232,255,82,0.32)";
    if (isKnightLeap) bg = "rgba(120,180,255,0.22)";
    const border = isValid ? "1px solid var(--accent)" : isKnightLeap ? "1px dashed #78b4ff" : "1px solid var(--border)";
    return { bg, border, isValid, isSelected, isKnightLeap };
  };

  const maxStagger = stagger && stagger.length > 0 ? Math.max(...stagger) : 0;
  const containerWidth = (tiling.shape === "square" ? width * cellSize : width * cellSize * 0.88 + 30) + maxStagger;
  const containerHeight = tiling.shape === "square" ? height * cellSize : height * cellSize * 0.78 + 30;

  const selectedOcc = occupants.find((o: Occupant) => o.id === selectedId);

  // Plan-configured presentation table (editable sheet, event cards): headers
  // plus bound cells instead of the game board. Game rendering below is
  // untouched when no presentation is configured.
  if (presentation) {
    const shown = derivedOccupants ?? occupants;
    const byKey = new Map<string, Occupant>();
    for (const o of shown) byKey.set(`${o.anchor.q},${o.anchor.r}`, o);
    const errIds = new Set(derivedErrorIds ?? []);
    const showCols = (headers?.columns ?? "none") === "letters";
    const showRows = (headers?.rows ?? "none") === "numbers";
    const cellText = (o: Occupant | undefined): { display: string; formula?: string; err: boolean } => {
      if (presentation.kind === "eventCard") {
        return { display: String(resolveBinding(o, presentation.value).value ?? ""), err: !!o && errIds.has(o.id) };
      }
      const formula = presentation.formula
        ? (resolveBinding(o, presentation.formula).value as string | undefined)
        : undefined;
      if (formula) {
        const err = !!o && errIds.has(o.id);
        if (err) return { display: formula, formula, err };
        const computed = resolveBinding(o, presentation.computed).value;
        return { display: String(computed ?? ""), formula, err };
      }
      return {
        display: String(resolveBinding(o, presentation.value).value ?? ""),
        err: !!o && errIds.has(o.id),
      };
    };
    const cols = Array.from({ length: width }, (_, q) => q);
    const rows = Array.from({ length: height }, (_, r) => r);
    return (
      <div>
        <table className="border-collapse">
          {showCols && (
            <thead>
              <tr>
                {showRows && <th className="w-8 px-1 py-1 text-[9px] text-[var(--text-faint)] font-normal" />}
                {cols.map(q => (
                  <th key={q} className="px-1 py-1 text-[9px] text-[var(--text-faint)] font-normal text-center min-w-[72px]">
                    {colName(q)}
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {rows.map(r => (
              <tr key={r}>
                {showRows && <td className="px-1 py-1 text-[9px] text-[var(--text-faint)] text-right">{r + 1}</td>}
                {cols.map(q => {
                  const o = byKey.get(`${q},${r}`);
                  const { display, formula, err } = cellText(o);
                  if (presentation.kind !== "editableText" || !onCellCommit) {
                    return (
                      <td key={q} className="p-0 border border-[var(--border)]">
                        <div
                          title={formula ? `${colName(q)}${r + 1}: ${formula}` : `${colName(q)}${r + 1}`}
                          className={`px-1 py-1 text-[11px] ${presentation.kind === "eventCard" ? "rounded-[6px] bg-[var(--bg-3)]" : ""} ${
                            formula ? "text-[var(--accent)]" : "text-[var(--text)]"
                          } ${err ? "text-[#ff8a6b]" : ""}`}
                        >
                          {display === "" ? <span className="text-[var(--text-faint)]">·</span> : err && formula ? "#ERR" : display}
                        </div>
                      </td>
                    );
                  }
                  return (
                    <td key={q} className="p-0 border border-[var(--border)]">
                      <input
                        key={`${o?.id ?? `empty-${q}-${r}`}:${String(display)}`}
                        defaultValue={formula ?? String(display)}
                        spellCheck={false}
                        onBlur={e => {
                          if (e.target.value !== (formula ?? String(display))) onCellCommit(q, r, e.target.value);
                        }}
                        onKeyDown={e => {
                          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        }}
                        title={formula ? `${colName(q)}${r + 1}: ${formula}` : `${colName(q)}${r + 1}`}
                        className={`w-full px-1 py-1 bg-[var(--bg-3)] text-[11px] outline-none focus:bg-[var(--bg-4)] ${
                          formula ? "text-[var(--accent)]" : "text-[var(--text)]"
                        } ${err ? "text-[#ff8a6b]" : ""}`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {(derivedErrors ?? []).length > 0 && (
          <div className="mt-2 p-2 rounded-[8px] bg-[rgba(90,255,140,0.06)] border border-[var(--border)] text-[9px] text-[var(--text-dim)]">
            <div className="font-bold text-[#ff8a6b]">SHEET ERRORS</div>
            {(derivedErrors ?? []).map((e, i) => (
              <div key={i} className="mt-1">
                • {e}
              </div>
            ))}
          </div>
        )}
        {presentationHint && (
          <div className="mt-1 text-[9px] text-[var(--text-faint)]">{presentationHint}</div>
        )}
      </div>
    );
  }

  return (
    <div className="relative w-full h-full flex flex-col">
      {chrome !== false && <div className="flex flex-wrap gap-2 mb-2">
        <button onClick={() => setShowRegions(!showRegions)} className={`px-2 py-1 rounded-full text-[10px] border ${showRegions ? "bg-[var(--accent)] text-black border-[var(--accent)]" : "bg-[var(--bg-3)] border-[var(--border)]"}`}>REGIONS {showRegions ? "ON" : "OFF"}</button>
        <button onClick={() => setKnightDemo(!knightDemo)} className={`px-2 py-1 rounded-full text-[10px] border ${knightDemo ? "bg-[#78b4ff] text-black border-[#78b4ff]" : "bg-[var(--bg-3)] border-[var(--border)]"}`}>KNIGHT LEAPS {knightDemo ? "ON" : "OFF"} • offset moves, not dir names</button>
        {selectedOcc && selectedOcc.span.length > 0 && <button onClick={rotateSelected} className="px-2 py-1 rounded-full text-[10px] border bg-[var(--bg-3)] border-[var(--border)]">ROTATE ⟳ • tiling steps</button>}
        <span className="text-[10px] text-[var(--text-faint)]">SPAN: {selectedOcc ? `${selectedOcc.span.length + 1} cells • ${selectedOcc.span.length > 0 ? "multi-cell" : "single"}` : "none"} {selectedOcc?.guest ? `• GUEST:${selectedOcc.guest.kind}` : ""}</span>
      </div>}

      <div className="relative mx-auto mt-2" style={{ width: containerWidth, height: containerHeight, minHeight: containerHeight }}>
        {Array.from({ length: height }).map((_, r) =>
          Array.from({ length: width }).map((_, q) => {
            const { bg, border, isValid, isSelected, isKnightLeap } = getCellStyle(q, r);
            // Covered span cells collapse into their anchor's box when the
            // guest renders merged geometry (wide keyboard keys).
            const occHere = mapOccupant.get(`${q},${r}`);
            const anchorHere = occHere && occHere.anchor.q === q && occHere.anchor.r === r;
            if (mergeSpans && occHere && !anchorHere) return null;
            let left = q * cellSize + staggerForRow(r, stagger);
            let top = r * cellSize;
            let spanW = 0;
            let spanH = 0;
            if (mergeSpans && anchorHere) {
              const box = mergedBox(occHere, cellSize);
              if (box) {
                spanW = box.w;
                spanH = box.h;
                left = box.minQ * cellSize + staggerForRow(r, stagger);
                top = box.minR * cellSize;
              }
            }
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
            const isAnchor = occ && occ.anchor.q === q && occ.anchor.r === r;
            const isInSelectedSpan = selectedOcc && getOccupiedCells(selectedOcc).some(c => c.q === q && c.r === r);
            const regionHere = showRegions ? ruleSet.regions.find((rg: Region) => rg.cells.some(c => c.q === q && c.r === r)) : null;
            return (
              <div
                key={`${q}-${r}`}
                onClick={() => handleCellClick(q, r)}
                className="absolute flex items-center justify-center select-none cursor-pointer transition-all"
                style={{
                  left, top,
                  width: spanW > 0 ? spanW : tiling.shape === "square" ? cellSize - 2 : 44,
                  height: spanH > 0 ? spanH : tiling.shape === "square" ? cellSize - 2 : 44,
                  background: bg,
                  border,
                  clipPath,
                  borderRadius: tiling.shape === "square" ? 8 : 0,
                  zIndex: isSelected ? 3 : isValid ? 2 : (occ?.z || 1),
                  boxShadow: isValid ? "0 0 0 1px var(--accent), 0 0 16px rgba(232,255,82,0.3)" : isKnightLeap ? "0 0 0 1px #78b4ff" : undefined,
                  opacity: occ && occ.type === "block" ? 0.9 : 1
                }}
              >
                {regionHere && showRegions && <div className="absolute inset-[2px] rounded-[4px] border border-dashed border-[var(--accent)] pointer-events-none opacity-40" title={regionHere.id} />}
                {isInSelectedSpan && <div className="absolute inset-0 bg-[rgba(232,255,82,0.12)] pointer-events-none" />}
                {isValid && !occ && <div className="w-[8px] h-[8px] rounded-full" style={{ background: "var(--accent)", boxShadow: "0 0 8px var(--accent)" }} />}
                {isKnightLeap && !occ && <div className="w-[6px] h-[6px] rounded-full bg-[#78b4ff]" />}
                {occ && isAnchor && (
                  <div className="flex flex-col items-center justify-center leading-none w-full h-full relative">
                    <span className="text-[14px] font-bold" style={{ color: occ.data?.player === "white" || occ.data?.player === "X" || occ.data?.player === "R" ? "#f5f7fa" : occ.data?.player === "black" || occ.data?.player === "O" || occ.data?.player === "Y" ? "#8a909c" : occ.type === "paint" ? "var(--accent)" : "#e6e8eb" }}>
                      {occ.data?.symbol || occ.data?.label || (occ.type === "king_w" ? "♔" : occ.type === "king_b" ? "♚" : occ.type.startsWith("man") ? (occ.data.player === "white" ? "○" : "●") : occ.type === "note" ? "◼" : occ.type === "clip" ? "▬" : occ.type === "block" ? "█" : occ.type[0].toUpperCase())}
                    </span>
                    {occ.span.length > 0 && <span className="text-[7px] text-[var(--text-faint)]">+{occ.span.length}</span>}
                    {occ.guest && (
                      <div className="absolute bottom-[2px] right-[2px] w-[18px] h-[10px] rounded-[3px] bg-[var(--bg-4)] border border-[var(--border)] flex items-center justify-center">
                        <span className="text-[6px] text-[var(--accent)]">{occ.guest.kind[0]}</span>
                      </div>
                    )}
                  </div>
                )}
                {occ && !isAnchor && <div className="w-full h-full bg-[rgba(232,255,82,0.18)] border border-[var(--accent)]/30 flex items-center justify-center text-[8px] text-[var(--accent)]">◍</div>}
              </div>
            );
          })
        )}
      </div>

      {outcome && <div className="mt-6 mx-auto px-4 py-2 rounded-full bg-[var(--accent)] text-black text-[11px] font-bold tracking-widest uppercase flex items-center gap-2"><span className="w-2 h-2 bg-black rounded-full animate-pulse" /> {outcome}</div>}

      {chrome !== false && <div className="mt-4 flex flex-wrap gap-2 justify-center text-[10px] text-[var(--text-faint)]">
        <span>VALID MOVES DRIVEN BY <b className="text-[var(--text-dim)]">getValidMoves() generic, uses tiling.directionMap + leaps</b></span>
        <span className="opacity-30">•</span>
        <span>TILING: {tiling.id} dirs:{tiling.directions.map((d: TilingDir)=>d.name).join(",")}</span>
        <span className="opacity-30">•</span>
        <span>TURN: {currentTurn.toUpperCase()} • {ruleSet.turns.type}</span>
        {chainCaptureActive && <span className="text-[var(--accent)]">• CHAIN CAPTURE ACTIVE — CONTINUE</span>}
      </div>}

      {selectedOcc?.guest && (
        <div className="mt-3 panel p-2">
          <div className="text-[9px] text-[var(--text-faint)]">GUEST INSIDE {selectedOcc.type} • {selectedOcc.guest.kind}</div>
          <div className="mt-1">
            {selectedOcc.guest.kind === "Path" && (
              <svg viewBox="0 0 100 20" className="w-full h-[30px]"><path d={`M0 10 Q20 0 40 10 T80 10`} fill="none" stroke="var(--accent)" strokeWidth={1.5} /></svg>
            )}
            {selectedOcc.guest.kind === "Grid" && <div className="grid grid-cols-3 gap-[2px]">{Array.from({length:6}).map((_,i)=><div key={i} className="h-3 bg-[var(--bg-4)] rounded-[2px]"></div>)}</div>}
            {selectedOcc.guest.kind === "Logic" && <div className="text-[10px]">{(selectedOcc.guest.state as any).triples?.map((t:LogicTriple)=><span key={t.id} className="px-1 py-0.5 bg-[var(--bg-4)] rounded mr-1">{t.s} {t.p} {t.o}</span>)}</div>}
            {selectedOcc.guest.kind === "Tree" && <div className="text-[10px]">Tree guest root:{(selectedOcc.guest.state as any).rootId}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
