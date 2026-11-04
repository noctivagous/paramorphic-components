import React, { useEffect, useMemo, useState } from 'react';
import { GridLayout } from '../../../src/framework/app-kit/GridLayout';
import { AppDialog, AppMenubar, AppToolbar } from '../../../src/framework/app-kit/Chrome';
import { appKit } from '../../../src/framework/app-kit/plans';
import { runAction } from '../../../src/framework/actions';
import { chooseLocalAdapter, createSampleAdapter, type BrowserAdapter } from '../../../src/framework/app-kit/browser';
import type { TreeNode, TreeState } from '../../../src/framework/tree-state';

const recipe = appKit.instantiate('browser', { title: 'File browser' });
if (!recipe.ok) throw new Error(recipe.errors.join('; '));
const plan = recipe.plan;
type Preview = { kind: 'text' | 'image' | 'metadata'; value: string; name: string; size: number };

export default function App() {
  const [adapter, setAdapter] = useState<BrowserAdapter>(() => createSampleAdapter());
  const [path, setPath] = useState<TreeNode[]>(() => [adapter.root]);
  const [tree, setTree] = useState<TreeState>(() => ({ nodes: [adapter.root] }));
  const [selected, setSelected] = useState<TreeNode | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState<string | null>(null);
  const folders = path.slice(-3);
  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all(path.map(p => adapter.list(p))).then(groups => {
      if (active) { setTree({ nodes: [adapter.root, ...groups.flat()] }); setError(''); }
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : String(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [adapter, path]);
  useEffect(() => {
    let active = true;
    let url: string | undefined;
    setPreview(null);
    if (selected?.kind === 'file') adapter.read(selected).then(async file => {
      if (!active) return;
      const text = file.type.startsWith('text/') || /\.(txt|md|json|csv|js|ts|tsx|html|css|xml|yaml|yml|log)$/i.test(file.name);
      if (file.type.startsWith('image/')) { url = URL.createObjectURL(file); if (active) setPreview({ kind: 'image', value: url, name: file.name, size: file.size }); }
      else if (text) { const value = await file.slice(0, 1024 * 1024).text(); if (active) setPreview({ kind: 'text', value, name: file.name, size: file.size }); }
      else setPreview({ kind: 'metadata', value: '', name: file.name, size: file.size });
    }).catch(e => { if (active) setError(e instanceof Error ? e.message : String(e)); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [adapter, selected]);
  const select = (node: TreeNode, index: number) => {
    setError(''); setSelected(node);
    if (node.kind === 'folder') setPath([...path.slice(0, index + 1), node]);
    else setPath(path.slice(0, index + 1));
  };
  const slots = useMemo(() => Object.fromEntries(plan.slots.map((slot, i) => {
    const folder = folders[i];
    const index = path.length - folders.length + i;
    const entries = folder ? tree.nodes.filter(n => n.parent === folder.id) : [];
    return [slot, folder ? <div><h2>{folder.label}</h2>{entries.length === 0 && !loading && <p>Empty folder</p>}{entries.map(node => <button key={node.id} onClick={() => select(node, index)} aria-pressed={selected?.id === node.id} style={{ display: 'block', width: '100%', textAlign: 'left', padding: 6, background: selected?.id === node.id ? 'var(--bg-4)' : 'transparent' }}>{node.kind === 'folder' ? '▸ ' : ''}{node.label}</button>)}</div> : <span>—</span>];
  })), [tree, path, selected, loading]);
  const switchAdapter = (next: BrowserAdapter) => { setAdapter(next); setPath([next.root]); setTree({ nodes: [next.root] }); setSelected(null); setError(''); };
  const action = async (id: string) => {
    const requireBrowser = (target: string) => { if (target !== 'browser') throw new Error(`Unknown browser target "${target}"`); };
    const result = await runAction(id, plan.actions ?? [], {
      openDialog: target => setDialog(target),
      closeDialog: () => setDialog(null),
      useSample: target => { requireBrowser(target); switchAdapter(createSampleAdapter()); },
      chooseFolder: async target => {
        requireBrowser(target);
        try { switchAdapter(await chooseLocalAdapter()); }
        catch (e) { if ((e as Error)?.name !== 'AbortError') throw e; }
      },
    });
    if (!result.ok) setError(result.errors.join('; '));
  };
  const activeDialog = plan.dialogs?.find(d => d.id === dialog);
  return <main style={{ padding: 20 }}><h1>{plan.title}</h1><AppMenubar menus={plan.menus ?? []} onAction={action} /><AppToolbar items={plan.toolbar ?? []} onAction={action} />
    <AppDialog open={!!activeDialog} title={activeDialog?.title ?? ''} onClose={() => setDialog(null)}>{activeDialog?.message}</AppDialog>
    <nav aria-label="Folder path">{path.map((folder, i) => <button key={folder.id} onClick={() => { setPath(path.slice(0, i + 1)); setSelected(null); }}>{i ? ' / ' : ''}{folder.label}</button>)}</nav>
    {loading && <p role="status">Loading folders…</p>}{error && <p role="alert">{error}</p>}
    <GridLayout plan={plan} slots={slots} />
    <section aria-label="Preview" style={{ marginTop: 16 }}><h2>Preview</h2>{preview ? <><p>{preview.name} · {preview.size} bytes</p>{preview.kind === 'text' ? <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{preview.value}</pre> : preview.kind === 'image' ? <img src={preview.value} alt={preview.name} style={{ maxWidth: '100%', maxHeight: 400 }} /> : <p>No preview available.</p>}</> : <p>Select a file.</p>}</section>
  </main>;
}
