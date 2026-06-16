import { ethers } from "ethers";
import { getProvider } from "./config.js";
import { ERC20_ABI, SELECTORS, UNLIMITED } from "./abi.js";

export interface TxRequest {
  from: string;
  to: string;
  value?: string; // decimal wei string, default "0"
  data?: string; // hex calldata, default "0x"
}

export interface DecodedAction {
  kind: "native_transfer" | "erc20_approve" | "erc20_transfer" | "erc20_transferFrom" | "contract_call" | "unknown";
  selector: string;
  summary: string;
  // ERC-20 specifics when applicable
  token?: string;
  tokenSymbol?: string;
  spender?: string;
  recipient?: string;
  amount?: string; // raw
  amountFormatted?: string; // human, when decimals known
  isUnlimitedApproval?: boolean;
}

export interface SimulationResult {
  willRevert: boolean;
  revertReason?: string;
  nativeValueWei: string;
  nativeValueEth: string;
  targetHasCode: boolean;
  decoded: DecodedAction;
  // The 4-byte selector and (if approve) approval amount, surfaced for policy.check.
  selector: string;
  approvalAmount: string;
}

const erc20 = new ethers.Interface(ERC20_ABI);

function selectorOf(data: string): string {
  if (!data || data === "0x" || data.length < 10) return "0x";
  return data.slice(0, 10).toLowerCase();
}

async function tryTokenMeta(token: string): Promise<{ symbol?: string; decimals?: number }> {
  try {
    const provider = getProvider();
    const c = new ethers.Contract(token, ERC20_ABI, provider);
    const [symbol, decimals] = await Promise.all([
      c.symbol().catch(() => undefined),
      c.decimals().catch(() => undefined),
    ]);
    return { symbol, decimals: decimals !== undefined ? Number(decimals) : undefined };
  } catch {
    return {};
  }
}

function decodeAction(to: string, data: string): { action: DecodedAction; approvalAmount: bigint } {
  const sel = selectorOf(data);

  if (sel === "0x") {
    return {
      action: {
        kind: "native_transfer",
        selector: sel,
        summary: `Plain transfer to ${to} (no calldata).`,
        recipient: to,
      },
      approvalAmount: 0n,
    };
  }

  try {
    if (sel === SELECTORS.approve) {
      const [spender, amount] = erc20.decodeFunctionData("approve", data);
      const isUnlimited = BigInt(amount) === UNLIMITED;
      return {
        action: {
          kind: "erc20_approve",
          selector: sel,
          token: to,
          spender,
          amount: amount.toString(),
          isUnlimitedApproval: isUnlimited,
          summary: isUnlimited
            ? `UNLIMITED ERC-20 approval of token ${to} to spender ${spender}.`
            : `Approve ${amount.toString()} of token ${to} to spender ${spender}.`,
        },
        approvalAmount: BigInt(amount),
      };
    }
    if (sel === SELECTORS.transfer) {
      const [recipient, amount] = erc20.decodeFunctionData("transfer", data);
      return {
        action: {
          kind: "erc20_transfer",
          selector: sel,
          token: to,
          recipient,
          amount: amount.toString(),
          summary: `Transfer ${amount.toString()} of token ${to} to ${recipient}.`,
        },
        approvalAmount: 0n,
      };
    }
    if (sel === SELECTORS.transferFrom) {
      const [fromA, recipient, amount] = erc20.decodeFunctionData("transferFrom", data);
      return {
        action: {
          kind: "erc20_transferFrom",
          selector: sel,
          token: to,
          recipient,
          amount: amount.toString(),
          summary: `transferFrom ${amount.toString()} of token ${to}: ${fromA} -> ${recipient}.`,
        },
        approvalAmount: 0n,
      };
    }
  } catch {
    // fall through to generic contract call
  }

  return {
    action: {
      kind: "contract_call",
      selector: sel,
      summary: `Contract call ${sel} to ${to}.`,
    },
    approvalAmount: 0n,
  };
}

/// Deterministically simulate a pending transaction: decode its declared effects
/// and statically execute it (eth_call) to detect reverts — without signing.
export async function simulate(tx: TxRequest): Promise<SimulationResult> {
  const provider = getProvider();
  const to = ethers.getAddress(tx.to);
  const from = ethers.getAddress(tx.from);
  const data = tx.data && tx.data !== "" ? tx.data : "0x";
  const value = BigInt(tx.value ?? "0");

  const { action, approvalAmount } = decodeAction(to, data);

  // Enrich ERC-20 actions with token metadata for readable amounts.
  if (action.token && action.amount) {
    const meta = await tryTokenMeta(action.token);
    if (meta.symbol) action.tokenSymbol = meta.symbol;
    if (meta.decimals !== undefined && !action.isUnlimitedApproval) {
      action.amountFormatted = `${ethers.formatUnits(action.amount, meta.decimals)} ${meta.symbol ?? ""}`.trim();
    }
  }

  const code = await provider.getCode(to);
  const targetHasCode = code !== "0x";

  // Static execution to catch reverts. Plain native transfers to EOAs always pass.
  let willRevert = false;
  let revertReason: string | undefined;
  if (data !== "0x") {
    try {
      await provider.call({ from, to, data, value });
    } catch (err: any) {
      willRevert = true;
      revertReason = err?.shortMessage ?? err?.reason ?? err?.message ?? "execution reverted";
    }
  }

  return {
    willRevert,
    revertReason,
    nativeValueWei: value.toString(),
    nativeValueEth: ethers.formatEther(value),
    targetHasCode,
    decoded: action,
    selector: action.selector === "0x" ? "0x00000000" : action.selector,
    approvalAmount: approvalAmount.toString(),
  };
}
