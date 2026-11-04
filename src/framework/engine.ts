import type { Axial, LogicTriple, MoveKind, MoveRule, Occupant, OutcomeCondition, Pos, Region, RuleSet, TilingDef, Toggles } from "./types";
import { addPosByDir, applyOffset, lineCells } from "./tilings";
import { basePieceType, buildOccupancyMap, getOccupiedCells, isCellOccupied, isPosInRegion, occupantAtCell, pieceMatchesRule } from "./occupancy";

/** Shared turn policy for moves and placements. */
export function nextTurn(turns: RuleSet['turns'], current: string, captured: boolean): string {
  if (turns.type === 'free' || (turns.type === 'samePlayerIfCapture' && captured)) return current;
  const index = turns.order.indexOf(current);
  return index < 0 || turns.order.length === 0 ? current : turns.order[(index + 1) % turns.order.length];
}

export function canActOn(turns: RuleSet['turns'], current: string, owner: unknown): boolean {
  return turns.type === 'free' || (typeof owner === 'string' && owner === current && turns.order.includes(owner));
}

// DEBT (README 11.1): outcomes, promotion, gravity and placement are still
// partly special-cased per game; they must become predicates over regions.
// ---------- Move engine (generic, no hard-coded id) ----------
export function getValidMoves(
  occ: Occupant,
  occupants: Occupant[],
  tiling: TilingDef,
  ruleSet: RuleSet,
  width: number,
  height: number,
  toggles: Toggles,
  logicTriples: LogicTriple[] = []
): (Pos & { capture?: string; via?: string })[] {
  const matchingRules = ruleSet.moves.filter(r => pieceMatchesRule(r.pieceType, occ));
  if (matchingRules.length === 0) return [];

  const occMap = buildOccupancyMap(occupants.filter(o => o.id !== occ.id)); // exclude self for collision check but keep self cells? For move we check new cells against others
  const res: (Pos & { capture?: string; via?: string })[] = [];
  const seen = new Set<string>();

  const logicPieceMatches = (s: string) =>
    s === "*" || s === occ.type || (occ.data?.group && s === occ.data.group) || s === basePieceType(occ.type);
  const allowedDirsFromLogic = (() => {
    const triplesForPiece = logicTriples.filter(t => logicPieceMatches(t.s) && t.p === "canMove");
    if (triplesForPiece.length === 0) return null;
    return new Set(triplesForPiece.map(t => t.o));
  })();
  const resolveLeapOffsets = (mk: MoveKind): { dq: number; dr: number; axial?: Axial }[] => {
    if (mk.type === "leap") return mk.offsets;
    if (mk.type === "leapRef") return tiling.leaps.offsets;
    return [];
  };

  const pushIf = (p: Pos, cap?: string, via?: string) => {
    const key = `${p.q},${p.r}`;
    if (seen.has(key)) return;
    seen.add(key);
    res.push({ ...p, capture: cap, via });
  };

  for (const rule of matchingRules) {
    // each moveKind
    for (const mk of rule.moves) {
      if (mk.type === "place") {
        // all empty cells
        for (let r = 0; r < height; r++) for (let q = 0; q < width; q++) {
          const pos = { q, r };
          // check collision with span? For place, anchor must be empty and span empty
          const cellsToOccupy = [pos, ...occ.span.map(s => ({ q: pos.q + s.q, r: pos.r + s.r }))];
          const collides = cellsToOccupy.some(c => {
            if (c.q < 0 || c.q >= width || c.r < 0 || c.r >= height) return true;
            const existing = occMap.get(`${c.q},${c.r}`);
            return !!existing;
          });
          if (!collides) pushIf(pos);
        }
        continue;
      }

      if (mk.type === "step") {
        if (allowedDirsFromLogic && !allowedDirsFromLogic.has(mk.dir)) continue;
        if (!tiling.directionMap[mk.dir]) continue;
        if (rule.requires?.darkOnly && (occ.anchor.q + occ.anchor.r) % 2 === 0) continue;
        const count = mk.count ?? 1;
        const target = addPosByDir(occ.anchor, mk.dir, count, tiling, width, height, toggles.wrapping);
        if (!target) continue;
        if (rule.requires?.darkOnly && (target.q + target.r) % 2 === 0) continue;
        // span collision at target
        const targetCells = [target, ...occ.span.map(s => ({ q: target.q + s.q, r: target.r + s.r }))];
        let blockedByOwn = false;
        let captureId: string | undefined;
        for (const c of targetCells) {
          if (c.q < 0 || c.q >= width || c.r < 0 || c.r >= height) { blockedByOwn = true; break; }
          const at = occMap.get(`${c.q},${c.r}`);
          if (at) {
            if (at.data?.player === occ.data?.player) { blockedByOwn = true; break; }
            else captureId = at.id;
          }
        }
        if (blockedByOwn) continue;
        if (captureId) {
          if (rule.capture === "move") continue;
          pushIf(target, captureId, mk.dir);
        } else {
          if (rule.capture === "captureOnly") continue;
          pushIf(target, undefined, mk.dir);
        }
      } else if (mk.type === "slide") {
        if (allowedDirsFromLogic && !allowedDirsFromLogic.has(mk.dir)) continue;
        if (!tiling.directionMap[mk.dir]) continue;
        const min = mk.min ?? 1;
        const max = mk.max ?? Math.max(width, height);
        const effectiveMax = toggles.sliding ? Math.max(max, Math.max(width, height)) : max;
        for (let s = min; s <= effectiveMax; s++) {
          const target = addPosByDir(occ.anchor, mk.dir, s, tiling, width, height, toggles.wrapping);
          if (!target) break;
          if (rule.requires?.darkOnly && (target.q + target.r) % 2 === 0) continue;
          const targetCells = [target, ...occ.span.map(sp => ({ q: target.q + sp.q, r: target.r + sp.r }))];
          let blocked = false;
          let captureId: string | undefined;
          for (const c of targetCells) {
            if (c.q < 0 || c.q >= width || c.r < 0 || c.r >= height) { blocked = true; break; }
            const at = occMap.get(`${c.q},${c.r}`);
            if (at) {
              if (at.data?.player === occ.data?.player) { blocked = true; break; }
              else captureId = at.id;
            }
          }
          if (blocked) {
            // if capture and both, we already captured? Actually for slide, if own blocks stop
            break;
          }
          if (captureId) {
            if (rule.capture !== "move") pushIf(target, captureId, mk.dir);
            break; // stop after capture
          } else {
            if (rule.capture !== "captureOnly") pushIf(target, undefined, mk.dir);
          }
        }
      } else if (mk.type === "leap" || mk.type === "leapRef") {
        for (const off of resolveLeapOffsets(mk)) {
          const target = applyOffset(occ.anchor, off, tiling, width, height, toggles.wrapping);
          if (!target) continue;
          if (rule.requires?.darkOnly && (target.q + target.r) % 2 === 0) continue;
          const targetCells = [target, ...occ.span.map(sp => ({ q: target.q + sp.q, r: target.r + sp.r }))];
          let blockedByOwn = false;
          let captureId: string | undefined;
          for (const c of targetCells) {
            const at = occMap.get(`${c.q},${c.r}`);
            if (at && at.data?.player === occ.data?.player) { blockedByOwn = true; break; }
            if (at && at.data?.player !== occ.data?.player) captureId = at.id;
          }
          if (blockedByOwn) continue;
          if (captureId) {
            if (rule.capture === "move") continue;
            pushIf(target, captureId, "leap");
          } else {
            if (rule.capture === "captureOnly") continue;
            pushIf(target, undefined, "leap");
          }
        }
      } else if (mk.type === "pawn") {
        const forwards = Array.isArray(mk.forward) ? mk.forward : [mk.forward];
        for (const f of forwards) {
          if (allowedDirsFromLogic && !allowedDirsFromLogic.has(f)) continue;
          if (!tiling.directionMap[f]) continue;
          const one = addPosByDir(occ.anchor, f, 1, tiling, width, height, toggles.wrapping);
          if (!one) continue;
          const oneCells = [one, ...occ.span.map(sp => ({ q: one.q + sp.q, r: one.r + sp.r }))];
          const blocked = oneCells.some(c => occMap.has(`${c.q},${c.r}`));
          if (!blocked && rule.capture !== "captureOnly") pushIf(one, undefined, f);
          if (mk.firstDouble && !occ.data?.hasMoved) {
            const two = addPosByDir(occ.anchor, f, 2, tiling, width, height, toggles.wrapping);
            if (two) {
              const midBlocked = oneCells.some(c => occMap.has(`${c.q},${c.r}`));
              const twoCells = [two, ...occ.span.map(sp => ({ q: two.q + sp.q, r: two.r + sp.r }))];
              const twoBlocked = twoCells.some(c => occMap.has(`${c.q},${c.r}`));
              if (!midBlocked && !twoBlocked && rule.capture !== "captureOnly") pushIf(two, undefined, f);
            }
          }
        }
        for (const capDir of mk.captureDirs) {
          if (allowedDirsFromLogic && !allowedDirsFromLogic.has(capDir)) continue;
          if (!tiling.directionMap[capDir]) continue;
          const target = addPosByDir(occ.anchor, capDir, 1, tiling, width, height, toggles.wrapping);
          if (!target) continue;
          const at = occMap.get(`${target.q},${target.r}`);
          if (at && at.data?.player !== occ.data?.player) {
            if (rule.capture !== "move") pushIf(target, at.id, capDir);
          }
        }
      }
    }
  }
  return res;
}

// ---------- Outcome evaluator (data-driven) ----------
export function evaluateOutcomes(
  occupants: Occupant[],
  tiling: TilingDef,
  ruleSet: RuleSet,
  currentPlayer: string,
  width: number,
  height: number,
  getValidMovesFn: (occ: Occupant, occs: Occupant[]) => (Pos & { capture?: string })[]
): string | null {
  // helper maps
  const occByCell = buildOccupancyMap(occupants);

  for (const cond of ruleSet.outcomes) {
    if (cond.kind === "line") {
      const count = cond.count;
      const dirs = cond.directions === "any" ? tiling.directions.map(d => d.name) : (cond.directions as string[]) || tiling.directions.map(d => d.name);
      // A configured region list restricts where the line may lie: every
      // cell of the winning sequence must fall inside the listed regions.
      // Absent, "all", or empty means the whole board (previous behavior).
      let regionCells: Set<string> | null = null;
      if (Array.isArray(cond.regions) && cond.regions.length > 0) {
        regionCells = new Set();
        for (const rid of cond.regions) {
          const rg = ruleSet.regions.find(r => r.id === rid);
          if (rg) for (const c of rg.cells) regionCells.add(`${c.q},${c.r}`);
        }
      }
      // for each cell that has occupant
      for (const occ of occupants) {
        const player = occ.data?.player || occ.type;
        if (cond.player !== "any" && cond.player !== player && cond.player !== occ.type) continue;
        for (const dir of dirs) {
          if (!tiling.directionMap[dir]) continue;
          const cells = lineCells(occ.anchor, dir, count, tiling, width, height);
          if (cells.length < count) continue;
          if (regionCells && !cells.every(c => regionCells!.has(`${c.q},${c.r}`))) continue;
          // check all cells occupied by same player
          let allSame = true;
          for (const c of cells) {
            const at = occByCell.get(`${c.q},${c.r}`);
            if (!at) { allSame = false; break; }
            const p = at.data?.player || at.type;
            if (p !== player) { allSame = false; break; }
          }
          if (allSame) {
            return `${player.toUpperCase()} wins • line ${count} ${dir} from ${occ.anchor.q},${occ.anchor.r}`;
          }
        }
      }
    } else if (cond.kind === "captureAll") {
      // Generic: winner is the surviving player. "opponent" resolves via turn order.
      const playersInGame = [...new Set(occupants.map(o => o.data?.player).filter(Boolean))] as string[];
      const order = (ruleSet.turns as any).order as string[] | undefined;
      const resolveOpponent = (me: string): string => {
        if (order && order.length > 1) {
          const i = order.indexOf(me);
          if (i >= 0) return order[(i + 1) % order.length];
        }
        const other = playersInGame.find(p => p !== me);
        return other || "opponent";
      };
      if (cond.player === "opponent" || !cond.player || cond.player === "any") {
        if (playersInGame.length === 1 && occupants.length > 0) {
          return `${playersInGame[0].toUpperCase()} wins • capture all`;
        }
      } else {
        const remaining = occupants.filter(o => o.data?.player === cond.player);
        if (remaining.length === 0) {
          const other = occupants[0]?.data?.player || resolveOpponent(cond.player);
          return `${other.toUpperCase()} wins • ${cond.player} no pieces`;
        }
      }
    } else if (cond.kind === "kingCaptured") {
      const isKingType = (t: string) => t === "king" || t.startsWith("king_") || t.includes("king");
      const targetPlayer = cond.player;
      const order = (ruleSet.turns as any).order as string[] | undefined;
      const winnerFor = (loser: string): string => {
        if (order && order.length > 1) {
          const i = order.indexOf(loser);
          if (i >= 0) return order[(i + 1) % order.length];
        }
        const survivor = [...new Set(occupants.map(o => o.data?.player).filter(Boolean))].find(p => p !== loser);
        return (survivor as string) || currentPlayer;
      };
      if (targetPlayer && targetPlayer !== "any") {
        const kingExists = occupants.some(o => isKingType(o.type) && o.data?.player === targetPlayer);
        if (!kingExists) return `${winnerFor(targetPlayer).toUpperCase()} wins • ${targetPlayer} king captured`;
      } else {
        // generic: any player left without a king loses
        const allPlayers = [...new Set(occupants.map(o => o.data?.player).filter(Boolean))] as string[];
        const kingPlayers = new Set(occupants.filter(o => isKingType(o.type)).map(o => o.data?.player));
        const loser = allPlayers.find(p => !kingPlayers.has(p));
        if (loser) return `${winnerFor(loser).toUpperCase()} wins • ${loser} king captured`;
      }
    } else if (cond.kind === "noMoves") {
      const order = (ruleSet.turns as any).order as string[] | undefined;
      const resolveTarget = (t: string): string => {
        if (t !== "opponent") return t;
        if (order && order.length > 1) {
          const i = order.indexOf(currentPlayer);
          if (i >= 0) return order[(i + 1) % order.length];
        }
        return `not-${currentPlayer}`;
      };
      const target = resolveTarget(cond.player);
      const targetOccs = target === "any"
        ? occupants
        : target.startsWith("not-")
          ? occupants.filter(o => o.data?.player !== target.slice(4))
          : occupants.filter(o => o.data?.player === target);
      const hasMove = targetOccs.some(o => getValidMovesFn(o, occupants).length > 0);
      if (!hasMove && targetOccs.length > 0) {
        return `${currentPlayer.toUpperCase()} wins • ${target} no moves`;
      }
    } else if (cond.kind === "reachRow") {
      const region = ruleSet.regions.find(r => r.id === cond.regionId);
      if (!region) continue;
      const found = occupants.find(o => o.data?.player === cond.player && isPosInRegion(o.anchor, region));
      if (found) return `${cond.player.toUpperCase()} wins • reach ${cond.regionId}`;
    } else if (cond.kind === "boardFull") {
      // check if board full (consider span)
      let filled = 0;
      for (let r = 0; r < height; r++) for (let q = 0; q < width; q++) if (occByCell.has(`${q},${r}`)) filled++;
      if (filled >= width * height) return "Draw • board full";
    } else if (cond.kind === "fillRegions") {
      // Generic: every cell filled and every region holds a permutation of its size.
      let filled = 0;
      for (let r = 0; r < height; r++) for (let q = 0; q < width; q++) if (occByCell.has(`${q},${r}`)) filled++;
      if (filled >= width * height) {
        if (cond.constraint === "sudokuValid" || !cond.constraint) {
          let valid = true;
          for (const reg of ruleSet.regions) {
            const nums = reg.cells.map(c => {
              const at = occByCell.get(`${c.q},${c.r}`);
              return at?.data?.value;
            }).filter(v => v !== undefined && v !== null && v !== "");
            const set = new Set(nums);
            if (set.size !== reg.cells.length || nums.length !== reg.cells.length) { valid = false; break; }
          }
          if (valid) return "Sudoku solved • all regions valid";
        } else {
          return "Draw • board full";
        }
      }
    } else if (cond.kind === "topReached") {
      const atTop = occupants.some(o => o.anchor.r <= cond.row);
      if (atTop) return "Game over • top reached";
    } else {
      // Unknown outcome kinds are ignored here so a typo fails loudly in
      // validatePlan() instead of silently never firing.
      continue;
    }
  }
  return null;
}

// ---------- End gating + shared placement capture ----------
// end.condition "manual"/"none" means the engine never auto-stops; outcomes are
// still evaluated for display but never set as terminal. end.action is read so
// the field is live data, not a comment ("stop" ends, "none" observes).
export function isAutoEnd(ruleSet: RuleSet): boolean {
  const c = ruleSet.end?.condition;
  if (c === "manual" || c === "none") return false;
  return true;
}
export function endAction(ruleSet: RuleSet): string {
  return ruleSet.end?.action || "stop";
}
// Generic surround capture (Go rule): after placing, remove opponent groups
// with zero liberties. Enabled by onPlace.captureSurrounded on any place rule,
// not by ruleSet.id.
export function applySurroundCapture(newOccs: Occupant[], player: string, tiling: TilingDef, width: number, height: number): Occupant[] {
  const groups = findGoGroups(newOccs, tiling, width, height);
  const toRemove: Set<string> = new Set();
  groups.forEach(g => {
    if (g.player !== player) {
      const liberties = countLiberties(g.cells, newOccs, tiling, width, height);
      if (liberties === 0) g.occupants.forEach(id => toRemove.add(id));
    }
  });
  return newOccs.filter(o => !toRemove.has(o.id));
}
export function ruleHasSurroundCapture(ruleSet: RuleSet): boolean {
  return ruleSet.moves.some(m => m.moves.some(mk => mk.type === "place") && m.onPlace?.captureSurrounded);
}

// Go helpers
export function findGoGroups(occupants: Occupant[], tiling: TilingDef, width: number, height: number) {
  const visited = new Set<string>();
  const groups: { cells: Pos[]; occupants: string[]; player: string }[] = [];
  const occMap = buildOccupancyMap(occupants);
  for (const occ of occupants) {
    const key = `${occ.anchor.q},${occ.anchor.r}`;
    if (visited.has(key)) continue;
    // BFS for connected same player stones
    const queue: Pos[] = [occ.anchor];
    const cells: Pos[] = [];
    const occIds: string[] = [];
    const player = occ.data?.player;
    const seenLocal = new Set<string>();
    while (queue.length) {
      const cur = queue.pop()!;
      const cKey = `${cur.q},${cur.r}`;
      if (seenLocal.has(cKey)) continue;
      seenLocal.add(cKey);
      visited.add(cKey);
      cells.push(cur);
      const at = occMap.get(cKey);
      if (at) occIds.push(at.id);
      // neighbors
      for (const dir of tiling.directions) {
        const nxt = addPosByDir(cur, dir.name, 1, tiling, width, height, false);
        if (!nxt) continue;
        const nKey = `${nxt.q},${nxt.r}`;
        if (seenLocal.has(nKey)) continue;
        const nOcc = occMap.get(nKey);
        if (nOcc && nOcc.data?.player === player) queue.push(nxt);
      }
    }
    groups.push({ cells, occupants: [...new Set(occIds)], player });
  }
  return groups;
}
export function countLiberties(cells: Pos[], occupants: Occupant[], tiling: TilingDef, width: number, height: number) {
  const occMap = buildOccupancyMap(occupants);
  let libs = 0;
  const seen = new Set<string>();
  for (const c of cells) {
    for (const dir of tiling.directions) {
      const nxt = addPosByDir(c, dir.name, 1, tiling, width, height, false);
      if (!nxt) continue;
      const k = `${nxt.q},${nxt.r}`;
      if (seen.has(k)) continue;
      if (!occMap.has(k)) { libs++; seen.add(k); }
    }
  }
  return libs;
}

// ---------- Promotion (choice, not auto-pick) ----------
// A move whose destination lies in the rule's promotion region offers the
// configured promotion types. One option applies silently; several wait for
// an explicit choice, so a pawn never silently becomes whatever is listed
// first. Symbol mapping preserves the established glyphs.
export function promotionSymbol(type: string): string {
  return type === "queen" ? "♕" : type === "king_w" ? "♔" : "♚";
}

export function promotionOptions(occ: Occupant, ruleSet: RuleSet, pos: Pos): string[] {
  const rule = ruleSet.moves.find(mr => pieceMatchesRule(mr.pieceType, occ));
  const regionId = rule?.onMove?.ifInRegion;
  const promoteTo = rule?.onMove?.promoteTo;
  if (!rule || !regionId || !promoteTo || promoteTo.length === 0) return [];
  const region = ruleSet.regions.find(rg => rg.id === regionId);
  if (!region || !isPosInRegion(pos, region)) return [];
  return [...promoteTo];
}

export function applyPromotion(occupants: Occupant[], id: string, type: string): Occupant[] {
  return occupants.map(o =>
    o.id === id ? { ...o, type, data: { ...o.data, symbol: promotionSymbol(type) } } : o
  );
}
