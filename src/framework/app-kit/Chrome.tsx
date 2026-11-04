import React, { useEffect, useId, useRef, useState } from 'react';
import type { MenuGroup, MenuItem } from './plans';

export function AppToolbar({ items, onAction }: { items: MenuItem[]; onAction: (id: string) => void }) {
  return <div role="group" aria-label="Application toolbar" style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
    {items.map(item => <button key={item.id} type="button" disabled={item.disabled} onClick={() => onAction(item.action ?? item.id)}>{item.label}</button>)}
  </div>;
}

/** Plan-configured menu buttons; actions are supplied by the host. */
export function AppMenubar({ menus, onAction }: { menus: MenuGroup[]; onAction: (id: string) => void }) {
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
      <button type="button" data-menu-index={index} aria-expanded={open === menu.id} aria-controls={`${id}-${index}`} onClick={() => setOpen(open === menu.id ? null : menu.id)}>{menu.label}</button>
      {open === menu.id && <div id={`${id}-${index}`} role="group" aria-label={menu.label} style={{ position: 'absolute', zIndex: 10, minWidth: 160, padding: 4, background: 'var(--bg-3)', border: '1px solid var(--border)' }}>
        {menu.items.map(item => <button key={item.id} type="button" disabled={item.disabled} style={{ display: 'block', width: '100%', textAlign: 'left', padding: 6 }} onClick={() => { setOpen(null); onAction(item.action ?? item.id); }}>{item.label}</button>)}
      </div>}
    </div>)}
  </nav>;
}

/** Native modal dialog provides focus trapping, Escape and focus restoration. */
export function AppDialog({ open, title, children, onClose }: { open: boolean; title: string; children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return <dialog ref={ref} aria-labelledby={titleId} onCancel={e => { e.preventDefault(); onClose(); }} onClose={() => { if (open) onClose(); }} style={{ color: 'var(--text)', background: 'var(--bg-3)', border: '1px solid var(--border)', padding: 20, maxWidth: 'min(90vw, 480px)' }}>
    <h2 id={titleId}>{title}</h2><div>{children}</div><button type="button" onClick={onClose} autoFocus>Close</button>
  </dialog>;
}
