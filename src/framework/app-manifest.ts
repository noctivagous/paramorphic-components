// App/program manifest (`paramorphic-app/1`): the one document that names
// an app whole. It *references* the existing formats — morph plans
// (`paramorphic-plan/1`), GUI documents (`paramorphic-gui/1`), shell plans
// (`paramorphic-shell/1`) — and never replaces or inlines them (settled
// decision 4, 2026-11-12: references only in v1, one source of truth per
// document). A piece that still exists only as TypeScript is declared as
// code, by name, through the `code` entry — a manifest must never pretend a
// piece is data when it is code (the `chainForSave` / exporter-manifest
// honesty rule). Design: ~/workspace/paramorphic-audit/D1-MANIFEST-PLAN.md,
// including the eight settled decisions this validator encodes.
//
// This module is format + validation only: pure functions from unknown data
// to structured error lists, in the `loadPlan` / `loadShellPlan` idiom
// (never a partial result). Reading files and loading the referenced
// documents under their own loaders is the host's / verify gate's job —
// which is why this file sits in the core and imports nothing outside it.

export const APP_SCHEMA = "paramorphic-app/1";

export type AppKind = "gui" | "cli" | "program";
export const APP_KINDS: readonly AppKind[] = ["gui", "cli", "program"];

/** Document formats a manifest can reference, by family name. Shell files
 *  on disk are `paramorphic-shell/1` snapshots or `/2` morph files; the
 *  family name here is what `loadShellPlan` reads. */
export type AppDocumentFormat = "paramorphic-plan/1" | "paramorphic-gui/1" | "paramorphic-shell/1";
export const APP_DOCUMENT_FORMATS: readonly AppDocumentFormat[] = [
  "paramorphic-plan/1",
  "paramorphic-gui/1",
  "paramorphic-shell/1",
];

/** Entry types name a document format, plus the `code` escape hatch.
 *  There is deliberately no `recipe` entry: settled decision 6 (2026-11-12)
 *  — recipes are document *sources*, never app entries, in v1. A recipe's
 *  output is saved as a document and referenced like any other. */
export type AppEntryRef =
  | { type: "plan" | "gui-document" | "shell"; ref: string }
  | { type: "code"; module: string };

export const ENTRY_FORMAT: Record<"plan" | "gui-document" | "shell", AppDocumentFormat> = {
  plan: "paramorphic-plan/1",
  "gui-document": "paramorphic-gui/1",
  shell: "paramorphic-shell/1",
};

export type AppDocumentSlot = { slot: string; format: AppDocumentFormat; ref: string };

/** `slot` names a declared document slot, or the reserved name `"entry"`
 *  for the entry document itself (only when the entry is a document ref,
 *  never a `code` entry). `key` is the storage key — required for
 *  `localStorage`, meaningless (and rejected) for the other channels. */
export type AppPersistenceSlot = { slot: string; via: "file" | "localStorage" | "records"; key?: string };
export const PERSISTENCE_CHANNELS: readonly AppPersistenceSlot["via"][] = ["file", "localStorage", "records"];

/** Device vocabulary for GUI documents — mirrors `DEVICES` in
 *  app-kit/controls/types (the app-kit is outside the core, so the list is
 *  restated here; the two must agree). */
export type AppDevice = "desktop" | "tablet" | "phone";
export const APP_DEVICES: readonly AppDevice[] = ["desktop", "tablet", "phone"];

export const APP_HOSTS: readonly string[] = ["browser", "headless"];

/**
 * Capability vocabulary (closed in v1): host capabilities an app declares
 * it needs, drawn from the action layer's host operations and the adapters
 * that exist today. Each name names real code:
 * - `file.open` / `file.save` — the `document.open` / `document.save`
 *   action operations; the apps' file pickers and download saves.
 * - `storage.local` — `localStorage` (the GUI builder's autosave).
 * - `storage.folder` — the `storage.chooseFolder` action operation; the
 *   File System Access directory picker behind app-kit/browser's adapter.
 * - `clipboard` — `navigator.clipboard` (the spreadsheet's copy/paste).
 * - `audio` — `adapters/audio.ts`, the tone-trigger adapter.
 * - `animation.clock` — an interval/animation clock the host lends the app
 *   (the supershape rider's 90 ms interval; time lives in the app, §8.3).
 * Custom capabilities are a host/D2 concern; unknown names are errors here.
 * Strictness (settled decision 5): each declaration carries `required` —
 * a host missing a required capability refuses (structured errors, never a
 * partial launch); a missing optional one warns and runs. D1a validates
 * the declarations; host enforcement is staged (decision 7).
 */
export type AppCapability = { name: string; required: boolean };
export const APP_CAPABILITIES: readonly string[] = [
  "file.open",
  "file.save",
  "storage.local",
  "storage.folder",
  "clipboard",
  "audio",
  "animation.clock",
];

/** I/O ports for `cli` / `program` kinds. Reserved and shape-validated
 *  only in v1 — the run semantics belong to D3/D4. */
export type AppIoPort = { name: string; bind: "argv" | "stdin" | "stdout" | "file"; ref?: string };

export type AppManifest = {
  $schema: typeof APP_SCHEMA;
  id: string;
  name: string;
  version: string;
  kind: AppKind;
  entry: AppEntryRef;
  documents?: AppDocumentSlot[];
  /** Shell plan ref (`paramorphic-shell/1` family), GUI kind only. */
  shell?: string;
  /** Actions document ref. D2 owns the format; D1a shape-checks the ref
   *  only — no loader exists yet, so no gate may claim to have loaded it. */
  actions?: string;
  persistence?: AppPersistenceSlot[];
  devices?: AppDevice[];
  /** A named built-in theme (`"classic-desktop"` today), or a theme-plan
   *  ref once D8 lands — the shape already allows both. */
  theme?: string | { ref: string };
  runtime?: { paramorphic: string; hosts: string[] };
  capabilities?: AppCapability[];
  io?: { inputs?: AppIoPort[]; outputs?: AppIoPort[] };
};

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/** Unknown keys are errors everywhere in the format. The format is *not*
 *  frozen (settled decision 8: optional fields may be added under
 *  `paramorphic-app/1`), but an addition lands by teaching this validator
 *  the new field — never by letting unvalidated keys ride along. */
function unknownKeys(obj: Record<string, unknown>, allowed: readonly string[], where: string): string[] {
  return Object.keys(obj).filter(k => !allowed.includes(k)).map(k => `${where}: unknown field "${k}"`);
}

/** A v1 ref is a path relative to the manifest file, inside the app
 *  directory: no absolute paths, no URLs, no `..` escapes. Named/versioned
 *  refs are D10's module system and change only this rule. */
function refErrors(ref: unknown, where: string): string[] {
  if (!nonEmpty(ref)) return [`${where} must be a non-empty relative path`];
  if (ref.startsWith("/") || ref.includes("://") || ref.split("/").includes("..")) {
    return [`${where} "${ref}" must be a path relative to the manifest, inside the app directory`];
  }
  return [];
}

function entryErrors(entry: unknown): string[] {
  if (!isRecord(entry)) return ["entry must be an object"];
  const type = entry.type;
  if (type === "recipe") {
    return ['entry.type "recipe" is not an app entry in paramorphic-app/1 (settled decision 6: recipes are document sources, not entries — save the recipe\'s output as a document and reference it)'];
  }
  if (type === "code") {
    return [
      ...unknownKeys(entry, ["type", "module"], "entry"),
      ...(nonEmpty(entry.module) ? [] : ["entry.module must name the TypeScript entry module"]),
    ];
  }
  if (type === "plan" || type === "gui-document" || type === "shell") {
    return [
      ...unknownKeys(entry, ["type", "ref"], "entry"),
      ...refErrors(entry.ref, "entry.ref"),
    ];
  }
  return [`entry.type must be "plan", "gui-document", "shell" or "code" (got ${JSON.stringify(type)})`];
}

function ioErrors(io: unknown, kind: unknown): string[] {
  if (io === undefined) return [];
  if (kind !== "cli" && kind !== "program") return ["io is only allowed on cli/program manifests"];
  if (!isRecord(io)) return ["io must be an object with inputs/outputs port lists"];
  const errors = [...unknownKeys(io, ["inputs", "outputs"], "io")];
  const checkPorts = (ports: unknown, direction: "inputs" | "outputs"): string[] => {
    if (ports === undefined) return [];
    if (!Array.isArray(ports)) return [`io.${direction} must be an array`];
    const binds = direction === "inputs" ? ["argv", "stdin", "file"] : ["stdout", "file"];
    const errs: string[] = [];
    const names = new Set<string>();
    ports.forEach((p, i) => {
      const where = `io.${direction}[${i}]`;
      if (!isRecord(p)) { errs.push(`${where} must be an object`); return; }
      errs.push(...unknownKeys(p, ["name", "bind", "ref"], where));
      if (!nonEmpty(p.name)) errs.push(`${where}.name must be a non-empty string`);
      else if (names.has(p.name)) errs.push(`${where}.name "${p.name}" is duplicated`);
      else names.add(p.name);
      if (typeof p.bind !== "string" || !binds.includes(p.bind)) {
        errs.push(`${where}.bind must be one of ${binds.join(", ")} for ${direction}`);
      }
      if (p.ref !== undefined && p.bind !== "file") errs.push(`${where}.ref is only allowed on file-bound ports`);
      if (p.ref !== undefined) errs.push(...refErrors(p.ref, `${where}.ref`));
    });
    return errs;
  };
  errors.push(...checkPorts(io.inputs, "inputs"), ...checkPorts(io.outputs, "outputs"));
  return errors;
}

export function validateManifest(data: unknown): string[] {
  if (!isRecord(data)) return ["manifest must be a JSON object"];
  const errors: string[] = [];
  errors.push(...unknownKeys(data, [
    "$schema", "id", "name", "version", "kind", "entry", "documents", "shell",
    "actions", "persistence", "devices", "theme", "runtime", "capabilities", "io",
  ], "manifest"));

  if (data.$schema !== APP_SCHEMA) {
    errors.push(`$schema must be "${APP_SCHEMA}" (got ${JSON.stringify(data.$schema)}); breaking changes bump the schema version`);
  }
  if (!nonEmpty(data.id) || !KEBAB.test(data.id)) errors.push('id must be a kebab-case string (e.g. "spreadsheet")');
  if (!nonEmpty(data.name)) errors.push("name must be a non-empty string");
  if (!nonEmpty(data.version)) errors.push("version must be a non-empty string");
  const kind = data.kind;
  if (typeof kind !== "string" || !APP_KINDS.includes(kind as AppKind)) {
    errors.push(`kind must be one of ${APP_KINDS.join(", ")}`);
  }

  errors.push(...entryErrors(data.entry));
  const entry = isRecord(data.entry) ? data.entry : {};
  const entryIsDocument = entry.type === "plan" || entry.type === "gui-document" || entry.type === "shell";

  // Document slots: unique names, known formats, valid refs.
  const slotNames = new Set<string>();
  if (data.documents !== undefined) {
    if (!Array.isArray(data.documents)) errors.push("documents must be an array of slots");
    else data.documents.forEach((slot, i) => {
      const where = `documents[${i}]`;
      if (!isRecord(slot)) { errors.push(`${where} must be an object`); return; }
      errors.push(...unknownKeys(slot, ["slot", "format", "ref"], where));
      if (!nonEmpty(slot.slot) || !KEBAB.test(slot.slot as string)) errors.push(`${where}.slot must be a kebab-case name`);
      else if (slotNames.has(slot.slot as string)) errors.push(`${where}.slot "${slot.slot}" is duplicated`);
      else slotNames.add(slot.slot as string);
      if (typeof slot.format !== "string" || !APP_DOCUMENT_FORMATS.includes(slot.format as AppDocumentFormat)) {
        errors.push(`${where}.format must be one of ${APP_DOCUMENT_FORMATS.join(", ")}`);
      }
      errors.push(...refErrors(slot.ref, `${where}.ref`));
    });
  }

  if (data.shell !== undefined) {
    if (kind !== "gui") errors.push("shell is only allowed on gui manifests");
    errors.push(...refErrors(data.shell, "shell"));
  }
  if (data.actions !== undefined) errors.push(...refErrors(data.actions, "actions"));

  // Persistence: every slot resolves to a declared document slot, or to
  // the reserved "entry" slot when the entry is a document.
  if (data.persistence !== undefined) {
    if (!Array.isArray(data.persistence)) errors.push("persistence must be an array of slots");
    else {
      const seen = new Set<string>();
      data.persistence.forEach((p, i) => {
        const where = `persistence[${i}]`;
        if (!isRecord(p)) { errors.push(`${where} must be an object`); return; }
        errors.push(...unknownKeys(p, ["slot", "via", "key"], where));
        if (!nonEmpty(p.slot)) errors.push(`${where}.slot must name a document slot`);
        else if (p.slot === "entry") {
          if (!entryIsDocument) errors.push(`${where}.slot "entry" has no document to persist — the entry is code`);
        } else if (!slotNames.has(p.slot)) {
          errors.push(`${where}.slot "${p.slot}" is not a declared document slot`);
        }
        if (typeof p.via !== "string" || !PERSISTENCE_CHANNELS.includes(p.via as AppPersistenceSlot["via"])) {
          errors.push(`${where}.via must be one of ${PERSISTENCE_CHANNELS.join(", ")}`);
        }
        if (p.via === "localStorage" && !nonEmpty(p.key)) errors.push(`${where}.key is required for localStorage persistence (the storage key is the declaration)`);
        if (p.via !== "localStorage" && p.key !== undefined) errors.push(`${where}.key is only allowed for localStorage persistence`);
        const pair = `${p.slot}:${p.via}`;
        if (nonEmpty(p.slot) && nonEmpty(p.via)) {
          if (seen.has(pair)) errors.push(`${where} duplicates persistence for slot "${p.slot}" via "${p.via}"`);
          seen.add(pair);
        }
      });
    }
  }

  if (data.devices !== undefined) {
    if (kind !== "gui") errors.push("devices are only allowed on gui manifests");
    if (!Array.isArray(data.devices)) errors.push("devices must be an array");
    else {
      const seen = new Set<string>();
      data.devices.forEach((d, i) => {
        if (typeof d !== "string" || !APP_DEVICES.includes(d as AppDevice)) errors.push(`devices[${i}] must be one of ${APP_DEVICES.join(", ")}`);
        else if (seen.has(d)) errors.push(`devices[${i}] "${d}" is duplicated`);
        else seen.add(d);
      });
    }
  }

  if (data.theme !== undefined) {
    if (typeof data.theme === "string") {
      if (!nonEmpty(data.theme)) errors.push("theme must be a named built-in or a { ref } object");
    } else if (isRecord(data.theme)) {
      errors.push(...unknownKeys(data.theme, ["ref"], "theme"));
      errors.push(...refErrors(data.theme.ref, "theme.ref"));
    } else errors.push("theme must be a named built-in or a { ref } object");
  }

  if (data.runtime !== undefined) {
    if (!isRecord(data.runtime)) errors.push("runtime must be an object");
    else {
      errors.push(...unknownKeys(data.runtime, ["paramorphic", "hosts"], "runtime"));
      if (!nonEmpty(data.runtime.paramorphic)) errors.push("runtime.paramorphic must be a non-empty version string");
      if (!Array.isArray(data.runtime.hosts) || data.runtime.hosts.length === 0) errors.push("runtime.hosts must be a non-empty array");
      else {
        const seen = new Set<string>();
        data.runtime.hosts.forEach((h, i) => {
          if (typeof h !== "string" || !APP_HOSTS.includes(h)) errors.push(`runtime.hosts[${i}] must be one of ${APP_HOSTS.join(", ")}`);
          else if (seen.has(h)) errors.push(`runtime.hosts[${i}] "${h}" is duplicated`);
          else seen.add(h);
        });
      }
    }
  }

  if (data.capabilities !== undefined) {
    if (!Array.isArray(data.capabilities)) errors.push("capabilities must be an array of { name, required } declarations");
    else {
      const seen = new Set<string>();
      data.capabilities.forEach((c, i) => {
        const where = `capabilities[${i}]`;
        if (!isRecord(c)) { errors.push(`${where} must be an object { name, required }`); return; }
        errors.push(...unknownKeys(c, ["name", "required"], where));
        if (typeof c.name !== "string" || !APP_CAPABILITIES.includes(c.name)) {
          errors.push(`${where}.name must be one of ${APP_CAPABILITIES.join(", ")}`);
        } else if (seen.has(c.name)) errors.push(`${where}.name "${c.name}" is duplicated`);
        else seen.add(c.name);
        if (typeof c.required !== "boolean") errors.push(`${where}.required must be a boolean (settled decision 5: every capability is declared required or optional, explicitly)`);
      });
    }
  }

  errors.push(...ioErrors(data.io, kind));
  return errors;
}

/** Parse + validate, in the loaders' idiom: ok with the typed manifest, or
 *  the full structured error list — never a partial manifest. */
export function loadManifest(data: unknown): { ok: true; manifest: AppManifest } | { ok: false; errors: string[] } {
  const errors = validateManifest(data);
  return errors.length ? { ok: false, errors } : { ok: true, manifest: data as AppManifest };
}

/** Formats a manifest ref can carry. The three document formats have
 *  loaders today; `"actions"` (D2) and `"theme-plan"` (D8) are named so
 *  callers handle those refs explicitly instead of silently skipping
 *  them — no loader exists for either yet. */
export type ManifestRefFormat = AppDocumentFormat | "actions" | "theme-plan";

/** Every file a manifest names, with the format it must load under — the
 *  host-resolution step 2 checklist. */
export function manifestRefs(manifest: AppManifest): Array<{ where: string; format: ManifestRefFormat; ref: string }> {
  const refs: Array<{ where: string; format: ManifestRefFormat; ref: string }> = [];
  if (manifest.entry.type !== "code") {
    refs.push({ where: "entry", format: ENTRY_FORMAT[manifest.entry.type], ref: manifest.entry.ref });
  }
  for (const slot of manifest.documents ?? []) {
    refs.push({ where: `documents.${slot.slot}`, format: slot.format, ref: slot.ref });
  }
  if (manifest.shell !== undefined) refs.push({ where: "shell", format: "paramorphic-shell/1", ref: manifest.shell });
  if (manifest.actions !== undefined) refs.push({ where: "actions", format: "actions", ref: manifest.actions });
  if (isRecord(manifest.theme) && typeof manifest.theme.ref === "string") {
    refs.push({ where: "theme", format: "theme-plan", ref: manifest.theme.ref });
  }
  return refs;
}
