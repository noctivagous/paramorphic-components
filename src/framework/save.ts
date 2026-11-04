// Shared save-plan assembly for Grid shells (spreadsheet, player, keyboard).
// Settings travel with the opened file (never the seed), and the chain is
// verified through the shared chainForSave publication rule before publishing.
// Kept pure so the verify script can drive save/reload round trips without React.
import { chainForSave } from "./plan";
import type { PlanBase } from "./plan";
export type { PlanBase };
import type { AppliedMorph } from "./morphs/registry";
import type { HistoryStep } from "./history";
import type { Occupant } from "./types";

export type AppSaveSettings = {
  tilingId: string;
  presetId: string;
  ruleSet: any;
  regions: any[];
  interpretation: any;
};

export function buildAppSave(args: {
  settings: AppSaveSettings;
  size: { w: number; h: number };
  occupants: Occupant[];
  base: PlanBase;
  adopted: AppliedMorph[];
  past: HistoryStep[];
  extra?: Record<string, unknown>;
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
      ...(args.extra ?? {}),
    },
  };
}
