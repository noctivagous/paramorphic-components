// ---------- Operations catalogue: named operation sets (README §8.7) ----------
// An operation set is a named bundle a plan can select and attach: a
// substrate, its rule-slot bindings, and vocabulary names expressed over
// the seven verbs. The catalogue indexes the verb definitions of
// operations.ts and binds them — it never re-defines a verb, so the
// chapter (§8.7) and the catalogue cannot drift. Sets are plan data:
// they load from plain objects (JSON files under operation-sets/),
// validated on load like every other plan artifact — an unknown verb
// or substrate is refused with the available names listed.
import type { FalloutPolicy, Verb } from "./operations";

export const OPERATION_VERBS: Verb[] = [
  "insert", "delete", "replace", "move", "transform", "compare", "merge",
];

export type OperationSetVocabularyEntry = {
  /** The domain name a plan or a user speaks ("move-paragraph"). */
  name: string;
  /** The one core verb this name expresses. */
  verb: Verb;
  describe: string;
};

export type OperationSet = {
  id: string;
  name: string;
  /** The substrate binding this set runs over ("tree", "graph", ...). */
  substrate: string;
  describe: string;
  /** Slot bindings the set carries; a consumer may add admissibility
   *  and effect bindings in code — those are behaviour, not plan data. */
  bindings: { fallout?: FalloutPolicy };
  vocabulary: OperationSetVocabularyEntry[];
};

const FALLOUTS: FalloutPolicy[] = ["refuse", "cascade", "promote", "detach"];

export function validateOperationSet(file: unknown): { ok: true; set: OperationSet } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!file || typeof file !== "object") return { ok: false, errors: ["operation set must be an object"] };
  const f = file as Partial<OperationSet>;
  if (typeof f.id !== "string" || !f.id) errors.push("set.id must be a non-empty string");
  if (typeof f.name !== "string" || !f.name) errors.push("set.name must be a non-empty string");
  if (typeof f.substrate !== "string" || !f.substrate) errors.push("set.substrate must name a substrate binding");
  if (typeof f.describe !== "string" || !f.describe) errors.push("set.describe must be a non-empty string");
  const bindings = (f.bindings ?? {}) as { fallout?: string };
  if (bindings.fallout !== undefined && !FALLOUTS.includes(bindings.fallout as FalloutPolicy)) {
    errors.push(`set.bindings.fallout must be one of ${FALLOUTS.join(", ")} (got "${bindings.fallout}")`);
  }
  if (!Array.isArray(f.vocabulary) || f.vocabulary.length === 0) {
    errors.push("set.vocabulary must be a non-empty array");
  } else {
    const seen = new Set<string>();
    f.vocabulary.forEach((entry, i) => {
      const e = entry as Partial<OperationSetVocabularyEntry>;
      if (typeof e.name !== "string" || !e.name) errors.push(`vocabulary[${i}] needs a name`);
      else if (seen.has(e.name)) errors.push(`vocabulary[${i}] duplicates the name "${e.name}"`);
      else seen.add(e.name);
      if (typeof e.verb !== "string" || !OPERATION_VERBS.includes(e.verb as Verb)) {
        errors.push(
          `vocabulary[${i}] ("${e.name}") has unknown verb "${e.verb}" (available: ${OPERATION_VERBS.join(", ")})`
        );
      }
      if (typeof e.describe !== "string" || !e.describe) errors.push(`vocabulary[${i}] ("${e.name}") needs a describe`);
    });
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    set: {
      id: f.id!,
      name: f.name!,
      substrate: f.substrate!,
      describe: f.describe!,
      bindings: { ...(bindings.fallout ? { fallout: bindings.fallout as FalloutPolicy } : {}) },
      vocabulary: f.vocabulary!,
    },
  };
}

export function createOperationSetRegistry() {
  const sets = new Map<string, OperationSet>();
  return {
    /** Register a set from plan data. Invalid data is refused whole —
     *  never partially registered. */
    register(file: unknown): { ok: true; set: OperationSet } | { ok: false; errors: string[] } {
      const res = validateOperationSet(file);
      if (!res.ok) return res;
      if (sets.has(res.set.id)) return { ok: false, errors: [`operation set "${res.set.id}" is already registered`] };
      sets.set(res.set.id, res.set);
      return res;
    },
    get(id: string): OperationSet | undefined {
      return sets.get(id);
    },
    list(): OperationSet[] {
      return [...sets.values()];
    },
    /** Resolve a vocabulary name to the core verb it expresses. */
    resolveVerb(setId: string, vocabularyName: string): Verb | undefined {
      return sets.get(setId)?.vocabulary.find(v => v.name === vocabularyName)?.verb;
    },
  };
}

export type OperationSetRegistry = ReturnType<typeof createOperationSetRegistry>;

/** The catalogue: the registry the built-in sets (operation-sets/*.json)
 *  are loaded into by consumers. Registration is explicit — importing
 *  this module defines the catalogue's machinery, and loading the plan
 *  data into it is the consumer's act, as with morph plans. */
export const operationCatalogue: OperationSetRegistry = createOperationSetRegistry();
