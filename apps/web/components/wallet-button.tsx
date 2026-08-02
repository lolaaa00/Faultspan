"use client";

import { useState } from "react";
import { AlertTriangle, LogOut, Wallet } from "lucide-react";
import { useFaultspanWallet } from "./wallet-provider";
import { GeneratedWalletPanel } from "./generated-wallet-panel";

function short(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function WalletButton() {
  const { address, mode, hasInjectedWallet, connecting, walletError, connect, disconnect } = useFaultspanWallet();
  const [panelOpen, setPanelOpen] = useState(false);

  if (address) {
    return (
      <div className="wallet-control">
        <div className="wallet-actions">
          <button
            className="button button-secondary"
            onClick={() => (mode === "generated" ? setPanelOpen(true) : undefined)}
            aria-describedby={walletError ? "wallet-error" : undefined}
          >
            <Wallet aria-hidden="true" size={16} />
            {short(address)}
            {mode === "generated" && <span className="wallet-mode-tag">browser wallet</span>}
          </button>
          <button className="icon-button wallet-disconnect" onClick={disconnect} aria-label="Disconnect wallet"><LogOut aria-hidden="true" size={16} /></button>
        </div>
        {walletError && <span className="wallet-error" id="wallet-error"><AlertTriangle aria-hidden="true" size={14} />{walletError}</span>}
        <GeneratedWalletPanel open={panelOpen} onClose={() => setPanelOpen(false)} />
      </div>
    );
  }

  return (
    <div className="wallet-control">
      <div className="wallet-actions">
        <button className="button button-secondary" onClick={connect} disabled={connecting} aria-describedby={walletError ? "wallet-error" : undefined}>
          <Wallet aria-hidden="true" size={16} />
          {connecting ? "Connecting..." : hasInjectedWallet ? "Connect wallet" : "Connect MetaMask"}
        </button>
        <button className="button button-ghost" onClick={() => setPanelOpen(true)}>
          Use browser wallet instead
        </button>
      </div>
      {walletError && <span className="wallet-error" id="wallet-error"><AlertTriangle aria-hidden="true" size={14} />{walletError}</span>}
      <GeneratedWalletPanel open={panelOpen} onClose={() => setPanelOpen(false)} />
    </div>
  );
}
