// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { EscalationGame } from './EscalationGame.sol';
import { SystemState } from './interfaces/IQuestionLedger.sol';
import { ISecurityPoolAccounting } from './interfaces/ISecurityPoolAccounting.sol';

/// @dev Per-question settlement caches and reporting state. All delegate targets share this layout.
abstract contract QuestionLedgerStorage {
	EscalationGame public escalationGame;
	uint256 public settlementCollateralAttoEth;
	uint256 public statoblastSecurityMultiplierBps;
	uint256 public shareTokenSupplyAttoShares;
	/// @dev Security pool time returned by central settlement, not an accumulated fee amount.
	uint256 public lastSettlementSecurityPoolTime;
	bool public awaitingForkContinuation;
	SystemState public systemState;
	address public securityPoolCustody;
	ISecurityPoolAccounting internal securityPoolAccounting;

	function _requireUnforkedOperational(uint256 forkTime) internal view {
		require(forkTime == 0, 'Forked');
		require(securityPoolCustody != address(0), 'Security pool settlement missing');
		require(systemState == SystemState.Operational, 'Pool inactive');
	}
}
