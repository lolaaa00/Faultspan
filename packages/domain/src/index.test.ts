import { describe, expect, it } from "vitest";
import {
  assertTransition,
  calculateSettlement,
  type CaseVerdict,
  type ObligationSpan,
  validateGraph
} from "./index.js";

const address = (suffix: string) => `0x${suffix.padStart(40, "0")}` as const;
const digest = `sha256:${"a".repeat(64)}`;

const spans: ObligationSpan[] = [
  {
    id: "root-report",
    parentId: null,
    requester: address("1"),
    provider: address("2"),
    obligation: "Coordinate and deliver a verified market report",
    obligationDigest: digest,
    bondWei: 100n,
    contributionPenaltyBps: 2500,
    causalPenaltyBps: 10000,
    status: "BONDED"
  },
  {
    id: "analysis",
    parentId: "root-report",
    requester: address("2"),
    provider: address("3"),
    obligation: "Validate source data before drawing conclusions",
    obligationDigest: digest,
    bondWei: 80n,
    contributionPenaltyBps: 2500,
    causalPenaltyBps: 10000,
    status: "BONDED"
  }
];

const verdict: CaseVerdict = {
  caseSatisfied: false,
  rubricVersion: "faultspan-rubric/1",
  findings: [
    { spanId: "root-report", finding: "COMPLIED", material: false, basisCodes: [], evidenceRefs: [], explanation: "" },
    { spanId: "analysis", finding: "CAUSED_FAILURE", material: true, basisCodes: [], evidenceRefs: [], explanation: "" }
  ]
};

describe("Faultspan domain", () => {
  it("accepts one rooted acyclic graph", () => expect(() => validateGraph(spans)).not.toThrow());

  it("rejects duplicate spans", () => expect(() => validateGraph([...spans, spans[1]])).toThrow(/duplicate/));

  it("rejects a cycle", () => {
    const cyclic = spans.map((span) => ({ ...span }));
    cyclic[0].parentId = "analysis";
    expect(() => validateGraph(cyclic)).toThrow();
  });

  it("conserves every bonded unit during settlement", () => {
    const settlement = calculateSettlement(spans, verdict);
    expect(settlement.totalDepositedWei).toBe(180n);
    expect(settlement.totalReturnedWei).toBe(100n);
    expect(settlement.totalSlashedWei).toBe(80n);
    expect(settlement.totalReturnedWei + settlement.totalSlashedWei).toBe(settlement.totalDepositedWei);
  });

  it("does not slash insufficient evidence", () => {
    const inconclusive: CaseVerdict = {
      ...verdict,
      findings: verdict.findings.map((finding) => ({ ...finding, finding: "INSUFFICIENT_EVIDENCE" }))
    };
    expect(calculateSettlement(spans, inconclusive).totalSlashedWei).toBe(0n);
  });

  it("rejects invalid state transitions", () => {
    expect(() => assertTransition("ACTIVE", "DISPUTED")).not.toThrow();
    expect(() => assertTransition("SETTLED", "ACTIVE")).toThrow(/invalid/);
  });
});

