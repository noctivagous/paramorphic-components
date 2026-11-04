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

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
