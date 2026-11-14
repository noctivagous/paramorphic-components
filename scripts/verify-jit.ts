// JIT verification (J1): the static derivation core against fixture
// DomLike trees constructed in code to mirror known HTML documents — the
// contract a real front-end must satisfy (plan §10, J1 gate). Covers the
// dom mirror's exact shape, the described pruning policy (counts, budgets,
// attribute filtering, text truncation), path-id determinism, the dom.*
// morph vocabulary with checked apply + inverses, kernel/path queries
// over a derived page, and the DOM adapter's structural mapping. Bare
// node asserts, one summary line — same idiom as the other verify gates.
import assert from "node:assert/strict";
import {
  DEFAULT_DOM_POLICY,
  bfsOrder,
  checkDomNodes,
  deriveDomTree,
  domChildIndex,
  domChildren,
  domDocumentOrder,
  domNodeById,
  domRegistry,
  domToGraph,
  domTreesEqual,
  domLikeFromDomNode,
  parseHtmlToDomLike,
  resolveDomPath,
  resolveDomPolicy,
  singleParentViolations,
  validateDomPolicy,
  type DomLikeNode,
  type DomTreeState,
} from "../src/framework";

let checks = 0;
const ok = (cond: unknown, msg: string) => { checks++; assert.ok(cond, msg); };
const eq = (a: unknown, b: unknown, msg: string) => { checks++; assert.deepEqual(a, b, msg); };

// ---------- fixture builders: DomLike trees mirroring known HTML ----------
const el = (tag: string, attrs: Record<string, string> = {}, ...children: DomLikeNode[]): DomLikeNode => ({
  nodeType: 1,
  nodeName: tag.toUpperCase(),
  attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
  childNodes: children,
});
const txt = (s: string): DomLikeNode => ({ nodeType: 3, nodeName: "#text", childNodes: [], data: s });
const cmt = (s: string): DomLikeNode => ({ nodeType: 8, nodeName: "#comment", childNodes: [], data: s });

const mustDerive = (src: DomLikeNode, policy?: Parameters<typeof deriveDomTree>[1]) => {
  const r = deriveDomTree(src, policy);
  assert.ok(r.ok, r.ok ? "" : `derivation failed: ${r.errors.join("; ")}`);
  return r;
};
const tagsOf = (state: DomTreeState, tag: string) => state.nodes.filter(n => n.tag === tag);
const docText = (state: DomTreeState) =>
  domDocumentOrder(state).map(id => domNodeById(state, id)?.tag);

// ---------- fixture 1: a semantic article page ----------
const articlePage = el("html", { lang: "en" },
  el("head", {},
    el("title", {}, txt("JIT Times"))),
  el("body", {},
    el("article", {},
      el("h1", {}, txt("A headline")),
      el("p", {}, txt("First paragraph.")),
      el("p", {},
        txt("Second "),
        el("a", { href: "/x", "data-kind": "internal" }, txt("link"))),
      el("ul", {},
        el("li", {}, txt("one")),
        el("li", {}, txt("two")),
        el("li", {}, txt("three")))),
    el("script", {}, txt("alert(1)")),
    cmt("a comment")));

{
  const { state, report } = mustDerive(articlePage);
  eq(checkDomNodes(state.nodes), [], "article: derived state passes checkDomNodes");
  eq(report.sourceNodes, 24, "article: source node count");
  eq(report.keptNodes, 21, "article: kept node count");
  eq(report.pruned.tag, 2, "article: script subtree (element + its text) pruned by tag");
  eq(report.prunedSubtreeRoots, 1, "article: one pruned subtree root");
  eq(report.commentsDropped, 1, "article: comment dropped");
  eq(report.attributesDropped, 1, "article: lang is outside the default allowlist");
  eq(state.nodes[0].id, "0", "article: root path id");
  eq(state.nodes[0].tag, "html", "article: root is the html element");
  eq(domNodeById(state, "0/0/0")?.tag, "title", "article: path id lands on title");
  eq(domNodeById(state, "0/0/0")?.text, "JIT Times", "article: title carries its summary text");
  eq(domNodeById(state, "0/1/0/0")?.text, "A headline", "article: h1 summary text");
  eq(domNodeById(state, "0/1")?.pruned, 1, "article: body records the pruned script subtree");
  eq(domNodeById(state, "0/1/0/2/1")?.attrs, { href: "/x", "data-kind": "internal" },
    "article: link attrs kept (allowlist + data-* prefix)");
  eq(tagsOf(state, "li").length, 3, "article: three list items");
  eq(docText(state).slice(0, 5), ["html", "head", "title", "#text", "body"],
    "article: document order is pre-order");

  // determinism: same source + policy ⇒ byte-identical mirror
  const again = mustDerive(articlePage);
  eq(JSON.stringify(again.state), JSON.stringify(state), "article: derivation is deterministic");
  eq(domTreesEqual(state, again.state), null, "article: domTreesEqual agrees");

  // traversal smoke: kernel projection + path query over the page
  const graph = domToGraph(state);
  eq(singleParentViolations(graph), [], "article: kernel sees a single-parent tree");
  eq(bfsOrder(graph, "0").length, state.nodes.length, "article: bfsOrder reaches every node");
  eq(resolveDomPath(state, "0/1/0/3")?.tag, "ul", "path query: 0/1/0/3 is the list");
  eq(resolveDomPath(state, "0/1/0/2/1")?.tag, "a", "path query: 0/1/0/2/1 is the link");
  eq(resolveDomPath(state, "0/1/0/2/1")?.id, "0/1/0/2/1", "path query: static id equals the path");
  eq(resolveDomPath(state, "0/9"), null, "path query: out-of-range index resolves to null");
  eq(resolveDomPath(state, "nonsense"), null, "path query: malformed path resolves to null");
}

// ---------- fixture 2: a table page ----------
const tablePage = el("html", {},
  el("body", {},
    el("table", { id: "results" },
      el("thead", {},
        el("tr", {}, el("th", {}, txt("Name")), el("th", {}, txt("Qty")))),
      el("tbody", {},
        el("tr", {}, el("td", {}, txt("Pens")), el("td", {}, txt("3"))),
        el("tr", {}, el("td", {}, txt("Pads")), el("td", {}, txt("5")))))));

{
  const { state } = mustDerive(tablePage);
  eq(checkDomNodes(state.nodes), [], "table: derived state passes checkDomNodes");
  eq(tagsOf(state, "tr").length, 3, "table: three rows");
  eq(tagsOf(state, "td").length, 4, "table: four body cells");
  eq(tagsOf(state, "th").map(n => n.text), ["Name", "Qty"], "table: header cells carry summaries");
  const tbody = tagsOf(state, "tbody")[0];
  const cellsInOrder = domDocumentOrder(state)
    .map(id => domNodeById(state, id)!)
    .filter(n => n.tag === "td")
    .map(n => n.text);
  eq(cellsInOrder, ["Pens", "3", "Pads", "5"], "table: cells read in document order (extraction smoke)");
  eq(domChildren(state, tbody.id).length, 2, "table: tbody has two row children");
  eq(domNodeById(state, domChildren(state, tbody.id)[0].id)?.tag, "tr", "table: child walk lands on rows");
}

// ---------- fixture 3: a form page (attribute filtering) ----------
const formPage = el("html", {},
  el("body", {},
    el("form", { action: "/go", onsubmit: "evil()" },
      el("label", { for: "q" }, txt("Query")),
      el("input", { id: "q", type: "text", name: "q", value: "", onclick: "x()" }),
      el("input", { type: "submit", value: "Go", style: "color: red" }),
      el("select", { name: "s" },
        el("option", { value: "a" }, txt("A")),
        el("option", { value: "b" }, txt("B"))))));

{
  const { state, report } = mustDerive(formPage);
  eq(checkDomNodes(state.nodes), [], "form: derived state passes checkDomNodes");
  const form = tagsOf(state, "form")[0];
  eq(form.attrs, {}, "form: action and onsubmit are both outside the allowlist — handler attrs stay inert data only when allowed, and these are not");
  const textInput = tagsOf(state, "input")[0];
  eq(textInput.attrs, { id: "q", type: "text", name: "q", value: "" },
    "form: input keeps allowlisted attrs, drops onclick");
  const submit = tagsOf(state, "input")[1];
  eq(submit.attrs, { type: "submit", value: "Go" }, "form: style dropped while keepStyleAttribute is off");
  ok(report.attributesDropped >= 4, "form: dropped attributes are counted");
  const styled = mustDerive(formPage, { keepStyleAttribute: true });
  eq(tagsOf(styled.state, "input")[1].attrs.style, "color: red", "form: style kept when the policy flag allows it");
  eq(tagsOf(state, "option").map(n => n.attrs.value), ["a", "b"], "form: option values survive");
}

// ---------- fixture 4: the pathological page (pruning + budgets) ----------
{
  // deep nesting vs maxDepth
  let deep: DomLikeNode = el("span", {}, txt("bottom"));
  for (let i = 0; i < 20; i++) deep = el("div", {}, deep);
  const deepPage = el("html", {}, el("body", {}, deep));
  const dres = mustDerive(deepPage, { maxDepth: 5 });
  ok(dres.state.nodes.every(n => n.id.split("/").length - 1 <= 5), "deep: nothing kept past maxDepth");
  ok(dres.report.pruned.depth > 0, "deep: depth cuts are reported");
  eq(dres.state.nodes.filter(n => n.pruned).length, 1, "deep: exactly one kept node carries a pruned count");
  eq(dres.state.nodes[dres.state.nodes.length - 1].pruned, 1,
    "deep: the cut lands as one pruned subtree on the deepest kept node");

  // huge text vs maxTextLength
  const hugePage = el("html", {}, el("body", {}, el("p", {}, txt("x".repeat(1000)))));
  const hres = mustDerive(hugePage, { maxTextLength: 50 });
  const ptext = hres.state.nodes.find(n => n.tag === "#text");
  eq(ptext?.text?.length, 50, "huge: text truncated to the policy length");
  eq(hres.report.textTruncations, 1, "huge: the truncation is a finding, counted once");

  // svg internals collapse into the svg element
  const svgPage = el("html", {},
    el("body", {},
      el("svg", { viewBox: "0 0 10 10" },
        el("circle", { cx: "5" }),
        el("rect", {}),
        el("g", {}, el("path", {})))));
  const sres = mustDerive(svgPage);
  const svg = tagsOf(sres.state, "svg")[0];
  ok(svg, "svg: the svg element itself is kept");
  eq(svg.pruned, 3, "svg: its three child subtrees are counted on it");
  eq(sres.report.pruned.svg, 4, "svg: all four internal nodes counted as pruned");
  eq(tagsOf(sres.state, "circle").length + tagsOf(sres.state, "path").length, 0, "svg: no internals in the mirror");

  // hidden subtrees (attribute-level signals only, static parse)
  const hiddenPage = el("html", {},
    el("body", {},
      el("div", { hidden: "" }, el("p", {}, txt("secret"))),
      el("div", { style: "display: none" }, el("p", {}, txt("also secret"))),
      el("p", {}, txt("visible"))));
  const hires = mustDerive(hiddenPage);
  eq(hires.report.pruned.hidden, 6, "hidden: both hidden subtrees counted (div + p + text, twice)");
  eq(tagsOf(hires.state, "p").length, 1, "hidden: only the visible paragraph survives");
  eq(domNodeById(hires.state, "0/0")?.pruned, 2, "hidden: body counts both cut subtrees");
  const shown = mustDerive(hiddenPage, { pruneHidden: false });
  eq(tagsOf(shown.state, "p").length, 3, "hidden: policy off keeps every paragraph");

  // node budget: breadth-first survivors
  const wide = el("html", {},
    el("body", {},
      ...Array.from({ length: 10 }, (_, i) =>
        el("section", {}, el("p", {}, txt(`s${i}`)), el("p", {}, txt(`t${i}`))))));
  const wres = mustDerive(wide, { maxNodes: 10 });
  eq(wres.state.nodes.length, 10, "budget: mirror capped at maxNodes");
  eq(wres.report.pruned.budget, wres.report.sourceNodes - 10, "budget: every cut node is counted");
  ok(wres.state.nodes.every(n => n.parent === null || domNodeById(wres.state, n.parent)),
    "budget: survivors are ancestor-closed (no orphans)");
  eq(checkDomNodes(wres.state.nodes), [], "budget: capped state still validates");

  // whitespace-only text is formatting, not content
  const wsPage = el("html", {}, el("body", {}, el("p", {}, txt("   "), txt(" hello "))));
  const wsres = mustDerive(wsPage);
  eq(wsres.report.whitespaceTextDropped, 1, "whitespace: the blank text node is dropped and counted");
  eq(tagsOf(wsres.state, "#text").map(n => n.text), [" hello "], "whitespace: real text is kept verbatim");
}

// ---------- the dom.* vocabulary over a derived mirror ----------
{
  const { state } = mustDerive(articlePage);
  const checked = (s: DomTreeState, name: string, params: unknown) => {
    const errs = domRegistry.checkMorphState(name, s, params);
    assert.deepEqual(errs, [], `${name} should check clean: ${errs.join("; ")}`);
    const applied = domRegistry.replayMorphsChecked(s, [{ name, params }], {}, (x: DomTreeState) => structuredClone(x));
    assert.ok(applied.ok, applied.ok ? "" : `${name} replay failed`);
    return applied.ok ? applied.state : s;
  };

  // setText on the headline's text node, then invert back
  const h1TextId = "0/1/0/0/0";
  const edited = checked(state, "dom.setText", { id: h1TextId, text: "A new headline" });
  eq(domNodeById(edited, h1TextId)?.text, "A new headline", "morphs: setText writes through");
  const framed = domRegistry.recaptureFrames(state, [{ name: "dom.setText", params: { id: h1TextId, text: "A new headline" } }], (x: DomTreeState) => structuredClone(x));
  const undone = domRegistry.invertMorph(edited, framed[0]);
  ok(undone && domTreesEqual(undone, state) === null, "morphs: setText inverts to the exact prior state");

  // setAttrs patch + removal via null
  const linkId = "0/1/0/2/1";
  const patched = checked(state, "dom.setAttrs", { id: linkId, attrs: { href: "/y", "data-kind": null } });
  eq(domNodeById(patched, linkId)?.attrs, { href: "/y" }, "morphs: setAttrs patches and deletes");

  // addNode appends as the last child, in document order
  const ulId = "0/1/0/3";
  const added = checked(state, "dom.addNode", {
    node: { id: "0/1/0/3/3", parent: ulId, tag: "li", attrs: {}, text: undefined },
  });
  eq(domChildren(added, ulId).map(n => n.id), ["0/1/0/3/0", "0/1/0/3/1", "0/1/0/3/2", "0/1/0/3/3"],
    "morphs: addNode lands as the last child");
  eq(domDocumentOrder(added).indexOf("0/1/0/3/3"), domDocumentOrder(added).indexOf("0/1/0/3/2/0") + 1,
    "morphs: document order preserved after addNode (lands after the last child's subtree)");

  // removeNode takes the subtree; invert restores it exactly
  const removed = checked(state, "dom.removeNode", { id: ulId });
  eq(tagsOf(removed, "li").length, 0, "morphs: removeNode removes the whole subtree");
  const rmFramed = domRegistry.recaptureFrames(state, [{ name: "dom.removeNode", params: { id: ulId } }], (x: DomTreeState) => structuredClone(x));
  const restored = domRegistry.invertMorph(removed, rmFramed[0]);
  ok(restored && domTreesEqual(restored, state) === null, "morphs: removeNode inverts to the exact prior state");

  // moveNode reorders within a parent
  const moved = checked(state, "dom.moveNode", { id: ulId, parent: "0/1/0", index: 0 });
  eq(domChildren(moved, "0/1/0").map(n => n.tag), ["ul", "h1", "p", "p"], "morphs: moveNode reorders children");
  eq(domChildIndex(moved, ulId), 0, "morphs: moved node reports child index 0");

  // checked rejections
  ok(domRegistry.checkMorphState("dom.addNode", state, {
    node: { id: "0", parent: null, tag: "html", attrs: {} },
  }).length > 0, "morphs: duplicate id is rejected");
  ok(domRegistry.checkMorphState("dom.removeNode", state, { id: "nope" }).length > 0,
    "morphs: removing a missing node is rejected");
  ok(domRegistry.checkMorphState("dom.moveNode", state, { id: "0/1/0", parent: ulId, index: 0 }).length > 0,
    "morphs: moving a node under its own descendant is rejected");
  ok(domRegistry.checkMorphState("dom.setText", state, { id: "nope", text: "x" }).length > 0,
    "morphs: setText on a missing node is rejected");
  eq(domRegistry.list().map(d => d.name),
    ["dom.addNode", "dom.removeNode", "dom.setAttrs", "dom.setText", "dom.moveNode"],
    "morphs: the dom vocabulary is exactly the five plan morphs");
}

// ---------- the DOM adapter's structural mapping ----------
{
  // A DOM-shaped plain object (what a browser Node looks like structurally).
  const fakeDom = {
    nodeType: 1, nodeName: "DIV",
    attributes: [{ name: "id", value: "root" }],
    childNodes: [
      { nodeType: 3, nodeName: "#text", childNodes: [], data: "hello" },
      { nodeType: 1, nodeName: "SPAN", attributes: [], childNodes: [] },
    ],
  };
  const like = domLikeFromDomNode(fakeDom as unknown as Node);
  eq(like.nodeType, 1, "adapter: element maps across");
  eq(like.childNodes[0].data, "hello", "adapter: text data maps across");
  eq((like.attributes as { name: string }[])[0].name, "id", "adapter: attributes map across");
  (fakeDom.childNodes[0] as { data: string }).data = "mutated";
  eq(like.childNodes[0].data, "hello", "adapter: the copy is detached from the source");
  if (typeof (globalThis as { DOMParser?: unknown }).DOMParser !== "function") {
    assert.throws(() => parseHtmlToDomLike("<p>x</p>"), /DOMParser is not available/);
    checks++;
  }
}

// ---------- negative fixtures: structured errors, never crashes ----------
{
  eq(deriveDomTree(null as unknown as DomLikeNode).ok, false, "negative: null source is an error");
  eq(deriveDomTree(txt("just text")).ok, false, "negative: a text root is an error");
  eq(deriveDomTree(articlePage, { maxNodes: 0 }).ok, false, "negative: maxNodes 0 is a policy error");
  eq(deriveDomTree(articlePage, { maxDepth: -1 }).ok, false, "negative: negative maxDepth is a policy error");
  eq(validateDomPolicy({ ...DEFAULT_DOM_POLICY, attributeAllowlist: "id" as unknown as string[] }).length > 0,
    true, "negative: a non-array allowlist is a policy error");
  eq(resolveDomPolicy().maxNodes, DEFAULT_DOM_POLICY.maxNodes, "negative: policy resolves to the defaults");
  const malformed = {
    nodeType: 1, nodeName: "HTML",
    childNodes: [{ nodeType: 1, nodeName: "BODY", childNodes: 42 }],
  } as unknown as DomLikeNode;
  const mres = deriveDomTree(malformed);
  eq(mres.ok, false, "negative: a non-list childNodes is an error, not a crash");
  ok(!mres.ok && mres.errors.some(e => e.includes("childNodes")), "negative: the error names the problem");
  const scriptRoot = deriveDomTree(el("script", {}, txt("x")));
  eq(scriptRoot.ok, false, "negative: a root the policy prunes is an error, not an empty mirror");
}

console.log(`verify:jit — ${checks} checks passed`);
