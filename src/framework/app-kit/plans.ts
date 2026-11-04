import { createPlanInventory } from '../plan-inventory';
import { createMorphRegistry, type ScopedAppliedMorph } from '../morphs/scoped';
import { actionRegistry, type ActionRegistry, type ActionSpec } from '../actions';

export type MenuItem = { id: string; label: string; action?: string; disabled?: boolean };
export type MenuGroup = { id: string; label: string; items: MenuItem[] };
export type ShellPlan = { schema: 'paramorphic-shell/1'; layout: 'sidebar' | 'split' | 'columns'; title: string; slots: string[]; widths: number[]; menus?: MenuGroup[]; toolbar?: MenuItem[]; dialogs?: Array<{ id: string; title: string; message: string }>; actions?: ActionSpec[] };
function validateShell(data: unknown): { ok: true; plan: ShellPlan } | { ok: false; errors: string[] } {
  const p = data as ShellPlan;
  if (!p || p.schema !== 'paramorphic-shell/1' || !['sidebar', 'split', 'columns'].includes(p.layout) || typeof p.title !== 'string' || !Array.isArray(p.slots) || !Array.isArray(p.widths) || p.slots.length !== p.widths.length || p.slots.length !== (p.layout === 'columns' ? 3 : 2) || new Set(p.slots).size !== p.slots.length || p.slots.some(s => typeof s !== 'string' || !s) || p.widths.some(w => !Number.isFinite(w) || w <= 0)) return { ok: false, errors: ['Invalid shell plan'] };
  if (p.menus !== undefined && (!Array.isArray(p.menus) || p.menus.some(m => !m || typeof m.id !== 'string' || !m.id || typeof m.label !== 'string' || !m.label || !Array.isArray(m.items) || m.items.some(i => !i || typeof i.id !== 'string' || !i.id || typeof i.label !== 'string' || !i.label || (i.disabled !== undefined && typeof i.disabled !== 'boolean')) || new Set(m.items.map(i => i.id)).size !== m.items.length) || new Set(p.menus.map(m => m.id)).size !== p.menus.length)) return { ok: false, errors: ['Invalid shell menus'] };
  if (p.toolbar !== undefined && (!Array.isArray(p.toolbar) || p.toolbar.some(i => !i || typeof i.id !== 'string' || !i.id || typeof i.label !== 'string' || !i.label || (i.disabled !== undefined && typeof i.disabled !== 'boolean')) || new Set(p.toolbar.map(i => i.id)).size !== p.toolbar.length)) return { ok: false, errors: ['Invalid shell toolbar'] };
  if (p.dialogs !== undefined && (!Array.isArray(p.dialogs) || p.dialogs.some(d => !d || typeof d.id !== 'string' || !d.id || typeof d.title !== 'string' || !d.title || typeof d.message !== 'string') || new Set(p.dialogs.map(d => d.id)).size !== p.dialogs.length)) return { ok: false, errors: ['Invalid shell dialogs'] };
  if (p.actions !== undefined && (!Array.isArray(p.actions) || p.actions.some(a => !a || typeof a.id !== 'string' || !a.id || typeof a.do !== 'string' || !a.do) || new Set(p.actions.map(a => a.id)).size !== p.actions.length)) return { ok: false, errors: ['Invalid shell actions'] };
  const controls = [...(p.menus ?? []).flatMap(m => m.items), ...(p.toolbar ?? [])];
  if (controls.some(i => i.action !== undefined && (typeof i.action !== 'string' || !i.action))) return { ok: false, errors: ['Control action must be a non-empty string'] };
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
  return errors;
}

export type ShellPlanFile = { schema: 'paramorphic-shell/2'; base: ShellPlan; morphs: ScopedAppliedMorph[] };
export const shellRegistry = createMorphRegistry<ShellPlan>();
const baseShell = (): ShellPlan => ({ schema: 'paramorphic-shell/1', layout: 'sidebar', title: '', slots: ['navigation', 'content'], widths: [1, 1] });
const cloneShell = (state: ShellPlan): ShellPlan => JSON.parse(JSON.stringify(state));

// Each definition captures its own prior configuration for inverse/history.
for (const name of ['title', 'layout', 'menus', 'toolbar', 'dialogs', 'actions'] as const) {
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
for (const [id, slots, widths] of [
  ['sidebar', ['navigation', 'content'], [1, 3]],
  ['split', ['first', 'second'], [1, 1]],
  ['columns', ['first', 'second', 'third'], [1, 1, 1]],
] as const) {
  appKit.register({ id, label: id, description: `${id} shell layout`, parameters: [{ name: 'title', type: 'string', description: 'Shell title' }],
    validate: p => !p || typeof p !== 'object' || Array.isArray(p) || (('title' in p) && typeof (p as {title: unknown}).title !== 'string') ? ['parameters must be an object with an optional title'] : [],
    build: (p: {title?: string}) => shellPlanFromState({ schema: 'paramorphic-shell/1', layout: id, title: p.title ?? 'Browser', slots: [...slots], widths: [...widths] }) });
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
