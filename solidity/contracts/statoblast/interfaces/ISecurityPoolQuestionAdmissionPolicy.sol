// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

/// @notice Portfolio question admission. Implementations may impose any onchain admission policy.
/// @dev Called with STATICCALL on registration, quotes and purchases, never on withdrawals or recovery.
interface ISecurityPoolQuestionAdmissionPolicy {
	function isQuestionAllowed(address portfolio, uint248 universeId, uint256 questionId) external view returns (bool);
}
