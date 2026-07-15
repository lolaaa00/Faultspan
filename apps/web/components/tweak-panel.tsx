"use client";

import { useEffect, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";

export type Tweaks = { tone: "light" | "dark"; density: "comfortable" | "compact"; view: "graph" | "ledger"; hue: string };
export const defaultTweaks: Tweaks = { tone: "light", density: "comfortable", view: "graph", hue: "#087f9d" };
export const tweakStorageKey = "faultspan:design-tweaks:v1";

export function TweakPanel({ value, onChange }: { value: Tweaks; onChange(value: Tweaks): void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const stored = localStorage.getItem(tweakStorageKey);
    if (!stored) return;
    try {
      const next = { ...defaultTweaks, ...JSON.parse(stored) } as Tweaks;
      if (["light", "dark"].includes(next.tone) && ["comfortable", "compact"].includes(next.density) && ["graph", "ledger"].includes(next.view)) onChange(next);
    } catch { localStorage.removeItem(tweakStorageKey); }
  }, [onChange]);

  function update(patch: Partial<Tweaks>) {
    const next = { ...value, ...patch };
    onChange(next);
    localStorage.setItem(tweakStorageKey, JSON.stringify(next));
  }

  return <>
    <button className="tweak-toggle" onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-controls="tweak-panel"><SlidersHorizontal aria-hidden="true" size={16} />Tweaks</button>
    {open && <aside className="tweak-panel" id="tweak-panel" aria-label="Design tweaks">
      <header><strong>Design tweaks</strong><button className="icon-button" onClick={() => setOpen(false)} aria-label="Close design tweaks"><X aria-hidden="true" size={18} /></button></header>
      <label>Surface tone<select value={value.tone} onChange={(event) => update({ tone: event.target.value as Tweaks["tone"] })}><option value="light">Mineral paper</option><option value="dark">Night evidence</option></select></label>
      <label>Density<select value={value.density} onChange={(event) => update({ density: event.target.value as Tweaks["density"] })}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label>
      <label>Case view<select value={value.view} onChange={(event) => update({ view: event.target.value as Tweaks["view"] })}><option value="graph">Evidence graph</option><option value="ledger">Case ledger</option></select></label>
      <label>Primary hue<input type="color" value={value.hue} onChange={(event) => update({ hue: event.target.value })} /></label>
      <button className="button button-secondary" onClick={() => update(defaultTweaks)}>Reset defaults</button>
    </aside>}
  </>;
}
