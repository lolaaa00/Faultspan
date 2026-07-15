"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { useFaultspanWallet } from "./wallet-provider";

export function CreateCaseDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const [step, setStep] = useState(1);
  const [title, setTitle] = useState("");
  const [coordinator, setCoordinator] = useState("");
  const [bond, setBond] = useState("2.00");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const { createCase } = useFaultspanWallet();

  useEffect(() => {
    if (!open) return;
    function escape(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose, open]);

  function next() {
    if (step === 1 && title.trim().length < 8) { setError("Describe the root obligation in at least eight characters."); return; }
    if (step === 2 && !/^0x[a-fA-F0-9]{40}$/.test(coordinator)) { setError("Enter a complete 20-byte coordinator address."); return; }
    setError(null); setStep((current) => Math.min(3, current + 1));
  }

  async function finish() {
    setError(null); setSubmitting(true); setResult(null);
    try {
      const created = await createCase({ title, coordinator: coordinator as `0x${string}`, bond });
      setResult(`Case ${created.caseId} finalized on Studionet.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Case creation failed");
    } finally { setSubmitting(false); }
  }

  if (!open) return null;
  return <div className="dialog-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><dialog className="case-dialog" open aria-modal="true" aria-labelledby="create-case-title">
    <div className="dialog-head"><div><span className="eyebrow">New case - Step {step} of 3</span><h2 id="create-case-title">{step === 1 ? "Define the commitment" : step === 2 ? "Name the coordinator" : "Set the recovery rule"}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close create case"><X aria-hidden="true" /></button></div>
    <div className="step-meter" aria-label={`Step ${step} of 3`}><span className={step >= 1 ? "active" : ""}></span><span className={step >= 2 ? "active" : ""}></span><span className={step >= 3 ? "active" : ""}></span></div>
    {step === 1 && <label className="field">Root obligation<span>Write the commitment a validator should later interpret.</span><textarea value={title} onChange={(event) => setTitle(event.target.value)} rows={5} required aria-describedby={error ? "case-error" : undefined} placeholder="Deliver a source-verified market report..." /></label>}
    {step === 2 && <label className="field">Coordinator address<span>The wallet allowed to register delegated spans.</span><input value={coordinator} onChange={(event) => setCoordinator(event.target.value)} required aria-describedby={error ? "case-error" : undefined} placeholder="0x..." autoComplete="off" /></label>}
    {step === 3 && <><label className="field">Default provider bond (GEN)<span>Each provider sees exact terms before accepting.</span><input type="number" min="0" step="0.01" value={bond} onChange={(event) => setBond(event.target.value)} required /></label><div className="review-box"><strong>Public commitment preview</strong><p>{title}</p><dl><div><dt>Coordinator</dt><dd className="mono">{coordinator.slice(0, 10)}...{coordinator.slice(-6)}</dd></div><div><dt>Default bond</dt><dd>{bond} GEN</dd></div><div><dt>Network</dt><dd>Studionet - 61999</dd></div></dl></div></>}
    {error && <p className="form-error" id="case-error" role="alert">{error}</p>}
    {result && <p className="form-success" role="status">{result}</p>}
    <div className="dialog-actions">{step > 1 ? <button className="button button-ghost" onClick={() => setStep((current) => current - 1)} disabled={submitting}><ArrowLeft aria-hidden="true" size={16} />Back</button> : <span />}{step < 3 ? <button className="button button-primary" onClick={next}>Continue<ArrowRight aria-hidden="true" size={16} /></button> : <button className="button button-primary" onClick={finish} disabled={submitting}>{submitting ? "Submitting..." : <><Check aria-hidden="true" size={16} />Create case</>}</button>}</div>
    <p className="prototype-note">Real mode is active. Case creation requires a connected wallet and submits to the configured Studionet contract.</p>
  </dialog></div>;
}