import { ethers } from "ethers";
import { getProvider, getSigner, config } from "./config.js";
import { GUARDIAN_POLICY_ABI } from "./abi.js";

export interface PolicyView {
  exists: boolean;
  maxValuePerTx: string;
  dailyLimit: string;
  allowUnlimitedApprovals: boolean;
  maxApprovalAmount: string;
  allowlistEnabled: boolean;
}

export interface PolicyCheckResult {
  allowed: boolean;
  reason: string; // on-chain reason code, e.g. DAILY_LIMIT_EXCEEDED
}

function requirePolicyAddress(): string {
  if (!config.policyAddress) {
    throw new Error("BASTION_POLICY_ADDRESS not configured. Deploy contracts and set it in .env.");
  }
  return config.policyAddress;
}

export function policyContract(withSigner = false): ethers.Contract {
  const addr = requirePolicyAddress();
  if (withSigner) {
    const signer = getSigner();
    if (!signer) throw new Error("No signer: set PHAROS_PRIVATE_KEY to mutate policy.");
    return new ethers.Contract(addr, GUARDIAN_POLICY_ABI, signer);
  }
  return new ethers.Contract(addr, GUARDIAN_POLICY_ABI, getProvider());
}

export async function getPolicy(account: string): Promise<PolicyView> {
  const c = policyContract(false);
  const p = await c.getPolicy(account);
  return {
    exists: p.exists,
    maxValuePerTx: p.maxValuePerTx.toString(),
    dailyLimit: p.dailyLimit.toString(),
    allowUnlimitedApprovals: p.allowUnlimitedApprovals,
    maxApprovalAmount: p.maxApprovalAmount.toString(),
    allowlistEnabled: p.allowlistEnabled,
  };
}

export async function checkPolicy(
  account: string,
  target: string,
  valueWei: string,
  selector: string,
  approvalAmount: string
): Promise<PolicyCheckResult> {
  const c = policyContract(false);
  const [allowed, reason] = await c.check(account, target, valueWei, selector, approvalAmount);
  return { allowed, reason };
}

export interface SetPolicyParams {
  maxValuePerTx: string;
  dailyLimit: string;
  allowUnlimitedApprovals: boolean;
  maxApprovalAmount: string;
  allowlistEnabled: boolean;
}

export async function setPolicy(params: SetPolicyParams): Promise<string> {
  const c = policyContract(true);
  const tx = await c.setPolicy(
    params.maxValuePerTx,
    params.dailyLimit,
    params.allowUnlimitedApprovals,
    params.maxApprovalAmount,
    params.allowlistEnabled
  );
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function setTargetAllowed(target: string, allowed: boolean): Promise<string> {
  const c = policyContract(true);
  const tx = await c.setTargetAllowed(target, allowed);
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function setTargetDenied(target: string, denied: boolean): Promise<string> {
  const c = policyContract(true);
  const tx = await c.setTargetDenied(target, denied);
  const receipt = await tx.wait();
  return receipt.hash;
}

export async function recordSpend(valueWei: string): Promise<string> {
  const c = policyContract(true);
  const tx = await c.recordSpend(valueWei);
  const receipt = await tx.wait();
  return receipt.hash;
}
