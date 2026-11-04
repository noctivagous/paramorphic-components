import { loadPlan, type LoadedPlan } from "./plan";

/** A recipe produces an ordinary plan; applications may also use plans directly. */
export type PlanRecipe<P> = {
  id: string;
  label: string;
  description: string;
  parameters: ReadonlyArray<{ name: string; type: string; description: string; default?: unknown }>;
  validate: (params: unknown) => string[];
  build: (params: P) => unknown;
};

export type InstantiatedPlan<T = LoadedPlan> =
  | { ok: true; data: unknown; plan: T }
  | { ok: false; errors: string[] };

type PlanLoader<T> = (data: unknown) => { ok: true; plan: T } | { ok: false; errors: string[] };
export type PlanInventory<T> = {
  register<P>(recipe: PlanRecipe<P>): void;
  list(): Array<Pick<PlanRecipe<unknown>, "id" | "label" | "description" | "parameters">>;
  instantiate(id: string, params: unknown): InstantiatedPlan<T>;
};

/** An inventory is scoped to its owner; other plan types can supply their own loader. */
export function createPlanInventory(): PlanInventory<LoadedPlan>;
export function createPlanInventory<T>(load: PlanLoader<T>): PlanInventory<T>;
export function createPlanInventory(load: PlanLoader<any> = data => loadPlan({ data, errors: [] }, null)): PlanInventory<any> {
  const recipes = new Map<string, PlanRecipe<any>>();
  return {
    register<P>(recipe: PlanRecipe<P>): void {
      if (!recipe.id || recipes.has(recipe.id)) throw new Error(`Plan recipe "${recipe.id}" is already registered or has no id`);
      recipes.set(recipe.id, recipe);
    },
    list() {
      return [...recipes.values()].map(({ id, label, description, parameters }) => ({ id, label, description, parameters }));
    },
    instantiate(id: string, params: unknown): InstantiatedPlan<any> {
      const recipe = recipes.get(id);
      if (!recipe) return { ok: false, errors: [`unknown plan recipe "${id}"`] };
      try {
        const errors = recipe.validate(params);
        if (errors.length) return { ok: false, errors };
        const data = recipe.build(params);
        const loaded = load(data);
        return loaded.ok ? { ok: true, data, plan: loaded.plan } : loaded;
      } catch (e) {
        return { ok: false, errors: [`plan recipe "${id}" failed: ${e instanceof Error ? e.message : String(e)}`] };
      }
    },
  };
}
