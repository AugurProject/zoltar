// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

/// @notice Authenticated question-to-portfolio fork notification.
interface ISecurityPoolPortfolioAccounting {
	function freezeForFork() external;
}
