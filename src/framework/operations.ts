// ---------- Operations: the content-level verbs (README §8.7) ----------
// Morphs construct components; composition operators combine structures;
// operations change the content a structure holds. The seven verbs are
// defined once here, generic over a substrate adapter. Everything
// data-specific is a binding in a named rule slot (identity, admissibility,
// relational fallout, effect) — the general layer holds no domain content.
// An edit script is a Path of operation records: ordered, replayable,
// inspectable, and never partially applied (the plan rule: a script that
// fails a step returns its errors and leaves the input state untouched).
// Bindings for concrete substrates live beside their states:
// operations-tree.ts (TreeState) and operations-graph.ts (graph kernel).

export type Verb = "insert" | "delete" | "replace" | "move" | "transform" | "compare" | "merge";

/** The verbs that appear inside an edit script. Compare and Merge are
 *  whole-structure operations (functions below), never script steps. */
export type ScriptVerb = "insert" | "delete" | "replace" | "move" | "transform";

export type Operation = {
  verb: ScriptVerb;
  /** The element the verb acts on, by the substrate's identity (a node id,
   *  an edge id). Absent for Insert, and for a region-wide Transform. */
  target?: string;
  /** Substrate-shaped position: a parent + sibling index for a tree, a
   *  { from, to } rewiring for a graph edge. Meaningless positions are
   *  declined by the substrate's own checks, not by domain rules. */
  position?: unknown;
  /** The content carried by Insert / Replace. Its shape is the substrate's. */
  content?: unknown;
  /** For Transform: the name of a registered function. Functions are
   *  supplied by the caller (the TransformFns map), never carried as code
   *  inside a script — the §8.4 rule for Relations, applied to scripts. */
  fn?: string;
};

/** An edit script: a Path of operation records (§8.7). */
export type EditScript = Operation[];

/** What Delete does to what the target held or linked. Interpreted per
 *  substrate; each adapter states which policies it supports and declines
 *  the rest rather than improvising. */
export type FalloutPolicy = "refuse" | "cascade" | "promote" | "detach";

export type RuleBindings<S> = {
  /** What counts as the same element across two states, for Compare.
   *  Default: the ref itself. (The Luoshu warning of §8.7: identity can
   *  itself be a parameter — arrangements under symmetry bind this.) */
  identity?: (state: S, ref: string) => string;
  /** May this verb run here, on this element, now? Return errors to refuse. */
  admissible?: (state: S, op: Operation) => string[];
  /** Delete's relational fallout. Default: the adapter's stated default. */
  fallout?: FalloutPolicy;
  /** What the operation changes downstream. Runs after a successful apply;
   *  its returned notes are collected on the result (a consumer may price,
   *  record or veto-by-throwing here — the slot is the consumer's). */
  effect?: (before: S, op: Operation, after: S) => string[];
};

/** Transform functions by name: content in, content out. */
export type TransformFns = Record<string, (content: unknown, op: Operation) => unknown>;

export interface SubstrateAdapter<S> {
  /** The concept this binding serves ("tree", "graph", ...). */
  name: string;
  /** Delete fallout this substrate applies when no binding overrides it. */
  defaultFallout: FalloutPolicy;
  /** Every element ref in the state, in the substrate's canonical order. */
  refs(state: S): string[];
  /** A snapshot of one element's content (for capture, inverse, Compare). */
  content(state: S, ref: string): unknown;
  /** A snapshot of one element's position (for Move capture and Compare). */
  position(state: S, ref: string): unknown;
  /** The ref a piece of content will carry once inserted. */
  refOfContent(content: unknown): string;
  checkInsert(state: S, position: unknown, content: unknown): string[];
  insert(state: S, position: unknown, content: unknown): S;
  checkDelete(state: S, ref: string, fallout: FalloutPolicy): string[];
  remove(state: S, ref: string, fallout: FalloutPolicy): S;
  checkReplace(state: S, ref: string, content: unknown): string[];
  replace(state: S, ref: string, content: unknown): S;
  checkMove(state: S, ref: string, position: unknown): string[];
  move(state: S, ref: string, position: unknown): S;
  equalContent(a: unknown, b: unknown): boolean;
  equalPosition(a: unknown, b: unknown): boolean;
}

export type ApplyResult<S> =
  | { ok: true; state: S; effectNotes: string[] }
  | { ok: false; errors: string[] };

/** The checks one operation must pass before it applies: the binding's
 *  admissibility slot first (the consumer's rules), then the substrate's
 *  own checks (its parameters — an unordered substrate declines Move here,
 *  with no domain rule involved). */
export function checkOperation<S>(
  adapter: SubstrateAdapter<S>,
  bindings: RuleBindings<S>,
  state: S,
  op: Operation
): string[] {
  const errors: string[] = [];
  if (bindings.admissible) errors.push(...bindings.admissible(state, op));
  const fallout = bindings.fallout ?? adapter.defaultFallout;
  switch (op.verb) {
    case "insert":
      errors.push(...adapter.checkInsert(state, op.position, op.content));
      break;
    case "delete":
      if (op.target === undefined) errors.push("delete needs a target");
      else errors.push(...adapter.checkDelete(state, op.target, fallout));
      break;
    case "replace":
      if (op.target === undefined) errors.push("replace needs a target");
      else errors.push(...adapter.checkReplace(state, op.target, op.content));
      break;
    case "move":
      if (op.target === undefined) errors.push("move needs a target");
      else errors.push(...adapter.checkMove(state, op.target, op.position));
      break;
    case "transform":
      if (!op.fn) errors.push("transform needs an fn name");
      if (op.target !== undefined && !adapter.refs(state).includes(op.target)) {
        errors.push(`transform target "${op.target}" is not present`);
      }
      break;
  }
  return errors;
}

function applyUnchecked<S>(
  adapter: SubstrateAdapter<S>,
  bindings: RuleBindings<S>,
  fns: TransformFns,
  state: S,
  op: Operation
): S {
  const fallout = bindings.fallout ?? adapter.defaultFallout;
  switch (op.verb) {
    case "insert":
      return adapter.insert(state, op.position, op.content);
    case "delete":
      return adapter.remove(state, op.target!, fallout);
    case "replace":
      return adapter.replace(state, op.target!, op.content);
    case "move":
      return adapter.move(state, op.target!, op.position);
    case "transform": {
      const fn = fns[op.fn!];
      if (!fn) throw new Error(`unknown transform fn "${op.fn}"`);
      const targets = op.target !== undefined ? [op.target] : adapter.refs(state);
      let next = state;
      for (const ref of targets) {
        next = adapter.replace(next, ref, fn(adapter.content(next, ref), op));
      }
      return next;
    }
  }
}

/** Apply one operation, checked. On refusal the input state is returned
 *  nowhere — the result is the errors, and the caller's state stands. */
export function applyOperation<S>(
  adapter: SubstrateAdapter<S>,
  bindings: RuleBindings<S>,
  fns: TransformFns,
  state: S,
  op: Operation
): ApplyResult<S> {
  const errors = checkOperation(adapter, bindings, state, op);
  if (errors.length > 0) return { ok: false, errors };
  if (op.verb === "transform" && !fns[op.fn!]) {
    return { ok: false, errors: [`unknown transform fn "${op.fn}"`] };
  }
  const next = applyUnchecked(adapter, bindings, fns, state, op);
  const effectNotes = bindings.effect ? bindings.effect(state, op, next) : [];
  return { ok: true, state: next, effectNotes };
}

/** Apply an edit script in order. Never partially applied: the first
 *  failing step ends the script with its errors, and the state the
 *  caller passed in is the state they still hold. */
export function applyScript<S>(
  adapter: SubstrateAdapter<S>,
  bindings: RuleBindings<S>,
  fns: TransformFns,
  state: S,
  script: EditScript
): ApplyResult<S> {
  let current = state;
  const effectNotes: string[] = [];
  for (let i = 0; i < script.length; i++) {
    const res = applyOperation(adapter, bindings, fns, current, script[i]);
    if (!res.ok) return { ok: false, errors: res.errors.map(e => `script[${i}] (${script[i].verb}): ${e}`) };
    current = res.state;
    effectNotes.push(...res.effectNotes);
  }
  return { ok: true, state: current, effectNotes };
}

/** The inverse of one operation against the state it is about to change,
 *  or null where the substrate cannot invert it (a region-wide Transform).
 *  Per §8.7's history rule: authored operations are recorded as scripts
 *  and invert where the substrate allows. */
export function captureInverse<S>(adapter: SubstrateAdapter<S>, state: S, op: Operation): Operation | null {
  switch (op.verb) {
    case "insert":
      return { verb: "delete", target: adapter.refOfContent(op.content) };
    case "delete":
      if (op.target === undefined) return null;
      return { verb: "insert", position: adapter.position(state, op.target), content: adapter.content(state, op.target) };
    case "replace":
      if (op.target === undefined) return null;
      return { verb: "replace", target: op.target, content: adapter.content(state, op.target) };
    case "move":
      if (op.target === undefined) return null;
      return { verb: "move", target: op.target, position: adapter.position(state, op.target) };
    case "transform":
      if (op.target === undefined) return null;
      return { verb: "replace", target: op.target, content: adapter.content(state, op.target) };
  }
}

/** Run a script and return its inverse script (reversed, per-step
 *  inverses captured against the states they changed), so a caller can
 *  keep the pair as history. */
export function applyScriptWithInverse<S>(
  adapter: SubstrateAdapter<S>,
  bindings: RuleBindings<S>,
  fns: TransformFns,
  state: S,
  script: EditScript
): ApplyResult<S> & { inverse?: EditScript } {
  let current = state;
  const effectNotes: string[] = [];
  const inverses: (Operation | null)[] = [];
  for (let i = 0; i < script.length; i++) {
    inverses.push(captureInverse(adapter, current, script[i]));
    const res = applyOperation(adapter, bindings, fns, current, script[i]);
    if (!res.ok) return { ok: false, errors: res.errors.map(e => `script[${i}] (${script[i].verb}): ${e}`) };
    current = res.state;
    effectNotes.push(...res.effectNotes);
  }
  if (inverses.some(inv => inv === null)) return { ok: true, state: current, effectNotes };
  return { ok: true, state: current, effectNotes, inverse: (inverses as Operation[]).reverse() };
}

/** Compare two structures: the edit script that turns `a` into `b`,
 *  element identity decided by the identity slot (default: the ref).
 *  Order is chosen so the script applies cleanly under the substrates'
 *  own checks: inserts first (a parent exists before its children),
 *  then replaces and moves, deletes last in reverse canonical order
 *  (children before their parents). */
export function compare<S>(
  adapter: SubstrateAdapter<S>,
  bindings: RuleBindings<S>,
  a: S,
  b: S
): EditScript {
  const key = (state: S, ref: string) => (bindings.identity ? bindings.identity(state, ref) : ref);
  const aByKey = new Map<string, string>();
  for (const ref of adapter.refs(a)) aByKey.set(key(a, ref), ref);
  const bByKey = new Map<string, string>();
  for (const ref of adapter.refs(b)) bByKey.set(key(b, ref), ref);

  const inserts: Operation[] = [];
  const replaces: Operation[] = [];
  const moves: Operation[] = [];
  for (const refB of adapter.refs(b)) {
    const k = key(b, refB);
    const refA = aByKey.get(k);
    if (refA === undefined) {
      inserts.push({ verb: "insert", position: adapter.position(b, refB), content: adapter.content(b, refB) });
      continue;
    }
    if (!adapter.equalContent(adapter.content(a, refA), adapter.content(b, refB))) {
      replaces.push({ verb: "replace", target: refA, content: adapter.content(b, refB) });
    }
    if (!adapter.equalPosition(adapter.position(a, refA), adapter.position(b, refB))) {
      moves.push({ verb: "move", target: refA, position: adapter.position(b, refB) });
    }
  }
  const deletes: Operation[] = [];
  for (const refA of [...adapter.refs(a)].reverse()) {
    if (!bByKey.has(key(a, refA))) deletes.push({ verb: "delete", target: refA });
  }
  return [...inserts, ...replaces, ...moves, ...deletes];
}

/** Merge: Compare `incoming` against `base` and apply the resulting
 *  script under the caller's bindings — the admissibility and fallout
 *  slots are the resolution policy. Returns the script beside the new
 *  state, so what merged is inspectable, not just its result. */
export function merge<S>(
  adapter: SubstrateAdapter<S>,
  bindings: RuleBindings<S>,
  fns: TransformFns,
  base: S,
  incoming: S
): ApplyResult<S> & { script?: EditScript } {
  const script = compare(adapter, bindings, base, incoming);
  const res = applyScript(adapter, bindings, fns, base, script);
  if (!res.ok) return res;
  return { ...res, script };
}
