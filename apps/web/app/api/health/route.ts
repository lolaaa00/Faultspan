import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "faultspan-web",
    network: "studionet",
    chainId: Number(process.env.NEXT_PUBLIC_GENLAYER_CHAIN_ID ?? 61999),
    contractConfigured: Boolean(process.env.NEXT_PUBLIC_FAULTSPAN_CONTRACT_ADDRESS)
  });
}

