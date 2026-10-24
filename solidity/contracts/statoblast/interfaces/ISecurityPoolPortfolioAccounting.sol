// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

/// @notice Authenticated native-pool notifications; receivers update accounting without calling users.
interface ISecurityPoolPortfolioAccounting {
	function onQuestionAccountingChanged() external;
	function freezeForFork() external;
	function onCompleteSetsReturned() external;
	function replaceFeeStream(uint96 rateAttoEthPerSecond, uint48 endTime) external payable;
	function feeStreamBudget(address pool) external view returns (uint256);
}
