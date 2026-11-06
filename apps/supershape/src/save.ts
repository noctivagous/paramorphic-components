// Pure save/load for the supershape app: the saved file is the plan (ctl
// values + binding). Opening validates through loadPlan — a file whose
// binding names an unknown def or occupant is rejected whole.
import { loadPlan } from "../../../src/framework";
import { CTL_ID, supershapePlanData, type SupershapeValues } from "./plans";

export function buildSupershapeSave(values: SupershapeValues): string {
  return JSON.stringify(supershapePlanData(values), null, 2);
}

export function parseSupershapeSave(text: string): { ok: true; values: SupershapeValues } | { ok: false; errors: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`JSON parse error: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const loaded = loadPlan({ data, errors: [] }, null);
  if (!loaded.ok) return { ok: false, errors: loaded.errors };
  const ctl = (loaded.plan.occupants ?? []).find(o => o.id === CTL_ID);
  if (!ctl) return { ok: false, errors: [`plan has no "${CTL_ID}" control occupant`] };
  const d = ctl.data as Record<string, unknown>;
  const values = {} as Record<string, number>;
  for (const k of ["m", "n1", "n2", "n3", "a", "b"]) {
    if (typeof d[k] !== "number") return { ok: false, errors: [`control occupant is missing numeric "${k}"`] };
    values[k] = d[k] as number;
  }
  return { ok: true, values: values as SupershapeValues };
}
