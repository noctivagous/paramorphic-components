// Generate game plans from presets: base + board chain constructs the
// setup, ruleBase + rule chain constructs the rules, and the embedded
// ruleSet is the cached snapshot the replay must match. Run with
// `npm run gen:plans`. Plans land in morph-plans/ for the demo shell.
import { writeFileSync } from "node:fs";
import { presetData } from "../src/framework/presets";
// Side-effect imports: register the rule.* and grid.* vocabularies used below.
import "../src/framework/morphs/rules";
import "../src/framework/morphs/grid";
import { loadRuleChain } from "../src/framework/rule-chains";
import { ruleSetsEqual } from "../src/framework/rule-sets";
import { loadPlan } from "../src/framework/plan";
import type { Occupant, RuleSet } from "../src/framework/types";

const GAMES = ["tictactoe", "checkers", "chess8", "painter"] as const;

function minimalBase(rs: RuleSet): RuleSet {
  return {
    id: rs.id,
    setup: rs.setup,
    moves: [],
    turns: { type: "free" },
    outcomes: [],
    end: { condition: "manual", action: "stop" },
    regions: [],
  };
}

for (const id of GAMES) {
  const { ruleSet, occupants, width, height, regions } = presetData(id);
  const det: Occupant[] = occupants.map(o => ({
    ...o,
    id: `${o.type}-q${o.anchor.q}-r${o.anchor.r}`,
  }));
  const boardChain = det.map(occ => ({ name: "grid.upsertOccupant", params: { occ }, inverse: { prev: null } }));
  const ruleBase = minimalBase(ruleSet);
  const ruleMorphs: any[] = [
    ...(ruleSet.regions ?? []).map(region => ({ name: "rule.addRegion", params: { region }, inverse: { prev: [] } })),
    ...ruleSet.moves.map(rule => ({ name: "rule.addMove", params: { rule }, inverse: { prev: null } })),
    { name: "rule.setTurns", params: { turns: ruleSet.turns }, inverse: { prev: { type: "free" } } },
    ...(ruleSet.outcomes ?? []).map(outcome => ({ name: "rule.addOutcome", params: { outcome }, inverse: { prev: [] } })),
    { name: "rule.setEnd", params: { end: ruleSet.end }, inverse: { prev: { condition: "manual", action: "stop" } } },
  ];
  // Self-check before writing: the chain must replay to the embedded ruleSet.
  const replayed = loadRuleChain(
    { board: { occupants: [], width, height }, rules: ruleBase },
    ruleMorphs,
    { tilingId: "square8" }
  );
  if (!replayed.ok) {
    console.error(`${id}: rule chain failed: ${replayed.errors.join("; ")}`);
    process.exitCode = 1;
    continue;
  }
  const mismatch = ruleSetsEqual(replayed.rules, ruleSet);
  if (mismatch) {
    console.error(`${id}: ${mismatch}`);
    process.exitCode = 1;
    continue;
  }
  const plan: any = {
    $schema: "paramorphic-plan/1",
    component: "Grid",
    tilingId: "square8",
    presetId: id,
    ruleSet,
    width,
    height,
    occupants: det,
    regions,
    turns: (ruleSet as any).turns,
    outcomes: (ruleSet as any).outcomes,
    interpretation: { view: "game", game: id },
    base: { occupants: [], width, height },
    morphs: boardChain,
    ruleBase,
    ruleMorphs: replayed.chain,
  };
  const loaded = loadPlan({ data: plan, errors: [] }, null);
  if (!loaded.ok) {
    console.error(`${id}: plan failed to load: ${loaded.errors.join("; ")}`);
    process.exitCode = 1;
    continue;
  }
  writeFileSync(`morph-plans/${id}.json`, JSON.stringify(plan, null, 2) + "\n");
  console.log(`${id}: ${det.length} pieces, ${ruleMorphs.length} rule morphs, loads clean`);
}
