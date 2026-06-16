// Minimal hand-written ABIs for the contracts and tokens Bastion interacts with.
// Hand-written (rather than imported from build artifacts) so the runtime is
// decoupled from the Hardhat build and stays small and auditable.

export const GUARDIAN_POLICY_ABI = [
  "function setPolicy(uint256 maxValuePerTx, uint256 dailyLimit, bool allowUnlimitedApprovals, uint256 maxApprovalAmount, bool allowlistEnabled)",
  "function setTargetAllowed(address target, bool allowed)",
  "function setTargetDenied(address target, bool denied)",
  "function getPolicy(address account) view returns (tuple(bool exists, uint256 maxValuePerTx, uint256 dailyLimit, bool allowUnlimitedApprovals, uint256 maxApprovalAmount, bool allowlistEnabled))",
  "function isAllowed(address account, address target) view returns (bool)",
  "function isDenied(address account, address target) view returns (bool)",
  "function spentToday(address account) view returns (uint256)",
  "function check(address account, address target, uint256 value, bytes4 selector, uint256 approvalAmount) view returns (bool allowed, string reason)",
  "function recordSpend(uint256 value)",
] as const;

export const GUARDIAN_REGISTRY_ABI = [
  "function logDecision(address account, address target, uint256 value, uint8 verdict, uint16 riskScore, bytes32 policyCode, bytes32 intentHash) returns (uint256 decisionId)",
  "function getDecision(uint256 decisionId) view returns (tuple(address account, address target, uint256 value, uint8 verdict, uint16 riskScore, bytes32 policyCode, bytes32 intentHash, uint256 timestamp))",
  "function totalDecisions() view returns (uint256)",
  "event DecisionLogged(uint256 indexed decisionId, address indexed account, address indexed target, uint8 verdict, uint16 riskScore, bytes32 policyCode)",
] as const;

// Subset of ERC-20 used for decoding intent and enriching simulations.
export const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function transferFrom(address from, address to, uint256 amount) returns (bool)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)",
] as const;

export const SELECTORS = {
  approve: "0x095ea7b3",
  transfer: "0xa9059cbb",
  transferFrom: "0x23b872dd",
} as const;

export const UNLIMITED = (1n << 256n) - 1n; // type(uint256).max
