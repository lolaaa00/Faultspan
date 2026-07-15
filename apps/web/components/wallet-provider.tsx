"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { ExecutionResult, TransactionStatus, type TransactionHash } from "genlayer-js/types";
import { PLATFORM_API_URL, saveCaseProjection } from "@/lib/platform-api";

type EthereumProvider = { request(args: { method: string; params?: unknown[] | Record<string, unknown>[] }): Promise<unknown> };
declare global { interface Window { ethereum?: EthereumProvider } }

type TxState = { phase: "IDLE" | "SUBMITTING" | "ACCEPTED" | "FINALIZED" | "FAILED"; hash?: string; message?: string };
type CaseInput = { title: string; coordinator: `0x${string}`; bond: string };
type EvidenceInput = { caseId: string; spanId: string; obligation: string; statement: string };
type RegisterSpanInput = {
  caseId: string;
  spanId: string;
  parentId: string;
  requester: `0x${string}`;
  provider: `0x${string}`;
  obligation: string;
  bondWei: bigint;
  contributionPenaltyBps: number;
  causalPenaltyBps: number;
};
type AcceptSpanInput = { caseId: string; spanId: string; bondWei: bigint };
type DeliveryInput = { caseId: string; spanId: string; deliveryRef: string };
type DisputeInput = { caseId: string; claimRef: string; claimDigest: string };
type ContractEvidenceInput = { caseId: string; spanId: string; evidenceRef: string; evidenceDigest: string };
type WalletContextValue = {
  address: `0x${string}` | null;
  connecting: boolean;
  walletError: string | null;
  tx: TxState;
  connect(): Promise<void>;
  disconnect(): void;
  createCase(input: CaseInput): Promise<{ onchain: boolean; caseId: string }>;
  submitEvidence(input: EvidenceInput): Promise<{ evidenceId: string; digest: string; publicPath: string }>;
  registerSpan(input: RegisterSpanInput): Promise<{ hash: string }>;
  acceptSpan(input: AcceptSpanInput): Promise<{ hash: string }>;
  submitDelivery(input: DeliveryInput): Promise<{ hash: string; deliveryDigest: string }>;
  openDispute(input: DisputeInput): Promise<{ hash: string }>;
  submitEvidenceToContract(input: ContractEvidenceInput): Promise<{ hash: string }>;
  lockEvidence(caseId: string): Promise<{ hash: string }>;
  adjudicateCase(caseId: string): Promise<{ hash: string }>;
  settleCase(caseId: string): Promise<{ hash: string }>;
  withdrawClaimable(): Promise<{ hash: string }>;
};

const STUDIONET_CHAIN_ID = "0xf22f";
const WalletContext = createContext<WalletContextValue | null>(null);

function slug(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42);
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function walletMessage(error: unknown) {
  if (!(error instanceof Error)) return "Wallet connection failed";
  const code = (error as Error & { code?: number }).code;
  if (code === 4001) return "Connection rejected in wallet";
  if (code === -32002) return "Open your wallet extension and finish the pending request";
  return error.message || "Wallet connection failed";
}

async function ensureStudionet(provider: EthereumProvider) {
  const current = await provider.request({ method: "eth_chainId" }).catch(() => null);
  if (current === STUDIONET_CHAIN_ID) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: STUDIONET_CHAIN_ID }] });
  } catch (error) {
    const code = (error as Error & { code?: number }).code;
    if (code !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: STUDIONET_CHAIN_ID,
        chainName: "GenLayer Studionet",
        nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
        rpcUrls: [process.env.NEXT_PUBLIC_GENLAYER_RPC_URL ?? "https://studio.genlayer.com/api"]
      }]
    });
  }
}

async function createPlatformSession(provider: EthereumProvider, address: `0x${string}`) {
  const challengeResponse = await fetch(`${PLATFORM_API_URL}/v1/auth/challenge`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address })
  });
  if (!challengeResponse.ok) throw new Error("Platform API did not issue a wallet challenge");
  const challenge = await challengeResponse.json() as { challenge_id: string; message: string };
  const signature = await provider.request({ method: "personal_sign", params: [challenge.message, address] }) as string;
  const sessionResponse = await fetch(`${PLATFORM_API_URL}/v1/auth/verify`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challenge_id: challenge.challenge_id, signature })
  });
  if (!sessionResponse.ok) throw new Error("Wallet challenge verification failed");
  const session = await sessionResponse.json() as { session_token: string };
  return session.session_token;
}

function requireContractAddress() {
  const contract = process.env.NEXT_PUBLIC_FAULTSPAN_CONTRACT_ADDRESS as `0x${string}` | undefined;
  if (!contract) throw new Error("Set NEXT_PUBLIC_FAULTSPAN_CONTRACT_ADDRESS before submitting contract actions");
  return contract;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [tx, setTx] = useState<TxState>({ phase: "IDLE" });

  const connect = useCallback(async () => {
    setWalletError(null);
    if (!window.ethereum) { setWalletError("No browser wallet detected. Install MetaMask or open the wallet extension you want to use."); return; }
    setConnecting(true);
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
      const selected = accounts[0] as `0x${string}` | undefined;
      if (!selected) throw new Error("Wallet returned no account");
      await ensureStudionet(window.ethereum);
      setAddress(selected);
    } catch (error) {
      setWalletError(walletMessage(error));
    } finally { setConnecting(false); }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    setWalletError(null);
    setTx({ phase: "IDLE" });
  }, []);

  const runWrite = useCallback(async <T,>(
    label: string,
    callback: (client: ReturnType<typeof createClient>, contract: `0x${string}`) => Promise<T>
  ) => {
    if (!address || !window.ethereum) throw new Error("Connect a Studionet wallet before submitting contract actions");
    const contract = requireContractAddress();
    setTx({ phase: "SUBMITTING", message: `Confirm ${label.toLowerCase()} in your wallet.` });
    try {
      await ensureStudionet(window.ethereum);
      const client = createClient({ chain: studionet, account: address, provider: window.ethereum as never });
      const result = await callback(client, contract);
      return result;
    } catch (error) {
      const message = walletMessage(error);
      setTx({ phase: "FAILED", message });
      throw new Error(message);
    }
  }, [address]);

  const finalizeHash = useCallback(async <T extends { hash: string }>(hash: string, successMessage: string, value: T) => {
    if (!address || !window.ethereum) throw new Error("Connect a Studionet wallet before submitting contract actions");
    const client = createClient({ chain: studionet, account: address, provider: window.ethereum as never });
    setTx({ phase: "SUBMITTING", hash, message: "Transaction submitted to Studionet." });
    await client.waitForTransactionReceipt({ hash: hash as TransactionHash, status: TransactionStatus.ACCEPTED, retries: 120, interval: 2_000 });
    setTx({ phase: "ACCEPTED", hash, message: "Accepted. Waiting for validator finalization." });
    const receipt = await client.waitForTransactionReceipt({ hash: hash as TransactionHash, status: TransactionStatus.FINALIZED, retries: 240, interval: 3_000 });
    if (receipt.txExecutionResultName !== ExecutionResult.FINISHED_WITH_RETURN) {
      throw new Error("Transaction finalized, but contract execution failed");
    }
    setTx({ phase: "FINALIZED", hash, message: successMessage });
    return value;
  }, [address]);

  const createCase = useCallback(async (input: CaseInput) => {
    const caseId = `${slug(input.title) || "case"}-${Date.now().toString(36)}`;
    if (!address || !window.ethereum) throw new Error("Connect a Studionet wallet before creating a case");
    const provider = window.ethereum;
    return runWrite("Create case", async (client, contract) => {
      const now = Math.floor(Date.now() / 1000);
      const digest = await sha256(input.title);
      const hash = await client.writeContract({
        address: contract,
        functionName: "create_case",
        args: [caseId, input.coordinator, `urn:faultspan:terms:${caseId}`, digest, BigInt(now + 7 * 86_400), BigInt(now + 10 * 86_400)],
        value: 0n
      }) as TransactionHash;
      await finalizeHash(hash, "Case finalized on Studionet.", { hash });
      const sessionToken = await createPlatformSession(provider, address);
      await saveCaseProjection({
        case_id: caseId,
        title: input.title,
        owner: address,
        coordinator: input.coordinator,
        contract_address: contract,
        tx_hash: hash,
        status: "OPEN"
      }, sessionToken);
      return { onchain: true, caseId };
    });
  }, [address, finalizeHash, runWrite]);

  const submitEvidence = useCallback(async (input: EvidenceInput) => {
    if (!address || !window.ethereum) throw new Error("Connect the submitting wallet first");
    const sessionToken = await createPlatformSession(window.ethereum, address);
    const evidenceResponse = await fetch(`${PLATFORM_API_URL}/v1/evidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({
        schema_version: "1", case_id: input.caseId, span_id: input.spanId, submitted_by: address,
        created_at: new Date().toISOString(), obligation: { text: input.obligation }, delivery: {},
        task_events: [], payment_receipts: [], attachments: [], statements: [{ text: input.statement }]
      })
    });
    if (!evidenceResponse.ok) {
      const body = await evidenceResponse.json().catch(() => null) as { detail?: string } | null;
      throw new Error(body?.detail ?? "Evidence upload failed");
    }
    const receipt = await evidenceResponse.json() as { evidence_id: string; digest: string; public_path: string };
    return { evidenceId: receipt.evidence_id, digest: receipt.digest, publicPath: `${PLATFORM_API_URL}${receipt.public_path}` };
  }, [address]);

  const registerSpan = useCallback(async (input: RegisterSpanInput) => {
    return runWrite("Register span", async (client, contract) => {
      const digest = await sha256(input.obligation);
      const hash = await client.writeContract({
        address: contract,
        functionName: "register_span",
        args: [
          input.caseId,
          input.spanId,
          input.parentId,
          input.requester,
          input.provider,
          `urn:faultspan:span:${input.caseId}:${input.spanId}`,
          digest,
          input.bondWei,
          BigInt(input.contributionPenaltyBps),
          BigInt(input.causalPenaltyBps)
        ],
        value: 0n
      }) as TransactionHash;
      return finalizeHash(hash, `Span ${input.spanId} registered.`, { hash });
    });
  }, [finalizeHash, runWrite]);

  const acceptSpan = useCallback(async (input: AcceptSpanInput) => {
    return runWrite("Accept span", async (client, contract) => {
      const hash = await client.writeContract({
        address: contract,
        functionName: "accept_span",
        args: [input.caseId, input.spanId],
        value: input.bondWei
      }) as TransactionHash;
      return finalizeHash(hash, `Span ${input.spanId} accepted and bonded.`, { hash });
    });
  }, [finalizeHash, runWrite]);

  const submitDelivery = useCallback(async (input: DeliveryInput) => {
    return runWrite("Submit delivery", async (client, contract) => {
      const deliveryDigest = await sha256(input.deliveryRef);
      const hash = await client.writeContract({
        address: contract,
        functionName: "submit_delivery",
        args: [input.caseId, input.spanId, input.deliveryRef, deliveryDigest],
        value: 0n
      }) as TransactionHash;
      return finalizeHash(hash, `Delivery submitted for ${input.spanId}.`, { hash, deliveryDigest });
    });
  }, [finalizeHash, runWrite]);

  const openDispute = useCallback(async (input: DisputeInput) => {
    return runWrite("Open dispute", async (client, contract) => {
      const hash = await client.writeContract({
        address: contract,
        functionName: "open_dispute",
        args: [input.caseId, input.claimRef, input.claimDigest],
        value: 0n
      }) as TransactionHash;
      return finalizeHash(hash, `Dispute opened for ${input.caseId}.`, { hash });
    });
  }, [finalizeHash, runWrite]);

  const submitEvidenceToContract = useCallback(async (input: ContractEvidenceInput) => {
    return runWrite("Submit contract evidence", async (client, contract) => {
      const hash = await client.writeContract({
        address: contract,
        functionName: "submit_evidence",
        args: [input.caseId, input.spanId, input.evidenceRef, input.evidenceDigest],
        value: 0n
      }) as TransactionHash;
      return finalizeHash(hash, `Evidence linked to ${input.spanId}.`, { hash });
    });
  }, [finalizeHash, runWrite]);

  const lockEvidence = useCallback(async (caseId: string) => {
    return runWrite("Lock evidence", async (client, contract) => {
      const hash = await client.writeContract({
        address: contract,
        functionName: "lock_evidence",
        args: [caseId],
        value: 0n
      }) as TransactionHash;
      return finalizeHash(hash, `Evidence locked for ${caseId}.`, { hash });
    });
  }, [finalizeHash, runWrite]);

  const adjudicateCase = useCallback(async (caseId: string) => {
    return runWrite("Adjudicate case", async (client, contract) => {
      const hash = await client.writeContract({
        address: contract,
        functionName: "adjudicate_case",
        args: [caseId],
        value: 0n
      }) as TransactionHash;
      return finalizeHash(hash, `Adjudication finalized for ${caseId}.`, { hash });
    });
  }, [finalizeHash, runWrite]);

  const settleCase = useCallback(async (caseId: string) => {
    return runWrite("Settle case", async (client, contract) => {
      const hash = await client.writeContract({
        address: contract,
        functionName: "settle_case",
        args: [caseId],
        value: 0n
      }) as TransactionHash;
      return finalizeHash(hash, `Settlement finalized for ${caseId}.`, { hash });
    });
  }, [finalizeHash, runWrite]);

  const withdrawClaimable = useCallback(async () => {
    return runWrite("Withdraw claimable balance", async (client, contract) => {
      const hash = await client.writeContract({
        address: contract,
        functionName: "withdraw",
        args: [],
        value: 0n
      }) as TransactionHash;
      return finalizeHash(hash, "Withdraw finalized on Studionet.", { hash });
    });
  }, [finalizeHash, runWrite]);

  const value = useMemo(() => ({
    address,
    connecting,
    walletError,
    tx,
    connect,
    disconnect,
    createCase,
    submitEvidence,
    registerSpan,
    acceptSpan,
    submitDelivery,
    openDispute,
    submitEvidenceToContract,
    lockEvidence,
    adjudicateCase,
    settleCase,
    withdrawClaimable
  }), [address, connecting, walletError, tx, connect, disconnect, createCase, submitEvidence, registerSpan, acceptSpan, submitDelivery, openDispute, submitEvidenceToContract, lockEvidence, adjudicateCase, settleCase, withdrawClaimable]);
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useFaultspanWallet() {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useFaultspanWallet must be used inside WalletProvider");
  return value;
}
