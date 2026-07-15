"use client";

import { useEffect, useState } from "react";
import { FileUp, LockKeyhole, X } from "lucide-react";
import { useFaultspanWallet } from "./wallet-provider";

export function FileEvidenceDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const [caseId, setCaseId] = useState("");
  const [spanId, setSpanId] = useState("");
  const [obligation, setObligation] = useState("");
  const [statement, setStatement] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const { submitEvidence } = useFaultspanWallet();

  useEffect(() => {
    if (!open) return;
    function escape(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose, open]);

  async function submit() {
    if (caseId.trim().length < 3) { setMessage({ kind: "error", text: "Enter the real case id." }); return; }
    if (spanId.trim().length < 3) { setMessage({ kind: "error", text: "Enter the real span id." }); return; }
    if (obligation.trim().length < 20) { setMessage({ kind: "error", text: "Paste the accepted obligation in at least 20 characters." }); return; }
    if (statement.trim().length < 20) { setMessage({ kind: "error", text: "Explain the evidence in at least 20 characters." }); return; }
    setSubmitting(true); setMessage(null);
    try {
      const receipt = await submitEvidence({ caseId: caseId.trim(), spanId: spanId.trim(), obligation: obligation.trim(), statement });
      setMessage({ kind: "success", text: `Evidence ${receipt.evidenceId} stored as ${receipt.digest.slice(0, 22)}...` });
    } catch (error) { setMessage({ kind: "error", text: error instanceof Error ? error.message : "Evidence submission failed" }); }
    finally { setSubmitting(false); }
  }

  if (!open) return null;
  return <div className="dialog-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><dialog className="case-dialog evidence-dialog" open aria-modal="true" aria-labelledby="evidence-dialog-title">
    <div className="dialog-head"><div><span className="eyebrow">Public evidence submission</span><h2 id="evidence-dialog-title">Add evidence to a span</h2></div><button className="icon-button" onClick={onClose} aria-label="Close evidence dialog"><X aria-hidden="true" /></button></div>
    <div className="evidence-warning"><LockKeyhole aria-hidden="true" size={18} /><p><strong>Public by design.</strong> Do not submit secrets, personal information, private keys, or confidential customer data.</p></div>
    <label className="field">Case id<span>Use the real case id returned by the Studionet transaction.</span><input value={caseId} onChange={(event) => setCaseId(event.target.value)} placeholder="case-id-from-contract" autoComplete="off" /></label>
    <label className="field">Obligation span id<span>Evidence must be attached to the real obligation span it supports or contests.</span><input value={spanId} onChange={(event) => setSpanId(event.target.value)} placeholder="root or delegated span id" autoComplete="off" /></label>
    <label className="field">Accepted obligation<span>Paste the obligation text this evidence should be judged against.</span><textarea rows={4} required value={obligation} onChange={(event) => setObligation(event.target.value)} placeholder="Provider accepted responsibility to..." /></label>
    <label className="field">Evidence statement<span>State what happened, what this object proves, and where the obligation differs from delivery.</span><textarea rows={6} required value={statement} onChange={(event) => setStatement(event.target.value)} placeholder="The validation trace shows that..." aria-describedby={message?.kind === "error" ? "evidence-error" : undefined} /></label>
    {message && <p className={message.kind === "error" ? "form-error" : "form-success"} id={message.kind === "error" ? "evidence-error" : undefined} role={message.kind === "error" ? "alert" : "status"}>{message.text}</p>}
    <div className="dialog-actions"><button className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" onClick={submit} disabled={submitting}><FileUp aria-hidden="true" size={16} />{submitting ? "Signing and storing..." : "Sign and store evidence"}</button></div>
  </dialog></div>;
}