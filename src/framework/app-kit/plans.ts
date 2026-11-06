import { createPlanInventory } from '../plan-inventory';
import { createMorphRegistry, type ScopedAppliedMorph } from '../morphs/scoped';
import { actionRegistry, type ActionRegistry, type ActionSpec } from '../actions';

export type MenuItem = { id: string; label: string; action?: string; disabled?: boolean; shortcut?: string };
export type MenuGroup = { id: string; label: string; items: MenuItem[] };
export type DialogField = { id: string; label: string; type: 'integer' | 'text' | 'boolean'; min?: number; max?: number; value?: unknown };
export type ShellDialog = { id: string; title: string; message: string; fields?: DialogField[]; submit?: string; submitLabel?: string };
export type StatusItem = { id: string; label: string };
export type ShellLayout = 'workspace' | 'sidebar' | 'split' | 'columns';
export type ShellPlan = { schema: 'paramorphic-shell/1'; layout: ShellLayout; title: string; slots: string[]; widths: number[]; menus?: MenuGroup[]; toolbar?: MenuItem[]; dialogs?: ShellDialog[]; actions?: ActionSpec[]; status?: StatusItem[] };
const LAYOUT_SLOTS: Record<ShellLayout, number> = { workspace: 1, sidebar: 2, split: 2, columns: 3 };
const FIELD_TYPES: DialogField['type'][] = ['integer', 'text', 'boolean'];
function invalidControl(i: MenuItem | undefined): boolean {
  return !i || typeof i.id !== 'string' || !i.id || typeof i.label !== 'string' || !i.label || (i.disabled !== undefined && typeof i.disabled !== 'boolean') || (i.shortcut !== undefined && (typeof i.shortcut !== 'string' || !i.shortcut)) || (i.action !== undefined && (typeof i.action !== 'string' || !i.action));
}
function invalidFields(fields: DialogField[] | undefined): boolean {
  if (fields === undefined) return false;
  if (!Array.isArray(fields)) return true;
  const ids = new Set<string>();
  for (const f of fields) {
    if (!f || typeof f.id !== 'string' || !f.id || typeof f.label !== 'string' || !f.label || !FIELD_TYPES.includes(f.type) || ids.has(f.id)) return true;
    ids.add(f.id);
    if ((f.min !== undefined && typeof f.min !== 'number') || (f.max !== undefined && typeof f.max !== 'number')) return true;
  }
  return false;
}
function validateShell(data: unknown): { ok: true; plan: ShellPlan } | { ok: false; errors: string[] } {
  const p = data as ShellPlan;
  if (!p || p.schema !== 'paramorphic-shell/1' || !(p.layout in LAYOUT_SLOTS) || typeof p.title !== 'string' || !Array.isArray(p.slots) || !Array.isArray(p.widths) || p.slots.length !== p.widths.length || p.slots.length !== LAYOUT_SLOTS[p.layout] || new Set(p.slots).size !== p.slots.length || p.slots.some(s => typeof s !== 'string' || !s) || p.widths.some(w => !Number.isFinite(w) || w <= 0)) return { ok: false, errors: ['Invalid shell plan'] };
  if (p.menus !== undefined && (!Array.isArray(p.menus) || p.menus.some(m => !m || typeof m.id !== 'string' || !m.id || typeof m.label !== 'string' || !m.label || !Array.isArray(m.items) || m.items.some(invalidControl) || new Set(m.items.map(i => i.id)).size !== m.items.length) || new Set(p.menus.map(m => m.id)).size !== p.menus.length)) return { ok: false, errors: ['Invalid shell menus'] };
  if (p.toolbar !== undefined && (!Array.isArray(p.toolbar) || p.toolbar.some(invalidControl) || new Set(p.toolbar.map(i => i.id)).size !== p.toolbar.length)) return { ok: false, errors: ['Invalid shell toolbar'] };
  if (p.dialogs !== undefined && (!Array.isArray(p.dialogs) || p.dialogs.some(d => !d || typeof d.id !== 'string' || !d.id || typeof d.title !== 'string' || !d.title || typeof d.message !== 'string' || (d.submit !== undefined && (typeof d.submit !== 'string' || !d.submit)) || (d.submitLabel !== undefined && (typeof d.submitLabel !== 'string' || !d.submitLabel)) || invalidFields(d.fields)) || new Set(p.dialogs.map(d => d.id)).size !== p.dialogs.length)) return { ok: false, errors: ['Invalid shell dialogs'] };
  if (p.actions !== undefined && (!Array.isArray(p.actions) || p.actions.some(a => !a || typeof a.id !== 'string' || !a.id || typeof a.do !== 'string' || !a.do) || new Set(p.actions.map(a => a.id)).size !== p.actions.length)) return { ok: false, errors: ['Invalid shell actions'] };
  if (p.status !== undefined && (!Array.isArray(p.status) || p.status.some(s => !s || typeof s.id !== 'string' || !s.id || typeof s.label !== 'string' || !s.label) || new Set(p.status.map(s => s.id)).size !== p.status.length)) return { ok: false, errors: ['Invalid shell status'] };
  return { ok: true, plan: p };
}

function validateShellActionBindings(plan: ShellPlan, registry: ActionRegistry): string[] {
  if (plan.actions === undefined) return []; // Snapshot-only legacy shells use host handlers.
  const errors: string[] = [];
  for (const action of plan.actions) {
    errors.push(...registry.validate(action).map(e => `action "${action.id}": ${e}`));
    if ((action.do === 'dialog.open' || action.do === 'dialog.close') && !plan.dialogs?.some(d => d.id === action.target)) errors.push(`action "${action.id}" references unknown dialog "${action.target}"`);
  }
  for (const control of [...(plan.menus ?? []).flatMap(m => m.items), ...(plan.toolbar ?? [])]) {
    const id = control.action ?? control.id;
    if (!plan.actions.some(a => a.id === id)) errors.push(`control "${control.id}" references unknown action "${id}"`);
  }
  for (const dialog of plan.dialogs ?? []) {
    if (dialog.submit && !plan.actions.some(a => a.id === dialog.submit)) errors.push(`dialog "${dialog.id}" submit references unknown action "${dialog.submit}"`);
  }
  return errors;
}

export type ShellPlanFile = { schema: 'paramorphic-shell/2'; base: ShellPlan; morphs: ScopedAppliedMorph[] };
export const shellRegistry = createMorphRegistry<ShellPlan>();
const baseShell = (): ShellPlan => ({ schema: 'paramorphic-shell/1', layout: 'sidebar', title: '', slots: ['navigation', 'content'], widths: [1, 1] });
const cloneShell = (state: ShellPlan): ShellPlan => JSON.parse(JSON.stringify(state));

// Each definition captures its own prior configuration for inverse/history.
for (const name of ['title', 'layout', 'menus', 'toolbar', 'dialogs', 'actions', 'status'] as const) {
  shellRegistry.register<{ value: unknown }>({
    name: `shell.${name}`, describe: `Configure shell ${name}`, invertible: true,
    validate: p => !p || typeof p !== 'object' || !('value' in p) ? ['params must contain value'] : [],
    check: (state, p) => {
      const candidate = name === 'layout' ? { ...state, ...(p.value && typeof p.value === 'object' ? p.value : {}) } : { ...state, [name]: p.value };
      if (name === 'layout' && (!p.value || typeof p.value !== 'object' || Array.isArray(p.value) || !('layout' in p.value) || !('slots' in p.value) || !('widths' in p.value) || Object.keys(p.value).some(k => !['layout', 'slots', 'widths'].includes(k)))) return ['layout needs layout, slots and widths'];
      const checked = validateShell(candidate);
      return checked.ok ? [] : checked.errors;
    },
    capture: state => ({ previous: cloneShell(state) }),
    apply: (state, p) => name === 'layout' ? { ...state, ...(p.value as Pick<ShellPlan, 'layout' | 'slots' | 'widths'>) } : { ...state, [name]: p.value },
    invert: (_state, _p, frame) => {
      const previous = (frame as { previous?: unknown } | undefined)?.previous;
      const checked = validateShell(previous);
      if (!checked.ok) throw new Error('Missing or invalid inverse frame');
      return cloneShell(checked.plan);
    },
  });
}

/** Materialize a shell description as a portable, replayable morph plan. */
export function shellPlanFromState(state: ShellPlan): ShellPlanFile {
  return { schema: 'paramorphic-shell/2', base: baseShell(), morphs: [
    { name: 'shell.title', params: { value: state.title } },
    { name: 'shell.layout', params: { value: { layout: state.layout, slots: state.slots, widths: state.widths } } },
    ...(state.menus ? [{ name: 'shell.menus', params: { value: state.menus } }] : []),
    ...(state.toolbar ? [{ name: 'shell.toolbar', params: { value: state.toolbar } }] : []),
    ...(state.dialogs ? [{ name: 'shell.dialogs', params: { value: state.dialogs } }] : []),
    ...(state.actions ? [{ name: 'shell.actions', params: { value: state.actions } }] : []),
    ...(state.status ? [{ name: 'shell.status', params: { value: state.status } }] : []),
  ] };
}

export function loadShellPlan(data: unknown, registry: ActionRegistry = actionRegistry): { ok: true; plan: ShellPlan } | { ok: false; errors: string[] } {
  if (!data || typeof data !== 'object') return { ok: false, errors: ['Shell plan must be an object'] };
  const file = data as ShellPlanFile;
  // Existing snapshot-only shell files remain readable.
  if (file.schema === ('paramorphic-shell/1' as string)) {
    const snapshot = validateShell(data);
    if (!snapshot.ok) return snapshot;
    const errors = validateShellActionBindings(snapshot.plan, registry);
    return errors.length ? { ok: false, errors } : snapshot;
  }
  if (file.schema !== 'paramorphic-shell/2') return { ok: false, errors: ['Unsupported shell plan version'] };
  const base = validateShell(file.base);
  if (!base.ok) return { ok: false, errors: base.errors.map(e => `base: ${e}`) };
  const errors = shellRegistry.validateChain(file.morphs);
  if (errors.length) return { ok: false, errors };
  const replayed = shellRegistry.replayMorphsChecked(base.plan, file.morphs, {}, cloneShell);
  if (!replayed.ok) return replayed;
  const checked = validateShell(replayed.state);
  if (!checked.ok) return checked;
  const actionErrors = validateShellActionBindings(checked.plan, registry);
  return actionErrors.length ? { ok: false, errors: actionErrors } : checked;
}
export const appKit = createPlanInventory(loadShellPlan);
const titleOnly = (p: unknown) => !p || typeof p !== 'object' || Array.isArray(p) || (('title' in p) && typeof (p as {title: unknown}).title !== 'string') ? ['parameters must be an object with an optional title'] : [];
for (const [id, slots, widths] of [
  ['workspace', ['content'], [1]],
  ['sidebar', ['navigation', 'content'], [1, 3]],
  ['split', ['first', 'second'], [1, 1]],
  ['columns', ['first', 'second', 'third'], [1, 1, 1]],
] as const) {
  appKit.register({ id, label: id, description: `${id} shell layout`, parameters: [{ name: 'title', type: 'string', description: 'Shell title' }],
    validate: titleOnly,
    build: (p: {title?: string}) => shellPlanFromState({ schema: 'paramorphic-shell/1', layout: id, title: p.title ?? id, slots: [...slots], widths: [...widths] }) });
}
appKit.register({ id: 'browser', label: 'Three-column browser', description: 'Three-column navigation shell',
  parameters: [{ name: 'title', type: 'string', description: 'Browser title' }],
  validate: p => !p || typeof p !== 'object' || Array.isArray(p) || ('title' in p && typeof (p as {title: unknown}).title !== 'string') ? ['parameters must be an object with an optional title'] : [],
  build: (p: {title?: string}) => shellPlanFromState({ schema: 'paramorphic-shell/1', layout: 'columns', title: p.title ?? 'File browser', slots: ['first', 'second', 'third'], widths: [1, 1, 1], menus: [
    { id: 'file', label: 'File', items: [{ id: 'sample', label: 'Sample files' }, { id: 'open-folder', label: 'Open local folder…' }] },
    { id: 'help', label: 'Help', items: [{ id: 'about', label: 'About' }] },
  ], toolbar: [{ id: 'sample', label: 'Sample files' }, { id: 'open-folder', label: 'Open local folder…' }], dialogs: [{ id: 'about', title: 'About File browser', message: 'Browse sample files or choose a local folder. Files are opened read-only.' }], actions: [
    { id: 'sample', do: 'storage.useSample', target: 'browser' },
    { id: 'open-folder', do: 'storage.chooseFolder', target: 'browser' },
    { id: 'about', do: 'dialog.open', target: 'about' },
  ] }),
});
appKit.register({ id: 'spreadsheet', label: 'Spreadsheet', description: 'Sidebar sheet editor with file, edit, and formula dialogs',
  parameters: [{ name: 'title', type: 'string', description: 'Window title' }],
  validate: titleOnly,
  build: (p: {title?: string}) => shellPlanFromState({ schema: 'paramorphic-shell/1', layout: 'sidebar', title: p.title ?? 'Spreadsheet', slots: ['inspector', 'sheet'], widths: [1, 4], menus: [
    { id: 'file', label: 'File', items: [
      { id: 'new', label: 'New sheet…', shortcut: 'Mod+N' },
      { id: 'open', label: 'Open…', shortcut: 'Mod+O' },
      { id: 'save', label: 'Save', shortcut: 'Mod+S' },
      { id: 'reload', label: 'Reload file' },
    ] },
    { id: 'edit', label: 'Edit', items: [
      { id: 'undo', label: 'Undo', shortcut: 'Mod+Z' },
      { id: 'redo', label: 'Redo', shortcut: 'Mod+Shift+Z' },
    ] },
    { id: 'help', label: 'Help', items: [{ id: 'about', label: 'About' }] },
  ], toolbar: [
    { id: 'new', label: 'New' }, { id: 'open', label: 'Open' }, { id: 'save', label: 'Save' },
    { id: 'undo', label: 'Undo' }, { id: 'redo', label: 'Redo' },
  ], dialogs: [
    { id: 'about', title: 'About Spreadsheet', message: 'Edit cells from a morph-plan. Save writes a replayable plan; Open validates it before it becomes a sheet.' },
    { id: 'new', title: 'New sheet', message: 'Choose dimensions and whether formulas are enabled.', submit: 'create', submitLabel: 'Create', fields: [
      { id: 'width', label: 'Columns', type: 'integer', min: 1, max: 64, value: 5 },
      { id: 'height', label: 'Rows', type: 'integer', min: 1, max: 64, value: 4 },
      { id: 'formulas', label: 'Formulas', type: 'boolean', value: true },
    ] },
  ], actions: [
    { id: 'new', do: 'dialog.open', target: 'new' },
    { id: 'create', do: 'document.new', target: 'sheet' },
    { id: 'open', do: 'document.open', target: 'sheet' },
    { id: 'save', do: 'document.save', target: 'sheet' },
    { id: 'reload', do: 'document.reload', target: 'sheet' },
    { id: 'undo', do: 'history.undo', target: 'sheet' },
    { id: 'redo', do: 'history.redo', target: 'sheet' },
    { id: 'about', do: 'dialog.open', target: 'about' },
  ], status: [
    { id: 'size', label: 'Size' }, { id: 'cells', label: 'Cells' }, { id: 'history', label: 'History' }, { id: 'errors', label: 'Errors' },
    { id: 'sum', label: 'Sum' }, { id: 'avg', label: 'Avg' }, { id: 'count', label: 'Count' }, { id: 'min', label: 'Min' }, { id: 'max', label: 'Max' },
  ] }),
});
