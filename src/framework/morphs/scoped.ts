// Scoped morph registries: isolated registration without a global map.
// The Grid contract in `./registry.ts` keeps one shared REGISTRY for
// backwards compatibility. This factory creates an independent registry per
// call so two vocabularies can register the same morph name without
// colliding, and unknown-morph errors list only the in-scope vocabulary.
// Generic over the state type S, so a disjoint TreeState can run the same
// validate/check/apply/invert/replay contract without Grid fields.
export type ScopedMorphDef<S, P = unknown> = {
  name: string;
  describe: string;
  invertible: boolean;
  validate: (params: P, ctx?: unknown) => string[];
  check?: (state: S, params: P, ctx?: unknown) => string[];
  capture?: (state: S, params: P) => unknown;
  apply: (state: S, params: P) => S;
  invert: (state: S, params: P, undoCtx: unknown) => S;
};

export type ScopedAppliedMorph<P = unknown> = {
  name: string;
  params: P;
  inverse?: unknown;
};

export function createMorphRegistry<S>() {
  const defs = new Map<string, ScopedMorphDef<S, any>>();

  function register<P>(def: ScopedMorphDef<S, P>): void {
    if (defs.has(def.name)) throw new Error(`Morph "${def.name}" already registered in this scope`);
    defs.set(def.name, def as ScopedMorphDef<S, any>);
  }

  function get(name: string): ScopedMorphDef<S, any> | undefined {
    return defs.get(name);
  }

  function list(): ScopedMorphDef<S, any>[] {
    return [...defs.values()];
  }

  function describeChain(chain: ScopedAppliedMorph[]): string[] {
    return chain.map((m, i) => {
      const def = defs.get(m.name);
      return `${i + 1}. ${def ? def.describe : m.name} ${JSON.stringify(m.params)}`;
    });
  }

  function validateChain(chain: unknown, ctx: unknown = {}): string[] {
    if (!Array.isArray(chain)) return ["plan.morphs must be an array"];
    const errors: string[] = [];
    chain.forEach((m: any, i: number) => {
      if (!m || typeof m.name !== "string") {
        errors.push(`morphs[${i}] missing name`);
        return;
      }
      const def = defs.get(m.name);
      if (!def) {
        errors.push(
          `morphs[${i}] unknown morph "${m.name}" (available: ${[...defs.keys()].join(", ") || "none"})`
        );
        return;
      }
      for (const e of def.validate(m.params, ctx)) errors.push(`morphs[${i}] (${m.name}): ${e}`);
    });
    return errors;
  }

  function applyMorph(
    state: S,
    applied: ScopedAppliedMorph,
    ctx: unknown = {}
  ): { ok: true; state: S } | { ok: false; errors: string[] } {
    const def = defs.get(applied.name);
    if (!def) {
      return {
        ok: false,
        errors: [`unknown morph "${applied.name}" (available: ${[...defs.keys()].join(", ") || "none"})`],
      };
    }
    const errs = def.validate(applied.params, ctx);
    if (errs.length > 0) return { ok: false, errors: errs };
    return { ok: true, state: def.apply(state, applied.params) };
  }

  function checkMorphState(name: string, state: S, params: unknown, ctx: unknown = {}): string[] {
    const def = defs.get(name);
    if (!def) {
      return [`unknown morph "${name}" (available: ${[...defs.keys()].join(", ") || "none"})`];
    }
    const errors = def.validate(params, ctx).map(e => `${name}: ${e}`);
    if (errors.length > 0) return errors;
    if (def.check) {
      for (const e of def.check(state, params, ctx)) errors.push(`${name}: ${e}`);
    }
    return errors;
  }

  function replayMorphs(
    base: S,
    chain: ScopedAppliedMorph[],
    ctx: unknown = {},
    clone: (s: S) => S
  ): { ok: true; state: S } | { ok: false; errors: string[] } {
    let state = clone(base);
    for (let i = 0; i < chain.length; i++) {
      const res = applyMorph(state, chain[i], ctx);
      if (!res.ok) return { ok: false, errors: res.errors.map(e => `morphs[${i}]: ${e}`) };
      state = res.state;
    }
    return { ok: true, state };
  }

  function replayMorphsChecked(
    base: S,
    chain: ScopedAppliedMorph[],
    ctx: unknown = {},
    clone: (s: S) => S
  ): { ok: true; state: S } | { ok: false; errors: string[] } {
    let state = clone(base);
    for (let i = 0; i < chain.length; i++) {
      const stepErrors = checkMorphState(chain[i].name, state, chain[i].params, ctx);
      if (stepErrors.length > 0) {
        return { ok: false, errors: stepErrors.map(e => `morphs[${i}]: ${e}`) };
      }
      const def = defs.get(chain[i].name);
      if (!def) return { ok: false, errors: [`morphs[${i}]: unknown morph "${chain[i].name}"`] };
      state = def.apply(state, chain[i].params);
    }
    return { ok: true, state };
  }

  function invertMorph(state: S, applied: ScopedAppliedMorph): S | null {
    const def = defs.get(applied.name);
    if (!def || !def.invertible) return null;
    try {
      return def.invert(state, applied.params, applied.inverse);
    } catch {
      return null;
    }
  }

  function recaptureFrames(base: S, chain: ScopedAppliedMorph[], clone: (s: S) => S): ScopedAppliedMorph[] {
    let state = clone(base);
    return chain.map(m => {
      const def = defs.get(m.name);
      let inverse: unknown = undefined;
      if (def?.capture) {
        try {
          inverse = def.capture(state, m.params);
        } catch {
          inverse = undefined;
        }
      } else if (!def) {
        inverse = m.inverse;
      }
      if (def) {
        try {
          state = def.apply(state, m.params);
        } catch {
          // Leave state as-is; checked replay reports the failure.
        }
      }
      return { ...m, inverse };
    });
  }

  return {
    register,
    get,
    list,
    describeChain,
    validateChain,
    applyMorph,
    checkMorphState,
    replayMorphs,
    replayMorphsChecked,
    invertMorph,
    recaptureFrames,
  };
}

export type MorphRegistry<S> = ReturnType<typeof createMorphRegistry<S>>;
