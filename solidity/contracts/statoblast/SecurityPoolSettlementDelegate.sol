// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolStorage } from './SecurityPoolStorage.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { IPortfolioSettlement } from './interfaces/IPortfolioSettlement.sol';

interface ISecurityPoolPortfolioPurchaseAuthority {
	function services() external view returns (address);
}

abstract contract SecurityPoolSettlementDelegate is SecurityPoolStorage {
	event CompleteSetCreated(address indexed creator, uint256 settlementCollateralProvidedAttoEth, uint256 completeSetsMintedAttoShares, uint256 resultingShareTokenSupplyAttoShares, uint256 resultingSettlementCollateralAttoEth);

	function createCompleteSet(uint256 cash) external returns (uint256 completeSetsToMintAttoShares) {
		ISecurityPool pool = ISecurityPool(payable(address(this)));
		require(!awaitingForkContinuation, 'Fork await');
		if (portfolioCustody != address(0)) {
			address portfolio = pool.securityPoolFactory().getSecurityPoolPortfolio(pool);
			require(msg.sender == ISecurityPoolPortfolioPurchaseAuthority(portfolio).services(), 'Use portfolio purchase');
		}
		require(address(escalationGame) == address(0), 'Escalation mint closed');
		if (cash == 0 || pool.isEscalationResolved()) revert('Settlement unavailable');
		require(block.timestamp < pool.questionData().getQuestionEndDate(pool.questionId()), 'Question ended');
		if (portfolioCustody != address(0)) {
			(
				completeSetsToMintAttoShares,
				shareTokenSupplyAttoShares,
				settlementCollateralAttoEth
			) = IPortfolioSettlement(address(portfolioAccounting)).mintQuestionSettlement(cash);
			emit CompleteSetCreated(msg.sender, cash, completeSetsToMintAttoShares, shareTokenSupplyAttoShares, settlementCollateralAttoEth);
			return completeSetsToMintAttoShares;
		}
		revert('Portfolio settlement missing');
	}

	function _redeemPortfolioSettlement(address recipient, uint256 burnedShares) internal returns (uint256 paidCashAttoEth) {
		if (burnedShares == 0) return 0;
		(paidCashAttoEth, shareTokenSupplyAttoShares, settlementCollateralAttoEth) = IPortfolioSettlement(address(portfolioAccounting)).redeemQuestionSettlement(recipient, burnedShares);
	}
}
