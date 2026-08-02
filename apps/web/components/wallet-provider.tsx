"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { ExecutionResult, TransactionStatus, type TransactionHash } from "genlayer-js/types";
import { appendActivityRecord, PLATFORM_API_URL, saveCaseProjection, saveSpanProjection } from "@/lib/platform-api";
import { pollTransactionLifecycle, RETRYABLE_STATUSES, type LifecycleStage } from "@/lib/genlayer";
import {
  createAndStoreGeneratedWallet,
  loadGeneratedWallet,
  type GeneratedAccount
} from "@/lib/generated-wallet";

type EthereumProvider = { request(args: { method: string; params?: unknown[] | Record<string, unknown>[] }): Promise<unknown> };
declare global { interface Window { ethereum?: EthereumProvider } }

export type WalletMode = "injected" | "generated";
type TxPhase = "IDLE" | "SUBMITTING" | "PROPOSING" | "COMMITTING" | "REVEALING" | "ACCEPTED" | "FINALIZED" | "UNDETERMINED" | "FAILED";
type TxState = { phase: TxPhase; hash?: string; message?: string; retryable?: boolean };
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
  mode: WalletMode | null;
  hasInjectedWallet: boolean;
  connecting: boolean;
  walletError: string | null;
  tx: TxState;
  connect(): Promise<void>;
  connectGenerated(): void;
  disconnect(): void;
  createCase(input: CaseInput): Promise<{ onchain: boolean; caseId: string }>;
  submitEvidence(input: EvidenceInput): Promise<{ evidenceId: string; digest: string; publicPath: string; byteLength?: number }>;
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
const WALLET_STORAGE_KEY = "faultspan.connectedWallet";
const WALLET_MODE_KEY = "faultspan.connectedMode";
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

type SignMessage = (message: string) => Promise<string>;

async function createPlatformSession(sign: SignMessage, address: `0x${string}`) {
  const challengeResponse = await fetch(`${PLATFORM_API_URL}/v1/auth/challenge`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address })
  });
  if (!challengeResponse.ok) throw new Error("Platform API did not issue a wallet challenge");
  const challenge = await challengeResponse.json() as { challenge_id: string; message: string };
  const signature = await sign(challenge.message);
  const sessionResponse = await fetch(`${PLATFORM_API_URL}/v1/auth/verify`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ challenge_id: challenge.challenge_id, signature })
  });
  if (!sessionResponse.ok) throw new Error("Wallet challenge verification failed");
  const session = await sessionResponse.json() as { session_token: string };
  return session.session_token;
}

async function recordActivity(sessionToken: string, input: Parameters<typeof appendActivityRecord>[0]) {
  await appendActivityRecord(input, sessionToken);
}

function requireContractAddress() {
  const contract = process.env.NEXT_PUBLIC_FAULTSPAN_CONTRACT_ADDRESS as `0x${string}` | undefined;
  if (!contract) throw new Error("Set NEXT_PUBLIC_FAULTSPAN_CONTRACT_ADDRESS before submitting contract actions");
  return contract;
}

function isSuccessfulExecution(receipt: { txExecutionResultName?: unknown; resultCode?: unknown }) {
  const execution = String(receipt.txExecutionResultName ?? "");
  const resultCode = String(receipt.resultCode ?? "");
  return execution === String(ExecutionResult.FINISHED_WITH_RETURN)
    || execution === "SUCCESS"
    || resultCode === "SUCCESS";
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [mode, setMode] = useState<WalletMode | null>(null);
  const [generatedAccount, setGeneratedAccount] = useState<GeneratedAccount | null>(null);
  const [hasInjectedWallet, setHasInjectedWallet] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [tx, setTx] = useState<TxState>({ phase: "IDLE" });

  useEffect(() => {
    setHasInjectedWallet(typeof window !== "undefined" && Boolean(window.ethereum));
  }, []);

  const connect = useCallback(async () => {
    setWalletError(null);
    if (!window.ethereum) { setWalletError("No browser wallet detected. Install MetaMask, or use a browser wallet with no extension required."); return; }
    setConnecting(true);
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
      const selected = accounts[0] as `0x${string}` | undefined;
      if (!selected) throw new Error("Wallet returned no account");
      await ensureStudionet(window.ethereum);
      setAddress(selected);
      setMode("injected");
      setGeneratedAccount(null);
      window.localStorage.setItem(WALLET_STORAGE_KEY, selected);
      window.localStorage.setItem(WALLET_MODE_KEY, "injected");
    } catch (error) {
      setWalletError(walletMessage(error));
    } finally { setConnecting(false); }
  }, []);

  /** Generates (or restores) a locally-signed browser wallet — zero-friction path
   * when no extension is present. Caller is responsible for the risk acknowledgement. */
  const connectGenerated = useCallback(() => {
    setWalletError(null);
    try {
      const account = createAndStoreGeneratedWallet();
      setGeneratedAccount(account);
      setAddress(account.address as `0x${string}`);
      setMode("generated");
      window.localStorage.setItem(WALLET_MODE_KEY, "generated");
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : "Could not create a browser wallet");
    }
  }, []);

  const disconnect = useCallback(() => {
    setAddress(null);
    setMode(null);
    setGeneratedAccount(null);
    setWalletError(null);
    setTx({ phase: "IDLE" });
    window.localStorage.removeItem(WALLET_STORAGE_KEY);
    window.localStorage.removeItem(WALLET_MODE_KEY);
  }, []);

  useEffect(() => {
    const provider = window.ethereum as (EthereumProvider & {
      on?: (event: string, listener: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
    }) | undefined;

    let cancelled = false;
    const rememberedMode = window.localStorage.getItem(WALLET_MODE_KEY);

    if (rememberedMode === "generated") {
      const restored = loadGeneratedWallet();
      if (restored) {
        setGeneratedAccount(restored);
        setAddress(restored.address as `0x${string}`);
        setMode("generated");
      }
      return;
    }

    if (!provider) return;

    const restore = async () => {
      const remembered = window.localStorage.getItem(WALLET_STORAGE_KEY);
      if (!remembered) return;
      try {
        const accounts = await provider.request({ method: "eth_accounts" }) as string[];
        const match = accounts.find((item) => item.toLowerCase() === remembered.toLowerCase()) as `0x${string}` | undefined;
        if (!match || cancelled) {
          if (!match) window.localStorage.removeItem(WALLET_STORAGE_KEY);
          return;
        }
        await ensureStudionet(provider);
        if (!cancelled) {
          setAddress(match);
          setMode("injected");
          setWalletError(null);
        }
      } catch {
        if (!cancelled) window.localStorage.removeItem(WALLET_STORAGE_KEY);
      }
    };

    const handleAccountsChanged = (accounts: unknown) => {
      const next = Array.isArray(accounts) ? accounts[0] : null;
      if (typeof next === "string" && next) {
        setAddress(next as `0x${string}`);
        setMode("injected");
        setWalletError(null);
        window.localStorage.setItem(WALLET_STORAGE_KEY, next);
        window.localStorage.setItem(WALLET_MODE_KEY, "injected");
        return;
      }
      disconnect();
    };

    const handleChainChanged = () => {
      void restore();
    };

    void restore();
    provider.on?.("accountsChanged", handleAccountsChanged);
    provider.on?.("chainChanged", handleChainChanged);

    return () => {
      cancelled = true;
      provider.removeListener?.("accountsChanged", handleAccountsChanged);
      provider.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [disconnect]);

  /** Builds a write-capable client for whichever wallet is active. Reads always use
   * the account-less `readClient` (see lib/genlayer.ts); this is the single place a
   * write client is constructed, so the signing identity can never drift from the
   * address the UI displays. */
  const buildWriteClient = useCallback(() => {
    if (mode === "generated" && generatedAccount) {
      return createClient({ chain: studionet, account: generatedAccount });
    }
    if (mode === "injected" && address && window.ethereum) {
      return createClient({ chain: studionet, account: address, provider: window.ethereum as never });
    }
    throw new Error("Connect a Studionet wallet before submitting contract actions");
  }, [mode, address, generatedAccount]);

  /** Signs an arbitrary message with whichever wallet is active — used for the
   * platform-evidence auth challenge. Injected wallets sign via personal_sign;
   * a generated wallet signs locally with no extension involved. */
  const signChallenge = useCallback<SignMessage>(async (message) => {
    if (mode === "generated" && generatedAccount) {
      return generatedAccount.signMessage({ message });
    }
    if (mode === "injected" && address && window.ethereum) {
      return window.ethereum.request({ method: "personal_sign", params: [message, address] }) as Promise<string>;
    }
    throw new Error("Connect a Studionet wallet before signing");
  }, [mode, address, generatedAccount]);

  const stageMessage: Record<string, string> = {
    PENDING: "Transaction queued on Studionet.",
    PROPOSING: "Leader validator is proposing a result.",
    COMMITTING: "Validators are committing their votes.",
    REVEALING: "Validators are revealing votes to reach consensus.",
    ACCEPTED: "Accepted by consensus. Waiting for the appeal window to finalize.",
    READY_TO_FINALIZE: "Consensus reached. Finalizing on Studionet."
  };

  const runWrite = useCallback(async <T,>(
    label: string,
    callback: (client: ReturnType<typeof createClient>, contract: `0x${string}`) => Promise<T>
  ) => {
    if (mode === "injected" && window.ethereum) await ensureStudionet(window.ethereum);
    const contract = requireContractAddress();
    setTx({ phase: "SUBMITTING", message: `Confirm ${label.toLowerCase()} ${mode === "generated" ? "with your browser wallet" : "in your wallet"}.` });
    try {
      const client = buildWriteClient();
      const result = await callback(client, contract);
      return result;
    } catch (error) {
      const message = walletMessage(error);
      setTx({ phase: "FAILED", message });
      throw new Error(message);
    }
  }, [mode, buildWriteClient]);

  const finalizeHash = useCallback(async <T extends { hash: string }>(hash: string, successMessage: string, value: T) => {
    const client = buildWriteClient();
    setTx({ phase: "SUBMITTING", hash, message: "Transaction submitted to Studionet." });

    const transaction = await pollTransactionLifecycle(client, hash as TransactionHash, (stage: LifecycleStage) => {
      if (stage.retryable) {
        setTx({
          phase: "UNDETERMINED",
          hash,
          message: `Validators reached ${stage.status} — nothing was written to the contract. This is a known, retryable Studionet outcome, not an error. You can safely resubmit.`,
          retryable: true
        });
        return;
      }
      const phase = (stage.status in { PROPOSING: 1, COMMITTING: 1, REVEALING: 1, ACCEPTED: 1, FINALIZED: 1 }
        ? stage.status
        : "SUBMITTING") as TxPhase;
      setTx({ phase, hash, message: stageMessage[stage.status] ?? `Status: ${stage.status}` });
    });

    const finalStatus = String(transaction.statusName ?? transaction.status ?? "");
    if (RETRYABLE_STATUSES.has(finalStatus)) {
      throw new Error(`Validators reached ${finalStatus} — nothing was written. Please retry.`);
    }
    if (!isSuccessfulExecution(transaction)) {
      const execution = String((transaction as { txExecutionResultName?: unknown }).txExecutionResultName ?? "unknown");
      const resultCode = String((transaction as { resultCode?: unknown }).resultCode ?? "unknown");
      const message = `Transaction finalized, but execution reports ${execution}/${resultCode}`;
      setTx({ phase: "FAILED", hash, message });
      throw new Error(message);
    }
    setTx({ phase: "FINALIZED", hash, message: successMessage });
    return value;
  }, [buildWriteClient, stageMessage]);

  const createCase = useCallback(async (input: CaseInput) => {
    const caseId = `${slug(input.title) || "case"}-${Date.now().toString(36)}`;
    if (!address) throw new Error("Connect a Studionet wallet before creating a case");
    const sessionToken = await createPlatformSession(signChallenge, address);
    const termsResponse = await fetch(`${PLATFORM_API_URL}/v1/evidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({
        schema_version: "1",
        case_id: caseId,
        span_id: "root-terms",
        submitted_by: address,
        created_at: new Date().toISOString(),
        obligation: { text: input.title },
        delivery: {},
        task_events: [],
        payment_receipts: [],
        attachments: [],
        statements: [{
          text: "COMPLIED requires material fulfillment of the stated obligation within the required timeframe. CAUSED_FAILURE applies when a material breach was a necessary cause of the root outcome failing. CONTRIBUTED_TO_FAILURE applies when a material breach worsened the root outcome but was not the sole cause. INSUFFICIENT_EVIDENCE applies when available evidence cannot support a determination."
        }]
      })
    });
    if (!termsResponse.ok) throw new Error("Root terms upload failed — check the platform backend is running with Pinata configured");
    const termsReceipt = await termsResponse.json() as { digest: string; public_path: string };
    const termsRef = termsReceipt.public_path.startsWith("http")
      ? termsReceipt.public_path
      : `${PLATFORM_API_URL}${termsReceipt.public_path}`;
    const termsDigest = termsReceipt.digest;
    return runWrite("Create case", async (client, contract) => {
      const now = Math.floor(Date.now() / 1000);
      const hash = await client.writeContract({
        address: contract,
        functionName: "create_case",
        args: [caseId, input.coordinator, termsRef, termsDigest, BigInt(now + 7 * 86_400), BigInt(now + 10 * 86_400)],
        value: 0n
      }) as TransactionHash;
      await finalizeHash(hash, "Case finalized on Studionet.", { hash });
      await saveCaseProjection({
        case_id: caseId,
        title: input.title,
        owner: address,
        coordinator: input.coordinator,
        contract_address: contract,
        tx_hash: hash,
        status: "OPEN"
      }, sessionToken);
      await recordActivity(sessionToken, {
        case_id: caseId,
        span_id: null,
        actor: address,
        action: "create_case",
        status: "FINALIZED",
        tx_hash: hash,
        summary: `Created case ${caseId}`
      });
      return { onchain: true, caseId };
    });
  }, [address, finalizeHash, runWrite, signChallenge]);

  const submitEvidence = useCallback(async (input: EvidenceInput) => {
    if (!address) throw new Error("Connect the submitting wallet first");
    const sessionToken = await createPlatformSession(signChallenge, address);
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
    const receipt = await evidenceResponse.json() as { evidence_id: string; digest: string; public_path: string; byte_length?: number };
    const result = {
      evidenceId: receipt.evidence_id,
      digest: receipt.digest,
      publicPath: receipt.public_path.startsWith("http")
        ? receipt.public_path
        : `${PLATFORM_API_URL}${receipt.public_path}`,
      byteLength: receipt.byte_length
    };
    await recordActivity(sessionToken, {
      case_id: input.caseId,
      span_id: input.spanId,
      actor: address,
      action: "submit_evidence_bundle",
      status: "STORED",
      tx_hash: null,
      summary: `Stored evidence bundle ${receipt.evidence_id} for ${input.spanId}`
    });
    return result;
  }, [address, signChallenge]);

  const registerSpan = useCallback(async (input: RegisterSpanInput) => {
    if (!address) throw new Error("Connect a Studionet wallet before registering a span");
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
      const result = await finalizeHash(hash, `Span ${input.spanId} registered.`, { hash });
      const sessionToken = await createPlatformSession(signChallenge, address);
      await saveSpanProjection({
        case_id: input.caseId,
        span_id: input.spanId,
        parent_id: input.parentId || null,
        requester: input.requester,
        provider: input.provider,
        obligation: input.obligation,
        bond_wei: input.bondWei.toString(),
        status: "PROPOSED",
        tx_hash: hash
      }, sessionToken);
      await recordActivity(sessionToken, {
        case_id: input.caseId,
        span_id: input.spanId,
        actor: address,
        action: "register_span",
        status: "FINALIZED",
        tx_hash: hash,
        summary: `Registered span ${input.spanId} for provider ${input.provider}`
      });
      return result;
    });
  }, [address, finalizeHash, runWrite, signChallenge]);

  const acceptSpan = useCallback(async (input: AcceptSpanInput) => {
    if (!address) throw new Error("Connect a Studionet wallet before accepting a span");
    return runWrite("Accept span", async (client, contract) => {
      const hash = await client.writeContract({
        address: contract,
        functionName: "accept_span",
        args: [input.caseId, input.spanId],
        value: input.bondWei
      }) as TransactionHash;
      const result = await finalizeHash(hash, `Span ${input.spanId} accepted and bonded.`, { hash });
      const sessionToken = await createPlatformSession(signChallenge, address);
      await recordActivity(sessionToken, {
        case_id: input.caseId,
        span_id: input.spanId,
        actor: address,
        action: "accept_span",
        status: "FINALIZED",
        tx_hash: hash,
        summary: `Accepted span ${input.spanId} with bond ${input.bondWei.toString()} wei`
      });
      return result;
    });
  }, [address, finalizeHash, runWrite, signChallenge]);

  const submitDelivery = useCallback(async (input: DeliveryInput) => {
    if (!address) throw new Error("Connect a Studionet wallet before submitting delivery");
    return runWrite("Submit delivery", async (client, contract) => {
      const deliveryDigest = await sha256(input.deliveryRef);
      const hash = await client.writeContract({
        address: contract,
        functionName: "submit_delivery",
        args: [input.caseId, input.spanId, input.deliveryRef, deliveryDigest],
        value: 0n
      }) as TransactionHash;
      const result = await finalizeHash(hash, `Delivery submitted for ${input.spanId}.`, { hash, deliveryDigest });
      const sessionToken = await createPlatformSession(signChallenge, address);
      await recordActivity(sessionToken, {
        case_id: input.caseId,
        span_id: input.spanId,
        actor: address,
        action: "submit_delivery",
        status: "FINALIZED",
        tx_hash: hash,
        summary: `Submitted delivery for ${input.spanId}`
      });
      return result;
    });
  }, [address, finalizeHash, runWrite, signChallenge]);

  const openDispute = useCallback(async (input: DisputeInput) => {
    if (!address) throw new Error("Connect a Studionet wallet before opening a dispute");
    return runWrite("Open dispute", async (client, contract) => {
      const hash = await client.writeContract({
        address: contract,
        functionName: "open_dispute",
        args: [input.caseId, input.claimRef, input.claimDigest],
        value: 0n
      }) as TransactionHash;
      const result = await finalizeHash(hash, `Dispute opened for ${input.caseId}.`, { hash });
      const sessionToken = await createPlatformSession(signChallenge, address);
      await recordActivity(sessionToken, {
        case_id: input.caseId,
        span_id: null,
        actor: address,
        action: "open_dispute",
        status: "FINALIZED",
        tx_hash: hash,
        summary: `Opened dispute with claim ref ${input.claimRef}`
      });
      return result;
    });
  }, [address, finalizeHash, runWrite, signChallenge]);

  const submitEvidenceToContract = useCallback(async (input: ContractEvidenceInput) => {
    if (!address) throw new Error("Connect a Studionet wallet before linking contract evidence");
    return runWrite("Submit contract evidence", async (client, contract) => {
      const hash = await client.writeContract({
        address: contract,
        functionName: "submit_evidence",
        args: [input.caseId, input.spanId, input.evidenceRef, input.evidenceDigest],
        value: 0n
      }) as TransactionHash;
      const result = await finalizeHash(hash, `Evidence linked to ${input.spanId}.`, { hash });
      const sessionToken = await createPlatformSession(signChallenge, address);
      await recordActivity(sessionToken, {
        case_id: input.caseId,
        span_id: input.spanId,
        actor: address,
        action: "submit_evidence",
        status: "FINALIZED",
        tx_hash: hash,
        summary: `Linked evidence for ${input.spanId}`
      });
      return result;
    });
  }, [address, finalizeHash, runWrite, signChallenge]);

  const lockEvidence = useCallback(async (caseId: string) => {
    if (!address) throw new Error("Connect a Studionet wallet before locking evidence");
    return runWrite("Lock evidence", async (client, contract) => {
      const hash = await client.writeContract({
        address: contract,
        functionName: "lock_evidence",
        args: [caseId],
        value: 0n
      }) as TransactionHash;
      const result = await finalizeHash(hash, `Evidence locked for ${caseId}.`, { hash });
      const sessionToken = await createPlatformSession(signChallenge, address);
      await recordActivity(sessionToken, {
        case_id: caseId,
        span_id: null,
        actor: address,
        action: "lock_evidence",
        status: "FINALIZED",
        tx_hash: hash,
        summary: `Locked evidence for case ${caseId}`
      });
      return result;
    });
  }, [address, finalizeHash, runWrite, signChallenge]);

  const adjudicateCase = useCallback(async (caseId: string) => {
    if (!address) throw new Error("Connect a Studionet wallet before adjudicating");
    return runWrite("Adjudicate case", async (client, contract) => {
      const hash = await client.writeContract({
        address: contract,
        functionName: "adjudicate_case",
        args: [caseId],
        value: 0n
      }) as TransactionHash;
      const result = await finalizeHash(hash, `Adjudication finalized for ${caseId}.`, { hash });
      const sessionToken = await createPlatformSession(signChallenge, address);
      await recordActivity(sessionToken, {
        case_id: caseId,
        span_id: null,
        actor: address,
        action: "adjudicate_case",
        status: "FINALIZED",
        tx_hash: hash,
        summary: `Requested and finalized adjudication for ${caseId}`
      });
      return result;
    });
  }, [address, finalizeHash, runWrite, signChallenge]);

  const settleCase = useCallback(async (caseId: string) => {
    if (!address) throw new Error("Connect a Studionet wallet before settling");
    return runWrite("Settle case", async (client, contract) => {
      const hash = await client.writeContract({
        address: contract,
        functionName: "settle_case",
        args: [caseId],
        value: 0n
      }) as TransactionHash;
      const result = await finalizeHash(hash, `Settlement finalized for ${caseId}.`, { hash });
      const sessionToken = await createPlatformSession(signChallenge, address);
      await recordActivity(sessionToken, {
        case_id: caseId,
        span_id: null,
        actor: address,
        action: "settle_case",
        status: "FINALIZED",
        tx_hash: hash,
        summary: `Settled case ${caseId}`
      });
      return result;
    });
  }, [address, finalizeHash, runWrite, signChallenge]);

  const withdrawClaimable = useCallback(async () => {
    if (!address) throw new Error("Connect a Studionet wallet before withdrawing");
    return runWrite("Withdraw claimable balance", async (client, contract) => {
      const hash = await client.writeContract({
        address: contract,
        functionName: "withdraw",
        args: [],
        value: 0n
      }) as TransactionHash;
      const result = await finalizeHash(hash, "Withdraw finalized on Studionet.", { hash });
      const sessionToken = await createPlatformSession(signChallenge, address);
      await recordActivity(sessionToken, {
        case_id: "global",
        span_id: null,
        actor: address,
        action: "withdraw",
        status: "FINALIZED",
        tx_hash: hash,
        summary: "Withdrew claimable Studionet balance"
      });
      return result;
    });
  }, [address, finalizeHash, runWrite, signChallenge]);

  const value = useMemo(() => ({
    address,
    mode,
    hasInjectedWallet,
    connecting,
    walletError,
    tx,
    connect,
    connectGenerated,
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
  }), [address, mode, hasInjectedWallet, connecting, walletError, tx, connect, connectGenerated, disconnect, createCase, submitEvidence, registerSpan, acceptSpan, submitDelivery, openDispute, submitEvidenceToContract, lockEvidence, adjudicateCase, settleCase, withdrawClaimable]);
  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useFaultspanWallet() {
  const value = useContext(WalletContext);
  if (!value) throw new Error("useFaultspanWallet must be used inside WalletProvider");
  return value;
}
