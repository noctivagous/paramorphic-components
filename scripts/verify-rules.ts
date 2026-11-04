// Rule morph checks: the rule.* vocabulary over AppState ({ board, rules }).
// Run with `npm run verify:rules` (esbuild bundle + node, no test framework).
import {
  appHistory,
  appStatesEqual,
  chainForRuleSave,
  cloneAppState,
  loadRuleChain,
  removeRuleMorphAt,
  replaceRuleMorphAt,
  rulesRegistry,
  type AppState,
} from "../src/framework/morphs/rules";
import { loadPlan } from "../src/framework/plan";
import type { RuleSet } from "../src/framework/types";

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

const ctx = { tilingId: "square8" };

function baseRules(): RuleSet {
  return {
    id: "test",
    setup: { width: 8, height: 8, description: "rule vocabulary fixture" },
    moves: [
      { pieceType: "pawn", moves: [{ type: "step", dir: "N" }], capture: "both" },
    ],
    turns: { type: "alternating", order: ["white", "black"], first: "white" },
    outcomes: [],
    end: { condition: "anyOutcome", action: "stop" },
    regions: [],
  };
}

function baseState(): AppState {
  return { board: { occupants: [], width: 8, height: 8 }, rules: baseRules() };
}

const rook = { pieceType: "rook", moves: [{ type: "slide", dir: "N" }], capture: "both" as const };

// 1. addMove validates shape, rejects duplicates, inverts by removal.
{
  const add = { name: "rule.addMove", params: { rule: rook }, inverse: { prev: null } };
  const bad = { name: "rule.addMove", params: { rule: { pieceType: "", moves: [] } }, inverse: {} };
  check("addMove validates shape", rulesRegistry.validateChain([bad], ctx).length > 0);
  const dup = rulesRegistry.checkMorphState("rule.addMove", baseState(), add.params, ctx);
  // No duplicate yet: applicable.
  check("addMove applicable when absent", dup.length === 0, dup.join("; "));
  const applied = rulesRegistry.applyMorph(baseState(), add, ctx);
  check("addMove applies", applied.ok && (applied as any).state.rules.moves.length === 2);
  if (applied.ok) {
    const again = rulesRegistry.checkMorphState("rule.addMove", applied.state, add.params, ctx);
    check("addMove rejects duplicates", again.some(e => e.includes("already exists")), again.join("; "));
    const framed = rulesRegistry.recaptureFrames(baseState(), [add], cloneAppState);
    const back = rulesRegistry.invertMorph(applied.state, framed[0]);
    check("addMove inverts by removal", !!back && back.rules.moves.length === 1);
  }
  // Unknown morphs and missing frames fail loudly, never silently.
  check("unknown rule morph rejected", rulesRegistry.validateChain([{ name: "rule.nope", params: {} }], ctx).length > 0);
  check("missing inverse frame throws to snapshot",
    rulesRegistry.invertMorph(baseState(), { name: "rule.addMove", params: { rule: rook } }) === null);
}

// 2. removeMove / replaceMove capture the prior rule and restore position.
{
  const st = baseState();
  st.rules.moves.push(rook as any);
  const rm = { name: "rule.removeMove", params: { pieceType: "rook" }, inverse: undefined as unknown };
  const missing = rulesRegistry.checkMorphState("rule.removeMove", baseState(), { pieceType: "ghost" }, ctx);
  check("removeMove rejects absent pieceType", missing.length > 0);
  const framed = rulesRegistry.recaptureFrames(st, [rm], cloneAppState);
  const applied = rulesRegistry.applyMorph(st, framed[0], ctx);
  check("removeMove applies", applied.ok && (applied as any).state.rules.moves.length === 1);
  if (applied.ok) {
    const back = rulesRegistry.invertMorph(applied.state, framed[0]);
    check(
      "removeMove restores rule and order",
      !!back && back.rules.moves.length === 2 && back.rules.moves[1].pieceType === "rook",
      back ? JSON.stringify(back.rules.moves.map((m: any) => m.pieceType)) : "null"
    );
  }
  const repl = { name: "rule.replaceMove", params: { rule: { ...rook, capture: "move" } }, inverse: undefined as unknown };
  const rframed = rulesRegistry.recaptureFrames(st, [repl], cloneAppState);
  const rapplied = rulesRegistry.applyMorph(st, rframed[0], ctx);
  check("replaceMove applies", rapplied.ok && (rapplied as any).state.rules.moves[1].capture === "move");
  if (rapplied.ok) {
    const back = rulesRegistry.invertMorph(rapplied.state, rframed[0]);
    check("replaceMove restores prior rule", !!back && back.rules.moves[1].capture === "both");
  }
  const badDir = { name: "rule.replaceMove", params: { rule: { pieceType: "rook", moves: [{ type: "step", dir: "NOPE" }], capture: "both" } } };
  const dirErrs = rulesRegistry.checkMorphState("rule.replaceMove", st, (badDir as any).params, ctx);
  check("bad direction rejected with tiling context", dirErrs.some(e => e.includes("NOPE")), dirErrs.join("; "));
  const noCtx = rulesRegistry.checkMorphState("rule.replaceMove", st, (badDir as any).params, {});
  check("shape passes without tiling context", noCtx.length === 0, noCtx.join("; "));
}

// 3. Turns, outcomes, regions, end.
{
  const st = baseState();
  const setT = { name: "rule.setTurns", params: { turns: { type: "free" } }, inverse: undefined as unknown };
  const tframed = rulesRegistry.recaptureFrames(st, [setT], cloneAppState);
  const tapplied = rulesRegistry.applyMorph(st, tframed[0], ctx);
  check("setTurns applies", tapplied.ok && (tapplied as any).state.rules.turns.type === "free");
  if (tapplied.ok) {
    const back = rulesRegistry.invertMorph(tapplied.state, tframed[0]);
    check("setTurns inverts", !!back && (back.rules.turns as any).type === "alternating");
  }
  check("bad turns type rejected",
    rulesRegistry.validateChain([{ name: "rule.setTurns", params: { turns: { type: "chaotic" } } }], ctx).length > 0);

  const addO = { name: "rule.addOutcome", params: { outcome: { kind: "boardFull", draw: true } }, inverse: undefined as unknown };
  const oframed = rulesRegistry.recaptureFrames(st, [addO], cloneAppState);
  const oapplied = rulesRegistry.applyMorph(st, oframed[0], ctx);
  check("addOutcome applies", oapplied.ok && (oapplied as any).state.rules.outcomes.length === 1);
  if (oapplied.ok) {
    const back = rulesRegistry.invertMorph(oapplied.state, oframed[0]);
    check("addOutcome inverts", !!back && back.rules.outcomes.length === 0);
  }
  check("unknown outcome kind rejected",
    rulesRegistry.validateChain([{ name: "rule.addOutcome", params: { outcome: { kind: "stalemate" } } }], ctx).length > 0);
  const dangling = { name: "rule.addOutcome", params: { outcome: { kind: "reachRow", player: "white", regionId: "ghost" } } };
  check("dangling region reference rejected",
    rulesRegistry.checkMorphState("rule.addOutcome", st, (dangling as any).params, ctx).length > 0);

  const region = { id: "home", cells: [{ q: 0, r: 0 }], type: "row" };
  const addR = { name: "rule.addRegion", params: { region }, inverse: undefined as unknown };
  const rframed = rulesRegistry.recaptureFrames(st, [addR], cloneAppState);
  const rapplied = rulesRegistry.applyMorph(st, rframed[0], ctx);
  check("addRegion applies", rapplied.ok && (rapplied as any).state.rules.regions.length === 1);
  if (rapplied.ok) {
    const dupR = rulesRegistry.checkMorphState("rule.addRegion", rapplied.state, { region }, ctx);
    check("addRegion rejects duplicate ids", dupR.length > 0);
    // A region referenced by an outcome cannot be removed first.
    const withRef: AppState = {
      board: st.board,
      rules: { ...rapplied.state.rules, outcomes: [{ kind: "reachRow", player: "white", regionId: "home" } as any] },
    };
    const blocked = rulesRegistry.checkMorphState("rule.removeRegion", withRef, { id: "home" }, ctx);
    check("referenced region removal blocked", blocked.some(e => e.includes("reachRow") || e.includes("referenced")), blocked.join("; "));
    const back = rulesRegistry.invertMorph(rapplied.state, rframed[0]);
    check("addRegion inverts", !!back && back.rules.regions.length === 0);
  }
  check("bad end rejected",
    rulesRegistry.validateChain([{ name: "rule.setEnd", params: { end: { condition: "suddenDeath", action: "stop" } } }], ctx).length > 0);
}

// 4. Replay, history, and chain surgery through the shared core.
{
  const st = baseState();
  const chain = [
    { name: "rule.addMove", params: { rule: rook }, inverse: { prev: null } },
    { name: "rule.addOutcome", params: { outcome: { kind: "captureAll" } }, inverse: undefined as unknown },
  ];
  const replayed = rulesRegistry.replayMorphsChecked(st, chain, ctx, cloneAppState);
  check("rule chain replays", replayed.ok, replayed.ok ? "" : replayed.errors.join("; "));
  if (replayed.ok) {
    const framed = rulesRegistry.recaptureFrames(st, chain, cloneAppState);
    const s1res = rulesRegistry.applyMorph(st, framed[0], ctx);
    const s2res = s1res.ok ? rulesRegistry.applyMorph(s1res.state, framed[1], ctx) : s1res;
    check("rule steps apply in order", s1res.ok && s2res.ok);
    if (s1res.ok && s2res.ok) {
      const past1 = appHistory.push([], st, framed[0]);
      const past2 = appHistory.push(past1, s1res.state, framed[1]);
      const undone = appHistory.undo(past2, [], s2res.state);
      check("appHistory undoes a rule morph",
        undone.undone && undone.state.rules.outcomes.length === 0,
        JSON.stringify(undone.state.rules.outcomes));
      const redone = appHistory.redo(undone.past, undone.future, undone.state);
      check("appHistory redoes a rule morph",
        redone.redone && redone.state.rules.outcomes.length === 1);
    }
  }
  // Surgery: removing the region definition breaks the dependent outcome step.
  const rst: AppState = {
    board: st.board,
    rules: { ...baseRules(), regions: [] },
  };
  const depChain = [
    { name: "rule.addRegion", params: { region: { id: "home", cells: [{ q: 0, r: 0 }], type: "row" } }, inverse: undefined as unknown },
    { name: "rule.addOutcome", params: { outcome: { kind: "reachRow", player: "white", regionId: "home" } }, inverse: undefined as unknown },
  ];
  const depReplayed = rulesRegistry.replayMorphsChecked(rst, depChain, ctx, cloneAppState);
  check("dependent chain replays", depReplayed.ok, depReplayed.ok ? "" : depReplayed.errors.join("; "));
  const removed = removeRuleMorphAt(rst, depChain, 0, ctx);
  check("surgery reports broken dependents", !removed.ok, removed.ok ? "replayed despite missing region" : "");
  const replaced = replaceRuleMorphAt(rst, depChain, 1, { name: "rule.addOutcome", params: { outcome: { kind: "boardFull" } } }, ctx);
  check("replaceMorphAt replays independents", replaced.ok, replaced.ok ? "" : replaced.errors.join("; "));
}

// 5. loadRuleChain / chainForRuleSave trust boundaries.
{
  const st = baseState();
  const chain = [{ name: "rule.addMove", params: { rule: rook } }];
  const loaded = loadRuleChain(st, chain, ctx);
  check("loadRuleChain replays", loaded.ok, loaded.ok ? "" : loaded.errors.join("; "));
  if (loaded.ok) {
    check("loadRuleChain adds the move", loaded.rules.moves.length === 2);
    check("loadRuleChain recaptures frames", loaded.chain[0].inverse !== undefined);
  }
  const badBase = loadRuleChain({ board: st.board, rules: { id: "bad" } as any }, [], ctx);
  check("invalid rule base rejected", !badBase.ok, badBase.ok ? "loaded" : "");
  let threw = false;
  try {
    loadRuleChain(null as any, [], ctx);
  } catch {
    threw = true;
  }
  check("malformed rule base never throws", !threw);
  const nonArray = loadRuleChain(st, "nope" as any, ctx);
  check("non-array rule chain rejected", !nonArray.ok);
  const dupChain = loadRuleChain(st, [
    { name: "rule.addMove", params: { rule: rook } },
    { name: "rule.addMove", params: { rule: rook } },
  ], ctx);
  check("duplicate add fails the loader", !dupChain.ok, dupChain.ok ? "loaded" : "");

  const full = chainForRuleSave(st, [{ name: "rule.addMove", params: { rule: rook }, inverse: { prev: null } }], {
    board: st.board,
    rules: { ...st.rules, moves: [...st.rules.moves, rook as any] },
  }, ctx);
  check("complete rule chain saves whole", full.ok && !full.checkpointed);
  const partial = chainForRuleSave(st, [], {
    board: st.board,
    rules: { ...st.rules, moves: [...st.rules.moves, rook as any] },
  }, ctx);
  check("partial rule chain checkpoints", partial.ok && partial.checkpointed);
  const badCurrent = chainForRuleSave(st, [], { board: st.board, rules: { id: "bad" } as any }, ctx);
  check("invalid current rules rejected", !badCurrent.ok, badCurrent.ok ? "published" : "");
  const badBaseSave = chainForRuleSave(
    { board: st.board, rules: { id: "bad" } as any },
    [],
    { board: st.board, rules: baseRules() },
    ctx
  );
  check("invalid base checkpoints valid current", badBaseSave.ok && badBaseSave.checkpointed);
  if (badBaseSave.ok) {
    const reload = loadRuleChain(badBaseSave.base, badBaseSave.morphs, ctx);
    check("rule checkpoint reloads", reload.ok, reload.ok ? "" : reload.errors.join("; "));
  }
}

// 6. loadPlan integration: rule chains construct the ruleSet.
{
  const embedded = baseRules();
  const ruleBase = { ...baseRules(), moves: [] };
  const plan: any = {
    $schema: "paramorphic-plan/1",
    component: "Grid",
    tilingId: "square8",
    presetId: "ruled",
    ruleSet: embedded,
    width: 8,
    height: 8,
    occupants: [],
    regions: [],
    turns: embedded.turns,
    outcomes: embedded.outcomes,
    base: { occupants: [], width: 8, height: 8 },
    morphs: [],
    ruleBase,
    ruleMorphs: [{ name: "rule.addMove", params: { rule: { pieceType: "pawn", moves: [{ type: "step", dir: "N" }], capture: "both" } }, inverse: { prev: null } }],
  };
  const res = loadPlan({ data: plan, errors: [] }, null);
  check("plan with rule chain loads", res.ok, res.ok ? "" : res.errors.join("; "));
  if (res.ok) {
    check("replayed ruleSet carried", res.plan.ruleSet.moves.length === 1);
    check("rule base echoed for save", !!res.plan.ruleBase && (res.plan.ruleMorphs ?? []).length === 1);
  }
  const tampered = {
    ...plan,
    ruleMorphs: [
      ...plan.ruleMorphs,
      { name: "rule.addMove", params: { rule: rook }, inverse: { prev: null } },
    ],
  };
  const bad = loadPlan({ data: tampered, errors: [] }, null);
  check("rule replay mismatch rejected",
    !bad.ok && bad.errors.some(e => e.includes("rule replay mismatch")), bad.ok ? "loaded" : "");
  const noChain = { ...plan };
  delete (noChain as any).ruleBase;
  delete (noChain as any).ruleMorphs;
  const plain = loadPlan({ data: noChain, errors: [] }, null);
  check("configuration-only plan unchanged",
    plain.ok && (plain.plan.ruleMorphs ?? []).length === 0 && plain.plan.ruleBase === undefined,
    plain.ok ? "" : plain.errors.join("; "));
  const badMorph = { ...plan, ruleMorphs: [{ name: "rule.nope", params: {} }] };
  check("unknown rule morph rejected", !loadPlan({ data: badMorph, errors: [] }, null).ok);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
