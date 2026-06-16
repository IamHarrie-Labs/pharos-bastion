import * as dotenv from "dotenv";
import { ethers } from "ethers";

dotenv.config();

export interface BastionConfig {
  rpcUrl: string;
  chainId: number;
  explorerUrl: string;
  privateKey?: string;
  policyAddress?: string;
  registryAddress?: string;
  goplusEnabled: boolean;
}

export const config: BastionConfig = {
  rpcUrl: process.env.PHAROS_RPC_URL ?? "https://atlantic.dplabs-internal.com",
  chainId: Number(process.env.PHAROS_CHAIN_ID ?? 688689),
  explorerUrl: process.env.PHAROS_EXPLORER_URL ?? "https://atlantic.pharosscan.xyz",
  privateKey: process.env.PHAROS_PRIVATE_KEY || undefined,
  policyAddress: process.env.BASTION_POLICY_ADDRESS || undefined,
  registryAddress: process.env.BASTION_REGISTRY_ADDRESS || undefined,
  // GoPlus is an optional, pluggable risk feed. Off by default so Bastion is
  // fully functional (simulation + policy + audit) with zero external deps.
  goplusEnabled: (process.env.BASTION_GOPLUS_ENABLED ?? "false").toLowerCase() === "true",
};

let _provider: ethers.JsonRpcProvider | undefined;
export function getProvider(): ethers.JsonRpcProvider {
  if (!_provider) {
    // Auto-detect the chain id from the RPC so we work with whichever Pharos
    // testnet the configured endpoint serves (688688 or Atlantic 688689).
    _provider = new ethers.JsonRpcProvider(config.rpcUrl);
  }
  return _provider;
}

/// Returns a signer if a private key is configured, else undefined.
/// Read-only tools (simulate, assess_risk, check_policy, explain) never need one;
/// only `execute` and policy-mutating tools require a signer.
export function getSigner(): ethers.Wallet | undefined {
  if (!config.privateKey) return undefined;
  return new ethers.Wallet(config.privateKey, getProvider());
}

export function explorerTx(hash: string): string {
  return `${config.explorerUrl}/tx/${hash}`;
}

export function explorerAddress(addr: string): string {
  return `${config.explorerUrl}/address/${addr}`;
}
