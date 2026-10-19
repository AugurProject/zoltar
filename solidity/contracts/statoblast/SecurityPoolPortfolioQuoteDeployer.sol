// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolPortfolioQuote } from './SecurityPoolPortfolioQuote.sol';

/// @notice Separates immutable quote deployment from recovery and custody deployment bytecode.
contract SecurityPoolPortfolioQuoteDeployer {
	function createQuote(address portfolio, uint256 targetHealthFactorBps, uint256 purchaseFeeBps, uint256 minimumPurchaseFeeAttoEth) external returns (SecurityPoolPortfolioQuote) {
		return
			new SecurityPoolPortfolioQuote(portfolio, targetHealthFactorBps, purchaseFeeBps, minimumPurchaseFeeAttoEth);
	}
}
