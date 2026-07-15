"use client";

import { Check, CircleAlert, FileQuestion, GitBranch } from "lucide-react";
import type { Address, Finding, SpanStatus } from "@faultspan/domain";

export type ObligationSpanView = {
  id: string;
  parentId: string | null;
  label: string;
  provider: string;
  address: Address;
  obligation: string;
  bond: string;
  status: SpanStatus;
  finding: Finding;
  evidenceCount: number;
  x: number;
  y: number;
  evidence: { label: string; digest: string; kind: string }[];
};

const findingMeta: Record<Finding, { label: string; icon: typeof Check }> = {
  COMPLIED: { label: "Complied", icon: Check },
  CONTRIBUTED_TO_FAILURE: { label: "Contributed", icon: CircleAlert },
  CAUSED_FAILURE: { label: "Caused failure", icon: CircleAlert },
  INSUFFICIENT_EVIDENCE: { label: "Insufficient evidence", icon: FileQuestion }
};

export function FindingBadge({ finding }: { finding: Finding }) {
  const value = findingMeta[finding];
  const Icon = value.icon;
  return <span className={`finding finding-${finding.toLowerCase()}`}><Icon aria-hidden="true" size={13} />{value.label}</span>;
}

export function LiabilityGraph({ spans, selectedId, onSelect, mode }: {
  spans: ObligationSpanView[];
  selectedId: string;
  onSelect(id: string): void;
  mode: "graph" | "ledger";
}) {
  if (spans.length === 0) {
    return (
      <div className="graph empty-graph" role="status">
        <div className="empty-state">
          <GitBranch aria-hidden="true" />
          <h3>No obligation spans loaded</h3>
          <p>Create or query a real Studionet case to populate this graph. Synthetic spans are disabled.</p>
        </div>
      </div>
    );
  }

  const ledger = (className = "") => (
    <div className={`ledger-wrap ${className}`} aria-label="Obligation span ledger">
      <table className="ledger">
        <thead><tr><th>Obligation</th><th>Provider</th><th>Bond</th><th>Finding</th></tr></thead>
        <tbody>{spans.map((span) => (
          <tr key={span.id} className={selectedId === span.id ? "is-selected" : undefined}>
            <td><button onClick={() => onSelect(span.id)}>{span.label}</button></td>
            <td>{span.provider}</td><td className="mono">{span.bond}</td><td><FindingBadge finding={span.finding} /></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
  if (mode === "ledger") return ledger();

  return (
    <><div className="graph" role="group" aria-label="Interactive obligation graph">
      <div className="graph-key"><GitBranch aria-hidden="true" size={14} /> Select a span to inspect its evidence</div>
      <svg className="graph-lines" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path d="M50 23 L18 42 M50 23 L50 42 M50 57 L82 76" />
      </svg>
      {spans.map((span) => (
        <button
          className={`graph-node ${selectedId === span.id ? "is-selected" : ""}`}
          style={{ left: `${span.x}%`, top: `${span.y}%` }}
          key={span.id}
          onClick={() => onSelect(span.id)}
          aria-pressed={selectedId === span.id}
        >
          <span className="node-eyebrow">{span.parentId ? "Delegated span" : "Root commitment"}</span>
          <strong>{span.label}</strong>
          <span className="node-provider">{span.provider}</span>
          <span className="node-bottom"><FindingBadge finding={span.finding} /><span className="mono">{span.bond}</span></span>
        </button>
      ))}
    </div>{ledger("mobile-ledger")}</>
  );
}
