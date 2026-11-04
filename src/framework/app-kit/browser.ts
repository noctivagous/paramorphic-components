import type { TreeNode } from '../tree-state';

export type BrowserAdapter = { root: TreeNode; list(parent: TreeNode): Promise<TreeNode[]>; read(node: TreeNode): Promise<File> };
export function children(nodes: TreeNode[], parent: string): TreeNode[] {
  return nodes.filter(n => n.parent === parent).sort((a, b) => a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === 'folder' ? -1 : 1);
}
export function createSampleAdapter(): BrowserAdapter {
  const root: TreeNode = { id: '/', kind: 'folder', parent: null, label: 'Sample files' };
  const nodes: TreeNode[] = [
    { id: '/documents', kind: 'folder', parent: '/', label: 'Documents' },
    { id: '/pictures', kind: 'folder', parent: '/', label: 'Pictures' },
    { id: '/documents/notes', kind: 'folder', parent: '/documents', label: 'Notes' },
    { id: '/documents/notes/welcome.txt', kind: 'file', parent: '/documents/notes', label: 'welcome.txt' },
    { id: '/documents/readme.txt', kind: 'file', parent: '/documents', label: 'readme.txt' },
  ];
  return { root, async list(parent) { return children(nodes, parent.id); }, async read(node) { return new File([`Sample file: ${node.label}\n`], node.label, { type: 'text/plain' }); } };
}

type DirectoryHandle = { name: string; kind: 'directory'; values(): AsyncIterable<DirectoryHandle | FileHandle> };
type FileHandle = { name: string; kind: 'file'; getFile(): Promise<File> };
export async function chooseLocalAdapter(): Promise<BrowserAdapter> {
  const picker = (window as unknown as { showDirectoryPicker?: () => Promise<DirectoryHandle> }).showDirectoryPicker;
  if (!picker) throw new Error('Local folder access is not supported by this browser.');
  const rootHandle = await picker.call(window);
  const handles = new Map<string, DirectoryHandle | FileHandle>([['/', rootHandle]]);
  const root: TreeNode = { id: '/', kind: 'folder', parent: null, label: rootHandle.name };
  return { root, async list(parent) {
    const handle = handles.get(parent.id);
    if (!handle || handle.kind !== 'directory') throw new Error('Folder is unavailable.');
    const nodes: TreeNode[] = [];
    for await (const child of handle.values()) {
      const id = `${parent.id === '/' ? '' : parent.id}/${encodeURIComponent(child.name)}`;
      handles.set(id, child);
      nodes.push({ id, parent: parent.id, label: child.name, kind: child.kind === 'directory' ? 'folder' : 'file' });
    }
    return children(nodes, parent.id);
  }, async read(node) {
    const handle = handles.get(node.id);
    if (!handle || handle.kind !== 'file') throw new Error('File is unavailable.');
    return handle.getFile();
  } };
}
