// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { QuestionLedgerStorage } from './QuestionLedgerStorage.sol';
import { IQuestionLedger } from './interfaces/IQuestionLedger.sol';
import { ISecurityPoolSettlement } from './interfaces/ISecurityPoolSettlement.sol';

interface ISecurityPoolPurchaseAuthority {
	function services() external view returns (address);
}

abstract contract QuestionLedgerSettlementDelegate is QuestionLedgerStorage {
	event CompleteSetCreated(address indexed creator, uint256 settlementCollateralProvidedAttoEth, uint256 completeSetsMintedAttoShares, uint256 resultingShareTokenSupplyAttoShares, uint256 resultingSettlementCollateralAttoEth);

	function createCompleteSet(uint256 cash) external returns (uint256 completeSetsToMintAttoShares) {
		IQuestionLedger pool = IQuestionLedger(payable(address(this)));
		require(!awaitingForkContinuation, 'Fork await');
		if (securityPoolCustody != address(0)) {
			address securityPool = pool.securityPoolFactory().securityPoolOf(pool);
			require(msg.sender == ISecurityPoolPurchaseAuthority(securityPool).services(), 'Use security pool purchase');
		}
		require(address(escalationGame) == address(0), 'Escalation mint closed');
		if (cash == 0 || pool.isEscalationResolved()) revert('Settlement unavailable');
		require(block.timestamp < pool.questionData().getQuestionEndDate(pool.questionId()), 'Question ended');
		if (securityPoolCustody != address(0)) {
			(
				completeSetsToMintAttoShares,
				shareTokenSupplyAttoShares,
				settlementCollateralAttoEth
			) = ISecurityPoolSettlement(address(securityPoolAccounting)).mintQuestionSettlement(cash);
			emit CompleteSetCreated(msg.sender, cash, completeSetsToMintAttoShares, shareTokenSupplyAttoShares, settlementCollateralAttoEth);
			return completeSetsToMintAttoShares;
		}
		revert('Security pool settlement missing');
	}

	function _redeemSecurityPoolSettlement(address recipient, uint256 burnedShares) internal returns (uint256 paidCashAttoEth) {
		if (burnedShares == 0) return 0;
		(paidCashAttoEth, shareTokenSupplyAttoShares, settlementCollateralAttoEth) = ISecurityPoolSettlement(address(securityPoolAccounting)).redeemQuestionSettlement(recipient, burnedShares);
	}
}
