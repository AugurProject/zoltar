// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolStorage } from './SecurityPoolStorage.sol';
import { IPortfolioSettlement } from './interfaces/IPortfolioSettlement.sol';

/// @dev Portfolio-native fee accounting. Ordinary standalone pools retain their exponential curve.
abstract contract SecurityPoolLinearFees is SecurityPoolStorage {
	/// @notice Mirror the central book after its aggregate fee and finality checkpoint.
	function updateLinearFees() public payable {
		require(portfolioCustody != address(0), 'Portfolio settlement missing');
		uint48 logicalClock;
		(shareTokenSupplyAttoShares, settlementCollateralAttoEth, logicalClock) = IPortfolioSettlement(address(portfolioAccounting)).checkpointQuestionSettlement();
		lastUpdatedFeeAccumulator = logicalClock;
	}

	/// @notice Synchronize a reporting change and the question's prospective central fee stream.
	function refreshLinearFeeStream() external payable {
		require(portfolioCustody != address(0), 'Portfolio settlement missing');
		uint48 logicalClock;
		(shareTokenSupplyAttoShares, settlementCollateralAttoEth, logicalClock) = IPortfolioSettlement(address(portfolioAccounting)).refreshQuestionSettlement();
		lastUpdatedFeeAccumulator = logicalClock;
	}
}
