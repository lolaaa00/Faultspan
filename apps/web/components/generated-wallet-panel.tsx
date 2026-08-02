"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Copy, Download, Upload, X } from "lucide-react";
import { exportGeneratedPrivateKey, hasAcknowledgedRisk, acknowledgeRisk, importGeneratedWallet } from "@/lib/generated-wallet";
import { useFaultspanWallet } from "./wallet-provider";

/**
 * Warning, export, and import UI for the generated (no-extension) browser wallet.
 * The key never leaves this browser except through explicit user action here —
 * export or import are the only ways a user can move this identity to another device.
 */
export function GeneratedWalletPanel({ open, onClose }: { open: boolean; onClose(): void }) {
  const { connectGenerated, address, mode } = useFaultspanWallet();
  const [acknowledged, setAcknowledged] = useState(false);
  const [importValue, setImportValue] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (open) setAcknowledged(hasAcknowledgedRisk());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function escape(event: KeyboardEvent) { if (event.key === "Escape") onClose(); }
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [onClose, open]);

  if (!open) return null;

  const isActive = mode === "generated" && Boolean(address);
  const privateKey = isActive ? exportGeneratedPrivateKey() : null;

  function handleCreate() {
    acknowledgeRisk();
    connectGenerated();
    onClose();
  }

  function handleImport() {
    setImportError(null);
    try {
      importGeneratedWallet(importValue);
      acknowledgeRisk();
      connectGenerated();
      setImportValue("");
      onClose();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Import failed");
    }
  }

  async function copyKey() {
    if (!privateKey) return;
    await navigator.clipboard.writeText(privateKey);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="dialog-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <dialog className="case-dialog" open aria-modal="true" aria-labelledby="generated-wallet-title">
        <div className="dialog-head">
          <div><span className="eyebrow">Browser wallet</span><h2 id="generated-wallet-title">{isActive ? "Manage your browser wallet" : "Create a browser wallet"}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><X aria-hidden="true" /></button>
        </div>

        {isActive ? (
          <>
            <div className="field"><span>Active address</span><p className="mono">{address}</p></div>
            <div className="field">
              <span>Private key</span>
              <button className="button button-secondary" onClick={() => setRevealed((v) => !v)} type="button">
                {revealed ? "Hide private key" : "Reveal private key"}
              </button>
              {revealed && privateKey && (
                <div className="review-box">
                  <p className="mono" style={{ wordBreak: "break-all" }}>{privateKey}</p>
                  <button className="button button-secondary" onClick={copyKey} type="button">
                    <Copy aria-hidden="true" size={14} />{copied ? "Copied" : "Copy"}
                  </button>
                </div>
              )}
            </div>
            <p className="form-error" role="alert">
              <AlertTriangle aria-hidden="true" size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />
              Anyone with this key controls this wallet. Export it before clearing site data or switching browsers — there is no recovery otherwise.
            </p>
            <div className="dialog-actions"><span /><button className="button button-primary" onClick={onClose}><Check aria-hidden="true" size={16} />Done</button></div>
          </>
        ) : (
          <>
            <div className="field">
              <span>
                Generates a wallet stored only in this browser&apos;s local storage — no
                extension, no install, no signup. You can start using Faultspan immediately.
              </span>
            </div>
            <div className="review-box">
              <strong>Before you continue</strong>
              <dl>
                <div><dt>Custody</dt><dd>This key lives only in this browser. Clearing site data destroys it permanently.</dd></div>
                <div><dt>Risk level</dt><dd>Not custody-grade. For real value, prefer an injected wallet like MetaMask.</dd></div>
                <div><dt>Portability</dt><dd>Export the key any time and import it elsewhere, or upgrade to an injected wallet later.</dd></div>
              </dl>
            </div>
            <label className="field" style={{ flexDirection: "row", alignItems: "center", display: "flex", gap: 10, fontWeight: 400 }}>
              <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
              I understand this key is not recoverable if lost.
            </label>
            <div className="dialog-actions">
              <span />
              <button className="button button-primary" disabled={!acknowledged} onClick={handleCreate}>
                <Download aria-hidden="true" size={16} />Create browser wallet
              </button>
            </div>
            <div className="field">
              <span>Already have a key? Import it instead.</span>
              <input aria-label="Private key to import" placeholder="0x..." value={importValue} onChange={(event) => setImportValue(event.target.value)} />
            </div>
            {importError && <p className="form-error" role="alert">{importError}</p>}
            <div className="dialog-actions">
              <span />
              <button className="button button-secondary" onClick={handleImport} disabled={!importValue.trim()}>
                <Upload aria-hidden="true" size={16} />Import key
              </button>
            </div>
          </>
        )}
        <p className="prototype-note">This key is generated and stored client-side only. Faultspan never transmits it anywhere.</p>
      </dialog>
    </div>
  );
}
