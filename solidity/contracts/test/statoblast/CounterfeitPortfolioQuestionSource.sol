// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolReporterLedger } from '../../statoblast/SecurityPoolReporterLedger.sol';

/// @dev Attacker-controlled source pool, factory, portfolio, and reporter ledger in one
/// contract. It reports itself canonical and returns a real pool as its new child.
contract CounterfeitPortfolioQuestionSource {
	uint248 public immutable universeId;
	address private immutable victim;
	bool private targetPrepared;
	uint248 private preparedUniverse;
	constructor(uint248 sourceUniverse, address victimPool) {
		universeId = sourceUniverse;
		victim = victimPool;
	}
	function securityPoolFactory() external view returns (address) {
		return address(this);
	}
	function getQuestionLedgerOriginId(address) external pure returns (bytes32) {
		return bytes32(0);
	}
	function getQuestionLedger(bytes32, uint248 universe) external view returns (address) {
		// Canonical for the source lookup, but no existing child in the prepared target.
		return universe == universeId && !(targetPrepared && universe == preparedUniverse) ? address(this) : address(0);
	}
	function getSecurityPoolPortfolio(address) external view returns (address) {
		return address(this);
	}
	function portfolioCustody() external view returns (address) {
		return address(this);
	}
	function prepareQuestionUniverse(uint248 universe) external {
		targetPrepared = true;
		preparedUniverse = universe;
	}
	function sourceGame(uint248, uint256) external pure returns (address) {
		return address(0);
	}
	function reporterLedger(uint248) external view returns (address) {
		return address(this);
	}
	function checkpoint(uint248) external {}
	function question(uint248, uint256) external pure returns (SecurityPoolReporterLedger.Question memory state, bool finalClaim) {}
	function questionId() external pure returns (uint256) {
		return 0;
	}
	function shareToken() external view returns (address) {
		return address(this);
	}
	function statoblastSecurityMultiplierBps() external pure returns (uint256) {
		return 0;
	}
	function preparePortfolioPriceFeed(address, uint248) external pure returns (address) {
		return address(0);
	}
	function deployChildQuestionLedger(address, address, uint248, uint256, uint256) external view returns (address) {
		return victim;
	}
	function authorizeChildQuestionLedger(address) external {}
	function registerChildQuestionLedger(address) external {}
}
