// ---------- DOM adapter (platform layer, not core) ----------
// The JIT derivation core (jit.ts) walks a structural DomLike tree and
// never touches DOM globals. This adapter is the browser front-end: it
// turns a live or parsed DOM into a detached DomLike snapshot the core
// can consume, and parses HTML strings through the platform's DOMParser.
// Derivation from a parsed string never executes page code — a DOMParser
// document is inert (README §8.6). A future Node front-end supplying the
// same DomLike shape is a separate dependency decision (plan §11.5).
import type { DomLikeNode } from "../jit";

/** Deep structural copy of a DOM node into a plain DomLike tree,
 *  detached from the live document (later DOM mutations do not leak in). */
export function domLikeFromDomNode(node: Node): DomLikeNode {
  const out: DomLikeNode = {
    nodeType: node.nodeType,
    nodeName: node.nodeName,
    childNodes: Array.from(node.childNodes, domLikeFromDomNode),
  };
  if (node.nodeType === 1) {
    const el = node as Element;
    out.attributes = Array.from(el.attributes, a => ({ name: a.name, value: a.value }));
  }
  if (node.nodeType === 3 || node.nodeType === 8) {
    out.data = (node as CharacterData).data;
  }
  return out;
}

/** Parse an HTML string into a DomLike document tree via DOMParser.
 *  Throws a plain Error where the platform has no DOMParser (Node): the
 *  core stays parser-free by design, so this front-end is browser-only. */
export function parseHtmlToDomLike(html: string): DomLikeNode {
  const Parser = (globalThis as { DOMParser?: typeof DOMParser }).DOMParser;
  if (typeof Parser !== "function") {
    throw new Error(
      "[dom adapter] DOMParser is not available in this environment; " +
      "deriving from HTML strings needs a browser host (a Node front-end is a separate dependency decision)"
    );
  }
  const doc = new Parser().parseFromString(html, "text/html");
  return domLikeFromDomNode(doc);
}
