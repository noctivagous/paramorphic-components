// JIT derivation core (README §8.6): derive a DomTreeState mirror from a
// live external tree, just in time. The core is written against the narrow
// DomLike structural interface below and never touches DOM globals — the
// platform front-ends (adapters/dom.ts for the browser; fixture builders
// in verify:jit) supply DomLike trees, and lint:boundaries keeps it so.
import type { DomNode, DomTreeState } from "./dom-state";
import { domChildren } from "./dom-state";
import type { Graph } from "./graph-kernel";

// ---------- DomLike: the minimal structural DOM the core walks ----------
export interface DomLikeAttr {
  name: string;
  value: string;
}

export interface DomLikeNode {
  /** 1 = element, 3 = text, 8 = comment, 9 = document. */
  nodeType: number;
  /** Tag name (any case) for elements; "#text" / "#comment" otherwise. */
  nodeName: string;
  childNodes: ArrayLike<DomLikeNode>;
  /** Elements only; null/absent elsewhere. */
  attributes?: ArrayLike<DomLikeAttr> | null;
  /** Character data for text/comment nodes. */
  data?: string | null;
}

export const DOM_ELEMENT_NODE = 1;
export const DOM_TEXT_NODE = 3;
export const DOM_COMMENT_NODE = 8;
export const DOM_DOCUMENT_NODE = 9;

// ---------- The described pruning policy (plan §4 / README §8.6) ----------
export type DomPolicy = {
  /** Hard cap on kept mirror nodes; exhaustion cuts breadth-first-last. */
  maxNodes: number;
  /** Deepest kept depth; the root is depth 0. */
  maxDepth: number;
  /** Per-node text truncation, in characters. */
  maxTextLength: number;
  /** Exact attribute names kept (plus `style` when its flag allows). */
  attributeAllowlist: string[];
  /** Attribute name prefixes kept (defaults cover `aria-*`, `data-*`). */
  attributePrefixes: string[];
  keepStyleAttribute: boolean;
  /** Element tags whose whole subtree is pruned. */
  pruneTags: string[];
  /** Keep an `svg` element as one node; prune its internals. */
  collapseSvgInternals: boolean;
  dropComments: boolean;
  /** Drop text nodes that are only whitespace (formatting indentation). */
  dropWhitespaceText: boolean;
  /** Prune elements hidden by attribute-level signals (static parses have
   *  no rendering: `hidden` attribute, inline `display:none`). */
  pruneHidden: boolean;
  /** Element tags that carry a direct-text summary in their `text` field. */
  summaryTextTags: string[];
};

export const DEFAULT_DOM_POLICY: DomPolicy = {
  maxNodes: 2000,
  maxDepth: 64,
  maxTextLength: 200,
  attributeAllowlist: ["id", "class", "href", "src", "alt", "title", "type", "name", "value", "role"],
  attributePrefixes: ["aria-", "data-"],
  keepStyleAttribute: false,
  pruneTags: ["script", "style", "noscript", "template"],
  collapseSvgInternals: true,
  dropComments: true,
  dropWhitespaceText: true,
  pruneHidden: true,
  summaryTextTags: ["title", "h1", "h2", "h3", "h4", "h5", "h6", "caption", "th", "td"],
};

export function resolveDomPolicy(partial?: Partial<DomPolicy>): DomPolicy {
  return { ...DEFAULT_DOM_POLICY, ...(partial ?? {}) };
}

export function validateDomPolicy(policy: DomPolicy): string[] {
  if (!policy || typeof policy !== "object") return ["policy must be an object"];
  const errs: string[] = [];
  if (!Number.isInteger(policy.maxNodes) || policy.maxNodes < 1) {
    errs.push("policy.maxNodes must be an integer >= 1");
  }
  if (!Number.isInteger(policy.maxDepth) || policy.maxDepth < 0) {
    errs.push("policy.maxDepth must be an integer >= 0");
  }
  if (!Number.isInteger(policy.maxTextLength) || policy.maxTextLength < 0) {
    errs.push("policy.maxTextLength must be an integer >= 0");
  }
  for (const key of ["attributeAllowlist", "attributePrefixes", "pruneTags", "summaryTextTags"] as const) {
    const v = policy[key];
    if (!Array.isArray(v) || v.some(x => typeof x !== "string")) {
      errs.push(`policy.${key} must be an array of strings`);
    }
  }
  for (const key of ["keepStyleAttribute", "collapseSvgInternals", "dropComments", "dropWhitespaceText", "pruneHidden"] as const) {
    if (typeof policy[key] !== "boolean") errs.push(`policy.${key} must be a boolean`);
  }
  return errs;
}

// ---------- Derivation report ----------
export type DomDerivationReport = {
  /** Every source node visited, kept or not. */
  sourceNodes: number;
  keptNodes: number;
  /** Source nodes cut, by reason (a cut subtree counts all its nodes). */
  pruned: { tag: number; hidden: number; svg: number; depth: number; budget: number };
  /** Cut subtree roots whose parent was kept (each also lands in the
   *  parent's `pruned` count). */
  prunedSubtreeRoots: number;
  commentsDropped: number;
  whitespaceTextDropped: number;
  textTruncations: number;
  attributesDropped: number;
};

export type DomDerivation =
  | { ok: true; state: DomTreeState; report: DomDerivationReport }
  | { ok: false; errors: string[] };

type CutReason = "tag" | "hidden" | "svg" | "depth" | "budget" | "comment" | "whitespace";

type SrcRec = {
  src: DomLikeNode;
  pathId: string;
  parentPathId: string | null;
  depth: number;
  order: number;
  kind: "element" | "text" | "comment" | "other";
  tag: string;
  subtreeSize: number;
  cut: CutReason | null;
  cutRoot: boolean;
};

function isArrayLike(v: unknown): v is ArrayLike<unknown> {
  return !!v && typeof v === "object" && typeof (v as ArrayLike<unknown>).length === "number";
}

function rawAttrs(src: DomLikeNode): DomLikeAttr[] {
  if (!isArrayLike(src.attributes)) return [];
  const out: DomLikeAttr[] = [];
  for (let i = 0; i < src.attributes!.length; i++) out.push(src.attributes![i]);
  return out;
}

function isHiddenBySignal(src: DomLikeNode): boolean {
  for (const a of rawAttrs(src)) {
    const name = a.name.toLowerCase();
    if (name === "hidden") return true;
    if (name === "style") {
      const flat = a.value.toLowerCase().replace(/\s+/g, "");
      if (flat.includes("display:none") || flat.includes("visibility:hidden")) return true;
    }
  }
  return false;
}

/**
 * Derive the mirror of a DomLike tree under a described policy. Static
 * identity regime (plan §5): ids are child-index paths from the root, so
 * the same source + policy always yields byte-identical output.
 */
export function deriveDomTree(source: DomLikeNode, policyPartial?: Partial<DomPolicy>): DomDerivation {
  const policy = resolveDomPolicy(policyPartial);
  const policyErrors = validateDomPolicy(policy);
  if (policyErrors.length > 0) return { ok: false, errors: policyErrors };
  if (!source || typeof source !== "object" || typeof source.nodeType !== "number") {
    return { ok: false, errors: ["source must be a DomLike node (object with a numeric nodeType)"] };
  }

  // Root selection: a document node derives from its document element;
  // an element derives from itself. Anything else has nothing to mirror.
  let rootSrc: DomLikeNode = source;
  if (source.nodeType === DOM_DOCUMENT_NODE) {
    if (!isArrayLike(source.childNodes)) {
      return { ok: false, errors: ["document node has no childNodes list"] };
    }
    let found: DomLikeNode | null = null;
    for (let i = 0; i < source.childNodes.length; i++) {
      const c = source.childNodes[i];
      if (c && c.nodeType === DOM_ELEMENT_NODE) { found = c; break; }
    }
    if (!found) return { ok: false, errors: ["document has no document element to mirror"] };
    rootSrc = found;
  } else if (source.nodeType !== DOM_ELEMENT_NODE) {
    return { ok: false, errors: [`root must be an element or document node (got nodeType ${source.nodeType})`] };
  }

  // Pre-order walk collecting records; structural problems are errors,
  // never crashes.
  const errors: string[] = [];
  const recs: SrcRec[] = [];
  const stack: { src: DomLikeNode; pathId: string; parentPathId: string | null; depth: number }[] = [
    { src: rootSrc, pathId: "0", parentPathId: null, depth: 0 },
  ];
  while (stack.length > 0) {
    const { src, pathId, parentPathId, depth } = stack.pop()!;
    if (!src || typeof src !== "object" || typeof src.nodeType !== "number") {
      errors.push(`node at path ${pathId} is not a DomLike node`);
      continue;
    }
    const kind: SrcRec["kind"] =
      src.nodeType === DOM_ELEMENT_NODE ? "element"
      : src.nodeType === DOM_TEXT_NODE ? "text"
      : src.nodeType === DOM_COMMENT_NODE ? "comment"
      : "other";
    const tag =
      kind === "element" ? String(src.nodeName ?? "").toLowerCase()
      : kind === "text" ? "#text"
      : kind === "comment" ? "#comment"
      : String(src.nodeName ?? `#node${src.nodeType}`).toLowerCase();
    if (kind === "element" && !tag) {
      errors.push(`element at path ${pathId} has no nodeName`);
      continue;
    }
    if (src.attributes !== undefined && src.attributes !== null && !isArrayLike(src.attributes)) {
      errors.push(`element at path ${pathId} has a non-list attributes field`);
    } else if (isArrayLike(src.attributes)) {
      for (let i = 0; i < src.attributes.length; i++) {
        const a = src.attributes[i];
        if (!a || typeof a.name !== "string" || typeof a.value !== "string") {
          errors.push(`element at path ${pathId} has a malformed attribute at index ${i}`);
          break;
        }
      }
    }
    const rec: SrcRec = {
      src, pathId, parentPathId, depth,
      order: recs.length, kind, tag,
      subtreeSize: 1, cut: null, cutRoot: false,
    };
    recs.push(rec);
    if (!isArrayLike(src.childNodes)) {
      if (kind === "element" || kind === "text" || kind === "comment") {
        errors.push(`node at path ${pathId} has no childNodes list`);
      }
      continue;
    }
    const kids: { src: DomLikeNode; pathId: string; parentPathId: string | null; depth: number }[] = [];
    for (let i = 0; i < src.childNodes.length; i++) {
      kids.push({ src: src.childNodes[i], pathId: `${pathId}/${i}`, parentPathId: pathId, depth: depth + 1 });
    }
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  if (errors.length > 0) return { ok: false, errors };
  // Subtree sizes from the pre-order list: a record's subtree runs while
  // following records are deeper than it.
  for (let i = recs.length - 1; i >= 0; i--) {
    let size = 1;
    for (let j = i + 1; j < recs.length && recs[j].depth > recs[i].depth; j++) size++;
    recs[i].subtreeSize = size;
  }
  const byPath = new Map(recs.map(r => [r.pathId, r]));
  const ancestorsOf = (rec: SrcRec): SrcRec[] => {
    const out: SrcRec[] = [];
    let cur = rec.parentPathId ? byPath.get(rec.parentPathId) : undefined;
    while (cur) {
      out.push(cur);
      cur = cur.parentPathId ? byPath.get(cur.parentPathId) : undefined;
    }
    return out;
  };

  const report: DomDerivationReport = {
    sourceNodes: recs.length,
    keptNodes: 0,
    pruned: { tag: 0, hidden: 0, svg: 0, depth: 0, budget: 0 },
    prunedSubtreeRoots: 0,
    commentsDropped: 0,
    whitespaceTextDropped: 0,
    textTruncations: 0,
    attributesDropped: 0,
  };
  const cutWith = (rec: SrcRec, reason: CutReason, root: boolean) => {
    rec.cut = reason;
    rec.cutRoot = root;
    if (reason === "comment") { if (root) report.commentsDropped += rec.subtreeSize; }
    else if (reason === "whitespace") report.whitespaceTextDropped += 1;
    else if (root) {
      // The root's subtreeSize already counts every descendant the cut
      // takes with it; inherited cuts add nothing further.
      report.pruned[reason] += rec.subtreeSize;
      report.prunedSubtreeRoots++;
    }
  };

  // Fate pass, in document order so ancestors are decided before children.
  const pruneTags = new Set(policy.pruneTags.map(t => t.toLowerCase()));
  for (const rec of recs) {
    const ancestors = ancestorsOf(rec);
    const inherited = ancestors.find(a => a.cut)?.cut ?? null;
    if (inherited) { cutWith(rec, inherited, false); continue; }
    if (rec.depth > policy.maxDepth) { cutWith(rec, "depth", true); continue; }
    if (rec.kind === "comment") {
      if (policy.dropComments) { cutWith(rec, "comment", true); continue; }
    } else if (rec.kind === "text") {
      const data = typeof rec.src.data === "string" ? rec.src.data : "";
      if (policy.dropWhitespaceText && data.trim() === "") { cutWith(rec, "whitespace", true); continue; }
    } else if (rec.kind === "element") {
      if (pruneTags.has(rec.tag)) { cutWith(rec, "tag", true); continue; }
      if (policy.collapseSvgInternals && ancestors.some(a => a.kind === "element" && a.tag === "svg")) {
        cutWith(rec, "svg", rec.parentPathId !== null && byPath.get(rec.parentPathId)?.tag === "svg");
        continue;
      }
      if (policy.pruneHidden && isHiddenBySignal(rec.src)) { cutWith(rec, "hidden", true); continue; }
    } else {
      // Non-element/text/comment node types (doctype, CDATA, …) have no
      // mirror record; they are dropped, counted with comments as the
      // "not content" bucket.
      cutWith(rec, "comment", true);
      continue;
    }
  }

  const rootRec = recs[0];
  if (rootRec.cut) {
    return {
      ok: false,
      errors: [`root element <${rootRec.tag}> is cut by policy (${rootRec.cut}); nothing to mirror`],
    };
  }

  // Budget pass: breadth-first order (depth, then document order) decides
  // what survives; the tail is cut, subtree-closed because a descendant is
  // always breadth-first-later than its ancestors.
  const kept = recs.filter(r => !r.cut);
  if (kept.length > policy.maxNodes) {
    const bfs = [...kept].sort((a, b) => a.depth - b.depth || a.order - b.order);
    const survivors = new Set(bfs.slice(0, policy.maxNodes).map(r => r.pathId));
    for (const rec of bfs.slice(policy.maxNodes)) {
      const parentKept = rec.parentPathId === null || survivors.has(rec.parentPathId);
      rec.cut = "budget";
      rec.cutRoot = parentKept;
      report.pruned.budget += 1;
      if (parentKept) report.prunedSubtreeRoots++;
    }
  }

  // Emit kept records in document order.
  const finalKept = recs.filter(r => !r.cut);
  const keptPaths = new Set(finalKept.map(r => r.pathId));
  const prunedByParent = new Map<string, number>();
  for (const rec of recs) {
    if (!rec.cutRoot || rec.parentPathId === null) continue;
    if (rec.cut === "comment" || rec.cut === "whitespace") continue;
    if (!keptPaths.has(rec.parentPathId)) continue;
    prunedByParent.set(rec.parentPathId, (prunedByParent.get(rec.parentPathId) ?? 0) + 1);
  }
  const allow = new Set(policy.attributeAllowlist.map(a => a.toLowerCase()));
  const summaryTags = new Set(policy.summaryTextTags.map(t => t.toLowerCase()));
  const truncate = (s: string): string => {
    if (s.length > policy.maxTextLength) {
      report.textTruncations++;
      return s.slice(0, policy.maxTextLength);
    }
    return s;
  };
  const nodes: DomNode[] = finalKept.map(rec => {
    const node: DomNode = {
      id: rec.pathId,
      parent: rec.parentPathId,
      tag: rec.tag,
      attrs: {},
    };
    if (rec.kind === "element") {
      for (const a of rawAttrs(rec.src)) {
        const name = a.name.toLowerCase();
        const allowed =
          allow.has(name) ||
          policy.attributePrefixes.some(p => name.startsWith(p.toLowerCase())) ||
          (name === "style" && policy.keepStyleAttribute);
        if (allowed) node.attrs[name] = a.value;
        else report.attributesDropped++;
      }
      if (summaryTags.has(rec.tag)) {
        const direct = recs.filter(
          r => r.parentPathId === rec.pathId && r.kind === "text" && !r.cut
        );
        const joined = direct.map(r => (typeof r.src.data === "string" ? r.src.data : "")).join("");
        if (joined.trim() !== "") node.text = truncate(joined);
      }
    } else {
      const data = typeof rec.src.data === "string" ? rec.src.data : "";
      node.text = truncate(data);
    }
    const pruned = prunedByParent.get(rec.pathId);
    if (pruned) node.pruned = pruned;
    return node;
  });
  report.keptNodes = nodes.length;
  return { ok: true, state: { nodes }, report };
}

// ---------- Kernel projection + path queries ----------
/** Project the mirror onto the Graph kernel: parent→child edges, tag as
 *  the node's kernel tag. Kernel walks (bfsOrder) and the single-parent
 *  check then apply to a page unchanged (plan §3). */
export function domToGraph(state: DomTreeState): Graph {
  return {
    nodes: state.nodes.map(n => ({ id: n.id, tags: [n.tag], data: n })),
    edges: state.nodes
      .filter(n => n.parent !== null)
      .map(n => ({ id: `${n.parent}->${n.id}`, from: n.parent!, to: n.id, label: "child" })),
  };
}

/**
 * Resolve a child-index path ("0/2/1") against the mirror's structure:
 * the first segment indexes the roots, each later segment indexes that
 * node's children in document order. In the static regime the result's
 * id equals the path; the walk itself is regime-independent.
 */
export function resolveDomPath(state: DomTreeState, path: string): DomNode | null {
  if (!/^\d+(\/\d+)*$/.test(path)) return null;
  const segments = path.split("/").map(Number);
  let level = domChildren(state, null);
  let current: DomNode | undefined;
  for (const seg of segments) {
    current = level[seg];
    if (!current) return null;
    level = domChildren(state, current.id);
  }
  return current ?? null;
}
