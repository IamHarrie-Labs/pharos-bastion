# 🛡️ Pharos Bastion

**The trusted execution layer for autonomous on-chain agents.**

Every AI agent eventually hits the same wall: *can I trust this transaction?* — *am I allowed to spend this much?* — *can I prove why I did (or didn't) act?* Bastion answers all three. It's an **MCP skill** that sits between an agent and Pharos and forces every transaction through one hardened checkpoint:

```
  Agent  ──▶  guard()  ──▶  Pharos
                │
   simulate ─ risk ─ policy ─ decide ─ explain ─ audit
```

Nothing is signed unless Bastion approves it. Every decision is **deterministic, explainable, and recorded on-chain**.

> Built for the Pharos *Skill-to-Agent Dual Cascade Hackathon* (Phase 1 — Skill). Bastion is the foundational layer dozens of Phase 2 agents can plug into: a payments agent, a DeFi agent, a treasury agent all call `guard()` before they act.

---

## Why this and not "another agent"

Most submissions will be *products* (a trading agent, a portfolio agent). Bastion is **infrastructure** — it compounds, because every future agent can use it. And it's built for *this* hackathon's reality:

- **Security is the rubric.** The judges adopted **CertiK Skill Scanner** as the official standard and **GoPlus** is a sponsor. Bastion is a security skill, with small auditable contracts and a pluggable GoPlus risk adapter.
- **Simulation, not guesswork.** Bastion doesn't *guess* whether a token is "bad." It **decodes and simulates** exactly what a transaction will do — deterministic and explainable, with zero reliance on threat-intel data that doesn't exist yet on a new testnet.
- **Enforcement, not advice.** Most "AI security" tools print a warning. Bastion's policy lives in an **on-chain contract** — denials are grounded in trustless rules, not vibes.

## What makes it memorable: explainability

Every decision is a structured, machine-verifiable object:

```json
{
  "decision": "DENY",
  "confidence": 0.99,
  "riskScore": 50,
  "reason": "Unlimited token approval to 0xDeadBeef… A compromised spender could drain the entire balance.",
  "policy": "ERC20_UNLIMITED_APPROVAL",
  "recommended_fix": "Approve an exact amount instead of unlimited (type(uint256).max).",
  "simulation": { "decoded": { "kind": "erc20_approve", "isUnlimitedApproval": true }, "willRevert": false },
  "decisionId": 7,
  "loggedTxUrl": "https://atlantic.pharosscan.xyz/tx/0x…"
}
```

…and `explain(decisionId)` reconstructs *any* past decision straight from the on-chain audit log. Another agent can ask **"why didn't you execute yesterday's swap?"** and get a verifiable answer.

---

## Architecture

| Layer | Component | What it does |
|---|---|---|
| **Skill** | MCP server (`src/`) | 11 tools agents call. `guard` is the one primitive everything else builds on. |
| **Simulation** | `simulate.ts` | Decodes calldata (native / ERC-20 approve / transfer), flags unlimited approvals, statically executes (`eth_call`) to catch reverts. |
| **Risk** | `risk.ts` + `goplus.ts` | 0–100 composite score from named, attributable factors. GoPlus enrichment is optional and degrades gracefully. |
| **Policy** | `GuardianPolicy.sol` | On-chain, per-account spend caps, daily limits, allow/denylists, approval rules. The *enforceable* gate. |
| **Audit** | `GuardianRegistry.sol` | Append-only, immutable on-chain log of every decision → powers `explain()`. |

### MCP tools

| Tool | Signs? | Purpose |
|---|---|---|
| `guard` | no | **The primitive.** simulate → risk → policy → explainable ALLOW/WARN/DENY. |
| `simulate_transaction` | no | Decode + statically execute a tx. |
| `assess_risk` | no | 0–100 score with attributable factors. |
| `check_policy` | no | Evaluate against on-chain policy. |
| `explain` | no | Reconstruct a past decision from the audit log. |
| `get_audit_log` | no | Recent on-chain decisions. |
| `get_policy` | no | Read an account's policy. |
| `bastion_info` | no | Network + deployed-contract + signer status. |
| `set_policy` | yes | Configure the signer's on-chain policy. |
| `set_target` | yes | Allow/denylist a target. |
| `execute` | yes | Guard, log on-chain, and broadcast **only if not DENY**. |

---

## Deployed contracts (Pharos Atlantic)

| Contract | Address |
|---|---|
| `GuardianPolicy` | [`0x7BBDa4409e300eaDB0A61F137498480c96173C9e`](https://atlantic.pharosscan.xyz/address/0x7BBDa4409e300eaDB0A61F137498480c96173C9e) |
| `GuardianRegistry` | [`0x44C97e79E4f6b9cD5065bEDc577C9B74bF9e523A`](https://atlantic.pharosscan.xyz/address/0x44C97e79E4f6b9cD5065bEDc577C9B74bF9e523A) |

Chain ID `688689` · RPC `https://atlantic.dplabs-internal.com` · Explorer `https://atlantic.pharosscan.xyz`

---

## Quickstart

```bash
npm install
cp .env.example .env        # add PHAROS_PRIVATE_KEY + deployed addresses above

npm run compile             # compile contracts
npm test                    # 11 passing tests

npm run demo                # 3 live guard() calls + on-chain audit trail
```

### Run as an MCP server

```bash
npm run mcp                 # stdio MCP server
```

Claude Desktop / any MCP client config:

```json
{
  "mcpServers": {
    "pharos-bastion": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "env": {
        "PHAROS_PRIVATE_KEY": "0x…",
        "BASTION_POLICY_ADDRESS": "0x7BBDa4409e300eaDB0A61F137498480c96173C9e",
        "BASTION_REGISTRY_ADDRESS": "0x44C97e79E4f6b9cD5065bEDc577C9B74bF9e523A"
      }
    }
  }
}
```

### REST API — deployed (no setup required)

The API is live at `https://pharos-bastion.onrender.com`. No key needed for read-only calls.

```bash
# Evaluate a transaction
curl -X POST https://pharos-bastion.onrender.com/guard \
  -H "Content-Type: application/json" \
  -d '{
    "from": "0xYourAgentWallet",
    "to":   "0xTargetContract",
    "value": "0",
    "data": "0x095ea7b3000000000000000000000000deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef"
  }'

# Read recent on-chain decisions
curl https://pharos-bastion.onrender.com/audit?limit=5

# Health check
curl https://pharos-bastion.onrender.com/health
```

**Endpoints:**

| Method | Path | Description |
|---|---|---|
| `POST` | `/guard` | Evaluate `{ from, to, value, data }` → full `GuardDecision` |
| `GET` | `/audit` | Recent on-chain decisions from GuardianRegistry |
| `GET` | `/health` | Status check |

**Live playground:** [https://trybastion.vercel.app](https://trybastion.vercel.app) — runs the full pipeline in the browser, no setup.

### Run the REST API + frontend locally

```bash
# Terminal 1 — API server (port 3457)
npm run api

# Terminal 2 — frontend (port 3456)
npx serve frontend -p 3456
```

Open `http://localhost:3456` → scroll to **Try Bastion** → click **Evaluate Transaction**.

The pre-filled scenario (unlimited ERC-20 approval) runs the full pipeline against Pharos Atlantic and returns a live DENY with simulation details, risk factors, on-chain policy reason, and a recommended fix.

---

## Network

Pharos **Atlantic testnet** — chain id `688689`, RPC `https://atlantic.dplabs-internal.com`, explorer `https://atlantic.pharosscan.xyz`.

## Security model

- **Least privilege.** Read-only tools (`guard`, `simulate`, `assess_risk`, `explain`) never need a key. Only `execute` / policy writes sign.
- **No key handling beyond a single env var.** The private key is read once from `PHAROS_PRIVATE_KEY`, never logged, never persisted. `.env` is gitignored.
- **Fail closed.** No policy configured ⇒ `guard` denies. `execute` broadcasts *only* on a non-DENY verdict.
- **Immutable audit.** Decisions in `GuardianRegistry` cannot be altered after the fact.

## Phase 2 roadmap (Agent Arena)

Bastion is deliberately a *layer*, not the whole runtime — so it ships polished in Phase 1 and grows into Phase 2:

- **Intent engine** — accept `swap 50 USDC, max 1% slippage` and compile the safest route.
- **Multi-agent co-signing** — a second agent must approve high-risk actions.
- **ERC-4337 hard-enforcement module** — route a smart account's calls through Bastion so denied txs revert *at the account level*, not just advisory.

A "Bastion-protected" agent in Phase 2 is the natural next build.

## License

MIT
