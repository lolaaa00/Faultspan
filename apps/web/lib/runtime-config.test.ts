import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { STUDIONET_CHAIN_ID, STUDIONET_RPC } from "./genlayer";

function localEnvValue(name: string) {
  const env = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  return env.split(/\r?\n/).find((line) => line.startsWith(`${name}=`))?.slice(name.length + 1);
}

describe("real Studionet runtime config", () => {
  it("uses the locked Studionet network", () => {
    expect(STUDIONET_RPC).toBe("https://studio.genlayer.com/api");
    expect(STUDIONET_CHAIN_ID).toBe(61999);
  });

  it("has a configured Faultspan contract address in local frontend env", () => {
    expect(localEnvValue("NEXT_PUBLIC_FAULTSPAN_CONTRACT_ADDRESS")).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });
});
