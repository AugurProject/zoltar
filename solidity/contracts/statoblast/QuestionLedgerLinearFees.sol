// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { QuestionLedgerStorage } from './QuestionLedgerStorage.sol';
import { ISecurityPoolSettlement } from './interfaces/ISecurityPoolSettlement.sol';

/// @dev Question accounting mirrors the security pool settlement book.
abstract contract QuestionLedgerLinearFees is QuestionLedgerStorage {
	/// @notice Mirror the central book after accruing fees and reserving any matured claim for this question.
	function updateLinearFees() public payable {
		require(securityPoolCustody != address(0), 'Security pool settlement missing');
		uint48 securityPoolTime;
		(shareTokenSupplyAttoShares, settlementCollateralAttoEth, securityPoolTime) = ISecurityPoolSettlement(address(securityPoolAccounting)).checkpointQuestionSettlement();
		lastSettlementSecurityPoolTime = securityPoolTime;
	}

	/// @notice Synchronize a reporting change and the question's prospective central fee stream.
	function refreshLinearFeeStream() external payable {
		require(securityPoolCustody != address(0), 'Security pool settlement missing');
		uint48 securityPoolTime;
		(shareTokenSupplyAttoShares, settlementCollateralAttoEth, securityPoolTime) = ISecurityPoolSettlement(address(securityPoolAccounting)).refreshQuestionSettlement();
		lastSettlementSecurityPoolTime = securityPoolTime;
	}
}
