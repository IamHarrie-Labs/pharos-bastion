// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title GuardianPolicy
/// @notice Per-account, on-chain spending policy for Pharos Bastion.
///         Each agent account owns its policy. The Bastion runtime evaluates a
///         pending transaction against `check(...)` before signing, so denials
///         are grounded in trustless on-chain rules rather than advisory hints.
/// @dev    Reason codes are returned as short strings so the off-chain runtime
///         can surface human-readable explanations (the `explain()` MCP tool).
contract GuardianPolicy {
    // ERC-20 selectors Bastion inspects.
    bytes4 internal constant APPROVE_SELECTOR = 0x095ea7b3; // approve(address,uint256)

    // The sentinel value agents most often get drained by: unlimited approval.
    uint256 internal constant UNLIMITED = type(uint256).max;

    uint256 internal constant ONE_DAY = 1 days;

    struct Policy {
        bool exists;
        uint256 maxValuePerTx; // max native value per tx (wei). 0 = no native transfers allowed.
        uint256 dailyLimit; // max cumulative native value per rolling 24h window. 0 = unlimited.
        bool allowUnlimitedApprovals; // if false, an unlimited ERC-20 approval is denied.
        uint256 maxApprovalAmount; // cap on bounded approvals. 0 = no approval cap.
        bool allowlistEnabled; // if true, only allowlisted targets may be called.
    }

    mapping(address => Policy) private _policies;
    mapping(address => mapping(address => bool)) private _allowed; // account => target => allowed
    mapping(address => mapping(address => bool)) private _denied; // account => target => denied

    // Rolling daily-spend accounting.
    mapping(address => uint256) private _spent; // spent in current window
    mapping(address => uint256) private _windowStart;

    event PolicySet(address indexed account);
    event TargetAllowed(address indexed account, address indexed target, bool allowed);
    event TargetDenied(address indexed account, address indexed target, bool denied);
    event SpendRecorded(address indexed account, uint256 value, uint256 windowTotal);

    /// @notice Set (or replace) the caller's policy.
    function setPolicy(
        uint256 maxValuePerTx,
        uint256 dailyLimit,
        bool allowUnlimitedApprovals,
        uint256 maxApprovalAmount,
        bool allowlistEnabled
    ) external {
        _policies[msg.sender] = Policy({
            exists: true,
            maxValuePerTx: maxValuePerTx,
            dailyLimit: dailyLimit,
            allowUnlimitedApprovals: allowUnlimitedApprovals,
            maxApprovalAmount: maxApprovalAmount,
            allowlistEnabled: allowlistEnabled
        });
        emit PolicySet(msg.sender);
    }

    function setTargetAllowed(address target, bool allowed) external {
        _allowed[msg.sender][target] = allowed;
        emit TargetAllowed(msg.sender, target, allowed);
    }

    function setTargetDenied(address target, bool denied) external {
        _denied[msg.sender][target] = denied;
        emit TargetDenied(msg.sender, target, denied);
    }

    function getPolicy(address account) external view returns (Policy memory) {
        return _policies[account];
    }

    function isAllowed(address account, address target) external view returns (bool) {
        return _allowed[account][target];
    }

    function isDenied(address account, address target) external view returns (bool) {
        return _denied[account][target];
    }

    /// @notice Native value already spent in the current rolling window.
    function spentToday(address account) public view returns (uint256) {
        if (block.timestamp >= _windowStart[account] + ONE_DAY) {
            return 0;
        }
        return _spent[account];
    }

    /// @notice Evaluate a pending transaction against `account`'s policy.
    /// @param account The agent account that would sign the tx.
    /// @param target The contract or recipient being called.
    /// @param value Native value (wei) attached to the tx.
    /// @param selector First 4 bytes of calldata (0x0 for plain transfers).
    /// @param approvalAmount If selector is approve(), the approved amount; else ignored.
    /// @return allowed True if the tx satisfies every rule.
    /// @return reason Short machine/human-readable code for the deciding rule.
    function check(
        address account,
        address target,
        uint256 value,
        bytes4 selector,
        uint256 approvalAmount
    ) external view returns (bool allowed, string memory reason) {
        Policy memory p = _policies[account];

        // No policy configured => fail closed. Bastion treats "no policy" as deny.
        if (!p.exists) {
            return (false, "NO_POLICY");
        }

        if (_denied[account][target]) {
            return (false, "TARGET_DENYLISTED");
        }

        if (p.allowlistEnabled && !_allowed[account][target]) {
            return (false, "TARGET_NOT_ALLOWLISTED");
        }

        if (value > p.maxValuePerTx) {
            return (false, "MAX_VALUE_PER_TX");
        }

        if (p.dailyLimit != 0) {
            if (spentToday(account) + value > p.dailyLimit) {
                return (false, "DAILY_LIMIT_EXCEEDED");
            }
        }

        if (selector == APPROVE_SELECTOR) {
            if (approvalAmount == UNLIMITED && !p.allowUnlimitedApprovals) {
                return (false, "ERC20_UNLIMITED_APPROVAL");
            }
            if (p.maxApprovalAmount != 0 && approvalAmount > p.maxApprovalAmount) {
                return (false, "ERC20_APPROVAL_LIMIT");
            }
        }

        return (true, "OK");
    }

    /// @notice Record native value spent so daily limits accrue across txs.
    /// @dev    Callable by the account itself (the agent wallet records its own
    ///         spend via Bastion's execute path). Handles window rollover.
    function recordSpend(uint256 value) external {
        uint256 start = _windowStart[msg.sender];
        if (block.timestamp >= start + ONE_DAY) {
            _windowStart[msg.sender] = block.timestamp;
            _spent[msg.sender] = value;
        } else {
            _spent[msg.sender] += value;
        }
        emit SpendRecorded(msg.sender, value, _spent[msg.sender]);
    }
}
