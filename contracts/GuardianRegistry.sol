// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title GuardianRegistry
/// @notice Append-only, on-chain audit log of every decision Bastion makes.
///         Each `guard()` verdict is recorded here so any party — a human, an
///         auditor, or another agent — can later ask "why did you (not) act?"
///         and get a machine-verifiable answer. This is the trust substrate for
///         Bastion's `explain(decisionId)` MCP tool.
/// @dev    Verdicts are intentionally immutable once written.
contract GuardianRegistry {
    enum Verdict {
        ALLOW,
        WARN,
        DENY
    }

    struct Decision {
        address account; // agent account the decision was made for
        address target; // contract / recipient evaluated
        uint256 value; // native value (wei) of the evaluated tx
        Verdict verdict; // ALLOW / WARN / DENY
        uint16 riskScore; // 0..100 composite risk from the runtime
        bytes32 policyCode; // deciding rule, e.g. keccak-free short code packed as bytes32
        bytes32 intentHash; // hash of the high-level intent / calldata for replay
        uint256 timestamp;
    }

    Decision[] private _decisions;

    event DecisionLogged(
        uint256 indexed decisionId,
        address indexed account,
        address indexed target,
        Verdict verdict,
        uint16 riskScore,
        bytes32 policyCode
    );

    /// @notice Log a decision. The caller (the Bastion runtime signer) attests to it.
    /// @return decisionId Monotonic id used by `explain(decisionId)`.
    function logDecision(
        address account,
        address target,
        uint256 value,
        Verdict verdict,
        uint16 riskScore,
        bytes32 policyCode,
        bytes32 intentHash
    ) external returns (uint256 decisionId) {
        require(riskScore <= 100, "RISK_OUT_OF_RANGE");

        decisionId = _decisions.length;
        _decisions.push(
            Decision({
                account: account,
                target: target,
                value: value,
                verdict: verdict,
                riskScore: riskScore,
                policyCode: policyCode,
                intentHash: intentHash,
                timestamp: block.timestamp
            })
        );

        emit DecisionLogged(decisionId, account, target, verdict, riskScore, policyCode);
    }

    function getDecision(uint256 decisionId) external view returns (Decision memory) {
        require(decisionId < _decisions.length, "UNKNOWN_DECISION");
        return _decisions[decisionId];
    }

    function totalDecisions() external view returns (uint256) {
        return _decisions.length;
    }
}
