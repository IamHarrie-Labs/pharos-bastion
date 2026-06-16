/**
 * Pharos Bastion — end-to-end demo.
 *
 * Runs three transactions through guard() against the live Atlantic testnet
 * contracts and reads back the on-chain audit trail:
 *   A) a small native transfer            -> ALLOW
 *   B) an UNLIMITED ERC-20 approval        -> DENY (ERC20_UNLIMITED_APPROVAL)
 *   C) a transfer over the daily cap       -> DENY (DAILY_LIMIT_EXCEEDED)
 *
 * Requires a deployed Policy + Registry and a funded PHAROS_PRIVATE_KEY in .env.
 */
import { ethers } from "ethers";
import { config, getSigner } from "../src/config.js";
import { ERC20_ABI, UNLIMITED } from "../src/abi.js";
import { setPolicy } from "../src/policy.js";
import { guard, getAuditLog } from "../src/runtime.js";

function banner(t: string) {
  console.log("\n" + "─".repeat(64) + `\n  ${t}\n` + "─".repeat(64));
}

async function main() {
  const signer = getSigner();
  if (!signer || !config.policyAddress || !config.registryAddress) {
    console.error(
      "Demo needs a deployed Policy + Registry and PHAROS_PRIVATE_KEY.\n" +
        "Run: npm run deploy, copy the addresses into .env, fund the key, then npm run demo."
    );
    process.exit(1);
  }
  const me = signer.address;
  console.log(`Signer / agent account: ${me}`);

  banner("1. Configure on-chain policy");
  // per-tx 0.5, daily 0.01, no unlimited approvals, no approval cap, no allowlist
  const hash = await setPolicy({
    maxValuePerTx: ethers.parseEther("0.5").toString(),
    dailyLimit: ethers.parseEther("0.01").toString(),
    allowUnlimitedApprovals: false,
    maxApprovalAmount: "0",
    allowlistEnabled: false,
  });
  console.log(`Policy set (tx ${hash}): maxPerTx=0.5, daily=0.01, no unlimited approvals`);

  banner("2A. Small native transfer (expect ALLOW)");
  const a = await guard(
    { from: me, to: "0x000000000000000000000000000000000000dEaD", value: ethers.parseEther("0.001").toString() },
    { logOnChain: true }
  );
  console.log(`-> ${a.decision} (${a.policy}) risk=${a.riskScore}  decision #${a.decisionId}`);

  banner("2B. UNLIMITED ERC-20 approval to an unknown spender (expect DENY)");
  const erc20 = new ethers.Interface(ERC20_ABI);
  const approveData = erc20.encodeFunctionData("approve", [
    "0x00000000000000000000000000000000DeaDBeef",
    UNLIMITED,
  ]);
  const someToken = "0x1111111111111111111111111111111111111111";
  const b = await guard({ from: me, to: someToken, data: approveData }, { logOnChain: true });
  console.log(`-> ${b.decision} (${b.policy}) risk=${b.riskScore}  decision #${b.decisionId}`);
  console.log(`   reason: ${b.reason}`);
  console.log(`   fix:    ${b.recommended_fix}`);

  banner("2C. Native transfer over the daily cap (expect DENY)");
  const c = await guard(
    { from: me, to: "0x000000000000000000000000000000000000dEaD", value: ethers.parseEther("0.05").toString() },
    { logOnChain: true }
  );
  console.log(`-> ${c.decision} (${c.policy}) risk=${c.riskScore}  decision #${c.decisionId}`);
  console.log(`   fix:    ${c.recommended_fix}`);

  banner("3. On-chain audit trail (explainable, machine-verifiable)");
  const log = await getAuditLog(3);
  for (const entry of log) {
    console.log(`#${entry.decisionId} ${entry.verdict} [${entry.policyCode}] risk=${entry.riskScore}`);
    console.log(`   ${entry.explanation}`);
  }
  console.log("\nDone. Every decision above is permanently recorded on Pharos and replayable via explain(decisionId).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
