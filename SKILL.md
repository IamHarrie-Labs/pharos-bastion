---
name: pharos-bastion
version: 0.1.0
description: >-
  Trusted execution layer for autonomous agents on Pharos. Before an agent signs
  any on-chain action, call guard() to simulate it, score its risk, enforce an
  on-chain spending policy, and return an explainable ALLOW / WARN / DENY verdict
  with a recommended fix. Every decision is recorded on-chain and replayable via
  explain(). Use whenever an agent is about to send a transaction, approve a
  token, or move value on Pharos — especially to catch unlimited approvals,
  reverting calls, and over-budget spends before anything is signed.
license: MIT
runtime: mcp
chain:
  name: Pharos Atlantic
  chainId: 688689
tags: [security, infrastructure, payments, agent, onchain, mcp, pharos]
---

# Pharos Bastion — Skill manifest

Bastion is an MCP skill. Connect it to any MCP-compatible agent and the tools
below become callable. It is **composable infrastructure**: other skills/agents
(payments, DeFi, treasury) should call `guard` before acting.

## When to use this skill

- An agent is about to **send a transaction or move value** on Pharos.
- An agent is about to **approve an ERC-20** (Bastion flags unlimited approvals).
- You need to **enforce spend limits / allowlists** on an autonomous agent.
- You need an **auditable, explainable** record of why an agent acted.

## Core call

`guard({ from, to, value?, data? })` → returns:

```
{ decision: "ALLOW"|"WARN"|"DENY", confidence, riskScore, reason, policy,
  factors[], simulation, recommended_fix, decisionId? }
```

`execute({ from, to, value?, data? })` does the same and then broadcasts **only
if the verdict is not DENY**.

## Tools

| Tool | Signs | Description |
|---|---|---|
| `guard` | no | Full pipeline → explainable verdict. The primitive. |
| `simulate_transaction` | no | Decode + statically execute a tx. |
| `assess_risk` | no | 0–100 risk score with attributable factors. |
| `check_policy` | no | Evaluate against on-chain policy. |
| `explain` | no | Reconstruct a past decision from the on-chain audit log. |
| `get_audit_log` | no | Recent on-chain decisions. |
| `get_policy` | no | Read an account's policy. |
| `bastion_info` | no | Network / contracts / signer status. |
| `set_policy` | yes | Configure the signer's on-chain policy. |
| `set_target` | yes | Allow/denylist a target. |
| `execute` | yes | Guard, log on-chain, broadcast only if not DENY. |

## Setup

See `README.md`. In short: `npm install`, set `PHAROS_PRIVATE_KEY` +
`BASTION_POLICY_ADDRESS` + `BASTION_REGISTRY_ADDRESS` in `.env`, then `npm run mcp`.

Read-only tools work with no key.
