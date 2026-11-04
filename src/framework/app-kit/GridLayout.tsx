import React, { useState } from 'react';
import type { ShellPlan } from './plans';

/** A reusable grid frame whose named slots host application content. */
export function GridLayout({ plan, slots }: { plan: ShellPlan; slots: Record<string, React.ReactNode> }) {
  const [split, setSplit] = useState(50);
  const widths = plan.layout === 'split' ? [split, 100 - split] : plan.widths;
  return <div>
    {plan.layout === 'split' && <label>Panel size <input aria-label="Panel size" type="range" min="15" max="85" value={split} onChange={e => setSplit(Number(e.target.value))} /></label>}
    <div style={{ display: 'grid', gridTemplateColumns: widths.map(n => `minmax(0, ${n}fr)`).join(' '), gap: 8, overflowX: 'auto', minWidth: 0 }}>
      {plan.slots.map(name => <section key={name} aria-label={name} style={{ minWidth: 0, border: '1px solid var(--border)', padding: 8 }}>{slots[name]}</section>)}
    </div>
  </div>;
}
