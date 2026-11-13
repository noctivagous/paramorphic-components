// Layout report CLI: snapshots a GUI document (default: the gui-builder
// starter document) at all three device classes and prints the wireframe
// summary + bounded finding lines per device. With --out <dir>, also
// writes one wireframe SVG per device (analysis overlays on) — the
// agent-readable "what does this layout actually look like" evidence.
// Usage: npm run layout:report [-- <document-or-plan.json>] [--out <dir>]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  DEVICES,
  GUI_CANVAS_MIN_HEIGHT,
  GUI_DEVICE_WIDTH,
  layoutFindingLines,
  loadGuiDocument,
  loadGuiPlan,
  renderSvgWireframe,
  resolvedRects,
  snapshotGuiDocument,
  summarizeWireframeSnapshot,
  type GuiDocument,
} from "../src/framework";
import { starterDocument } from "../apps/gui-builder/src/starter";

const args = process.argv.slice(2);
let inputPath: string | undefined;
let outDir: string | undefined;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--out") outDir = args[++i];
  else if (!args[i].startsWith("--")) inputPath = args[i];
}

let doc: GuiDocument;
let sourceName: string;
if (inputPath) {
  const data = JSON.parse(readFileSync(path.resolve(inputPath), "utf8"));
  const asDoc = loadGuiDocument(data);
  if (asDoc.ok) {
    doc = asDoc.doc;
  } else {
    const asPlan = loadGuiPlan(data);
    if (!asPlan.ok) {
      console.error(`layout:report: ${inputPath} is neither a gui document nor a gui plan:`);
      for (const e of [...asDoc.errors, ...asPlan.errors]) console.error(`  - ${e}`);
      process.exit(1);
    }
    doc = asPlan.doc;
  }
  sourceName = inputPath;
} else {
  doc = starterDocument();
  sourceName = "gui-builder starter document";
}

if (outDir) mkdirSync(outDir, { recursive: true });
console.log(`layout report: ${sourceName} (${doc.nodes.length} nodes)`);
let totalFindings = 0;
for (const device of DEVICES) {
  // Canvas mirrors the builder's extent rule: the width is the device
  // class width (elements past it are overflow), the height grows to fit
  // content past the 560px minimum (the builder canvas scrolls/grows).
  const rects = resolvedRects(doc, device);
  let contentBottom = 0;
  for (const r of rects.values()) contentBottom = Math.max(contentBottom, r.absY + r.h);
  const canvas = { w: GUI_DEVICE_WIDTH[device], h: Math.max(GUI_CANVAS_MIN_HEIGHT, contentBottom) };
  const snapshot = snapshotGuiDocument(doc, device, canvas);
  const summary = summarizeWireframeSnapshot(snapshot);
  const lines = layoutFindingLines(snapshot);
  totalFindings += lines.length;
  console.log(
    `\n[${device}] canvas ${summary.viewport.width}x${summary.viewport.height} · ${summary.elementCount} elements · ` +
    `${summary.overlaps} overlaps · ${summary.clipping} clipping · ${summary.overflowX} overflow-x · ${summary.overflowY} overflow-y · ${summary.gaps} sibling gaps (>=4px)`,
  );
  for (const line of lines) console.log(`  ${line}`);
  if (lines.length === 0) console.log("  no findings");
  if (outDir) {
    const svg = renderSvgWireframe(snapshot, {
      showLabels: true,
      showDimensions: true,
      showOverlaps: true,
      showGaps: false,
      showClipping: true,
    });
    const file = path.join(outDir, `wireframe-${device}.svg`);
    writeFileSync(file, svg);
    console.log(`  svg: ${file}`);
  }
}
console.log(`\nlayout report: ${totalFindings} findings across ${DEVICES.length} devices`);
