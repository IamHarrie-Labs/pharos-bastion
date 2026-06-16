---
name: pharos-bastion
version: 0.1.0
description: >-
  Trusted execution layer for autonomous agents on Pharos. Evaluates every
  pending transaction through simulate → risk-score → on-chain policy before
  anything is signed. Returns an explainable ALLOW / WARN / DENY verdict.
  Every decision is permanently recorded on GuardianRegistry.
license: MIT
runtime: mcp+cast
chain:
  name: Pharos Atlantic
  chainId: 688689
  rpc: https://atlantic.dplabs-internal.com
  explorer: https://atlantic.pharosscan.xyz
contracts:
  GuardianPolicy: "0x7BBDa4409e300eaDB0A61F137498480c96173C9e"
  GuardianRegistry: "0x44C97e79E4f6b9cD5065bEDc577C9B74bF9e523A"
tags: [security, infrastructure, agent, onchain, mcp, pharos, guard, policy, audit]
---

# Pharos Bastion — Skill

Bastion is the **trusted execution layer for autonomous on-chain agents**. Before
an agent signs any transaction it calls Bastion, which:

1. **Simulates** the transaction (`eth_call`) to decode intent and detect reverts
2. **Scores risk** — names every contributing factor (unlimited approval, revert, bad target)
3. **Checks policy** — enforces per-account spend caps, daily limits, allow/denylists on-chain
4. **Returns a verdict** — ALLOW / WARN / DENY with a reason code and recommended fix
5. **Logs the decision** permanently to `GuardianRegistry` for verifiable replay via `explain()`

---

## Environment

```bash
export POLICY_ADDRESS=0x7BBDa4409e300eaDB0A61F137498480c96173C9e
export REGISTRY_ADDRESS=0x44C97e79E4f6b9cD5065bEDc577C9B74bF9e523A
export RPC_URL=https://atlantic.dplabs-internal.com
export PRIVATE_KEY=<funded-testnet-key>
```

---

## Capability Index

| User Need | Capability | Detailed Instructions |
|---|---|---|
| evaluate a transaction / check if this tx is safe / guard before signing / should I send this | Check a pending transaction against the on-chain policy | → [references/bastion.md#check-policy](references/bastion.md#check-policy) |
| set spending limits / configure my agent's policy / define rules / set max value per tx / set daily limit | Configure the caller's on-chain spending policy | → [references/bastion.md#set-policy](references/bastion.md#set-policy) |
| block an address / denylist a contract / prevent interactions with / blacklist | Add a target to the denylist | → [references/bastion.md#denylist-a-target](references/bastion.md#denylist-a-target) |
| whitelist a protocol / allowlist a contract / trust this address / allow interactions with | Add a target to the allowlist | → [references/bastion.md#allowlist-a-target](references/bastion.md#allowlist-a-target) |
| read my policy / what are my spending rules / show my policy / what limits do I have | Read an account's current policy | → [references/bastion.md#get-policy](references/bastion.md#get-policy) |
| how much have I spent today / check daily spend / remaining budget / spending window | Check native value spent in the current 24h rolling window | → [references/bastion.md#check-daily-spend](references/bastion.md#check-daily-spend) |
| is this address whitelisted / is this target allowed / check allowlist | Check if a target is on the allowlist | → [references/bastion.md#check-allowlist](references/bastion.md#check-allowlist) |
| is this address blacklisted / is this target blocked / check denylist | Check if a target is on the denylist | → [references/bastion.md#check-denylist](references/bastion.md#check-denylist) |
| explain decision / why was this denied / look up past verdict / audit trail / decision id | Read a specific past decision from the on-chain audit log | → [references/bastion.md#get-decision](references/bastion.md#get-decision) |
| how many decisions / total audit log size / count decisions | Get the total number of decisions in GuardianRegistry | → [references/bastion.md#total-decisions](references/bastion.md#total-decisions) |
| show recent decisions / query decision log / list evaluations / audit feed | Query DecisionLogged events from GuardianRegistry | → [references/bastion.md#query-decisions](references/bastion.md#query-decisions) |
| record spend / accrue daily limit / track native spend | Record native value spent for daily-limit accounting | → [references/bastion.md#record-spend](references/bastion.md#record-spend) |
| full pipeline guard / simulate risk policy in one call / MCP guard | Run the full Bastion pipeline via MCP (recommended for agents) | → [references/bastion.md#mcp-guard-pipeline](references/bastion.md#mcp-guard-pipeline) |

---

## Two interfaces

| Interface | When to use |
|---|---|
| **MCP** (`npm run mcp`) | Agent needs the full pipeline (simulate + risk + policy + decide) in one call. The `guard` tool is the primitive. |
| **Cast** (`cast call` / `cast send`) | Granular on-chain reads/writes. Inspect one rule at a time, configure policy, or read the audit log directly. |
