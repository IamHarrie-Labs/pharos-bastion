# Bastion — Skill Reference

Deployed on **Pharos Atlantic** (chain ID `688689`).

```bash
export POLICY_ADDRESS=0x7BBDa4409e300eaDB0A61F137498480c96173C9e
export REGISTRY_ADDRESS=0x44C97e79E4f6b9cD5065bEDc577C9B74bF9e523A
export RPC_URL=https://atlantic.dplabs-internal.com
export EXPLORER=https://atlantic.pharosscan.xyz
```

---

## check-policy

**Overview.** Read-only evaluation of a pending transaction against the account's
on-chain policy. This is the core on-chain gate. Returns `(bool allowed, string reason)`.
Use this to verify whether a specific transaction satisfies every rule before committing
to `guard()` or `execute()`. Returns instantly with no gas cost.

**Command Template**

```bash
cast call $POLICY_ADDRESS \
  "check(address,address,uint256,bytes4,uint256)(bool,string)" \
  $AGENT_WALLET \
  $TARGET_CONTRACT \
  $VALUE_WEI \
  $SELECTOR \
  $APPROVAL_AMOUNT \
  --rpc-url $RPC_URL
```

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `AGENT_WALLET` | `address` | yes | The account whose policy is evaluated (the wallet that would sign) |
| `TARGET_CONTRACT` | `address` | yes | The contract or EOA being called |
| `VALUE_WEI` | `uint256` | yes | Native value attached to the tx in wei. Use `0` for token-only calls |
| `SELECTOR` | `bytes4` | yes | First 4 bytes of calldata. Use `0x095ea7b3` for ERC-20 approve, `0x00000000` for plain transfers |
| `APPROVAL_AMOUNT` | `uint256` | yes | If selector is approve(), the approved amount. Use `0` otherwise |

**Common selectors**

| Action | Selector |
|---|---|
| ERC-20 `approve(address,uint256)` | `0x095ea7b3` |
| ERC-20 `transfer(address,uint256)` | `0xa9059cbb` |
| ERC-20 `transferFrom(address,address,uint256)` | `0x23b872dd` |
| Plain native transfer | `0x00000000` |
| Unlimited approval sentinel | `115792089237316195423570985008687907853269984665640564039457584007913129639935` |

**Output Parsing**

| Field | Position | Meaning |
|---|---|---|
| `allowed` | first return value | `true` = transaction satisfies all rules; `false` = blocked |
| `reason` | second return value | Short code identifying the deciding rule (see below) |

**Reason codes**

| Code | Meaning |
|---|---|
| `OK` | All rules passed — transaction is allowed |
| `NO_POLICY` | No policy configured for this account. Call `setPolicy` first |
| `TARGET_DENYLISTED` | Target address is on the account's denylist |
| `TARGET_NOT_ALLOWLISTED` | Allowlist mode is on and target is not on it |
| `MAX_VALUE_PER_TX` | Native value exceeds the per-transaction cap |
| `DAILY_LIMIT_EXCEEDED` | Cumulative spend today exceeds the 24h rolling limit |
| `ERC20_UNLIMITED_APPROVAL` | approve(max_uint256) is not permitted by this policy |
| `ERC20_APPROVAL_LIMIT` | Approval amount exceeds the bounded approval cap |

**Error Handling**

| Error | Cause | Fix |
|---|---|---|
| Returns `(false, "NO_POLICY")` | Account has no policy set | Call `setPolicy` with desired limits |
| Returns `(false, "ERC20_UNLIMITED_APPROVAL")` | Unlimited approval blocked | Use a bounded approval amount instead of `type(uint256).max` |
| `execution reverted` | Invalid address or malformed call | Verify addresses are checksummed; use `cast checksum <address>` |

**Agent Guidelines**

1. Set `SELECTOR=0x095ea7b3` and `APPROVAL_AMOUNT=<amount>` when evaluating an ERC-20 approve.
2. Set `SELECTOR=0x00000000` and `APPROVAL_AMOUNT=0` for plain native transfers.
3. If `allowed` is `false`, read `reason` to determine the fix before proceeding.
4. A `NO_POLICY` result means the wallet has never called `setPolicy` — do that first.
5. Never bypass a DENY — it exists to protect the agent.

---

## set-policy

**Overview.** Configure the caller's on-chain spending policy. Defines per-transaction
value caps, rolling 24h daily limits, ERC-20 approval rules, and allow/denylist mode.
This is the first call any agent must make before `guard()` can return ALLOW.
The policy is stored on-chain and persists until overwritten.

**Command Template**

```bash
cast send $POLICY_ADDRESS \
  "setPolicy(uint256,uint256,bool,uint256,bool)" \
  $MAX_VALUE_PER_TX \
  $DAILY_LIMIT \
  $ALLOW_UNLIMITED_APPROVALS \
  $MAX_APPROVAL_AMOUNT \
  $ALLOWLIST_ENABLED \
  --private-key $PRIVATE_KEY \
  --rpc-url $RPC_URL
```

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `MAX_VALUE_PER_TX` | `uint256` | yes | Max native wei per transaction. `0` = no native transfers allowed |
| `DAILY_LIMIT` | `uint256` | yes | Max cumulative native wei per rolling 24h window. `0` = no daily cap |
| `ALLOW_UNLIMITED_APPROVALS` | `bool` | yes | `false` = block `approve(type(uint256).max)`. Recommended: `false` |
| `MAX_APPROVAL_AMOUNT` | `uint256` | yes | Cap on bounded ERC-20 approvals in raw token units. `0` = no cap |
| `ALLOWLIST_ENABLED` | `bool` | yes | `true` = only allowlisted targets can be called |

**Common value examples**

```bash
# Conservative: 0.1 ETH/tx, 1 ETH/day, no unlimited approvals, 100k USDC cap
MAX_VALUE_PER_TX=$(cast to-wei 0.1)           # 100000000000000000
DAILY_LIMIT=$(cast to-wei 1)                  # 1000000000000000000
ALLOW_UNLIMITED_APPROVALS=false
MAX_APPROVAL_AMOUNT=100000000000              # 100,000 USDC (6 decimals)
ALLOWLIST_ENABLED=false
```

**Output Parsing**

| Field | Meaning |
|---|---|
| Transaction hash | Confirm with `cast receipt <hash> --rpc-url $RPC_URL` |
| `PolicySet(address)` event | Emitted on success — the indexed address is the account configured |

**Error Handling**

| Error | Cause | Fix |
|---|---|---|
| `insufficient funds` | Wallet has no PHRS for gas | Fund wallet on Pharos Atlantic faucet |
| No revert, no event | Wrong contract address | Verify `POLICY_ADDRESS` matches deployment |

**Agent Guidelines**

1. Always call `setPolicy` before any `guard()` — a missing policy returns `NO_POLICY`.
2. Set `ALLOW_UNLIMITED_APPROVALS=false` to protect against drain attacks.
3. Use `cast to-wei <eth-amount>` to convert human-readable ETH to wei.
4. After sending, confirm with `cast call $POLICY_ADDRESS "getPolicy(address)((bool,uint256,uint256,bool,uint256,bool))" $AGENT_WALLET --rpc-url $RPC_URL`.
5. Explorer link: `$EXPLORER/address/$POLICY_ADDRESS`.

---

## denylist-a-target

**Overview.** Add a contract or address to the caller's denylist. Any future transaction
to this target will be blocked by `check()` with reason `TARGET_DENYLISTED`, regardless
of all other policy rules. Use to permanently block a suspicious contract.

**Command Template**

```bash
cast send $POLICY_ADDRESS \
  "setTargetDenied(address,bool)" \
  $TARGET_ADDRESS \
  true \
  --private-key $PRIVATE_KEY \
  --rpc-url $RPC_URL
```

To remove from denylist, set the last argument to `false`.

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `TARGET_ADDRESS` | `address` | yes | Contract or EOA to block |
| `true` / `false` | `bool` | yes | `true` = add to denylist; `false` = remove from denylist |

**Output Parsing**

| Field | Meaning |
|---|---|
| `TargetDenied(account, target, denied)` event | Emitted on success |

**Error Handling**

| Error | Cause | Fix |
|---|---|---|
| `insufficient funds` | No PHRS for gas | Fund wallet |
| No event emitted | Wrong contract address | Verify `POLICY_ADDRESS` |

**Agent Guidelines**

1. After calling, verify with `cast call $POLICY_ADDRESS "isDenied(address,address)(bool)" $AGENT_WALLET $TARGET_ADDRESS --rpc-url $RPC_URL`.
2. Denylisting overrides allowlisting — a denylisted target is always blocked.
3. To block all interactions with a protocol permanently, denylist its router and token addresses.

---

## allowlist-a-target

**Overview.** Add a trusted contract to the caller's allowlist. Only takes effect when
`allowlistEnabled` is `true` in the policy. When enabled, only allowlisted targets
can be called — all others return `TARGET_NOT_ALLOWLISTED`.

**Command Template**

```bash
cast send $POLICY_ADDRESS \
  "setTargetAllowed(address,bool)" \
  $TARGET_ADDRESS \
  true \
  --private-key $PRIVATE_KEY \
  --rpc-url $RPC_URL
```

To remove from allowlist, set the last argument to `false`.

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `TARGET_ADDRESS` | `address` | yes | Contract or EOA to trust |
| `true` / `false` | `bool` | yes | `true` = add to allowlist; `false` = remove |

**Output Parsing**

| Field | Meaning |
|---|---|
| `TargetAllowed(account, target, allowed)` event | Emitted on success |

**Error Handling**

| Error | Cause | Fix |
|---|---|---|
| Target still blocked after allowlisting | `allowlistEnabled` is `false` in policy | Allowlist mode must be enabled via `setPolicy` for this to take effect |

**Agent Guidelines**

1. Allowlist mode must be activated — set `ALLOWLIST_ENABLED=true` in `setPolicy`.
2. Verify membership: `cast call $POLICY_ADDRESS "isAllowed(address,address)(bool)" $AGENT_WALLET $TARGET_ADDRESS --rpc-url $RPC_URL`.
3. Pre-allowlist all trusted protocols before enabling allowlist mode to avoid locking the agent out.

---

## get-policy

**Overview.** Read the current on-chain policy for any account. Returns all six policy
fields as a struct. Use to verify settings before running transactions.

**Command Template**

```bash
cast call $POLICY_ADDRESS \
  "getPolicy(address)((bool,uint256,uint256,bool,uint256,bool))" \
  $AGENT_WALLET \
  --rpc-url $RPC_URL
```

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `AGENT_WALLET` | `address` | yes | Account whose policy to read |

**Output Parsing**

The tuple fields are returned in this order:

| Position | Field | Type | Meaning |
|---|---|---|---|
| 1 | `exists` | `bool` | `true` if a policy has been configured |
| 2 | `maxValuePerTx` | `uint256` | Per-tx native cap in wei |
| 3 | `dailyLimit` | `uint256` | 24h rolling cap in wei (`0` = unlimited) |
| 4 | `allowUnlimitedApprovals` | `bool` | Whether `approve(max_uint256)` is permitted |
| 5 | `maxApprovalAmount` | `uint256` | Bounded approval cap in raw token units (`0` = no cap) |
| 6 | `allowlistEnabled` | `bool` | Whether only allowlisted targets may be called |

**Error Handling**

| Error | Cause | Fix |
|---|---|---|
| Returns `(false,0,0,false,0,false)` | No policy set for this account | Call `setPolicy` first |

**Agent Guidelines**

1. Check `exists` first — if `false`, `check()` will always return `NO_POLICY`.
2. Use `cast to-unit <wei> ether` to convert returned wei values to human-readable ETH.
3. A returned `maxValuePerTx` of `0` means no native transfers are allowed, not unlimited.

---

## check-daily-spend

**Overview.** Read how much native value (in wei) the account has spent in the current
rolling 24h window. Resets automatically when 24 hours have elapsed since the window started.

**Command Template**

```bash
cast call $POLICY_ADDRESS \
  "spentToday(address)(uint256)" \
  $AGENT_WALLET \
  --rpc-url $RPC_URL
```

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `AGENT_WALLET` | `address` | yes | Account to check spend for |

**Output Parsing**

| Field | Meaning |
|---|---|
| returned `uint256` | Wei spent in current window. `0` means window has reset or nothing spent |

**Agent Guidelines**

1. Compare against `dailyLimit` from `getPolicy` to calculate remaining budget.
2. `cast to-unit <result> ether` converts the wei value to a readable ETH amount.
3. Returns `0` when the 24h window has expired — the next `recordSpend` starts a fresh window.

---

## check-allowlist

**Overview.** Check whether a specific target is on an account's allowlist.

**Command Template**

```bash
cast call $POLICY_ADDRESS \
  "isAllowed(address,address)(bool)" \
  $AGENT_WALLET \
  $TARGET_ADDRESS \
  --rpc-url $RPC_URL
```

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `AGENT_WALLET` | `address` | yes | Account whose allowlist to check |
| `TARGET_ADDRESS` | `address` | yes | Target to look up |

**Output Parsing**

| Value | Meaning |
|---|---|
| `true` | Target is on the allowlist |
| `false` | Target is not allowlisted (blocked if allowlist mode is enabled) |

**Agent Guidelines**

1. A `true` result only matters if `allowlistEnabled` is `true` in the policy.
2. Use before adding a target to avoid duplicate transactions.

---

## check-denylist

**Overview.** Check whether a specific target is on an account's denylist.

**Command Template**

```bash
cast call $POLICY_ADDRESS \
  "isDenied(address,address)(bool)" \
  $AGENT_WALLET \
  $TARGET_ADDRESS \
  --rpc-url $RPC_URL
```

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `AGENT_WALLET` | `address` | yes | Account whose denylist to check |
| `TARGET_ADDRESS` | `address` | yes | Target to look up |

**Output Parsing**

| Value | Meaning |
|---|---|
| `true` | Target is denylisted — all transactions to it will be blocked |
| `false` | Target is not on the denylist |

**Agent Guidelines**

1. Always check before sending transactions to unknown contracts.
2. A denylisted target cannot be unblocked by allowlisting — remove it from the denylist first.

---

## get-decision

**Overview.** Retrieve a specific past decision from `GuardianRegistry` by its monotonic
ID. Every `guard()` call with `logOnChain=true` writes a decision and returns its ID.
Use this to reconstruct exactly why a transaction was allowed or denied.

**Command Template**

```bash
cast call $REGISTRY_ADDRESS \
  "getDecision(uint256)((address,address,uint256,uint8,uint16,bytes32,bytes32,uint256))" \
  $DECISION_ID \
  --rpc-url $RPC_URL
```

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `DECISION_ID` | `uint256` | yes | Monotonic decision ID (starts at 0) |

**Output Parsing**

The tuple fields are returned in this order:

| Position | Field | Type | Meaning |
|---|---|---|---|
| 1 | `account` | `address` | Agent wallet the decision was made for |
| 2 | `target` | `address` | Contract or recipient evaluated |
| 3 | `value` | `uint256` | Native value (wei) of the evaluated transaction |
| 4 | `verdict` | `uint8` | `0` = ALLOW, `1` = WARN, `2` = DENY |
| 5 | `riskScore` | `uint16` | Composite risk 0–100 |
| 6 | `policyCode` | `bytes32` | Deciding rule packed as bytes32 (decode with `cast parse-bytes32-string`) |
| 7 | `intentHash` | `bytes32` | keccak256 of canonical transaction intent for replay verification |
| 8 | `timestamp` | `uint256` | Unix timestamp when the decision was recorded |

**Decode the policy code**

```bash
cast parse-bytes32-string <policyCode>
```

**Error Handling**

| Error | Revert message | Fix |
|---|---|---|
| `execution reverted` | `"UNKNOWN_DECISION"` | Decision ID does not exist yet — check `totalDecisions()` first |

**Agent Guidelines**

1. Decision IDs are zero-indexed monotonic integers. Decision `0` was the first ever logged.
2. Decode `policyCode` with `cast parse-bytes32-string` to get the human-readable reason code (e.g. `ERC20_UNLIMITED_APPROVAL`).
3. Verdict `2` (DENY) with `policyCode` = `NO_POLICY` means no spending rules were set at evaluation time.
4. View the decision on the explorer: `$EXPLORER/tx/<loggedTxHash>`.

---

## total-decisions

**Overview.** Get the total number of decisions stored in `GuardianRegistry`.
Useful for iterating the audit log or confirming a decision was written.

**Command Template**

```bash
cast call $REGISTRY_ADDRESS \
  "totalDecisions()(uint256)" \
  --rpc-url $RPC_URL
```

**Output Parsing**

| Value | Meaning |
|---|---|
| returned `uint256` | Total decisions logged. Valid IDs are `0` through `result - 1` |

**Agent Guidelines**

1. Decision IDs run from `0` to `totalDecisions() - 1`.
2. To read the most recent decision: `DECISION_ID = totalDecisions() - 1`.

---

## query-decisions

**Overview.** Stream all `DecisionLogged` events from `GuardianRegistry` using
`cast logs`. Useful for building an off-chain feed of all verdicts without reading
each decision individually.

**Command Template**

```bash
cast logs \
  "DecisionLogged(uint256,address,address,uint8,uint16,bytes32)" \
  --address $REGISTRY_ADDRESS \
  --rpc-url $RPC_URL
```

Filter by agent account (second topic):

```bash
cast logs \
  "DecisionLogged(uint256,address,address,uint8,uint16,bytes32)" \
  --address $REGISTRY_ADDRESS \
  $AGENT_WALLET \
  --rpc-url $RPC_URL
```

**Output Parsing**

| Log field | Meaning |
|---|---|
| topic 1 (`decisionId`) | Monotonic decision ID — use with `getDecision` for full data |
| topic 2 (`account`) | Agent wallet the decision was made for |
| topic 3 (`target`) | Contract evaluated |
| data byte 0 (`verdict`) | `0x00` = ALLOW, `0x01` = WARN, `0x02` = DENY |
| data bytes 1–2 (`riskScore`) | Risk score 0–100 |
| data bytes 3–34 (`policyCode`) | Deciding rule as bytes32 |

**Agent Guidelines**

1. No block range is required — Pharos Atlantic retains all logs.
2. Use `decisionId` from the event to call `getDecision(decisionId)` for the full struct including `intentHash` and `timestamp`.
3. Filter by verdict: look for `0x02` in the data field to find all DENY decisions.

---

## record-spend

**Overview.** Record native value spent for daily-limit accounting. Called automatically
by the Bastion `execute()` MCP tool after a successful transaction. Call manually if
broadcasting transactions outside of Bastion's `execute()` path to keep the daily
spend counter accurate.

**Command Template**

```bash
cast send $POLICY_ADDRESS \
  "recordSpend(uint256)" \
  $VALUE_WEI \
  --private-key $PRIVATE_KEY \
  --rpc-url $RPC_URL
```

**Parameters**

| Name | Type | Required | Description |
|---|---|---|---|
| `VALUE_WEI` | `uint256` | yes | Native value (wei) to accrue to the rolling 24h window |

**Output Parsing**

| Event | Meaning |
|---|---|
| `SpendRecorded(account, value, windowTotal)` | Emitted on success. `windowTotal` is the running sum for the current window |

**Agent Guidelines**

1. Each account records its own spend — `msg.sender` is the account being tracked.
2. If 24h have elapsed since the last call, the window resets automatically.
3. Only necessary when sending transactions outside the Bastion `execute()` path. Inside `execute()`, this is called automatically.

---

## mcp-guard-pipeline

**Overview.** The full Bastion pipeline in a single MCP tool call. Runs simulation
(`eth_call` revert detection + calldata decoding), risk scoring (0–100 composite),
and on-chain policy check in sequence, then returns an explainable ALLOW/WARN/DENY
verdict. This is the **recommended interface for AI agents** — it replaces the
individual `cast call` steps with one structured result.

**Setup**

```bash
npm install
cp .env.example .env   # add PHAROS_PRIVATE_KEY, BASTION_POLICY_ADDRESS, BASTION_REGISTRY_ADDRESS
npm run mcp            # starts stdio MCP server
```

**Claude Desktop config**

```json
{
  "mcpServers": {
    "pharos-bastion": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "env": {
        "PHAROS_PRIVATE_KEY": "0x…",
        "BASTION_POLICY_ADDRESS": "0x7BBDa4409e300eaDB0A61F137498480c96173C9e",
        "BASTION_REGISTRY_ADDRESS": "0x44C97e79E4f6b9cD5065bEDc577C9B74bF9e523A",
        "PHAROS_RPC_URL": "https://atlantic.dplabs-internal.com"
      }
    }
  }
}
```

**Tool call: `guard`**

```json
{
  "tool": "guard",
  "arguments": {
    "from": "0xAgentWallet",
    "to": "0xTargetContract",
    "value": "0",
    "data": "0x095ea7b3000000000000000000000000SpenderAddressffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    "logOnChain": true
  }
}
```

**Response schema**

```json
{
  "decision": "ALLOW | WARN | DENY",
  "confidence": 0.99,
  "riskScore": 95,
  "reason": "Human-readable explanation of the deciding rule",
  "policy": "ERC20_UNLIMITED_APPROVAL",
  "factors": [
    { "code": "UNLIMITED_APPROVAL", "weight": 50, "detail": "…" },
    { "code": "WOULD_REVERT", "weight": 45, "detail": "…" }
  ],
  "simulation": {
    "willRevert": true,
    "decoded": {
      "kind": "erc20_approve",
      "isUnlimitedApproval": true,
      "spender": "0x…",
      "summary": "UNLIMITED ERC-20 approval of token 0x… to spender 0x…"
    }
  },
  "policyCheck": { "allowed": false, "reason": "ERC20_UNLIMITED_APPROVAL" },
  "recommended_fix": "Approve an exact amount instead of unlimited (type(uint256).max).",
  "intentHash": "0x…",
  "decisionId": 7,
  "loggedTxUrl": "https://atlantic.pharosscan.xyz/tx/0x…"
}
```

**All MCP tools**

| Tool | Signs | Purpose |
|---|---|---|
| `guard` | no | Full pipeline → ALLOW/WARN/DENY. **The primitive.** |
| `execute` | yes | Guard + sign + broadcast only if not DENY |
| `explain` | no | Reconstruct any past decision from the audit log |
| `simulate_transaction` | no | Decode calldata + `eth_call` revert detection |
| `assess_risk` | no | 0–100 risk score with named factors |
| `check_policy` | no | On-chain policy check only |
| `get_policy` | no | Read an account's policy |
| `set_policy` | yes | Configure the signer's policy |
| `set_target` | yes | Add to allow/denylist |
| `get_audit_log` | no | Recent on-chain decisions |
| `bastion_info` | no | Network + contracts + signer status |

**Agent Guidelines**

1. Call `guard()` with every transaction before signing. If verdict is `DENY`, stop.
2. If verdict is `WARN`, surface the risk factors to a human reviewer before proceeding.
3. Call `execute()` instead of `guard()` when the agent should also broadcast the transaction.
4. Use `explain(decisionId)` to answer "why didn't you act?" for any past decision.
5. Read-only tools (`guard`, `simulate_transaction`, `assess_risk`, `explain`) need no private key.
