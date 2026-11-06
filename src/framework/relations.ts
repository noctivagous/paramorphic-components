// ---------- Relations: named functions from input ports to output ports ----------
// Mechanism only, in derivation.ts's spirit: a registry of definitions, a
// dependency-ordered evaluation with quarantine, and plan-level bindings.
// The functions themselves (spreadsheet formulas, bézier sampling, the
// supershape) live in the morph library (morphs/relation-defs.ts) and
// register here; plans name a definition id and wire its ports to entities.
//
// A binding's ports are wired with EntityRefs. Grammar (the occupant part is
// implemented by occupantStore below; hosts may implement other entities
// behind the same RelationStore interface):
//
//   <occId>.data.<field>        occupant data field        (read/write)
//   <occId>.guest.points        a Path guest's points      (read/write)
//   <occId>.guest.state.<field> any other guest state field (read/write)
//   <occId>.anchor              occupant anchor as {x,y}   (read-only)
//
// Evaluation is forward-only: outputs are computed from inputs, never
// solved backwards. Outputs are derived state — hosts recompute them on
// load and on change, exactly like formula results; plans store inputs and
// bindings only. Failure is quarantine, copied from the spreadsheet: a
// DomainError (or a cycle across bindings) quarantines that binding's
// outputs and their dependents, marked with the reason, while everything
// else stays live.
import type { Occupant } from "./types";

// ---------- Ports and definitions ----------

export type PortType = "number" | "boolean" | "string" | "point" | "points" | "range" | "bbox";

export type RelationPoint = { x: number; y: number };
export type RelationBBox = { minX: number; minY: number; maxX: number; maxY: number };

export type PortDef = {
  name: string;
  type: PortType;
  /** UI-facing description, aligned with the app-kit PropSchemaField. */
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  /** Value used when a binding leaves the port unwired. Absent = required. */
  default?: unknown;
  unit?: string;
};

export type RelationEvalContext = {
  /** Sampling resolution requested by the binding (fixed count in v1). */
  sampleCount?: number;
  /** Data parameters carried by the binding (never code). */
  params?: Record<string, unknown>;
  bindingId: string;
};

export type RelationDef = {
  id: string;
  label: string;
  inputs: PortDef[];
  outputs: PortDef[];
  /**
   * True when the port set is generated per binding rather than fixed
   * (sheet.formula: its ports come from the formula's references). Dynamic
   * defs skip port-name validation; their evaluate receives every wired
   * input by name.
   */
  dynamic?: boolean;
  evaluate: (inputs: Record<string, unknown>, ctx: RelationEvalContext) => Record<string, unknown>;
};

/** Raised by a def's evaluate for out-of-domain inputs: quarantine, not crash. */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainError";
  }
}

const defs = new Map<string, RelationDef>();

export function registerRelationDef(def: RelationDef): void {
  if (!def.id) throw new Error("relation def needs an id");
  if (defs.has(def.id)) throw new Error(`relation def "${def.id}" is already registered`);
  defs.set(def.id, def);
}

export function getRelationDef(id: string): RelationDef | undefined {
  return defs.get(id);
}

export function listRelationDefs(): RelationDef[] {
  return [...defs.values()];
}

// ---------- Ordered evaluation with quarantine (shared engine) ----------
// Kahn ordering over items with named dependencies. Unprocessed items (cycle
// members and everything downstream of a cycle) are quarantined as a group
// with the concrete loop reported; an item whose compute throws is
// quarantined with the error; an item depending on a failed item is
// quarantined without its compute running. This is the exact semantics the
// spreadsheet's recalc has always had — formulas.ts now runs on it too.

export type EvalFailure =
  | { kind: "cycle" }
  | { kind: "error"; message: string }
  | { kind: "dependency"; dep: string };

export type EvalOutcome<T> = {
  /** Successfully computed values by item id. */
  values: Map<string, T>;
  /** Every processed item (computed or failed), in evaluation order. */
  order: string[];
  failed: Map<string, EvalFailure>;
  /** All unprocessed items: cycle members plus their transitive dependents. */
  cyclic: string[];
  /** The concrete dependency loop, when a cycle exists. */
  cycleLoop: string[] | null;
};

export type EvalItem<T> = {
  id: string;
  dependsOn: string[];
  compute: (get: (id: string) => T | undefined) => T;
};

export function evaluateItems<T>(items: EvalItem<T>[]): EvalOutcome<T> {
  const byId = new Map(items.map(i => [i.id, i]));
  const ids = items.map(i => i.id);
  const indeg = new Map(ids.map(id => [id, 0]));
  const dependents = new Map(ids.map(id => [id, [] as string[]]));
  for (const item of items) {
    for (const d of item.dependsOn) {
      if (!byId.has(d)) continue;
      indeg.set(item.id, indeg.get(item.id)! + 1);
      dependents.get(d)!.push(item.id);
    }
  }
  const queue = ids.filter(id => indeg.get(id) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const m of dependents.get(id)!) {
      indeg.set(m, indeg.get(m)! - 1);
      if (indeg.get(m) === 0) queue.push(m);
    }
  }
  const ordered = new Set(order);
  const cyclic = ids.filter(id => !ordered.has(id));
  let cycleLoop: string[] | null = null;
  if (cyclic.length > 0) {
    const stack: string[] = [];
    const onStack = new Set<string>();
    const done = new Set<string>();
    const visit = (id: string): void => {
      if (cycleLoop !== null || done.has(id)) return;
      if (onStack.has(id)) {
        cycleLoop = [...stack.slice(stack.indexOf(id)), id];
        return;
      }
      onStack.add(id);
      stack.push(id);
      for (const d of byId.get(id)!.dependsOn) if (!ordered.has(d)) visit(d);
      stack.pop();
      onStack.delete(id);
      done.add(id);
    };
    for (const id of cyclic) visit(id);
    cycleLoop = cycleLoop ?? cyclic;
  }
  const failed = new Map<string, EvalFailure>();
  for (const id of cyclic) failed.set(id, { kind: "cycle" });
  const values = new Map<string, T>();
  for (const id of order) {
    const item = byId.get(id)!;
    const badDep = item.dependsOn.find(d => failed.has(d));
    if (badDep !== undefined) {
      failed.set(id, { kind: "dependency", dep: badDep });
      continue;
    }
    try {
      values.set(id, item.compute(dep => values.get(dep)));
    } catch (e) {
      failed.set(id, { kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { values, order, failed, cyclic, cycleLoop };
}

// ---------- Bindings and stores ----------

export type RelationBinding = {
  id: string;
  def: string;
  in: Record<string, string | { const: unknown }>;
  out: Record<string, string>;
  /** Data parameters for the def (e.g. sheet.formula carries the formula). */
  params?: Record<string, unknown>;
  sample?: { count: number };
  /** Default true. On-demand bindings evaluate only when a host asks. */
  live?: boolean;
};

export type RelationStore = {
  get(ref: string): unknown;
  set(ref: string, value: unknown): void;
  has(ref: string): boolean;
};

export type ParsedRef =
  | { occId: string; kind: "data"; field: string }
  | { occId: string; kind: "guestPoints" }
  | { occId: string; kind: "guestState"; field: string }
  | { occId: string; kind: "anchor" };

export function parseEntityRef(ref: string): ParsedRef | null {
  if (typeof ref !== "string") return null;
  const parts = ref.split(".");
  if (parts.length < 2 || !parts[0]) return null;
  const [occId, head, a, b] = parts;
  if (head === "data" && parts.length === 3 && a) return { occId, kind: "data", field: a };
  if (head === "guest" && a === "points" && parts.length === 3) return { occId, kind: "guestPoints" };
  if (head === "guest" && a === "state" && parts.length === 4 && b) return { occId, kind: "guestState", field: b };
  if (head === "anchor" && parts.length === 2) return { occId, kind: "anchor" };
  return null;
}

export function isWritableRef(ref: string): boolean {
  const p = parseEntityRef(ref);
  return p !== null && p.kind !== "anchor";
}

/**
 * A store over a working copy of an occupant list. Reads see prior writes;
 * `occupants()` returns the list with every write applied (inputs are never
 * mutated — written occupants are shallow-copied first).
 */
export function occupantStore(source: Occupant[]): {
  store: RelationStore;
  occupants: () => Occupant[];
  setGuestQuarantine: (occId: string, reason: string | null) => void;
} {
  const list = source.slice();
  const index = new Map(list.map((o, i) => [o.id, i]));
  const find = (occId: string) => {
    const i = index.get(occId);
    return i === undefined ? undefined : list[i];
  };
  const replace = (occ: Occupant) => {
    list[index.get(occ.id)!] = occ;
  };
  const store: RelationStore = {
    get(ref) {
      const p = parseEntityRef(ref);
      if (!p) return undefined;
      const occ = find(p.occId);
      if (!occ) return undefined;
      switch (p.kind) {
        case "data": return (occ.data as any)?.[p.field];
        case "anchor": return { x: occ.anchor.q, y: occ.anchor.r };
        case "guestPoints": return occ.guest?.kind === "Path" ? occ.guest.state.points : undefined;
        case "guestState": return occ.guest ? (occ.guest.state as any)?.[p.field] : undefined;
      }
    },
    set(ref, value) {
      const p = parseEntityRef(ref);
      if (!p) throw new Error(`relation store: unparseable entity ref "${ref}"`);
      const occ = find(p.occId);
      if (!occ) throw new Error(`relation store: unknown occupant "${p.occId}"`);
      switch (p.kind) {
        case "data":
          replace({ ...occ, data: { ...(occ.data as any), [p.field]: value } });
          return;
        case "anchor":
          throw new Error(`relation store: "${ref}" is read-only (anchor)`);
        case "guestPoints": {
          if (occ.guest?.kind !== "Path") throw new Error(`relation store: occupant "${p.occId}" has no Path guest`);
          const { quarantine: _drop, ...rest } = occ.guest.state as any;
          replace({ ...occ, guest: { kind: "Path", state: { ...rest, points: value as { x: number; y: number }[] } } });
          return;
        }
        case "guestState": {
          if (!occ.guest) throw new Error(`relation store: occupant "${p.occId}" has no guest`);
          const guest = { ...occ.guest, state: { ...(occ.guest.state as any), [p.field]: value } } as Occupant["guest"];
          replace({ ...occ, guest });
          return;
        }
      }
    },
    has(ref) {
      return store.get(ref) !== undefined;
    },
  };
  const setGuestQuarantine = (occId: string, reason: string | null) => {
    const occ = find(occId);
    if (!occ || occ.guest?.kind !== "Path") return;
    if (reason === null) {
      if ((occ.guest.state as any).quarantine === undefined) return;
      const { quarantine: _drop, ...rest } = occ.guest.state as any;
      replace({ ...occ, guest: { kind: "Path", state: rest } });
    } else {
      replace({ ...occ, guest: { kind: "Path", state: { ...occ.guest.state, points: [], quarantine: reason } } });
    }
  };
  return { store, occupants: () => list.slice(), setGuestQuarantine };
}

// ---------- Binding evaluation ----------

export type RelationEvalResult = {
  /** Binding ids that evaluated successfully, in evaluation order. */
  evaluated: string[];
  /** Binding id -> quarantine reason, for every quarantined binding. */
  quarantined: Map<string, string>;
};

export function evaluateRelations(
  bindings: RelationBinding[],
  store: RelationStore,
  opts?: { changedRefs?: Set<string>; includeOnDemand?: boolean }
): RelationEvalResult {
  const active = bindings.filter(b => b.live !== false || opts?.includeOnDemand);
  // Entity -> producing binding, for dependency edges and change scoping.
  const producer = new Map<string, string>();
  for (const b of active) for (const ref of Object.values(b.out)) producer.set(ref, b.id);
  const dependsOn = (b: RelationBinding): string[] => {
    const out: string[] = [];
    for (const w of Object.values(b.in)) {
      if (typeof w !== "string") continue;
      const p = producer.get(w);
      if (p && p !== b.id) out.push(p);
    }
    return [...new Set(out)];
  };
  let scoped = active;
  if (opts?.changedRefs && opts.changedRefs.size > 0) {
    // Dependents-only recompute: bindings reading a changed entity, plus
    // everything downstream of them. Producers upstream of the change keep
    // their outputs, which are already in the store from the last pass.
    const affected = new Set<string>();
    const queue: string[] = [];
    for (const b of active) {
      const readsChanged = Object.values(b.in).some(w => typeof w === "string" && opts.changedRefs!.has(w));
      if (readsChanged) { affected.add(b.id); queue.push(b.id); }
    }
    const downstream = new Map<string, string[]>();
    for (const b of active) for (const d of dependsOn(b)) {
      if (!downstream.has(d)) downstream.set(d, []);
      downstream.get(d)!.push(b.id);
    }
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const nxt of downstream.get(cur) ?? []) {
        if (!affected.has(nxt)) { affected.add(nxt); queue.push(nxt); }
      }
    }
    scoped = active.filter(b => affected.has(b.id));
  }
  const byId = new Map(scoped.map(b => [b.id, b]));
  const items: EvalItem<Record<string, unknown>>[] = scoped.map(b => ({
    id: b.id,
    dependsOn: dependsOn(b).filter(d => byId.has(d)),
    compute: () => {
      const def = getRelationDef(b.def);
      if (!def) throw new DomainError(`unknown relation def "${b.def}"`);
      const inputs: Record<string, unknown> = {};
      if (def.dynamic) {
        for (const [port, w] of Object.entries(b.in)) {
          inputs[port] = typeof w === "string" ? store.get(w) : (w as { const: unknown }).const;
        }
      } else {
        for (const port of def.inputs) {
          const w = b.in[port.name];
          if (w === undefined) inputs[port.name] = port.default;
          else if (typeof w === "string") inputs[port.name] = store.get(w);
          else inputs[port.name] = (w as { const: unknown }).const;
        }
      }
      const outputs = def.evaluate(inputs, { sampleCount: b.sample?.count, params: b.params, bindingId: b.id });
      for (const [port, ref] of Object.entries(b.out)) {
        if (outputs && port in outputs) store.set(ref, outputs[port]);
      }
      return outputs ?? {};
    },
  }));
  const outcome = evaluateItems(items);
  const quarantined = new Map<string, string>();
  for (const [id, f] of outcome.failed) {
    if (f.kind === "cycle") quarantined.set(id, `cycle: ${(outcome.cycleLoop ?? outcome.cyclic).join(" -> ")}`);
    else if (f.kind === "error") quarantined.set(id, f.message);
    else {
      const depReason = quarantined.get(f.dep) ?? outcome.failed.get(f.dep)?.kind ?? "failed";
      quarantined.set(id, `depends on quarantined binding "${f.dep}" (${depReason})`);
    }
  }
  return { evaluated: outcome.order.filter(id => !outcome.failed.has(id)), quarantined };
}

/**
 * Evaluate a plan's bindings over its occupants. Outputs land in the
 * derived layer (occupant data fields, Path guest points); a quarantined
 * binding whose output is a Path guest leaves the guest with empty points
 * and the reason recorded in its state, so renderers can dim it.
 */
export function evaluatePlanRelations(
  occupants: Occupant[],
  bindings: RelationBinding[],
  opts?: { changedRefs?: Set<string>; includeOnDemand?: boolean }
): { occupants: Occupant[]; evaluated: string[]; quarantined: Map<string, string> } {
  if (bindings.length === 0) return { occupants, evaluated: [], quarantined: new Map() };
  const { store, occupants: read, setGuestQuarantine } = occupantStore(occupants);
  const result = evaluateRelations(bindings, store, opts);
  for (const b of bindings) {
    const reason = result.quarantined.get(b.id);
    for (const ref of Object.values(b.out)) {
      const p = parseEntityRef(ref);
      if (p?.kind === "guestPoints") setGuestQuarantine(p.occId, reason ?? null);
    }
  }
  return { occupants: read(), evaluated: result.evaluated, quarantined: result.quarantined };
}

// ---------- Binding validation (loadPlan) ----------

function valueMatchesPort(value: unknown, type: PortType): boolean {
  switch (type) {
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "boolean": return typeof value === "boolean";
    case "string": return typeof value === "string";
    case "point": {
      const p = value as { x?: unknown; y?: unknown } | null;
      return !!p && typeof p === "object" && typeof p.x === "number" && typeof p.y === "number";
    }
    case "points": return Array.isArray(value) && value.every(v => valueMatchesPort(v, "point"));
    case "range": return !!value && typeof value === "object";
    case "bbox": {
      const b = value as Partial<RelationBBox> | null;
      return !!b && typeof b === "object" && ["minX", "minY", "maxX", "maxY"].every(k => typeof (b as any)[k] === "number");
    }
  }
}

/**
 * Validate plan bindings against the registered defs and the plan's final
 * occupant ids. Every problem is an actionable message; callers reject the
 * whole plan when the list is non-empty (never a partial apply).
 */
export function validateRelationBindings(raw: unknown, occupantIds: Set<string>): string[] {
  const errors: string[] = [];
  if (!Array.isArray(raw)) return ["plan.relations must be an array of bindings"];
  const seenIds = new Set<string>();
  raw.forEach((b: any, i: number) => {
    const at = `relations[${i}]`;
    if (!b || typeof b !== "object") { errors.push(`${at} must be an object`); return; }
    if (typeof b.id !== "string" || !b.id) errors.push(`${at} needs a string id`);
    else if (seenIds.has(b.id)) errors.push(`${at} duplicates binding id "${b.id}"`);
    else seenIds.add(b.id);
    if (typeof b.def !== "string" || !b.def) { errors.push(`${at} needs a def id`); return; }
    const def = getRelationDef(b.def);
    if (!def) {
      errors.push(`${at} references unknown relation def "${b.def}" (registered: ${listRelationDefs().map(d => d.id).join(", ") || "none"})`);
      return;
    }
    const inRec = b.in ?? {};
    const outRec = b.out ?? {};
    if (typeof inRec !== "object" || Array.isArray(inRec)) errors.push(`${at}.in must be an object mapping ports to entity refs`);
    if (typeof outRec !== "object" || Array.isArray(outRec)) errors.push(`${at}.out must be an object mapping ports to entity refs`);
    const checkRef = (ref: unknown, where: string, writable: boolean): void => {
      if (typeof ref !== "string") { errors.push(`${where} must be an entity ref string`); return; }
      const p = parseEntityRef(ref);
      if (!p) { errors.push(`${where} "${ref}" is not a valid entity ref (expected <occId>.data.<field>, <occId>.guest.points, <occId>.guest.state.<field> or <occId>.anchor)`); return; }
      if (!occupantIds.has(p.occId)) errors.push(`${where} "${ref}" targets unknown occupant "${p.occId}"`);
      if (writable && p.kind === "anchor") errors.push(`${where} "${ref}" is read-only (anchor) and cannot be an output`);
    };
    if (!def.dynamic) {
      const inPorts = new Map(def.inputs.map(p => [p.name, p]));
      const outPorts = new Map(def.outputs.map(p => [p.name, p]));
      for (const [port, w] of Object.entries(inRec)) {
        const pd = inPorts.get(port);
        if (!pd) { errors.push(`${at}.in names unknown input port "${port}" for def "${def.id}"`); continue; }
        if (typeof w === "string") {
          checkRef(w, `${at}.in.${port}`, false);
          const p = parseEntityRef(w);
          if (p?.kind === "guestPoints" && pd.type !== "points") errors.push(`${at}.in.${port} wires a points entity to a ${pd.type} port`);
        } else if (w && typeof w === "object" && "const" in (w as any)) {
          if (!valueMatchesPort((w as { const: unknown }).const, pd.type)) {
            errors.push(`${at}.in.${port} const value does not match port type ${pd.type}`);
          }
        } else {
          errors.push(`${at}.in.${port} must be an entity ref or { const: value }`);
        }
      }
      for (const port of def.inputs) {
        if (port.default === undefined && !(port.name in inRec)) {
          errors.push(`${at} leaves required input port "${port.name}" of def "${def.id}" unwired`);
        }
      }
      for (const [port, ref] of Object.entries(outRec)) {
        const pd = outPorts.get(port);
        if (!pd) { errors.push(`${at}.out names unknown output port "${port}" for def "${def.id}"`); continue; }
        checkRef(ref, `${at}.out.${port}`, true);
        const p = parseEntityRef(ref as string);
        if (p?.kind === "guestPoints" && pd.type !== "points") errors.push(`${at}.out.${port} wires a ${pd.type} output to a points entity`);
      }
    } else {
      for (const [port, w] of Object.entries(inRec)) {
        if (typeof w === "string") checkRef(w, `${at}.in.${port}`, false);
        else if (!(w && typeof w === "object" && "const" in (w as any))) errors.push(`${at}.in.${port} must be an entity ref or { const: value }`);
      }
      for (const [port, ref] of Object.entries(outRec)) checkRef(ref, `${at}.out.${port}`, true);
    }
    if (b.sample !== undefined && (typeof b.sample !== "object" || typeof b.sample?.count !== "number" || !(b.sample.count > 0))) {
      errors.push(`${at}.sample.count must be a positive number`);
    }
  });
  return errors;
}
