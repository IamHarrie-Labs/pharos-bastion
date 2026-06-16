import { config } from "./config.js";

/// Pluggable external risk feed. GoPlus is a hackathon sponsor whose API scores
/// token/contract risk. Bastion treats it as an *enrichment adapter*: when it
/// has data for the chain/target it sharpens the score; when it doesn't (e.g. a
/// fresh testnet it doesn't index yet), Bastion degrades gracefully to its own
/// deterministic simulation + policy checks. Never a hard dependency.
export interface ExternalRiskSignal {
  source: string;
  available: boolean;
  malicious?: boolean;
  flags: string[];
  note?: string;
}

const GOPLUS_BASE = "https://api.goplus.io/api/v1";

export async function fetchExternalRisk(token: string): Promise<ExternalRiskSignal> {
  if (!config.goplusEnabled) {
    return { source: "goplus", available: false, flags: [], note: "disabled (set BASTION_GOPLUS_ENABLED=true)" };
  }
  try {
    const url = `${GOPLUS_BASE}/token_security/${config.chainId}?contract_addresses=${token}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) {
      return { source: "goplus", available: false, flags: [], note: `http ${res.status}` };
    }
    const body: any = await res.json();
    const entry = body?.result?.[token.toLowerCase()];
    if (!entry) {
      return { source: "goplus", available: false, flags: [], note: "no coverage for this chain/target" };
    }
    const flags: string[] = [];
    if (entry.is_honeypot === "1") flags.push("HONEYPOT");
    if (entry.is_blacklisted === "1") flags.push("BLACKLISTED");
    if (entry.is_proxy === "1") flags.push("PROXY");
    if (entry.cannot_sell_all === "1") flags.push("CANNOT_SELL_ALL");
    if (entry.is_open_source === "0") flags.push("CLOSED_SOURCE");
    return {
      source: "goplus",
      available: true,
      malicious: flags.includes("HONEYPOT") || flags.includes("BLACKLISTED"),
      flags,
    };
  } catch (err: any) {
    return { source: "goplus", available: false, flags: [], note: err?.message ?? "request failed" };
  }
}
