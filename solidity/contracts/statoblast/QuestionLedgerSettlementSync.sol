// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { QuestionLedgerStorage } from './QuestionLedgerStorage.sol';
import { ISecurityPoolSettlement } from './interfaces/ISecurityPoolSettlement.sol';

/// @dev Question accounting mirrors the security pool settlement book.
abstract contract QuestionLedgerSettlementSync is QuestionLedgerStorage {
	/// @notice Mirror the central book after accruing fees and reserving any matured claim for this question.
	function synchronizeSettlement() public payable {
		_synchronizeSettlement(false);
	}

	/// @notice Synchronize a reporting change and the question's prospective central fee stream.
	function refreshSettlement() external payable {
		_synchronizeSettlement(true);
	}

	function _synchronizeSettlement(bool refresh) private {
		require(securityPoolCustody != address(0), 'Security pool settlement missing');
		ISecurityPoolSettlement settlement = ISecurityPoolSettlement(address(securityPoolAccounting));
		uint48 securityPoolTime;
		(shareTokenSupplyAttoShares, settlementCollateralAttoEth, securityPoolTime) = refresh
			? settlement.refreshQuestionSettlement()
			: settlement.checkpointQuestionSettlement();
		lastSettlementSecurityPoolTime = securityPoolTime;
	}
}
