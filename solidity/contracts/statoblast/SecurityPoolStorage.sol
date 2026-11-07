// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { EscalationGame } from './EscalationGame.sol';
import { SystemState } from './interfaces/ISecurityPool.sol';
import { ISecurityPoolPortfolioAccounting } from './interfaces/ISecurityPoolPortfolioAccounting.sol';

/// @dev Per-question settlement caches and reporting state. All delegate targets share this layout.
abstract contract SecurityPoolStorage {
	EscalationGame public escalationGame;
	uint256 public settlementCollateralAttoEth;
	uint256 public statoblastSecurityMultiplierBps;
	uint256 public shareTokenSupplyAttoShares;
	/// @dev Logical time returned by central settlement, not an accumulated fee amount.
	uint256 public lastSettlementLogicalTime;
	bool public awaitingForkContinuation;
	SystemState public systemState;
	uint256 internal feeEpochEndTime;
	address public portfolioCustody;
	ISecurityPoolPortfolioAccounting internal portfolioAccounting;

	function _requireUnforkedOperational(uint256 forkTime) internal view {
		require(forkTime == 0, 'Forked');
		require(portfolioCustody != address(0), 'Portfolio settlement missing');
		require(systemState == SystemState.Operational, 'Pool inactive');
	}
}
