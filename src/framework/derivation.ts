// ---------- Derivation: recompute derived occupant data in dependency order ----------
// Mechanism only: topological ordering plus cycle detection. Expression
// languages (spreadsheet formulas, logic rules) live in the morph library
// and plans, and supply the dependsOn/compute callbacks used here.
export function orderForRecalc(
  targets: string[],
  dependsOn: (id: string) => string[]
): string[] {
  const order: string[] = [];
  const visiting = new Set<string>();
  const done = new Set<string>();
  const visit = (id: string, stack: string[]): void => {
    if (done.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(
        `[framework] derivation cycle detected: ${[...stack, id].join(" -> ")}`
      );
    }
    visiting.add(id);
    for (const dep of dependsOn(id)) visit(dep, [...stack, id]);
    visiting.delete(id);
    done.add(id);
    order.push(id);
  };
  for (const t of targets) visit(t, []);
  return order;
}

export function recomputeDerived<T>(
  targets: string[],
  dependsOn: (id: string) => string[],
  compute: (id: string, get: (id: string) => T) => T
): Map<string, T> {
  const values = new Map<string, T>();
  for (const id of orderForRecalc(targets, dependsOn)) {
    values.set(
      id,
      compute(id, dep => {
        const v = values.get(dep);
        if (v === undefined) {
          throw new Error(
            `[framework] derivation missing value for dependency "${dep}" of "${id}"`
          );
        }
        return v;
      })
    );
  }
  return values;
}
