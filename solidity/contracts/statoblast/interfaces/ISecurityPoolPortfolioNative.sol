// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IQuestionLedger } from './IQuestionLedger.sol';

/// @dev Canonical portfolio callbacks used by native question materialization.
interface ISecurityPoolPortfolioNative {
	function portfolioTime(uint248 universeId) external view returns (uint48);
	function portfolioTimeForNative(uint248 universeId, uint48 timestamp) external view returns (uint48);
	function nativeTimeForPortfolioTime(uint248 universeId, uint48 timestamp) external view returns (uint48);
	function sourceGame(uint248 universeId, uint256 questionId) external view returns (address);
	function inheritedFixedOutcome(uint248 universeId, uint256 questionId) external view returns (bool, uint256);
	function reporterLedger(uint248 universeId) external view returns (address);
	function settlement() external view returns (address);
	function prepareQuestionUniverse(uint248 universeId) external;
	function registerChildQuestionLedger(IQuestionLedger pool) external;
	function registerReporterGame(address game) external;
	function forkWithReporterQuestion(IQuestionLedger pool) external;
}
