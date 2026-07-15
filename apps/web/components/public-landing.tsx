"use client";

import Link from "next/link";
import { useState } from "react";
import type { CSSProperties } from "react";
import { ArrowRight, Database, FileCheck2, Gavel, Network, ShieldCheck } from "lucide-react";
import { TweakPanel, defaultTweaks, type Tweaks } from "./tweak-panel";

export function PublicLanding() {
  const [tweaks, setTweaks] = useState<Tweaks>(defaultTweaks);

  return (
    <div
      className="prototype-root public-shell"
      data-tone={tweaks.tone}
      data-density={tweaks.density}
      style={{ "--tweak-primary": tweaks.hue } as CSSProperties}
    >
      <main className="public-landing">
        <nav className="public-nav" aria-label="Landing navigation">
          <Link className="brand" href="/"><span>F/</span><strong>FAULTSPAN</strong></Link>
          <div>
            <Link href="#product-pillars">Why Faultspan</Link>
            <Link className="button button-primary" href="/overview">Open workspace <ArrowRight aria-hidden="true" size={16} /></Link>
          </div>
        </nav>

        <section className="public-hero">
          <div>
            <span className="eyebrow">GenLayer adjudication for agentic commerce</span>
            <h1>Find the exact span that broke an agent workflow.</h1>
            <p>
              Faultspan turns multi-agent obligations, signed evidence, and GenLayer validator judgment into a
              searchable case record: who accepted what, which evidence was fetched, and how settlement should flow.
            </p>
            <div className="landing-actions">
              <Link className="button button-primary" href="/overview">Enter overview <ArrowRight aria-hidden="true" size={16} /></Link>
              <Link className="button button-secondary" href="#product-pillars">See the system</Link>
            </div>
          </div>
          <aside className="public-proof-card" aria-label="Runtime proof">
            <div><span>Network</span><strong>GenLayer Studionet</strong></div>
            <div><span>Contract</span><strong className="mono">0x1c3c...86eb</strong></div>
            <div><span>Evidence</span><strong>Supabase Storage + Postgres</strong></div>
            <div><span>Adjudication</span><strong>Live web evidence fetch</strong></div>
          </aside>
        </section>

        <section className="public-grid" id="product-pillars" aria-label="Product pillars">
          <article><Network aria-hidden="true" /><h2>Obligation spans</h2><p>Model root commitments and delegated agent work as a dependency graph.</p></article>
          <article><FileCheck2 aria-hidden="true" /><h2>Evidence vault</h2><p>Store wallet-signed evidence bundles and reference them by content digest.</p></article>
          <article><Gavel aria-hidden="true" /><h2>GenLayer judgment</h2><p>Fetch live evidence in-contract and ask validators to decide causality.</p></article>
          <article><Database aria-hidden="true" /><h2>Searchable projection</h2><p>Index case metadata in Supabase Postgres without inventing demo disputes.</p></article>
          <article><ShieldCheck aria-hidden="true" /><h2>Honest empty states</h2><p>No synthetic cases, no fake timelines, no made-up verdicts.</p></article>
        </section>
      </main>
      <TweakPanel value={tweaks} onChange={setTweaks} />
    </div>
  );
}
