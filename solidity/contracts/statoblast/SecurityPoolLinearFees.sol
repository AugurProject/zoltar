// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolStorage } from './SecurityPoolStorage.sol';
import { IPortfolioSettlement } from './interfaces/IPortfolioSettlement.sol';

/// @dev Question accounting mirrors the portfolio settlement book.
abstract contract SecurityPoolLinearFees is SecurityPoolStorage {
	/// @notice Mirror the central book after its aggregate fee and finality checkpoint.
	function updateLinearFees() public payable {
		require(portfolioCustody != address(0), 'Portfolio settlement missing');
		uint48 portfolioTime;
		(shareTokenSupplyAttoShares, settlementCollateralAttoEth, portfolioTime) = IPortfolioSettlement(address(portfolioAccounting)).checkpointQuestionSettlement();
		lastSettlementPortfolioTime = portfolioTime;
	}

	/// @notice Synchronize a reporting change and the question's prospective central fee stream.
	function refreshLinearFeeStream() external payable {
		require(portfolioCustody != address(0), 'Portfolio settlement missing');
		uint48 portfolioTime;
		(shareTokenSupplyAttoShares, settlementCollateralAttoEth, portfolioTime) = IPortfolioSettlement(address(portfolioAccounting)).refreshQuestionSettlement();
		lastSettlementPortfolioTime = portfolioTime;
	}
}
