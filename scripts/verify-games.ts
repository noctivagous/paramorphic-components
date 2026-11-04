// Game acceptance checks: engine behavior plus full play scenarios through
// the same paths as the apps (plan load -> replay -> moves -> outcomes ->
// save round trip). Run with `npm run verify:games`.
// Section 1 covers rule-behavior fixes (line regions, promotion choice).
// Later sections play Tic-Tac-Toe, Checkers, Chess, and the painter.
import { evaluateOutcomes, getValidMoves, applyPromotion, promotionOptions, promotionSymbol } from "../src/framework/engine";
import { getTiling } from "../src/framework/tilings";
import type { Occupant, RuleSet } from "../src/framework/types";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    pass++;
    console.log(`ok - ${name}`);
  } else {
    fail++;
    console.log(`FAIL - ${name}${detail ? `: ${detail}` : ""}`);
  }
}

const tiling = getTiling("square8");

function mark(id: string, q: number, r: number, player: string): Occupant {
  return { id, anchor: { q, r }, span: [], type: "mark", data: { player, symbol: player }, tags: [] };
}

function lineRuleSet(regions?: string[] | "all"): RuleSet {
  return {
    id: "tictactoe",
    setup: { width: 3, height: 3, description: "line fixture" },
    moves: [{ pieceType: "mark", moves: [{ type: "place", anywhere: true }], capture: "move" }],
    turns: { type: "alternating", order: ["X", "O"], first: "X" },
    outcomes: [{ kind: "line", player: "X", count: 3, directions: "any", ...(regions === undefined ? {} : { regions }) }],
    end: { condition: "anyOutcome", action: "stop" },
    regions: [{ id: "top", cells: [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }], type: "row" }],
  };
}

const noMoves = () => ({});
const ev = (occs: Occupant[], rs: RuleSet, player: string) =>
  evaluateOutcomes(occs, tiling, rs, player, 3, 3, (occ, os) =>
    getValidMoves(occ, os, tiling, rs, 3, 3, { gravity: false, diagonal: false, sliding: false, wrapping: false, chainCapture: false }, []));

// 1. line outcomes respect their configured regions.
{
  const row = [mark("a", 0, 0, "X"), mark("b", 1, 0, "X"), mark("c", 2, 0, "X")];
  check("line wins with no regions configured", ev(row, lineRuleSet(), "X") !== null);
  check("line wins with regions: all", ev(row, lineRuleSet("all"), "X") !== null);
  check("line wins inside a listed region", ev(row, lineRuleSet(["top"]), "X") !== null);
  check("line outside listed regions does not win", ev(row, {
    ...lineRuleSet(["nowhere"]),
    regions: [{ id: "nowhere", cells: [{ q: 0, r: 2 }, { q: 1, r: 2 }, { q: 2, r: 2 }], type: "row" }],
  }, "X") === null);
  const col = [mark("a", 0, 0, "X"), mark("b", 0, 1, "X"), mark("c", 0, 2, "X")];
  check("line crossing out of the region does not win", ev(col, lineRuleSet(["top"]), "X") === null);
  void noMoves;
}

// 2. promotion is a choice: options listed, never auto-picked.
{
  const rules: RuleSet = {
    id: "pawn",
    setup: { width: 8, height: 8, description: "promotion fixture" },
    moves: [
      {
        pieceType: "pawn_w",
        moves: [{ type: "pawn", forward: "N", captureDirs: ["NE", "NW"], firstDouble: true }],
        capture: "both",
        onMove: { promoteTo: ["queen", "rook"], ifInRegion: "promotion-white" },
      },
      {
        pieceType: "man_w",
        moves: [{ type: "step", dir: "NE" }, { type: "step", dir: "NW" }],
        capture: "both",
        onMove: { promoteTo: ["king_w"], ifInRegion: "promotion-white" },
      },
    ],
    turns: { type: "alternating", order: ["white", "black"], first: "white" },
    outcomes: [],
    end: { condition: "manual", action: "stop" },
    regions: [{ id: "promotion-white", cells: Array.from({ length: 8 }, (_, q) => ({ q, r: 0 })), type: "edge" }],
  };
  const pawn = { id: "p", anchor: { q: 3, r: 1 }, span: [], type: "pawn_w", data: { player: "white" }, tags: [] };
  check("promotion lists every option", JSON.stringify(promotionOptions(pawn, rules, { q: 3, r: 0 })) === JSON.stringify(["queen", "rook"]));
  check("no options off the promotion rank", promotionOptions(pawn, rules, { q: 3, r: 3 }).length === 0);
  const man = { ...pawn, id: "m", type: "man_w" };
  check("single option offered silently", JSON.stringify(promotionOptions(man, rules, { q: 3, r: 0 })) === JSON.stringify(["king_w"]));
  check("unknown pieces never promote", promotionOptions({ ...pawn, type: "king" }, rules, { q: 3, r: 0 }).length === 0);
  const promoted = applyPromotion([pawn], "p", "rook");
  check("applyPromotion changes type and symbol",
    promoted[0].type === "rook" && (promoted[0].data as any).symbol === promotionSymbol("rook"));
  check("applyPromotion leaves others untouched",
    applyPromotion([pawn, man], "p", "rook")[1] === man);
  check("established glyphs preserved",
    promotionSymbol("queen") === "♕" && promotionSymbol("king_w") === "♔");
}

// 3. Acceptance: every game plan loads, plays, and saves through app paths.
import { readFileSync as readGameFile } from "node:fs";
// Side-effect imports: register the vocabularies the game plans replay.
import "../src/framework/morphs/grid";
import "../src/framework/morphs/rules";
import { loadPlan as loadGamePlan, chainForSave as chainForBoardSave } from "../src/framework/plan";
import { chainForRuleSave as chainForGameRuleSave, loadRuleChain as loadGameRuleChain } from "../src/framework/rule-chains";
import { canActOn as canActOnGame, nextTurn as nextTurnGame } from "../src/framework/engine";

const OFF = { gravity: false, diagonal: false, sliding: false, wrapping: false, chainCapture: false };

function loadGame(name: string, tilingId?: string) {
  const data = JSON.parse(readGameFile(`morph-plans/${name}.json`, "utf8"));
  if (tilingId) data.tilingId = tilingId;
  return { data, res: loadGamePlan({ data, errors: [] }, null) };
}

function gameRoundTrip(name: string) {
  const { data, res } = loadGame(name);
  check(`${name} plan loads`, res.ok, res.ok ? "" : res.errors.join("; "));
  if (!res.ok) return null;
  const w = res.plan.width, h = res.plan.height;
  const occs = res.plan.occupants ?? [];
  // Rule chain save publishes whole at load time (board untouched so far).
  const appBase = { board: res.plan.base, rules: res.plan.ruleBase ?? res.plan.ruleSet };
  const current = { board: res.plan.base, rules: res.plan.ruleSet };
  const saved = chainForGameRuleSave(appBase, res.plan.ruleMorphs ?? [], current, { tilingId: data.tilingId });
  check(`${name} rule chain saves whole`, saved.ok && !saved.checkpointed, saved.ok ? "" : saved.errors.join("; "));
  if (saved.ok) {
    const reload = loadGameRuleChain(saved.base, saved.morphs, { tilingId: data.tilingId });
    check(`${name} rule save reloads`, reload.ok, reload.ok ? "" : reload.errors.join("; "));
  }
  // Board chain save publishes whole: replayed board equals the snapshot.
  const bSaved = chainForBoardSave(res.plan.base, res.plan.morphs, occs, w, h, { tilingId: data.tilingId });
  check(`${name} board chain saves whole`, bSaved.ok && !bSaved.checkpointed, bSaved.ok ? "" : bSaved.errors.join("; "));
  // Edited boards checkpoint instead of publishing (honest snapshot).
  const edited = chainForGameRuleSave(appBase, res.plan.ruleMorphs ?? [],
    { board: { occupants: occs, width: w, height: h }, rules: res.plan.ruleSet }, { tilingId: data.tilingId });
  if (occs.length > 0) {
    check(`${name} edited board checkpoints`, edited.ok && edited.checkpointed, edited.ok ? "published" : edited.errors.join("; "));
  }
  return { data, plan: res.plan, occs, w, h };
}

// 4. Tic-Tac-Toe through its own plan rules.
{
  const g = gameRoundTrip("tictactoe");
  if (g) {
    const rs = g.plan.ruleSet;
    const tiling = getTiling("square8");
    const ghost = (player: string): Occupant => ({ id: "g", anchor: { q: -1, r: -1 }, span: [], type: "mark", data: { player }, tags: [] });
    const movesOf = (os: Occupant[], player: string) =>
      getValidMoves(ghost(player), os, tiling, rs, 3, 3, OFF, []);
    check("tictactoe opens with 9 placements", movesOf([], "X").length === 9);
    const one = [...movesOf([], "X").slice(0, 1)].map(m => ({ id: `x-${m.q}-${m.r}`, anchor: { q: m.q, r: m.r }, span: [], type: "mark", data: { player: "X", symbol: "X" }, tags: [] }));
    check("tictactoe occupied cell excluded", !movesOf(one, "O").some(m => m.q === one[0].anchor.q && m.r === one[0].anchor.r));
    check("tictactoe alternates X to O", nextTurnGame(rs.turns, "X", false) === "O" && nextTurnGame(rs.turns, "O", false) === "X");
    check("tictactoe gates the wrong side", !canActOnGame(rs.turns, "X", "O") && canActOnGame(rs.turns, "X", "X"));
    const ev = (os: Occupant[]) => evaluateOutcomes(os, tiling, rs, "X", 3, 3, (o, os2) => getValidMoves(o, os2, tiling, rs, 3, 3, OFF, []));
    const row = [0, 1, 2].map(q => ({ id: `x${q}`, anchor: { q, r: 0 }, span: [], type: "mark", data: { player: "X" }, tags: [] as string[] }));
    check("tictactoe detects a row win", (ev(row) ?? "").includes("X"));
    const full: Occupant[] = [];
    const picks: [number, number, string][] = [[0,0,"X"],[1,0,"O"],[2,0,"X"],[0,1,"X"],[1,1,"O"],[2,1,"O"],[0,2,"O"],[1,2,"X"],[2,2,"X"]];
    picks.forEach(([q, r, p], i) => full.push({ id: `c${i}`, anchor: { q, r }, span: [], type: "mark", data: { player: p }, tags: [] }));
    check("tictactoe detects a draw", (evaluateOutcomes(full, tiling, rs, "O", 3, 3, (o, os2) => getValidMoves(o, os2, tiling, rs, 3, 3, OFF, [])) ?? "").toLowerCase().includes("draw"));
  }
}

// 5. Checkers through its own plan rules.
{
  const g = gameRoundTrip("checkers");
  if (g) {
    const rs = g.plan.ruleSet;
    const tiling = getTiling("square8");
    const movesOf = (o: Occupant, os: Occupant[]) => getValidMoves(o, os, tiling, rs, 8, 8, OFF, []);
    check("checkers sets up 24 men on dark squares",
      g.occs.length === 24 && g.occs.every(o => (o.anchor.q + o.anchor.r) % 2 === 1));
    const man = g.occs.find(o => o.type === "man_w" && o.anchor.q === 0 && o.anchor.r === 5)!;
    const targets = movesOf(man, g.occs);
    check("checkers man steps forward", targets.some(m => m.q === 1 && m.r === 4 && !m.capture));
    check("checkers man cannot step back", !targets.some(m => m.r === 6));
    check("checkers captures keep moving", nextTurnGame(rs.turns, "white", true) === "white" && nextTurnGame(rs.turns, "white", false) === "black");
    // Constructed capture on dark squares: white (2,5) jumps black (3,4) to (4,3).
    const wb = { id: "w", anchor: { q: 2, r: 5 }, span: [], type: "man_w", data: { player: "white" }, tags: [] as string[] };
    const bb = { id: "b", anchor: { q: 3, r: 4 }, span: [], type: "man_b", data: { player: "black" }, tags: [] as string[] };
    const caps = movesOf(wb, [wb, bb]);
    check("checkers leap captures over the midpoint", caps.some(m => m.q === 4 && m.r === 3 && m.capture === "b"), JSON.stringify(caps));
    check("checkers leap needs a victim", !movesOf(wb, [wb]).some(m => m.q === 4 && m.r === 3));
    const blocked = { id: "w2", anchor: { q: 0, r: 5 }, span: [], type: "man_w", data: { player: "white" }, tags: [] as string[] };
    const friend = { id: "f", anchor: { q: 1, r: 4 }, span: [], type: "man_w", data: { player: "white" }, tags: [] as string[] };
    check("checkers leap cannot jump friends", !movesOf(blocked, [blocked, friend]).some(m => m.q === 2 && m.r === 3 && m.capture));
    check("checkers promotes on the last rank", JSON.stringify(promotionOptions(wb, rs, { q: 0, r: 0 })) === JSON.stringify(["king_w"]));
    const ev = (os: Occupant[]) => evaluateOutcomes(os, tiling, rs, "white", 8, 8, (o, os2) => getValidMoves(o, os2, tiling, rs, 8, 8, OFF, []));
    check("checkers detects elimination", (ev([wb]) ?? "").toLowerCase().includes("white"));
  }
}

// 6. Chess through its own plan rules.
{
  const g = gameRoundTrip("chess8");
  if (g) {
    const rs = g.plan.ruleSet;
    const tiling = getTiling("square8");
    const movesOf = (o: Occupant, os: Occupant[]) => getValidMoves(o, os, tiling, rs, 8, 8, OFF, []);
    check("chess sets up 32 pieces", g.occs.length === 32);
    const pawn = g.occs.find(o => o.type === "pawn_w" && o.anchor.q === 0 && o.anchor.r === 6)!;
    const pt = movesOf(pawn, g.occs);
    check("chess pawn steps forward", pt.some(m => m.q === 0 && m.r === 5 && !m.capture));
    check("chess pawn double-steps unmoved", pt.some(m => m.q === 0 && m.r === 4 && !m.capture));
    check("chess pawn never steps back", !pt.some(m => m.r === 7));
    const knight = g.occs.find(o => o.type === "knight" && o.anchor.q === 1 && o.anchor.r === 7)!;
    const kt = movesOf(knight, g.occs);
    check("chess knight leaps", kt.some(m => m.q === 0 && m.r === 5) && kt.some(m => m.q === 2 && m.r === 5));
    const king = g.occs.find(o => o.type === "king" && o.data?.player === "white")!;
    const kti = movesOf(king, [king]);
    check("chess king steps one", kti.length === 5 && kti.every(m => Math.abs(m.q - 4) <= 1 && Math.abs(m.r - 7) <= 1));
    const expected = (rs.moves.find(m => m.pieceType === "pawn_w") as any)?.onMove?.promoteTo ?? [];
    check("chess promotion is a choice",
      expected.length > 1 && JSON.stringify(promotionOptions(pawn, rs, { q: 0, r: 0 })) === JSON.stringify(expected));
    const ev = (os: Occupant[]) => evaluateOutcomes(os, tiling, rs, "black", 8, 8, (o, os2) => getValidMoves(o, os2, tiling, rs, 8, 8, OFF, []));
    check("chess detects the captured king",
      (ev(g.occs.filter(o => !(o.type === "king" && o.data?.player === "white"))) ?? "").toLowerCase().includes("black"));
  }
}

// 7. Painter on square and hex through plan paths.
{
  const g = gameRoundTrip("painter");
  if (g) {
    for (const tid of ["square8", "hexH", "hexV"]) {
      const t = getTiling(tid as any);
      const { res } = loadGame("painter", tid);
      check(`painter loads on ${tid}`, res.ok, res.ok ? "" : res.errors.join("; "));
      if (!res.ok) continue;
      const ghost: Occupant = { id: "g", anchor: { q: -1, r: -1 }, span: [], type: "mark", data: { player: "painter" }, tags: [] };
      const targets = getValidMoves(ghost, [], t, res.plan.ruleSet, 12, 12, OFF, []);
      check(`painter covers the ${tid} board`, targets.length === 12 * 12, `${targets.length}`);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
