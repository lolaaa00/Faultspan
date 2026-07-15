"use client";

import { AlertTriangle, LogOut, Wallet } from "lucide-react";
import { useFaultspanWallet } from "./wallet-provider";

function short(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function WalletButton() {
  const { address, connecting, walletError, connect, disconnect } = useFaultspanWallet();

  return (
    <div className="wallet-control">
      <div className="wallet-actions">
        <button className="button button-secondary" onClick={connect} disabled={connecting} aria-describedby={walletError ? "wallet-error" : undefined}>
          <Wallet aria-hidden="true" size={16} />
          {connecting ? "Connecting..." : address ? short(address) : "Connect wallet"}
        </button>
        {address && <button className="icon-button wallet-disconnect" onClick={disconnect} aria-label="Disconnect wallet"><LogOut aria-hidden="true" size={16} /></button>}
      </div>
      {walletError && <span className="wallet-error" id="wallet-error"><AlertTriangle aria-hidden="true" size={14} />{walletError}</span>}
    </div>
  );
}
