// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { SecurityPoolPortfolioPosition } from './SecurityPoolPortfolioPosition.sol';
import { SecurityPoolPortfolioQuote } from './SecurityPoolPortfolioQuote.sol';
import { SecurityPoolPortfolioRecovery } from './SecurityPoolPortfolioRecovery.sol';

/// @notice Deploy portfolio accounting and custody with authority bound to the requesting controller.
contract SecurityPoolPortfolioRecoveryDeployer {
	function createRootRecovery() external returns (SecurityPoolPortfolioRecovery) {
		return new SecurityPoolPortfolioRecovery(msg.sender, 0, false);
	}

	function createRecovery(uint256 positionCount) external returns (SecurityPoolPortfolioRecovery) {
		return new SecurityPoolPortfolioRecovery(msg.sender, positionCount, true);
	}

	function createQuote() external returns (SecurityPoolPortfolioQuote) {
		return new SecurityPoolPortfolioQuote();
	}

	function createPosition(ISecurityPool pool, SecurityPoolPortfolioQuote quote, ISecurityPool incomingParent, address incomingSource) external returns (SecurityPoolPortfolioPosition) {
		return new SecurityPoolPortfolioPosition(msg.sender, pool, quote, incomingParent, incomingSource);
	}
}
