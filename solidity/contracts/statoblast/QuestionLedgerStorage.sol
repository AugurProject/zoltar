// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { EscalationGame } from './EscalationGame.sol';
import { SystemState } from './interfaces/IQuestionLedger.sol';
import { ISecurityPoolAccounting } from './interfaces/ISecurityPoolAccounting.sol';

/// @dev Per-question checkpoint evidence and reporting state. All delegate targets share this layout.
/// The three settlement fields describe the last synchronized mutation, not live quotes.
/// Accounting events expose that snapshot to indexers; keepers use its clock to decide
/// whether another checkpoint is needed. Live pricing reads the central settlement book.
abstract contract QuestionLedgerStorage {
	EscalationGame public escalationGame;
	uint256 public settlementCollateralAttoEth;
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
