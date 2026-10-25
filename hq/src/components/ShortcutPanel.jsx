import React from "react";
import { Keyboard, X } from "lucide-react";

const SHORTCUTS = [
  ["Search everything", "⌘ K"],
  ["Talk to Agent4", "⌘ J"],
  ["Go home", "H"],
  ["Show this list", "?"],
  ["Close a panel", "Esc"]
];

export function ShortcutPanel({ open, onClose }) {
  if (!open) return null;
  return (
    <aside className="shortcut-panel" aria-label="Keyboard shortcuts">
      <header><div><Keyboard size={17} /><strong>Keyboard</strong></div><button type="button" onClick={onClose} aria-label="Close keyboard shortcuts"><X size={16} /></button></header>
      <div>
        <section>
          {SHORTCUTS.map(([label, key]) => <p key={key}><span>{label}</span><kbd>{key}</kbd></p>)}
        </section>
      </div>
    </aside>
  );
}
