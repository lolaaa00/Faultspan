"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, ArrowUpRight, BookOpen, ChevronRight, CircleDollarSign, FileCheck2, FileText, FileUp, Gavel, LayoutDashboard, LockKeyhole, Network, Plus, Search, ShieldCheck, Split, TerminalSquare } from "lucide-react";
import { CreateCaseDialog } from "./create-case-dialog";
import { LiabilityGraph } from "./liability-graph";
import { TweakPanel, defaultTweaks, type Tweaks } from "./tweak-panel";
import { WalletButton } from "./wallet-button";
import { useFaultspanWallet } from "./wallet-provider";
import { FileEvidenceDialog } from "./file-evidence-dialog";
import { listActivityRecords, listCaseProjections, listSpanProjections, searchProjection, type ActivityRecord, type CaseProjection, type SearchResult, type SpanProjection } from "@/lib/platform-api";
import { readFaultspanCase, type LoadedFaultspanCase } from "@/lib/faultspan-contract";
import { formatGen } from "@/lib/format";
import type { Address, Finding, SpanStatus } from "@faultspan/domain";
import type { ObligationSpanView } from "./liability-graph";
import { CaseWorkflowPanel } from "./case-workflow-panel";

type Tab = "evidence" | "settlement" | "activity";
type View = "overview" | "cases" | "obligations" | "evidence" | "docs";

const nav = [
  { id: "overview", href: "/overview", label: "Overview", icon: LayoutDashboard },
  { id: "cases", href: "/cases", label: "Cases", icon: Gavel },
  { id: "obligations", href: "/obligations", label: "Obligations", icon: Network },
  { id: "evidence", href: "/evidence", label: "Evidence", icon: FileCheck2 },
  { id: "docs", href: "/integration", label: "Integration", icon: BookOpen }
] satisfies { id: View; href: string; label: string; icon: typeof LayoutDashboard }[];

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function shortAddress(value?: string) {
  if (!value) return "unknown";
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function toFinding(value?: string): Finding {
  if (value === "COMPLIED" || value === "CONTRIBUTED_TO_FAILURE" || value === "CAUSED_FAILURE" || value === "INSUFFICIENT_EVIDENCE") return value;
  return "INSUFFICIENT_EVIDENCE";
}

function toSpanStatus(value?: string): SpanStatus {
  if (value === "PROPOSED" || value === "BONDED" || value === "DELIVERED" || value === "ACCEPTED" || value === "DISPUTED") return value;
  return "PROPOSED";
}

function parseEvidenceManifest(manifest?: string) {
  return (manifest ?? "")
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toViewSpans(loaded: LoadedFaultspanCase | null): ObligationSpanView[] {
  if (!loaded) return [];
  const points = [
    { x: 50, y: 13 },
    { x: 22, y: 36 },
    { x: 50, y: 36 },
    { x: 78, y: 36 },
    { x: 22, y: 62 },
    { x: 50, y: 62 },
    { x: 78, y: 62 },
    { x: 50, y: 78 }
  ];
  return loaded.spans.map(({ spanId, record }, index) => ({
    id: spanId,
    parentId: record.parent_id || null,
    label: spanId,
    provider: shortAddress(record.provider),
    address: (record.provider || "0x0000000000000000000000000000000000000000") as Address,
    obligation: String(record.explanation || record.evidence_refs || "Contract span loaded from Studionet"),
    bond: formatGen(record.bond_posted ?? record.bond_required ?? 0n),
    status: toSpanStatus(record.status),
    finding: toFinding(record.finding),
    evidenceCount: record.evidence_refs ? 1 : 0,
    x: points[index]?.x ?? 50,
    y: points[index]?.y ?? 50,
    evidence: record.evidence_refs ? [{ label: "Contract evidence", digest: record.evidence_refs, kind: "manifest" }] : []
  }));
}

export function FaultspanPrototype({ initialView = "overview" }: { initialView?: View }) {
  const router = useRouter();
  const [loadedCase, setLoadedCase] = useState<LoadedFaultspanCase | null>(null);
  const spans = useMemo(() => toViewSpans(loadedCase), [loadedCase]);
  const [selectedId, setSelectedId] = useState("");
  const [tab, setTab] = useState<Tab>("evidence");
  const [view, setView] = useState<View>(initialView);
  const [caseQuery, setCaseQuery] = useState("");
  const [caseList, setCaseList] = useState<CaseProjection[]>([]);
  const [spanList, setSpanList] = useState<SpanProjection[]>([]);
  const [activityList, setActivityList] = useState<ActivityRecord[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [caseSearchError, setCaseSearchError] = useState<string | null>(null);
  const [caseLoading, setCaseLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [tweaks, setTweaks] = useState<Tweaks>(defaultTweaks);
  const updateTweaks = useCallback((value: Tweaks) => setTweaks(value), []);
  const { tx, submitEvidence } = useFaultspanWallet();
  const selectedSpan = spans.find((span) => span.id === selectedId);
  const manifestRefs = useMemo(() => parseEvidenceManifest(loadedCase?.caseRecord.evidence_manifest), [loadedCase?.caseRecord.evidence_manifest]);
  const evidenceActivity = useMemo(
    () => activityList.filter((item) => item.action.includes("evidence") || item.action.includes("dispute")),
    [activityList]
  );

  const openCaseBuilder = () => { setView("cases"); router.push("/cases"); setCreateOpen(true); };
  const openEvidenceBuilder = () => { setView("evidence"); router.push("/evidence"); setEvidenceOpen(true); };
  const refreshCases = useCallback(async (query = caseQuery) => {
    setCaseSearchError(null);
    try {
      const [cases, results] = await Promise.all([listCaseProjections(query), searchProjection(query)]);
      setCaseList(cases);
      setSearchResults(results);
    } catch (error) {
      setCaseSearchError(error instanceof Error ? error.message : "Case search failed");
    }
  }, [caseQuery]);
  const loadCase = useCallback(async (caseId: string) => {
    setCaseLoading(true);
    setCaseSearchError(null);
    try {
      const loaded = await readFaultspanCase(caseId);
      const [spans, activity] = await Promise.all([listSpanProjections(caseId), listActivityRecords(caseId)]);
      setLoadedCase(loaded);
      setSpanList(spans);
      setActivityList(activity);
      setSelectedId(loaded.spanIds[0] ?? "");
      setView("cases");
    } catch (error) {
      setCaseSearchError(error instanceof Error ? error.message : "Contract read failed");
    } finally {
      setCaseLoading(false);
    }
  }, []);
  const refreshCurrentCase = useCallback(async () => {
    if (!loadedCase?.caseId) return;
    await loadCase(loadedCase.caseId);
  }, [loadCase, loadedCase?.caseId]);
  const draftEvidence = useCallback(async (input: { caseId: string; spanId: string; obligation: string; statement: string }) => {
    const receipt = await submitEvidence(input);
    return { digest: receipt.digest, publicPath: receipt.publicPath };
  }, [submitEvidence]);

  useEffect(() => { void refreshCases(""); }, [refreshCases]);

  useEffect(() => {
    if (tx.phase !== "FINALIZED" || !loadedCase?.caseId) return;
    let cancelled = false;

    const sync = async () => {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        if (cancelled) return;
        await refreshCurrentCase();
        await new Promise((resolve) => window.setTimeout(resolve, 2_000));
      }
    };

    void sync();
    return () => {
      cancelled = true;
    };
  }, [loadedCase?.caseId, refreshCurrentCase, tx.phase, tx.hash]);

  return (
    <div className="prototype-root" data-tone={tweaks.tone} data-density={tweaks.density} style={{ "--tweak-primary": tweaks.hue } as React.CSSProperties}>
      <a className="skip-link" href="#case-workspace">Skip to workspace</a>
      <aside className="sidebar" aria-label="Primary navigation">
        <Link className="brand brand-button" href="/overview" aria-label="Faultspan overview"><span>F/</span><strong>FAULTSPAN</strong></Link>
        <nav>
          {nav.map((item) => {
            const Icon = item.icon;
            return <Link key={item.id} href={item.href} className={view === item.id ? "active" : ""} aria-current={view === item.id ? "page" : undefined}><Icon aria-hidden="true" />{item.label}</Link>;
          })}
        </nav>
        <div className="sidebar-foot"><span className="network-light" aria-hidden="true"></span><div><strong>Studionet</strong><small>Chain 61999</small></div></div>
      </aside>

      <div className="app-column">
        <header className="topbar">
          <form className="search" onSubmit={(event) => { event.preventDefault(); setView("cases"); router.push("/cases"); void refreshCases(caseQuery); }}><Search aria-hidden="true" size={16} /><input aria-label="Search cases" placeholder="Search real cases, agents, tx hashes" value={caseQuery} onChange={(event) => setCaseQuery(event.target.value)} /></form>
          <div className="topbar-actions"><span className="network-chip"><span aria-hidden="true"></span>Studionet</span><WalletButton /></div>
        </header>

        <main id="case-workspace">
          {tx.phase !== "IDLE" && <div className={`tx-banner tx-${tx.phase.toLowerCase()}`} role="status"><span className="tx-pulse" aria-hidden="true"></span><div><strong>{tx.phase === "SUBMITTING" ? "Studionet transaction pending" : tx.phase === "ACCEPTED" ? "Accepted by the network" : tx.phase === "FINALIZED" ? "Transaction finalized" : "Transaction failed"}</strong><small>{tx.message}{tx.hash ? ` - ${tx.hash.slice(0, 12)}...${tx.hash.slice(-8)}` : ""}</small></div></div>}

          {view === "overview" && <section className="landing-panel" aria-labelledby="landing-title">
            <div className="landing-copy"><span className="eyebrow">Agentic dispute resolution</span><h1 id="landing-title">Faultspan</h1><p>Attribute failures across multi-agent commerce, preserve public evidence in Supabase, and submit adjudication flows to the GenLayer Studionet contract.</p><div className="landing-actions"><button className="button button-primary" onClick={openCaseBuilder}><Plus aria-hidden="true" size={16} />Create real case</button><button className="button button-secondary" onClick={openEvidenceBuilder}><FileUp aria-hidden="true" size={16} />Submit evidence</button></div></div>
            <div className="landing-instrument" aria-label="Live configuration"><div><span>Contract</span><strong className="mono">0x23B6...Df5D</strong></div><div><span>RPC</span><strong>studio.genlayer.com/api</strong></div><div><span>Storage</span><strong>Supabase private bucket</strong></div></div>
          </section>}

          {view === "cases" && <>
            <div className="case-breadcrumb"><Link href="/overview">Overview</Link><ChevronRight aria-hidden="true" size={14} /><span>Cases</span></div>
            <section className="case-heading" aria-labelledby="case-title"><div><div className="eyebrow-row"><span className="eyebrow">Real Studionet mode</span><span className="status status-disputed"><Gavel aria-hidden="true" size={13} />Live contract</span></div><h1 id="case-title">{loadedCase ? loadedCase.caseId : "No synthetic case loaded"}</h1><p>{loadedCase ? `Loaded from get_case/get_case_span_ids/get_span. Current status: ${loadedCase.caseRecord.status || "unknown"}.` : "Create a case against the configured Studionet contract or query a real case id. This workspace no longer seeds demo disputes."}</p></div><div className="case-actions"><button className="button button-secondary"><FileText aria-hidden="true" size={16} />Export record</button><button className="button button-secondary" onClick={openEvidenceBuilder}><FileUp aria-hidden="true" size={16} />Add evidence</button><button className="button button-primary" onClick={() => setCreateOpen(true)}><Plus aria-hidden="true" size={16} />New case</button></div></section>
            <section className="case-search-panel" aria-label="Search and load cases"><form className="case-search-row" onSubmit={(event) => { event.preventDefault(); void refreshCases(caseQuery); }}><input value={caseQuery} onChange={(event) => setCaseQuery(event.target.value)} placeholder="Search indexed cases or paste a case id" aria-label="Case search or case id" /><button className="button button-secondary" type="submit"><Search aria-hidden="true" size={16} />Search</button><button className="button button-primary" type="button" disabled={!caseQuery.trim() || caseLoading} onClick={() => void loadCase(caseQuery.trim())}>{caseLoading ? "Loading..." : "Load from contract"}</button></form>{caseSearchError && <p className="form-error">{caseSearchError}</p>}<div className="case-list">{caseList.map((item) => <button key={item.case_id} onClick={() => void loadCase(item.case_id)}><span><strong>{item.title}</strong><small>{item.case_id} · {item.status} · {item.tx_hash ?? "no tx hash indexed"}</small></span><ChevronRight aria-hidden="true" size={16} /></button>)}</div></section>
            {searchResults.length > 0 && <section className="workspace-panel explorer-panel" aria-labelledby="explorer-title"><header className="panel-head"><div><span className="eyebrow">Projection explorer</span><h2 id="explorer-title">Cases, spans, activity, tx hashes</h2></div></header><div className="explorer-list">{searchResults.map((item, index) => <button key={`${item.result_type}-${item.case_id}-${item.span_id ?? ""}-${item.tx_hash ?? ""}-${index}`} onClick={() => void loadCase(item.case_id)}><span><strong>{item.title}</strong><small>{item.result_type} · {item.case_id}{item.span_id ? ` · ${item.span_id}` : ""}{item.tx_hash ? ` · ${item.tx_hash}` : ""}</small></span><span>{item.subtitle}</span></button>)}</div></section>}
            <section className="case-facts" aria-label="Case facts"><Metric label="Bonded value" value={formatGen(loadedCase?.caseRecord.totalBonded ?? 0n)} detail={loadedCase ? "From get_case" : "Awaiting real case"} /><Metric label="Evidence" value={`${loadedCase?.caseRecord.evidence_manifest?.split("\n").filter(Boolean).length ?? 0} refs`} detail={loadedCase ? "Manifest entries" : "No manifest loaded"} /><Metric label="Current phase" value={loadedCase?.caseRecord.status || "Not loaded"} detail="Studionet accepted state" /><Metric label="Potential recovery" value={formatGen(loadedCase?.caseRecord.totalSlashed ?? 0n)} detail="After adjudication/settlement" /></section>
            <CaseWorkflowPanel
              caseId={loadedCase?.caseId ?? caseQuery.trim()}
              owner={loadedCase?.caseRecord.owner ? loadedCase.caseRecord.owner as `0x${string}` : null}
              coordinator={loadedCase?.caseRecord.coordinator ? loadedCase.caseRecord.coordinator as `0x${string}` : null}
              spanActors={loadedCase?.spans.map((item) => ({ spanId: item.spanId, provider: item.record.provider, requester: item.record.requester, status: item.record.status })) ?? []}
              loaded={Boolean(loadedCase?.caseId)}
              onEvidenceDraft={draftEvidence}
              onRefresh={refreshCurrentCase}
            />
            <div className="workspace-grid"><section className="workspace-panel graph-panel" aria-labelledby="graph-title"><header className="panel-head"><div><span className="eyebrow">Liability topology</span><h2 id="graph-title">Obligation graph</h2></div><div className="segmented" aria-label="Graph display mode"><button className={tweaks.view === "graph" ? "active" : ""} onClick={() => updateTweaks({ ...tweaks, view: "graph" })}>Graph</button><button className={tweaks.view === "ledger" ? "active" : ""} onClick={() => updateTweaks({ ...tweaks, view: "ledger" })}>Ledger</button></div></header><LiabilityGraph spans={spans} selectedId={selectedId} onSelect={setSelectedId} mode={tweaks.view} /></section><aside className="workspace-panel inspector" aria-labelledby="inspector-title"><header className="panel-head"><div><span className="eyebrow">Selected span</span><h2 id="inspector-title">{selectedSpan?.label ?? "Nothing selected"}</h2></div></header>{selectedSpan ? <><section className="provider-line"><span className="agent-mark">{selectedSpan.provider.slice(0, 1)}</span><div><strong>{selectedSpan.provider}</strong><span>{selectedSpan.address}</span></div></section><section className="inspector-section"><h3>Contract status</h3><p>{selectedSpan.status} · finding {selectedSpan.finding}</p></section><section className="inspector-section"><h3>Evidence</h3><p>{selectedSpan.evidenceCount ? selectedSpan.evidence[0]?.digest : "No evidence refs on this span yet."}</p></section></> : <section className="empty-state"><ShieldCheck aria-hidden="true" /><h3>Real data only</h3><p>No obligation span is loaded from the contract yet. Create a case or query a real case id; no demo findings are shown here.</p></section>}</aside></div>
            <section className="workspace-panel case-record"><div className="tabs" role="tablist" aria-label="Case record"><button role="tab" aria-selected={tab === "evidence"} onClick={() => setTab("evidence")}><FileCheck2 aria-hidden="true" size={15} />Evidence</button><button role="tab" aria-selected={tab === "settlement"} onClick={() => setTab("settlement")}><CircleDollarSign aria-hidden="true" size={15} />Settlement</button><button role="tab" aria-selected={tab === "activity"} onClick={() => setTab("activity")}><Activity aria-hidden="true" size={15} />Activity</button></div>{tab === "evidence" && <div className="tab-content evidence-stack"><div className="evidence-summary"><div><LockKeyhole aria-hidden="true" /><span><strong>{manifestRefs.length > 0 ? "Manifest loaded" : "No manifest loaded"}</strong><small className="mono">{manifestRefs.length > 0 ? `${manifestRefs.length} refs locked or pending` : "waiting for real evidence"}</small></span></div><p>Evidence submitted through this app is stored through the backend, projected into activity history, and later referenced on-chain by digest or public path.</p><button className="button button-secondary" onClick={openEvidenceBuilder}>Add evidence<ArrowUpRight aria-hidden="true" size={15} /></button></div><div className="evidence-detail-grid"><section className="evidence-card"><div className="section-title"><h3>Manifest refs</h3><span>{manifestRefs.length > 0 ? "from get_case" : "not locked yet"}</span></div>{manifestRefs.length > 0 ? <div className="evidence-refs">{manifestRefs.map((ref) => <a key={ref} href={ref} target="_blank" rel="noreferrer"><code>{ref}</code><ArrowUpRight aria-hidden="true" size={14} /></a>)}</div> : <p>No on-chain manifest refs yet. Store evidence first, then link or lock it during dispute resolution.</p>}</section><section className="evidence-card"><div className="section-title"><h3>Projected evidence activity</h3><span>{evidenceActivity.length > 0 ? `${evidenceActivity.length} event(s)` : "backend status"}</span></div>{evidenceActivity.length > 0 ? <ul className="activity-list compact">{evidenceActivity.slice(0, 6).map((item) => <li key={item.activity_id}><time>{item.action}</time><span><strong>{item.summary}</strong><small>{item.status}{item.span_id ? ` · ${item.span_id}` : ""}{item.tx_hash ? ` · ${item.tx_hash}` : ""}</small></span></li>)}</ul> : <p>No evidence-specific activity recorded yet. The first signed evidence bundle or dispute action will appear here.</p>}</section></div></div>}{tab === "settlement" && <div className="tab-content empty-state"><CircleDollarSign aria-hidden="true" /><h3>{loadedCase?.caseRecord.status === "SETTLED" ? "Settlement completed" : "No settlement computed"}</h3><p>{loadedCase?.caseRecord.status === "SETTLED" ? `Total slashed: ${formatGen(loadedCase.caseRecord.totalSlashed ?? 0n)}.` : "Settlement rows will stay empty until a real case is adjudicated by the configured Studionet contract."}</p></div>}{tab === "activity" && <div className="tab-content">{activityList.length > 0 ? <ul className="activity-list">{activityList.map((item) => <li key={item.activity_id}><time>{item.action}</time><span><strong>{item.summary}</strong><small>{item.actor}{item.tx_hash ? ` · ${item.tx_hash}` : ""}{item.span_id ? ` · ${item.span_id}` : ""}</small></span></li>)}</ul> : <div className="empty-state"><Activity aria-hidden="true" /><h3>No activity loaded</h3><p>Run actions through the workflow panel and this tab will accumulate projected history and tx hashes.</p></div>}</div>}</section>
          </>}

          {view === "obligations" && <section className="route-panel" aria-labelledby="obligations-title"><span className="eyebrow">Obligation registry</span><h1 id="obligations-title">Obligations</h1><p>Define the root commitment, delegated spans, provider bonds, and acceptance windows before a dispute starts.</p><div className="route-grid"><article><Network aria-hidden="true" /><h2>Span graph</h2><p>Each delegated task becomes a span with a parent, provider, obligation text, and bond.</p></article><article><Split aria-hidden="true" /><h2>Dependency chain</h2><p>Root outcomes can point to the exact span that caused or contributed to failure.</p></article><article><Gavel aria-hidden="true" /><h2>Adjudication terms</h2><p>Deadlines and recovery rules are set before evidence is locked.</p></article></div><button className="button button-primary" onClick={openCaseBuilder}><Plus aria-hidden="true" size={16} />Create first obligation case</button></section>}

          {view === "evidence" && <section className="route-panel" aria-labelledby="evidence-title"><span className="eyebrow">Supabase evidence vault</span><h1 id="evidence-title">Evidence</h1><p>Submit public, signed evidence bundles to the private Supabase bucket and reference them by digest for GenLayer adjudication.</p><div className="route-grid"><article><LockKeyhole aria-hidden="true" /><h2>Private bucket</h2><p>Objects are stored under content-addressed paths and served through the backend evidence endpoint.</p></article><article><FileCheck2 aria-hidden="true" /><h2>Wallet signed</h2><p>The backend issues a challenge, verifies the wallet signature, then accepts the evidence bundle.</p></article><article><FileUp aria-hidden="true" /><h2>Case scoped</h2><p>Every bundle needs a real case id, span id, obligation text, and statement.</p></article></div><button className="button button-primary" onClick={() => setEvidenceOpen(true)}><FileUp aria-hidden="true" size={16} />Add evidence</button></section>}

          {view === "docs" && <section className="route-panel" aria-labelledby="docs-title"><span className="eyebrow">Integration guide</span><h1 id="docs-title">Integration</h1><p>Runtime is locked to Studionet, GenLayer JS 1.1.8, and the deployed Faultspan contract.</p><div className="docs-list"><div><TerminalSquare aria-hidden="true" /><span>RPC</span><code>https://studio.genlayer.com/api</code></div><div><TerminalSquare aria-hidden="true" /><span>Chain ID</span><code>61999 / 0xf22f</code></div><div><TerminalSquare aria-hidden="true" /><span>Contract</span><code>0x23B6F12322d811918c4Ca5De210529d6cB09Df5D</code></div><div><TerminalSquare aria-hidden="true" /><span>Storage</span><code>SUPABASE_EVIDENCE_BUCKET=faultspan-evidence</code></div></div></section>}

          <footer className="prototype-footer"><span>Faultspan real-mode build</span><span>RPC <code>studio.genlayer.com/api</code> - SDK <code>genlayer-js@1.1.8</code></span></footer>
        </main>
      </div>
      <TweakPanel value={tweaks} onChange={updateTweaks} />
      <CreateCaseDialog open={createOpen} onClose={() => setCreateOpen(false)} />
      <FileEvidenceDialog open={evidenceOpen} onClose={() => setEvidenceOpen(false)} />
    </div>
  );
}
