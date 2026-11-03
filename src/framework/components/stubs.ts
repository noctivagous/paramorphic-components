// ---------- Component stubs (Tree / Path / Protocol / Logic) ----------
// README 11.1: Graph, Tree, Path, Protocol, Logic and composition are still
// illustrative mockups in the demo. The framework therefore ships their shared
// types now and fails loudly on use, instead of enshrining mockups as API.

import type { LogicTriple } from "../types";

export function notImplemented(component: string): never {
  throw new Error(
    `[framework] ${component} is not implemented yet (README 11.1: still a mockup in the demo shell)`
  );
}

export type TreeViewProps = {
  rootId: string;
};

export type PathViewProps = {
  points: { x: number; y: number }[];
};

export type ProtocolViewProps = {
  sessionId: string;
};

export type LogicViewProps = {
  triples: LogicTriple[];
};

export function requireTree(props: TreeViewProps): TreeViewProps {
  return notImplemented("Tree");
}

export function requirePath(props: PathViewProps): PathViewProps {
  return notImplemented("Path");
}

export function requireProtocol(props: ProtocolViewProps): ProtocolViewProps {
  return notImplemented("Protocol");
}

export function requireLogic(props: LogicViewProps): LogicViewProps {
  return notImplemented("Logic");
}
