// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool } from './ISecurityPool.sol';

/// @dev Canonical portfolio callbacks used by native question materialization.
interface ISecurityPoolPortfolioNative {
	function logicalTime(uint248 universeId) external view returns (uint48);
	function logicalTimeForNative(uint248 universeId, uint48 timestamp) external view returns (uint48);
	function nativeTimeForLogical(uint248 universeId, uint48 timestamp) external view returns (uint48);
	function sourceGame(uint248 universeId, uint256 questionId) external view returns (address);
	function inheritedFixedOutcome(uint248 universeId, uint256 questionId) external view returns (bool, uint256);
	function reporterLedger(uint248 universeId) external view returns (address);
	function settlement() external view returns (address);
	function prepareQuestionUniverse(uint248 universeId) external;
	function registerChildPool(ISecurityPool pool) external;
	function registerReporterGame(address game) external;
	function forkWithReporterQuestion(ISecurityPool pool) external;
}
