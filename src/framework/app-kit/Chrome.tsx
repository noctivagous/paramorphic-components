import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { runAction, type ActionContext } from '../actions';
import { GridLayout } from './GridLayout';
import type { DialogField, MenuGroup, MenuItem, ShellDialog, ShellPlan } from './plans';

const btn: React.CSSProperties = { padding: '4px 10px', borderRadius: 999, fontSize: 10, border: '1px solid var(--border)', background: 'var(--bg-3)', color: 'var(--text)' };

export function controlDisabled(item: MenuItem, availability?: Record<string, boolean>): boolean {
  const id = item.action ?? item.id;
  return availability && Object.prototype.hasOwnProperty.call(availability, id) ? !availability[id] : !!item.disabled;
}

export function shortcutMatches(shortcut: string, event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>): boolean {
  const parts = shortcut.split('+').map(part => part.trim().toLowerCase());
  const key = parts[parts.length - 1];
  if (!key) return false;
  if (parts.includes('mod') !== (event.metaKey || event.ctrlKey)) return false;
  if (parts.includes('shift') !== event.shiftKey) return false;
  if (parts.includes('alt') !== event.altKey) return false;
  return event.key.toLowerCase() === key || event.code.toLowerCase() === `key${key}`;
}

function editingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
}

function shortcutsFrom(plan: ShellPlan): Array<{ id: string; shortcut: string }> {
  return [...(plan.menus ?? []).flatMap(menu => menu.items), ...(plan.toolbar ?? [])]
    .filter(item => item.shortcut)
    .map(item => ({ id: item.action ?? item.id, shortcut: item.shortcut! }));
}

export function AppToolbar({ items, onAction, availability }: { items: MenuItem[]; onAction: (id: string) => void; availability?: Record<string, boolean> }) {
  return <div role="group" aria-label="Application toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '12px 0' }}>
    {items.map(item => <button key={item.id} type="button" disabled={controlDisabled(item, availability)} style={btn} onClick={() => onAction(item.action ?? item.id)}>{item.label}</button>)}
  </div>;
}

/** Plan-configured menu buttons; actions are supplied by the host. */
export function AppMenubar({ menus, onAction, availability }: { menus: MenuGroup[]; onAction: (id: string) => void; availability?: Record<string, boolean> }) {
  const [open, setOpen] = useState<string | null>(null);
  const root = useRef<HTMLElement>(null);
  const id = useId();
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(null); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  return <nav ref={root} aria-label="Application menu" style={{ display: 'flex', gap: 4 }} onKeyDown={e => {
    if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(null); (root.current?.querySelector(`[data-menu-index="${menus.findIndex(m => m.id === open)}"]`) as HTMLElement | null)?.focus(); }
  }}>
    {menus.map((menu, index) => <div key={menu.id} style={{ position: 'relative' }}>
      <button type="button" data-menu-index={index} aria-expanded={open === menu.id} aria-controls={`${id}-${index}`} style={btn} onClick={() => setOpen(open === menu.id ? null : menu.id)}>{menu.label}</button>
      {open === menu.id && <div id={`${id}-${index}`} role="group" aria-label={menu.label} style={{ position: 'absolute', zIndex: 10, minWidth: 200, padding: 4, background: 'var(--bg-3)', border: '1px solid var(--border)' }}>
        {menu.items.map(item => <button key={item.id} type="button" disabled={controlDisabled(item, availability)} aria-keyshortcuts={item.shortcut} style={{ display: 'flex', width: '100%', justifyContent: 'space-between', gap: 12, textAlign: 'left', padding: 6, background: 'transparent', color: 'var(--text)', opacity: controlDisabled(item, availability) ? 0.4 : 1 }} onClick={() => { setOpen(null); onAction(item.action ?? item.id); }}><span>{item.label}</span>{item.shortcut && <span style={{ color: 'var(--text-faint)' }}>{item.shortcut}</span>}</button>)}
      </div>}
    </div>)}
  </nav>;
}

function fieldValue(field: DialogField, raw: unknown): unknown {
  if (field.type === 'boolean') return raw === true;
  if (field.type === 'integer') {
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) ? n : field.value;
  }
  return raw == null ? '' : String(raw);
}

/** Native modal dialog provides focus trapping, Escape and focus restoration. */
export function AppDialog({ open, title, children, onClose, fields, submitLabel, onSubmit }: {
  open: boolean; title: string; children?: React.ReactNode; onClose: () => void;
  fields?: DialogField[]; submitLabel?: string; onSubmit?: (values: Record<string, unknown>) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [values, setValues] = useState<Record<string, unknown>>({});
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  useEffect(() => {
    if (open) setValues(Object.fromEntries((fields ?? []).map(field => [field.id, field.value ?? (field.type === 'boolean' ? false : field.type === 'integer' ? 0 : '')])));
  }, [open, fields]);
  return <dialog ref={ref} aria-labelledby={titleId} onCancel={e => { e.preventDefault(); onClose(); }} onClose={() => { if (open) onClose(); }} style={{ color: 'var(--text)', background: 'var(--bg-3)', border: '1px solid var(--border)', padding: 20, maxWidth: 'min(90vw, 480px)' }}>
    <h2 id={titleId}>{title}</h2>
    <div>{children}</div>
    {fields && fields.length > 0 && <form onSubmit={e => { e.preventDefault(); onSubmit?.(Object.fromEntries(fields.map(field => [field.id, fieldValue(field, values[field.id])]))); }} style={{ display: 'grid', gap: 8, marginTop: 12 }}>
      {fields.map((field, index) => <label key={field.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ minWidth: 80 }}>{field.label}</span>
        {field.type === 'boolean' ? <input aria-label={field.label} type="checkbox" checked={values[field.id] === true} autoFocus={index === 0} onChange={e => { const checked = e.currentTarget.checked; setValues(v => ({ ...v, [field.id]: checked })); }} /> :
          <input aria-label={field.label} type={field.type === 'integer' ? 'number' : 'text'} min={field.min} max={field.max} value={Number.isNaN(values[field.id]) ? '' : values[field.id] as string | number ?? ''} autoFocus={index === 0} onChange={e => { const next = field.type === 'integer' ? e.currentTarget.valueAsNumber : e.currentTarget.value; setValues(v => ({ ...v, [field.id]: next })); }} style={{ ...btn, borderRadius: 6, width: 80 }} />}
      </label>)}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" style={btn} onClick={onClose}>Cancel</button>
        <button type="submit" style={btn}>{submitLabel ?? 'OK'}</button>
      </div>
    </form>}
    {(!fields || fields.length === 0) && <button type="button" onClick={onClose} autoFocus style={{ ...btn, marginTop: 12 }}>Close</button>}
  </dialog>;
}

export function AppStatus({ items, values }: { items: Array<{ id: string; label: string }>; values?: Record<string, string> }) {
  if (items.length === 0) return null;
  return <footer aria-label="Application status" style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 12, paddingTop: 8, borderTop: '1px solid var(--border)', color: 'var(--text-faint)', fontSize: 10 }}>
    {items.map(item => <span key={item.id}>{item.label}: {values?.[item.id] ?? '—'}</span>)}
  </footer>;
}

/** Plan-driven window chrome: menus, toolbar, dialogs, layout, status, and shortcuts. */
export function AppShell({ plan, slots, context, availability, status, notices, errors }: {
  plan: ShellPlan;
  slots: Record<string, React.ReactNode>;
  context?: ActionContext;
  availability?: Record<string, boolean>;
  status?: Record<string, string>;
  notices?: string[];
  errors?: string[];
}) {
  const [dialog, setDialog] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const contextRef = useRef(context);
  contextRef.current = context;
  const run = useCallback(async (id: string, value?: unknown) => {
    setActionError('');
    const result = await runAction(id, plan.actions ?? [], {
      openDialog: target => setDialog(target),
      closeDialog: () => setDialog(null),
      ...contextRef.current,
    }, undefined, value);
    if (!result.ok) setActionError(result.errors.join('; '));
    else if (plan.dialogs?.some(d => d.submit === id)) setDialog(null);
  }, [plan]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const match = shortcutsFrom(plan).find(item => shortcutMatches(item.shortcut, event));
      if (!match) return;
      if (editingTarget(event.target) && (match.id === 'undo' || match.id === 'redo')) return;
      event.preventDefault();
      void run(match.id);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [plan, run]);
  const active = plan.dialogs?.find(d => d.id === dialog);
  const shownErrors = [...(errors ?? []), ...(actionError ? [actionError] : [])];
  return <main style={{ padding: 16 }}>
    <div style={{ fontSize: 10, letterSpacing: '0.18em', color: 'var(--text-faint)' }}>A PARAMORPHIC APP</div>
    <h1 style={{ fontSize: 15, fontWeight: 700, margin: '4px 0 8px' }}>{plan.title}</h1>
    <AppMenubar menus={plan.menus ?? []} onAction={id => void run(id)} availability={availability} />
    <AppToolbar items={plan.toolbar ?? []} onAction={id => void run(id)} availability={availability} />
    <AppDialog open={!!active} title={active?.title ?? ''} onClose={() => setDialog(null)} fields={active?.fields} submitLabel={active?.submitLabel} onSubmit={values => { if (active?.submit) void run(active.submit, values); }}>
      {active?.message}
    </AppDialog>
    {shownErrors.length > 0 && <div role="alert" style={{ margin: '8px 0', padding: 8, border: '1px solid #ff5a3c', background: 'rgba(255,90,60,0.12)', color: '#ff8a6b', fontSize: 9 }}>{shownErrors.map((err, i) => <div key={i}>• {err}</div>)}</div>}
    {(notices ?? []).map((notice, i) => <div key={i} role="status" style={{ margin: '8px 0', padding: 8, border: '1px solid var(--border)', background: 'var(--lime-bg)', color: 'var(--text-dim)', fontSize: 9 }}>{notice}</div>)}
    <GridLayout plan={plan} slots={slots} />
    <AppStatus items={plan.status ?? []} values={status} />
  </main>;
}
