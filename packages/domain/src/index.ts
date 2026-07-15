export const MAX_SPANS_PER_CASE = 8;
export const BPS_DENOMINATOR = 10_000n;

export type Address = `0x${string}`;

export type CaseStatus =
  | "OPEN"
  | "ACTIVE"
  | "COMPLETED"
  | "DISPUTED"
  | "EVIDENCE_LOCKED"
  | "DECIDED"
  | "UNDETERMINED"
  | "SETTLED";

export type SpanStatus = "PROPOSED" | "BONDED" | "DELIVERED" | "ACCEPTED" | "DISPUTED";

export type Finding =
  | "COMPLIED"
  | "CONTRIBUTED_TO_FAILURE"
  | "CAUSED_FAILURE"
  | "INSUFFICIENT_EVIDENCE";

export interface ObligationSpan {
  id: string;
  parentId: string | null;
  requester: Address;
  provider: Address;
  obligation: string;
  obligationDigest: string;
  bondWei: bigint;
  contributionPenaltyBps: number;
  causalPenaltyBps: number;
  status: SpanStatus;
}

export interface SpanFinding {
  spanId: string;
  finding: Finding;
  material: boolean;
  basisCodes: string[];
  evidenceRefs: string[];
  explanation: string;
}

export interface CaseVerdict {
  caseSatisfied: boolean;
  findings: SpanFinding[];
  rubricVersion: string;
}

export interface SettlementLine {
  spanId: string;
  provider: Address;
  depositedWei: bigint;
  returnedWei: bigint;
  slashedWei: bigint;
  finding: Finding;
}

export interface Settlement {
  totalDepositedWei: bigint;
  totalReturnedWei: bigint;
  totalSlashedWei: bigint;
  lines: SettlementLine[];
}

function requireBps(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0 || value > Number(BPS_DENOMINATOR)) {
    throw new Error(`${label} must be an integer between 0 and 10000`);
  }
}

export function validateSpan(span: ObligationSpan): void {
  if (!/^[a-zA-Z0-9_-]{3,64}$/.test(span.id)) {
    throw new Error("span id must be 3-64 URL-safe characters");
  }
  if (span.parentId === span.id) throw new Error("span cannot parent itself");
  if (!span.obligation.trim()) throw new Error("obligation is required");
  if (!/^sha256:[a-f0-9]{64}$/.test(span.obligationDigest)) {
    throw new Error("obligation digest must be sha256:<64 lowercase hex characters>");
  }
  if (span.bondWei < 0n) throw new Error("bond cannot be negative");
  requireBps(span.contributionPenaltyBps, "contribution penalty");
  requireBps(span.causalPenaltyBps, "causal penalty");
  if (span.contributionPenaltyBps > span.causalPenaltyBps) {
    throw new Error("contribution penalty cannot exceed causal penalty");
  }
}

export function validateGraph(spans: ObligationSpan[]): void {
  if (spans.length === 0) throw new Error("case requires at least one span");
  if (spans.length > MAX_SPANS_PER_CASE) throw new Error(`case supports at most ${MAX_SPANS_PER_CASE} spans`);

  const byId = new Map<string, ObligationSpan>();
  for (const span of spans) {
    validateSpan(span);
    if (byId.has(span.id)) throw new Error(`duplicate span id: ${span.id}`);
    byId.set(span.id, span);
  }

  const roots = spans.filter((span) => span.parentId === null);
  if (roots.length !== 1) throw new Error("case must contain exactly one root span");

  for (const span of spans) {
    if (span.parentId && !byId.has(span.parentId)) {
      throw new Error(`missing parent ${span.parentId} for ${span.id}`);
    }
    const visited = new Set<string>();
    let current: ObligationSpan | undefined = span;
    while (current?.parentId) {
      if (visited.has(current.id)) throw new Error(`cycle detected at ${current.id}`);
      visited.add(current.id);
      current = byId.get(current.parentId);
    }
  }
}

function slashBpsFor(finding: Finding, span: ObligationSpan): number {
  if (finding === "CAUSED_FAILURE") return span.causalPenaltyBps;
  if (finding === "CONTRIBUTED_TO_FAILURE") return span.contributionPenaltyBps;
  return 0;
}

export function calculateSettlement(spans: ObligationSpan[], verdict: CaseVerdict): Settlement {
  validateGraph(spans);
  const findings = new Map(verdict.findings.map((item) => [item.spanId, item]));
  if (findings.size !== spans.length) throw new Error("verdict must include exactly one finding per span");

  const lines = spans.map<SettlementLine>((span) => {
    const result = findings.get(span.id);
    if (!result) throw new Error(`missing finding for ${span.id}`);
    const slashBps = BigInt(slashBpsFor(result.finding, span));
    const slashedWei = (span.bondWei * slashBps) / BPS_DENOMINATOR;
    return {
      spanId: span.id,
      provider: span.provider,
      depositedWei: span.bondWei,
      returnedWei: span.bondWei - slashedWei,
      slashedWei,
      finding: result.finding
    };
  });

  const totalDepositedWei = lines.reduce((total, line) => total + line.depositedWei, 0n);
  const totalReturnedWei = lines.reduce((total, line) => total + line.returnedWei, 0n);
  const totalSlashedWei = lines.reduce((total, line) => total + line.slashedWei, 0n);
  if (totalReturnedWei + totalSlashedWei !== totalDepositedWei) {
    throw new Error("settlement violates value conservation");
  }

  return { totalDepositedWei, totalReturnedWei, totalSlashedWei, lines };
}

export function assertTransition(from: CaseStatus, to: CaseStatus): void {
  const transitions: Record<CaseStatus, CaseStatus[]> = {
    OPEN: ["ACTIVE"],
    ACTIVE: ["COMPLETED", "DISPUTED"],
    COMPLETED: ["SETTLED"],
    DISPUTED: ["EVIDENCE_LOCKED"],
    EVIDENCE_LOCKED: ["DECIDED", "UNDETERMINED"],
    DECIDED: ["SETTLED"],
    UNDETERMINED: [],
    SETTLED: []
  };
  if (!transitions[from].includes(to)) throw new Error(`invalid case transition: ${from} -> ${to}`);
}

