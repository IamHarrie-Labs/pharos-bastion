import { ethers } from "ethers";
import { getProvider, getSigner, config, explorerTx } from "./config.js";
import { GUARDIAN_REGISTRY_ABI } from "./abi.js";
import { simulate, SimulationResult, TxRequest } from "./simulate.js";
import { assessRisk, RiskFactor } from "./risk.js";
import { checkPolicy, recordSpend, PolicyCheckResult } from "./policy.js";
import { fetchExternalRisk, ExternalRiskSignal } from "./goplus.js";

export type Verdict = "ALLOW" | "WARN" | "DENY";
const VERDICT_CODE: Record<Verdict, number> = { ALLOW: 0, WARN: 1, DENY: 2 };
const VERDICT_FROM_CODE: Verdict[] = ["ALLOW", "WARN", "DENY"];

export interface GuardDecision {
  decision: Verdict;
  confidence: number;
  riskScore: number;
  reason: string;
  policy: string;
  factors: RiskFactor[];
  simulation: SimulationResult;
  policyCheck: PolicyCheckResult;
  external?: ExternalRiskSignal;
  recommended_fix?: string;
  intentHash: string;
  decisionId?: number;
  loggedTx?: string;
  loggedTxUrl?: string;
}

const FIX_BY_CODE: Record<string, string> = {
  NO_POLICY: "No policy is set for this account. Configure one with set_policy before transacting.",
  TARGET_DENYLISTED: "This target is on your denylist. Remove it from the denylist only if you trust it.",
  TARGET_NOT_ALLOWLISTED: "Allowlist mode is on. Add this target to your allowlist if you trust it.",
  MAX_VALUE_PER_TX: "Lower the transaction value below your per-tx cap, or raise the cap via set_policy.",
  DAILY_LIMIT_EXCEEDED: "Reduce the amount or wait for the rolling 24h window to reset.",
  ERC20_UNLIMITED_APPROVAL: "Approve an exact amount instead of unlimited (type(uint256).max).",
  ERC20_APPROVAL_LIMIT: "Approve no more than your configured max approval amount.",
  UNLIMITED_APPROVAL: "Approve an exact amount instead of unlimited (type(uint256).max).",
  WOULD_REVERT: "The call reverts in simulation and would fail on-chain. Fix the call before sending.",
  NO_CODE_AT_TARGET: "Double-check the target address — it has no contract code.",
};

export function intentHashOf(tx: TxRequest): string {
  const canonical = JSON.stringify({
    from: tx.from.toLowerCase(),
    to: tx.to.toLowerCase(),
    value: tx.value ?? "0",
    data: (tx.data ?? "0x").toLowerCase(),
  });
  return ethers.keccak256(ethers.toUtf8Bytes(canonical));
}

function toBytes32Code(code: string): string {
  // codes are short ASCII; truncate defensively to 31 bytes.
  return ethers.encodeBytes32String(code.slice(0, 31));
}

/// The Bastion pipeline: simulate -> risk -> policy -> decide -> explain.
/// Pure analysis; never signs. Optionally records the decision on-chain.
export async function guard(tx: TxRequest, opts: { logOnChain?: boolean } = {}): Promise<GuardDecision> {
  const sim = await simulate(tx);

  // External enrichment only meaningful for token-touching actions.
  let external: ExternalRiskSignal | undefined;
  if (sim.decoded.token) {
    external = await fetchExternalRisk(sim.decoded.token);
  }

  const risk = assessRisk(sim, external);

  // Policy is evaluated against the contract/recipient actually being called.
  const policyCheck = await checkPolicy(
    tx.from,
    tx.to,
    sim.nativeValueWei,
    sim.selector,
    sim.approvalAmount
  );

  // Decision: on-chain policy is a hard gate; risk score is a soft gate.
  let decision: Verdict;
  let reason: string;
  let policyCode: string;

  if (!policyCheck.allowed) {
    decision = "DENY";
    reason = `Blocked by policy: ${policyCheck.reason}.`;
    policyCode = policyCheck.reason;
  } else if (risk.score >= 70) {
    decision = "DENY";
    const top = risk.factors[0];
    reason = top ? top.detail : "High composite risk score.";
    policyCode = top?.code ?? "HIGH_RISK";
  } else if (risk.score >= 40) {
    decision = "WARN";
    const top = risk.factors[0];
    reason = top ? top.detail : "Elevated risk — review before signing.";
    policyCode = top?.code ?? "ELEVATED_RISK";
  } else {
    decision = "ALLOW";
    reason = "Passed simulation, risk, and policy checks.";
    policyCode = "OK";
  }

  const deterministic = !policyCheck.allowed || sim.willRevert;
  const confidence = deterministic ? 0.99 : decision === "ALLOW" ? 0.95 : 0.75;

  const result: GuardDecision = {
    decision,
    confidence,
    riskScore: risk.score,
    reason,
    policy: policyCode,
    factors: risk.factors,
    simulation: sim,
    policyCheck,
    external,
    recommended_fix: FIX_BY_CODE[policyCode],
    intentHash: intentHashOf(tx),
  };

  if (opts.logOnChain) {
    const logged = await logDecision(tx, result);
    result.decisionId = logged.decisionId;
    result.loggedTx = logged.txHash;
    result.loggedTxUrl = explorerTx(logged.txHash);
  }

  return result;
}

function registryContract(withSigner: boolean): ethers.Contract {
  if (!config.registryAddress) {
    throw new Error("BASTION_REGISTRY_ADDRESS not configured.");
  }
  if (withSigner) {
    const signer = getSigner();
    if (!signer) throw new Error("No signer: set PHAROS_PRIVATE_KEY to log decisions on-chain.");
    return new ethers.Contract(config.registryAddress, GUARDIAN_REGISTRY_ABI, signer);
  }
  return new ethers.Contract(config.registryAddress, GUARDIAN_REGISTRY_ABI, getProvider());
}

export async function logDecision(
  tx: TxRequest,
  d: GuardDecision
): Promise<{ decisionId: number; txHash: string }> {
  const c = registryContract(true);
  const resp = await c.logDecision(
    tx.from,
    tx.to,
    d.simulation.nativeValueWei,
    VERDICT_CODE[d.decision],
    d.riskScore,
    toBytes32Code(d.policy),
    d.intentHash
  );
  const receipt = await resp.wait();
  // Pull the decisionId out of the DecisionLogged event.
  let decisionId = -1;
  for (const log of receipt.logs) {
    try {
      const parsed = c.interface.parseLog(log);
      if (parsed?.name === "DecisionLogged") {
        decisionId = Number(parsed.args.decisionId);
        break;
      }
    } catch {
      /* not our event */
    }
  }
  return { decisionId, txHash: receipt.hash };
}

export interface ExplainResult {
  decisionId: number;
  account: string;
  target: string;
  valueWei: string;
  verdict: Verdict;
  riskScore: number;
  policyCode: string;
  intentHash: string;
  timestamp: number;
  explanation: string;
}

/// Reconstruct a past decision from the on-chain audit log — machine-verifiable
/// reasoning any agent or auditor can query.
export async function explain(decisionId: number): Promise<ExplainResult> {
  const c = registryContract(false);
  const d = await c.getDecision(decisionId);
  const verdict = VERDICT_FROM_CODE[Number(d.verdict)] ?? "DENY";
  let policyCode = "";
  try {
    policyCode = ethers.decodeBytes32String(d.policyCode);
  } catch {
    policyCode = d.policyCode;
  }
  const ts = Number(d.timestamp);
  const explanation =
    `Decision #${decisionId}: Bastion returned ${verdict} for account ${d.account} ` +
    `acting on ${d.target} (value ${ethers.formatEther(d.value)} native). ` +
    `Risk score ${Number(d.riskScore)}/100. Deciding rule: ${policyCode}. ` +
    (FIX_BY_CODE[policyCode] ? `Recommended fix: ${FIX_BY_CODE[policyCode]} ` : "") +
    `Recorded on-chain at unix ${ts}.`;

  return {
    decisionId,
    account: d.account,
    target: d.target,
    valueWei: d.value.toString(),
    verdict,
    riskScore: Number(d.riskScore),
    policyCode,
    intentHash: d.intentHash,
    timestamp: ts,
    explanation,
  };
}

export async function getAuditLog(limit = 10): Promise<ExplainResult[]> {
  const c = registryContract(false);
  const total = Number(await c.totalDecisions());
  const out: ExplainResult[] = [];
  for (let id = total - 1; id >= 0 && out.length < limit; id--) {
    out.push(await explain(id));
  }
  return out;
}

/// Guard, and only if ALLOW, sign and broadcast. The one call an agent makes to
/// act safely: nothing is signed unless Bastion approves it.
export async function execute(tx: TxRequest): Promise<{
  decision: GuardDecision;
  executed: boolean;
  txHash?: string;
  txUrl?: string;
  message: string;
}> {
  const decision = await guard(tx, { logOnChain: true });

  if (decision.decision === "DENY") {
    return {
      decision,
      executed: false,
      message: `Execution blocked (${decision.policy}). Nothing was signed. ${decision.recommended_fix ?? ""}`.trim(),
    };
  }

  const signer = getSigner();
  if (!signer) {
    return { decision, executed: false, message: "No signer configured (set PHAROS_PRIVATE_KEY)." };
  }

  const sent = await signer.sendTransaction({
    to: tx.to,
    value: BigInt(tx.value ?? "0"),
    data: tx.data ?? "0x",
  });
  const receipt = await sent.wait();

  // Accrue native spend so daily limits track across executed txs.
  const value = BigInt(tx.value ?? "0");
  if (value > 0n) {
    try {
      await recordSpend(value.toString());
    } catch {
      /* best-effort accounting */
    }
  }

  return {
    decision,
    executed: true,
    txHash: receipt?.hash,
    txUrl: receipt?.hash ? explorerTx(receipt.hash) : undefined,
    message: `${decision.decision}: executed and recorded on-chain (decision #${decision.decisionId}).`,
  };
}
