// Pure save-plan assembly for the spreadsheet shell: settings travel with the
// opened file (never the seed), and the chain is verified before publishing.
// Kept pure so the verify script can drive the complete save/reload round
// trip without React.
import { chainForSave, type PlanBase } from "../../../src/framework/plan";
import type { AppliedMorph } from "../../../src/framework/morphs/registry";
import type { HistoryStep } from "../../../src/framework/history";
import type { Occupant } from "../../../src/framework/types";

export type SheetSettings = {
  tilingId: string;
  presetId: string;
  ruleSet: any;
  regions: any[];
  interpretation: any;
};

export function buildSheetSave(args: {
  settings: SheetSettings;
  size: { w: number; h: number };
  occupants: Occupant[];
  base: PlanBase;
  adopted: AppliedMorph[];
  past: HistoryStep[];
}): { plan: any; checkpointed: boolean } {
  const stepped = args.past.map(e => e.morph).filter((m): m is AppliedMorph => m !== null);
  const saved = chainForSave(
    args.base,
    [...args.adopted, ...stepped],
    args.occupants,
    args.size.w,
    args.size.h
  );
  return {
    checkpointed: saved.checkpointed,
    plan: {
      $schema: "paramorphic-plan/1",
      component: "Grid",
      tilingId: args.settings.tilingId,
      presetId: args.settings.presetId,
      width: args.size.w,
      height: args.size.h,
      ruleSet: args.settings.ruleSet,
      occupants: args.occupants,
      regions: args.settings.regions,
      turns: args.settings.ruleSet.turns,
      outcomes: args.settings.ruleSet.outcomes,
      interpretation: args.settings.interpretation,
      base: saved.base,
      morphs: saved.morphs,
    },
  };
}
