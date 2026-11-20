// Operations verification (README §8.7): the seven verbs over the two
// implemented bindings — Tree (disjoint TreeState; the text reading:
// folder = section, file = paragraph, label = text) and Graph (kernel
// state) — the four rule slots, edit scripts as Paths (apply, compare,
// merge, invert), and the reconciliation with the tree vocabulary:
// the same scenarios run through morphs/tree2.ts and through the
// operations binding must land on equal states. Bare node asserts, one
// summary line — same idiom as verify-relations.ts.
import assert from "node:assert/strict";
import {
  applyOperation,
  applyScript,
  applyScriptWithInverse,
  compare,
  merge,
  treeOperations,
  graphOperations,
  type Operation,
  type RuleBindings,
  type TreeState,
  type Graph,
} from "../src/framework";
import { treeRegistry } from "../src/framework/morphs/tree2";

let checks = 0;
const ok = (cond: unknown, msg: string) => { checks++; assert.ok(cond, msg); };
const eq = (a: unknown, b: unknown, msg: string) => { checks++; assert.deepEqual(a, b, msg); };

const noBindings: RuleBindings<TreeState> = {};
const noGraphBindings: RuleBindings<Graph> = {};
const noFns = {};

/* ---------------- Tree binding: a small document ---------------- */

const doc: TreeState = {
  nodes: [
    { id: "doc", kind: "folder", parent: null, label: "Document" },
    { id: "s1", kind: "folder", parent: "doc", label: "Section one" },
    { id: "p1", kind: "file", parent: "s1", label: "Hello." },
    { id: "p2", kind: "file", parent: "s1", label: "World." },
  ],
};

// Insert a sentence at the head of the section.
let r = applyOperation(treeOperations, noBindings, noFns, doc, {
  verb: "insert",
  position: { parent: "s1", index: 0 },
  content: { id: "p0", kind: "file", label: "First." },
});
ok(r.ok, "insert sentence applies");
if (r.ok) {
  eq(r.state.nodes.map(n => n.id), ["doc", "s1", "p0", "p1", "p2"], "insert lands at the sibling index");
}

// Replace a word (the paragraph's text), identity and position unchanged.
r = applyOperation(treeOperations, noBindings, noFns, doc, {
  verb: "replace", target: "p1", content: { id: "p1", kind: "file", label: "Hello again." },
});
ok(r.ok && r.state.nodes.find(n => n.id === "p1")?.label === "Hello again.", "replace swaps content in place");

// Move: reorder paragraphs.
r = applyOperation(treeOperations, noBindings, noFns, doc, {
  verb: "move", target: "p2", position: { parent: "s1", index: 0 },
});
ok(r.ok, "move applies");
if (r.ok) eq(r.state.nodes.map(n => n.id), ["doc", "s1", "p2", "p1"], "move reorders siblings");

// Delete with the default fallout (refuse) declines a section with children…
r = applyOperation(treeOperations, noBindings, noFns, doc, { verb: "delete", target: "s1" });
ok(!r.ok && r.errors.join(" ").includes("children"), "delete of a section with children is refused by default");
// …with cascade bound, the subtree goes…
r = applyOperation(treeOperations, { fallout: "cascade" }, noFns, doc, { verb: "delete", target: "s1" });
ok(r.ok && r.state.nodes.length === 1, "cascade delete removes the subtree");
// …and with promote bound, the paragraphs move up to the document.
r = applyOperation(treeOperations, { fallout: "promote" }, noFns, doc, { verb: "delete", target: "s1" });
ok(r.ok && r.state.nodes.every(n => n.parent !== "s1") && r.state.nodes.length === 3, "promote delete lifts children to the parent");

// The substrate declines what its own parameters forbid: a cycle.
r = applyOperation(treeOperations, noBindings, noFns, doc, {
  verb: "move", target: "s1", position: { parent: "p1", index: 0 },
});
ok(!r.ok, "move under a file / into a cycle is declined by the substrate checks");

// Admissibility slot: a consumer rule — p1 is locked.
const locked: RuleBindings<TreeState> = {
  admissible: (_s, op) => (op.target === "p1" ? [`"p1" is locked`] : []),
};
r = applyOperation(treeOperations, locked, noFns, doc, { verb: "delete", target: "p1" });
ok(!r.ok && r.errors.join(" ").includes("locked"), "admissibility binding refuses the locked paragraph");
r = applyOperation(treeOperations, locked, noFns, doc, { verb: "delete", target: "p2" });
ok(r.ok, "the same binding lets other deletes through");

// Effect slot: notes are collected, the state still applies.
const priced: RuleBindings<TreeState> = { effect: (_b, op) => [`did:${op.verb}`] };
r = applyOperation(treeOperations, priced, noFns, doc, { verb: "delete", target: "p2" });
ok(r.ok && r.effectNotes.join() === "did:delete", "effect slot notes ride the result");

// Transform: a named function over one target, and over the region (all).
const shout = { shout: (c: unknown) => ({ ...(c as object), label: (c as { label: string }).label.toUpperCase() }) };
r = applyOperation(treeOperations, noBindings, shout, doc, { verb: "transform", target: "p1", fn: "shout" });
ok(r.ok && r.state.nodes.find(n => n.id === "p1")?.label === "HELLO.", "transform applies the named fn to the target");
r = applyOperation(treeOperations, noBindings, shout, doc, { verb: "transform", fn: "nope" });
ok(!r.ok, "an unknown transform fn is refused, never improvised");

/* ---------------- Scripts: apply, compare, merge, invert ---------------- */

const docB: TreeState = {
  nodes: [
    { id: "doc", kind: "folder", parent: null, label: "Document" },
    { id: "s1", kind: "folder", parent: "doc", label: "Section one" },
    { id: "p2", kind: "file", parent: "s1", label: "World!" },
    { id: "p3", kind: "file", parent: "s1", label: "New." },
  ],
};
const script = compare(treeOperations, noBindings, doc, docB);
ok(script.length >= 3, "compare produces a script (insert p3, replace p2, delete p1)");
const applied = applyScript(treeOperations, noBindings, noFns, doc, script);
ok(applied.ok, "the compared script applies");
if (applied.ok) {
  eq(
    [...applied.state.nodes].sort((x, y) => x.id.localeCompare(y.id)),
    [...docB.nodes].sort((x, y) => x.id.localeCompare(y.id)),
    "applying compare(a, b) to a lands on b"
  );
}

// A script that fails mid-way applies nothing.
const bad = applyScript(treeOperations, noBindings, noFns, doc, [
  { verb: "delete", target: "p2" },
  { verb: "delete", target: "s1" }, // refused: p1 still inside
]);
ok(!bad.ok, "a failing script returns errors");
eq(doc.nodes.length, 4, "the input state stands untouched after a failed script");

// Merge is compare + apply, with the script beside the result.
const merged = merge(treeOperations, noBindings, noFns, doc, docB);
ok(merged.ok && !!merged.script, "merge returns its script for inspection");

// Inverse: a script and its captured inverse round-trip.
const withInv = applyScriptWithInverse(treeOperations, noBindings, noFns, doc, [
  { verb: "insert", position: { parent: "s1" }, content: { id: "px", kind: "file", label: "Temp." } },
  { verb: "replace", target: "p1", content: { id: "p1", kind: "file", label: "Changed." } },
]);
ok(withInv.ok && !!withInv.inverse, "inverse script is captured");
if (withInv.ok && withInv.inverse) {
  const back = applyScript(treeOperations, noBindings, noFns, withInv.state, withInv.inverse);
  ok(back.ok, "inverse applies");
  if (back.ok) eq(back.state, doc, "script + inverse round-trips to the original state");
}

/* ---------------- Reconciliation with the tree vocabulary ---------------- */

// The same three scenarios through tree2 morphs and through operations
// must land on equal states (sorted by id — array order is the morph
// chain's business, state equality is the claim).
const sortNodes = (s: TreeState) => [...s.nodes].sort((x, y) => x.id.localeCompare(y.id));
const viaMorphs = treeRegistry.replayMorphsChecked({ nodes: [] }, [
  { name: "tree.addNode", params: { node: { id: "doc", kind: "folder", parent: null, label: "Document" } } },
  { name: "tree.addNode", params: { node: { id: "s1", kind: "folder", parent: "doc", label: "Section one" } } },
  { name: "tree.addNode", params: { node: { id: "p1", kind: "file", parent: "s1", label: "Hello." } } },
  { name: "tree.reparent", params: { id: "p1", parent: "doc" } },
], {}, (s: TreeState) => ({ nodes: s.nodes.map(n => ({ ...n })) }));
const viaOps = applyScript(treeOperations, noBindings, noFns, { nodes: [] }, [
  { verb: "insert", position: { parent: null }, content: { id: "doc", kind: "folder", label: "Document" } },
  { verb: "insert", position: { parent: "doc" }, content: { id: "s1", kind: "folder", label: "Section one" } },
  { verb: "insert", position: { parent: "s1" }, content: { id: "p1", kind: "file", label: "Hello." } },
  { verb: "move", target: "p1", position: { parent: "doc" } },
]);
ok(viaMorphs.ok && viaOps.ok, "both paths apply");
if (viaMorphs.ok && viaOps.ok) {
  eq(sortNodes(viaOps.state), sortNodes(viaMorphs.state), "tree morphs and tree operations land on equal states");
}
// And the shared refusal: removing a node with children fails in both.
const morphRefusal = treeRegistry.checkMorphState("tree.removeNode", doc, { id: "s1" });
ok(morphRefusal.length > 0, "tree.removeNode refuses a node with children");
const opRefusal = applyOperation(treeOperations, noBindings, noFns, doc, { verb: "delete", target: "s1" });
ok(!opRefusal.ok && opRefusal.errors.join(" ") === morphRefusal.map(e => e.replace("tree.removeNode: ", "")).join(" "),
  "delete-with-refuse states the same refusal as tree.removeNode");

/* ---------------- Graph binding: a small knowledge graph ---------------- */

const g: Graph = {
  nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
  edges: [{ id: "e1", from: "a", to: "b", label: "knows" }],
};
let gr = applyOperation(graphOperations, noGraphBindings, noFns, g, {
  verb: "insert", position: { from: "b", to: "c" }, content: { id: "e2", label: "likes" },
});
ok(gr.ok && gr.state.edges.length === 2, "insert adds an edge between present nodes");
gr = applyOperation(graphOperations, noGraphBindings, noFns, g, {
  verb: "insert", position: { from: "b", to: "zz" }, content: { id: "e9" },
});
ok(!gr.ok, "an edge to a missing node is declined");
// Move rewires an edge; a node itself declines Move (no position in a graph).
gr = applyOperation(graphOperations, noGraphBindings, noFns, g, {
  verb: "move", target: "e1", position: { from: "c", to: "b" },
});
ok(gr.ok && gr.state.edges[0].from === "c", "move rewires the edge");
gr = applyOperation(graphOperations, noGraphBindings, noFns, g, {
  verb: "move", target: "a", position: { from: "a", to: "b" },
});
ok(!gr.ok && gr.errors.join(" ").includes("no position"), "move of a node is declined by the substrate");
// Delete: refuse while wired; detach (the default) takes the edges with it.
gr = applyOperation(graphOperations, { fallout: "refuse" }, noFns, g, { verb: "delete", target: "b" });
ok(!gr.ok, "delete of a wired node is refused under fallout=refuse");
gr = applyOperation(graphOperations, noGraphBindings, noFns, g, { verb: "delete", target: "b" });
ok(gr.ok && gr.state.nodes.length === 2 && gr.state.edges.length === 0, "detach delete removes incident edges");
// Compare/merge over graphs.
const gB: Graph = {
  nodes: [{ id: "a" }, { id: "b" }, { id: "d" }],
  edges: [{ id: "e1", from: "a", to: "b", label: "knows" }, { id: "e3", from: "b", to: "d" }],
};
const gMerged = merge(graphOperations, noGraphBindings, noFns, g, gB);
ok(gMerged.ok, "graph merge applies");
if (gMerged.ok) {
  eq([...gMerged.state.nodes].map(n => n.id).sort(), ["a", "b", "d"], "merge unions the nodes by identity");
  eq(gMerged.state.edges.length, 2, "merge carries the incoming edge and keeps the shared one");
}

/* ---------------- O3: the catalogue ---------------- */

import { readFileSync } from "node:fs";
import { createOperationSetRegistry, validateOperationSet } from "../src/framework";

const catalogue = createOperationSetRegistry();
for (const file of ["text-editing.json", "graph-surgery.json"]) {
  const data = JSON.parse(readFileSync(`operation-sets/${file}`, "utf8")); // cwd: the repo root, as npm runs it
  const res = catalogue.register(data);
  ok(res.ok, `catalogue loads ${file} as plan data`);
}
eq(catalogue.list().map(s => s.id), ["text-editing", "graph-surgery"], "both built-in sets are registered");
eq(catalogue.resolveVerb("text-editing", "move-paragraph"), "move", "a vocabulary name resolves to its one core verb");
eq(catalogue.resolveVerb("graph-surgery", "rewire-relation"), "move", "graph vocabulary resolves too");
eq(catalogue.resolveVerb("text-editing", "fly-to-moon"), undefined, "an unlisted name resolves to nothing");
// An unknown verb is refused with the available verbs listed — the
// catalogue indexes the definitions, it does not improvise new ones.
const badSet = validateOperationSet({
  id: "bad", name: "Bad", substrate: "tree", describe: "x",
  vocabulary: [{ name: "teleport", verb: "teleport", describe: "not a verb" }],
});
ok(!badSet.ok && badSet.errors.join(" ").includes("insert"), "an unknown verb is refused, available verbs listed");
// Duplicate registration is refused whole.
const dup = catalogue.register(JSON.parse(readFileSync("operation-sets/text-editing.json", "utf8")));
ok(!dup.ok, "re-registering a set id is refused");
// The set's own bindings drive the engine: text-editing binds fallout
// refuse, so its section delete is refused exactly as the set states.
const textSet = catalogue.get("text-editing")!;
const viaSet = applyOperation(treeOperations, { fallout: textSet.bindings.fallout }, noFns, doc, { verb: "delete", target: "s1" });
ok(!viaSet.ok, "the text-editing set's fallout binding governs its deletes");

console.log(`verify:operations — ${checks} checks passed`);
