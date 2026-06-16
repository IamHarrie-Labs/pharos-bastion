#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ethers } from "ethers";

import { config, explorerAddress } from "./config.js";
import { simulate } from "./simulate.js";
import { assessRisk } from "./risk.js";
import { fetchExternalRisk } from "./goplus.js";
import { guard, execute, explain, getAuditLog } from "./runtime.js";
import {
  getPolicy,
  checkPolicy,
  setPolicy,
  setTargetAllowed,
  setTargetDenied,
} from "./policy.js";

const server = new McpServer({
  name: "pharos-bastion",
  version: "0.1.0",
});

const txShape = {
  from: z.string().describe("Agent account that would sign the tx (0x address)."),
  to: z.string().describe("Target contract or recipient (0x address)."),
  value: z.string().optional().describe("Native value in wei as a decimal string. Default '0'."),
  data: z.string().optional().describe("Hex calldata. Default '0x'."),
};

function ok(obj: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(obj, null, 2) }] };
}
function fail(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: "text" as const, text: `Error: ${message}` }] };
}

// ── guard: THE primitive. simulate → risk → policy → explainable verdict ──────
server.registerTool(
  "guard",
  {
    title: "Guard a transaction",
    description:
      "Pharos Bastion's core primitive. Runs the full pipeline (simulate → risk-score → on-chain policy check → decide) on a pending transaction and returns an explainable ALLOW/WARN/DENY verdict with reasons, a risk score, the simulated effects, and a recommended fix. Nothing is signed. Set logOnChain=true to record the decision in the on-chain audit log.",
    inputSchema: {
      ...txShape,
      logOnChain: z.boolean().optional().describe("Record this decision in the on-chain audit log."),
    },
  },
  async ({ from, to, value, data, logOnChain }) => {
    try {
      const d = await guard({ from, to, value, data }, { logOnChain: !!logOnChain });
      return ok(d);
    } catch (e) {
      return fail(e);
    }
  }
);

// ── simulate_transaction ──────────────────────────────────────────────────────
server.registerTool(
  "simulate_transaction",
  {
    title: "Simulate a transaction",
    description:
      "Deterministically decode what a transaction will do and statically execute it (eth_call) to detect reverts — without signing. Surfaces native value, decoded ERC-20 intent, unlimited-approval flags, and whether the target has contract code.",
    inputSchema: txShape,
  },
  async ({ from, to, value, data }) => {
    try {
      return ok(await simulate({ from, to, value, data }));
    } catch (e) {
      return fail(e);
    }
  }
);

// ── assess_risk ───────────────────────────────────────────────────────────────
server.registerTool(
  "assess_risk",
  {
    title: "Assess transaction risk",
    description:
      "Return a 0–100 composite risk score with named, attributable factors (would-revert, unlimited approval, no-code target, external feed flags). Pulls optional GoPlus enrichment when enabled.",
    inputSchema: txShape,
  },
  async ({ from, to, value, data }) => {
    try {
      const sim = await simulate({ from, to, value, data });
      const external = sim.decoded.token ? await fetchExternalRisk(sim.decoded.token) : undefined;
      return ok({ ...assessRisk(sim, external), external });
    } catch (e) {
      return fail(e);
    }
  }
);

// ── check_policy ──────────────────────────────────────────────────────────────
server.registerTool(
  "check_policy",
  {
    title: "Check against on-chain policy",
    description:
      "Evaluate a transaction against the account's on-chain GuardianPolicy (spend caps, daily limits, allow/denylist, approval rules). Returns allowed + the deciding on-chain reason code.",
    inputSchema: txShape,
  },
  async ({ from, to, value, data }) => {
    try {
      const sim = await simulate({ from, to, value, data });
      const res = await checkPolicy(from, to, sim.nativeValueWei, sim.selector, sim.approvalAmount);
      return ok(res);
    } catch (e) {
      return fail(e);
    }
  }
);

// ── get_policy ────────────────────────────────────────────────────────────────
server.registerTool(
  "get_policy",
  {
    title: "Get an account's policy",
    description: "Read the on-chain GuardianPolicy configured for an account.",
    inputSchema: { account: z.string().describe("0x account address.") },
  },
  async ({ account }) => {
    try {
      return ok(await getPolicy(account));
    } catch (e) {
      return fail(e);
    }
  }
);

// ── set_policy (write) ────────────────────────────────────────────────────────
server.registerTool(
  "set_policy",
  {
    title: "Set the signer's policy",
    description:
      "Configure the on-chain spending policy for the configured signer account. Requires PHAROS_PRIVATE_KEY. Amounts are wei decimal strings; use '0' for 'no native transfers' (maxValuePerTx) or 'unlimited' (dailyLimit/maxApprovalAmount).",
    inputSchema: {
      maxValuePerTx: z.string().describe("Max native value per tx (wei)."),
      dailyLimit: z.string().describe("Max cumulative native value per rolling 24h (wei). '0' = unlimited."),
      allowUnlimitedApprovals: z.boolean().describe("Permit unlimited ERC-20 approvals."),
      maxApprovalAmount: z.string().describe("Cap on bounded approvals (raw). '0' = no cap."),
      allowlistEnabled: z.boolean().describe("If true, only allowlisted targets may be called."),
    },
  },
  async (args) => {
    try {
      const hash = await setPolicy(args);
      return ok({ status: "policy set", txHash: hash });
    } catch (e) {
      return fail(e);
    }
  }
);

// ── set_target (write) ────────────────────────────────────────────────────────
server.registerTool(
  "set_target",
  {
    title: "Allowlist or denylist a target",
    description:
      "Add a target to the signer's allowlist or denylist. Requires PHAROS_PRIVATE_KEY.",
    inputSchema: {
      target: z.string().describe("0x target address."),
      list: z.enum(["allow", "deny"]).describe("Which list to set."),
      enabled: z.boolean().describe("True to add to the list, false to remove."),
    },
  },
  async ({ target, list, enabled }) => {
    try {
      const hash = list === "allow" ? await setTargetAllowed(target, enabled) : await setTargetDenied(target, enabled);
      return ok({ status: `${list}list updated`, target, enabled, txHash: hash });
    } catch (e) {
      return fail(e);
    }
  }
);

// ── execute (write) ───────────────────────────────────────────────────────────
server.registerTool(
  "execute",
  {
    title: "Guard then execute",
    description:
      "The safe-action call: guard the transaction, log the decision on-chain, and ONLY broadcast it if the verdict is not DENY. Requires PHAROS_PRIVATE_KEY. Returns the decision and, if executed, the tx hash.",
    inputSchema: txShape,
  },
  async ({ from, to, value, data }) => {
    try {
      return ok(await execute({ from, to, value, data }));
    } catch (e) {
      return fail(e);
    }
  }
);

// ── explain ───────────────────────────────────────────────────────────────────
server.registerTool(
  "explain",
  {
    title: "Explain a past decision",
    description:
      "Reconstruct a past Bastion decision from the on-chain audit log — machine-verifiable reasoning any agent or auditor can query. Answers 'why did you (not) act?'.",
    inputSchema: { decisionId: z.number().int().nonnegative().describe("The decision id returned by guard/execute.") },
  },
  async ({ decisionId }) => {
    try {
      return ok(await explain(decisionId));
    } catch (e) {
      return fail(e);
    }
  }
);

// ── get_audit_log ─────────────────────────────────────────────────────────────
server.registerTool(
  "get_audit_log",
  {
    title: "Read the audit log",
    description: "Return the most recent Bastion decisions recorded on-chain.",
    inputSchema: { limit: z.number().int().positive().max(50).optional().describe("Max entries (default 10).") },
  },
  async ({ limit }) => {
    try {
      return ok(await getAuditLog(limit ?? 10));
    } catch (e) {
      return fail(e);
    }
  }
);

// ── bastion_info ──────────────────────────────────────────────────────────────
server.registerTool(
  "bastion_info",
  {
    title: "Bastion configuration",
    description: "Report the Pharos network, deployed contract addresses, and signer status Bastion is using.",
    inputSchema: {},
  },
  async () => {
    const signer = config.privateKey ? new ethers.Wallet(config.privateKey).address : undefined;
    return ok({
      network: "Pharos Atlantic",
      chainId: config.chainId,
      rpcUrl: config.rpcUrl,
      explorer: config.explorerUrl,
      policyContract: config.policyAddress ? explorerAddress(config.policyAddress) : "NOT DEPLOYED",
      registryContract: config.registryAddress ? explorerAddress(config.registryAddress) : "NOT DEPLOYED",
      signer: signer ?? "read-only (no PHAROS_PRIVATE_KEY)",
      goplusEnrichment: config.goplusEnabled ? "enabled" : "disabled",
    });
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Pharos Bastion MCP server running on stdio.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
