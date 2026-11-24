// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

/// @notice Authenticated question-to-security-pool fork notification.
interface ISecurityPoolAccounting {
	function freezeForFork() external;
}
