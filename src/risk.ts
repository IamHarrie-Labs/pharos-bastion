import { SimulationResult } from "./simulate.js";
import { ExternalRiskSignal } from "./goplus.js";

export interface RiskFactor {
  code: string;
  weight: number; // contribution to the 0..100 score
  detail: string;
}

export interface RiskAssessment {
  score: number; // 0..100 composite
  factors: RiskFactor[];
}

/// Deterministic, explainable risk scoring. Every point added to the score is
/// attributable to a named factor, so `explain()` can reconstruct exactly why a
/// transaction looked risky. External feeds (GoPlus) are additive, not required.
export function assessRisk(sim: SimulationResult, external?: ExternalRiskSignal): RiskAssessment {
  const factors: RiskFactor[] = [];

  if (sim.willRevert) {
    factors.push({
      code: "WOULD_REVERT",
      weight: 45,
      detail: `Simulation reverted: ${sim.revertReason ?? "unknown"}. The tx would fail and waste gas.`,
    });
  }

  if (sim.decoded.kind === "erc20_approve" && sim.decoded.isUnlimitedApproval) {
    factors.push({
      code: "UNLIMITED_APPROVAL",
      weight: 50,
      detail: `Unlimited token approval to ${sim.decoded.spender}. A compromised spender could drain the entire balance.`,
    });
  }

  // Calldata sent to an address with no contract code => almost always a mistake
  // or a spoofed target.
  if (sim.selector !== "0x00000000" && !sim.targetHasCode) {
    factors.push({
      code: "NO_CODE_AT_TARGET",
      weight: 35,
      detail: "Calldata is being sent to an address that has no contract code.",
    });
  }

  if (external?.available && external.flags.length > 0) {
    const weight = external.malicious ? 60 : 20;
    factors.push({
      code: `EXTERNAL_${external.source.toUpperCase()}`,
      weight,
      detail: `${external.source} flagged: ${external.flags.join(", ")}.`,
    });
  }

  const score = Math.min(
    100,
    factors.reduce((s, f) => s + f.weight, 0)
  );

  return { score, factors };
}
