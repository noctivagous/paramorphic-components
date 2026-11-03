// ---------- Types ----------
export type Pos = { q: number; r: number };
export type Axial = { q: number; r: number };

export type TilingDir = {
  name: string;
  dq: number; // offset delta for square, axial delta for hex (stored as axial)
  dr: number;
  axial: Axial;
  angle: number;
  isOrthogonal?: boolean;
  isDiagonal?: boolean;
};

export type TilingDef = {
  id: "square4" | "square8" | "hexH" | "hexV";
  name: string;
  shape: "square" | "hex";
  style: "2color" | "3color";
  directions: TilingDir[];
  directionMap: Record<string, TilingDir>;
  leaps: { name: string; offsets: { dq: number; dr: number; axial: Axial }[] }; // knight
};

export type MoveKind =
  | { type: "step"; dir: string; count?: number }
  | { type: "slide"; dir: string; min?: number; max?: number }
  | { type: "leap"; offsets: { dq: number; dr: number; axial?: Axial }[] }
  | { type: "leapRef"; ref: "knight" }
  | { type: "pawn"; forward: string | string[]; captureDirs: string[]; firstDouble?: boolean }
  | { type: "place"; anywhere?: boolean };

export type MoveRule = {
  pieceType: string;
  moves: MoveKind[];
  capture?: "move" | "captureOnly" | "both";
  jumpOver?: boolean;
  onMove?: { promoteTo?: string[]; ifInRegion?: string; chain?: boolean };
  onCapture?: { remove?: boolean; chain?: boolean };
  onPlace?: { captureSurrounded?: boolean };
  requires?: { darkOnly?: boolean };
};

export type TurnRule =
  | { type: "alternating"; order: string[]; first: string }
  | { type: "free" }
  | { type: "samePlayerIfCapture"; order: string[]; first: string };

export type OutcomeCondition =
  | { kind: "line"; player: string; count: number; directions?: string[] | "any"; regions?: string[] | "all"; id?: string }
  | { kind: "captureAll"; player?: string; target?: string; winFor?: string; id?: string }
  | { kind: "noMoves"; player: string; id?: string }
  | { kind: "kingCaptured"; player: string; id?: string }
  | { kind: "reachRow"; player: string; regionId: string; id?: string }
  | { kind: "boardFull"; draw?: boolean; id?: string }
  | { kind: "fillRegions"; constraint?: string; id?: string }
  | { kind: "topReached"; row: number; id?: string };

export type Region = { id: string; cells: Pos[]; type: "row" | "col" | "box" | "edge" | "track" | "word" | "custom"; color?: string };

export type Guest =
  | { kind: "Path"; state: { points: { x: number; y: number }[] } }
  | { kind: "Tree"; state: { rootId: string } }
  | { kind: "Grid"; state: { occupants: Occupant[]; width: number; height: number } }
  | { kind: "Logic"; state: { triples: LogicTriple[] } };

export type Occupant = {
  id: string;
  anchor: Pos;
  span: Pos[]; // offsets from anchor
  type: string;
  data: any;
  tags: string[];
  guest?: Guest;
  z?: number;
};

export type LogicTriple = { id: string; s: string; p: string; o: string };

export type RuleSet = {
  id: string;
  setup: { width: number; height: number; description: string };
  moves: MoveRule[];
  turns: TurnRule;
  outcomes: OutcomeCondition[];
  end: { condition: string; action: string };
  regions: Region[];
  gravity?: { direction: string; after: "move" | "always" };
};

export type Toggles = { gravity: boolean; diagonal: boolean; sliding: boolean; wrapping: boolean; chainCapture: boolean };
