"use client";

import { useState } from "react";
import { Bot, Gavel, Link2, LockKeyhole, Play, Plus, ReceiptText, Send, Wallet } from "lucide-react";
import { useFaultspanWallet } from "./wallet-provider";

type Props = {
  caseId: string;
  coordinator: `0x${string}` | null;
  loaded: boolean;
  onEvidenceDraft(input: { caseId: string; spanId: string; obligation: string; statement: string }): Promise<{ digest: string; publicPath: string }>;
  onRefresh(): Promise<void>;
};

function slug(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42);
}

export function CaseWorkflowPanel({ caseId, coordinator, loaded, onEvidenceDraft, onRefresh }: Props) {
  const {
    address,
    registerSpan,
    acceptSpan,
    submitDelivery,
    openDispute,
    submitEvidenceToContract,
    lockEvidence,
    adjudicateCase,
    settleCase,
    withdrawClaimable
  } = useFaultspanWallet();
  const [working, setWorking] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [spanId, setSpanId] = useState("root-span");
  const [parentId, setParentId] = useState("");
  const [obligation, setObligation] = useState("Validate all supporting evidence before publishing the final output.");
  const [provider, setProvider] = useState("");
  const [bond, setBond] = useState("1000000000000000");
  const [deliveryRef, setDeliveryRef] = useState("https://example.com/faultspan/delivery.json");
  const [evidenceSpanId, setEvidenceSpanId] = useState("root-span");
  const [statement, setStatement] = useState("This evidence shows the provider missed a required validation step.");

  async function run(label: string, action: () => Promise<void>) {
    setWorking(label);
    setMessage(null);
    try {
      await action();
      await onRefresh();
      setMessage(`${label} completed.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${label} failed.`);
    } finally {
      setWorking(null);
    }
  }

  async function seedDemoSpans() {
    if (!address) throw new Error("Connect a wallet before seeding demo spans.");
    const root = `${slug(caseId)}-research`;
    const analysis = `${slug(caseId)}-analysis`;
    const writing = `${slug(caseId)}-writing`;
    await registerSpan({
      caseId,
      spanId: root,
      parentId: "",
      requester: coordinator ?? address,
      provider: address,
      obligation: "Gather source material and preserve all citations.",
      bondWei: 1_000_000_000_000_000n,
      contributionPenaltyBps: 2500,
      causalPenaltyBps: 7000
    });
    await registerSpan({
      caseId,
      spanId: analysis,
      parentId: root,
      requester: coordinator ?? address,
      provider: address,
      obligation: "Validate each source and derive the decision-critical conclusion.",
      bondWei: 2_000_000_000_000_000n,
      contributionPenaltyBps: 4000,
      causalPenaltyBps: 9000
    });
    await registerSpan({
      caseId,
      spanId: writing,
      parentId: analysis,
      requester: coordinator ?? address,
      provider: address,
      obligation: "Produce the final report exactly from the validated analysis.",
      bondWei: 1_500_000_000_000_000n,
      contributionPenaltyBps: 2500,
      causalPenaltyBps: 8000
    });
  }

  return (
    <section className="workflow-panel workspace-panel" aria-labelledby="workflow-title">
      <header className="panel-head">
        <div>
          <span className="eyebrow">Guided contract workflow</span>
          <h2 id="workflow-title">Run the case lifecycle</h2>
        </div>
      </header>

      <div className="workflow-grid">
        <article className="workflow-card">
          <div className="workflow-card-head"><Bot aria-hidden="true" size={16} /><strong>3-span demo path</strong></div>
          <p>Seed the master-plan demo structure using the connected wallet as provider for all three spans.</p>
          <button className="button button-primary" disabled={!loaded || !!working} onClick={() => run("3-span demo seed", seedDemoSpans)}>
            <Play aria-hidden="true" size={16} />{working === "3-span demo seed" ? "Running..." : "Seed 3 spans"}
          </button>
        </article>

        <article className="workflow-card">
          <div className="workflow-card-head"><Plus aria-hidden="true" size={16} /><strong>Register span</strong></div>
          <div className="workflow-fields">
            <input value={spanId} onChange={(event) => setSpanId(event.target.value)} placeholder="span id" />
            <input value={parentId} onChange={(event) => setParentId(event.target.value)} placeholder="parent span id (blank for root)" />
            <input value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="provider 0x..." />
            <input value={bond} onChange={(event) => setBond(event.target.value)} placeholder="bond wei" />
            <textarea value={obligation} onChange={(event) => setObligation(event.target.value)} rows={3} placeholder="obligation text" />
          </div>
          <button
            className="button button-secondary"
            disabled={!loaded || !!working || !address}
            onClick={() => run("Register span", async () => {
              await registerSpan({
                caseId,
                spanId: spanId.trim(),
                parentId: parentId.trim(),
                requester: coordinator ?? address!,
                provider: (provider.trim() || address) as `0x${string}`,
                obligation: obligation.trim(),
                bondWei: BigInt(bond.trim() || "0"),
                contributionPenaltyBps: 2500,
                causalPenaltyBps: 8000
              });
            })}
          >
            <Plus aria-hidden="true" size={16} />Register
          </button>
        </article>

        <article className="workflow-card">
          <div className="workflow-card-head"><Wallet aria-hidden="true" size={16} /><strong>Accept and bond</strong></div>
          <p>Provider accepts a proposed span by sending the exact bond amount.</p>
          <div className="workflow-inline">
            <input value={spanId} onChange={(event) => setSpanId(event.target.value)} placeholder="span id" />
            <input value={bond} onChange={(event) => setBond(event.target.value)} placeholder="bond wei" />
          </div>
          <button className="button button-secondary" disabled={!loaded || !!working} onClick={() => run("Accept span", async () => {
            await acceptSpan({ caseId, spanId: spanId.trim(), bondWei: BigInt(bond.trim() || "0") });
          })}>
            <Wallet aria-hidden="true" size={16} />Accept span
          </button>
        </article>

        <article className="workflow-card">
          <div className="workflow-card-head"><Send aria-hidden="true" size={16} /><strong>Submit delivery</strong></div>
          <div className="workflow-fields">
            <input value={spanId} onChange={(event) => setSpanId(event.target.value)} placeholder="span id" />
            <input value={deliveryRef} onChange={(event) => setDeliveryRef(event.target.value)} placeholder="delivery URL or artifact ref" />
          </div>
          <button className="button button-secondary" disabled={!loaded || !!working} onClick={() => run("Submit delivery", async () => {
            await submitDelivery({ caseId, spanId: spanId.trim(), deliveryRef: deliveryRef.trim() });
          })}>
            <Send aria-hidden="true" size={16} />Submit delivery
          </button>
        </article>

        <article className="workflow-card">
          <div className="workflow-card-head"><ReceiptText aria-hidden="true" size={16} /><strong>Open dispute + store evidence</strong></div>
          <div className="workflow-fields">
            <input value={evidenceSpanId} onChange={(event) => setEvidenceSpanId(event.target.value)} placeholder="span id" />
            <textarea value={statement} onChange={(event) => setStatement(event.target.value)} rows={3} placeholder="evidence statement" />
          </div>
          <button className="button button-secondary" disabled={!loaded || !!working} onClick={() => run("Open dispute", async () => {
            const stored = await onEvidenceDraft({
              caseId,
              spanId: evidenceSpanId.trim(),
              obligation,
              statement
            });
            await openDispute({ caseId, claimRef: stored.publicPath, claimDigest: stored.digest });
          })}>
            <Gavel aria-hidden="true" size={16} />Open dispute
          </button>
          <button className="button button-secondary" disabled={!loaded || !!working} onClick={() => run("Link evidence", async () => {
            const stored = await onEvidenceDraft({
              caseId,
              spanId: evidenceSpanId.trim(),
              obligation,
              statement
            });
            await submitEvidenceToContract({
              caseId,
              spanId: evidenceSpanId.trim(),
              evidenceRef: stored.publicPath,
              evidenceDigest: stored.digest
            });
          })}>
            <Link2 aria-hidden="true" size={16} />Submit contract evidence
          </button>
        </article>

        <article className="workflow-card">
          <div className="workflow-card-head"><LockKeyhole aria-hidden="true" size={16} /><strong>Resolve case</strong></div>
          <p>Lock evidence, ask GenLayer for judgment, settle the economic result, then withdraw claimable balance.</p>
          <div className="workflow-actions">
            <button className="button button-secondary" disabled={!loaded || !!working} onClick={() => run("Lock evidence", async () => { await lockEvidence(caseId); })}>Lock evidence</button>
            <button className="button button-secondary" disabled={!loaded || !!working} onClick={() => run("Adjudicate case", async () => { await adjudicateCase(caseId); })}>Adjudicate</button>
            <button className="button button-secondary" disabled={!loaded || !!working} onClick={() => run("Settle case", async () => { await settleCase(caseId); })}>Settle</button>
            <button className="button button-secondary" disabled={!loaded || !!working} onClick={() => run("Withdraw", async () => { await withdrawClaimable(); })}>Withdraw</button>
          </div>
        </article>
      </div>

      {message && <p className={message.toLowerCase().includes("failed") || message.toLowerCase().includes("error") ? "form-error" : "form-success"}>{message}</p>}
    </section>
  );
}
