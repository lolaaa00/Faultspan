"use client";

import { createAccount, generatePrivateKey } from "genlayer-js";

const STORAGE_KEY = "faultspan.generatedWallet.privateKey";
const ACK_KEY = "faultspan.generatedWallet.acknowledged";

export type GeneratedAccount = ReturnType<typeof createAccount>;

function isPrivateKey(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{64}$/.test(value);
}

export function loadStoredPrivateKey(): `0x${string}` | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored && isPrivateKey(stored) ? stored : null;
}

export function hasAcknowledgedRisk(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(ACK_KEY) === "1";
}

export function acknowledgeRisk() {
  window.localStorage.setItem(ACK_KEY, "1");
}

/** Creates and persists a brand-new generated wallet. Never overwrites an existing one. */
export function createAndStoreGeneratedWallet(): GeneratedAccount {
  const existing = loadStoredPrivateKey();
  if (existing) return createAccount(existing);
  const privateKey = generatePrivateKey();
  window.localStorage.setItem(STORAGE_KEY, privateKey);
  return createAccount(privateKey);
}

export function loadGeneratedWallet(): GeneratedAccount | null {
  const key = loadStoredPrivateKey();
  return key ? createAccount(key) : null;
}

/** Replaces the stored key with an imported one. Caller must confirm intent first. */
export function importGeneratedWallet(privateKey: string): GeneratedAccount {
  const trimmed = privateKey.trim();
  if (!isPrivateKey(trimmed)) throw new Error("Private key must be a 0x-prefixed 64-character hex string");
  window.localStorage.setItem(STORAGE_KEY, trimmed);
  return createAccount(trimmed as `0x${string}`);
}

export function exportGeneratedPrivateKey(): `0x${string}` | null {
  return loadStoredPrivateKey();
}

export function clearGeneratedWallet() {
  window.localStorage.removeItem(STORAGE_KEY);
}
