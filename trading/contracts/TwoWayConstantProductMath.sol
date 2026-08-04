// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Math } from '../../solidity/contracts/peripherals/openOracle/openzeppelin/contracts/utils/math/Math.sol';

library TwoWayConstantProductMath {
	uint256 internal constant BPS_DENOMINATOR = 10_000;

	function quoteExactInput(
		uint256 reserveIn,
		uint256 reserveOut,
		uint256 amountIn,
		uint256 feeBps
	) internal pure returns (uint256 amountOut, uint256 feeAmount) {
		require(reserveIn > 0 && reserveOut > 0, 'Empty reserves');
		require(amountIn > 0, 'Input is zero');
		require(feeBps < BPS_DENOMINATOR, 'Invalid fee');
		uint256 netInput = Math.mulDiv(amountIn, BPS_DENOMINATOR - feeBps, BPS_DENOMINATOR);
		require(netInput > 0, 'Net input is zero');
		amountOut = Math.mulDiv(reserveOut, netInput, reserveIn + netInput);
		require(amountOut > 0 && amountOut < reserveOut, 'Insufficient output');
		feeAmount = amountIn - netInput;
	}

	function quoteExactOutput(
		uint256 reserveIn,
		uint256 reserveOut,
		uint256 amountOut,
		uint256 feeBps
	) internal pure returns (uint256 amountIn, uint256 feeAmount) {
		require(reserveIn > 0 && reserveOut > 0, 'Empty reserves');
		require(amountOut > 0 && amountOut < reserveOut, 'Invalid output');
		require(feeBps < BPS_DENOMINATOR, 'Invalid fee');
		uint256 netInput = Math.mulDiv(reserveIn, amountOut, reserveOut - amountOut, Math.Rounding.Ceil);
		amountIn = Math.mulDiv(netInput, BPS_DENOMINATOR, BPS_DENOMINATOR - feeBps, Math.Rounding.Ceil);
		feeAmount = amountIn - netInput;
	}

	function proportionalDeposit(
		uint256 yesReserve,
		uint256 noReserve,
		uint256 maxYes,
		uint256 maxNo
	) internal pure returns (uint256 yesUsed, uint256 noUsed) {
		require(yesReserve > 0 && noReserve > 0, 'Empty reserves');
		noUsed = Math.mulDiv(maxYes, noReserve, yesReserve);
		if (noUsed <= maxNo) return (maxYes, noUsed);
		yesUsed = Math.mulDiv(maxNo, yesReserve, noReserve);
		noUsed = maxNo;
	}

	function conditionalYesBps(uint256 yesReserve, uint256 noReserve) internal pure returns (uint256) {
		require(yesReserve <= type(uint256).max - noReserve, 'Reserve sum overflow');
		return Math.mulDiv(noReserve, BPS_DENOMINATOR, yesReserve + noReserve);
	}

	function initialLiquidityAmounts(
		uint256 completeSets,
		uint256 conditionalYesBpsValue
	) internal pure returns (uint256 yesAmount, uint256 noAmount) {
		require(conditionalYesBpsValue > 0 && conditionalYesBpsValue < BPS_DENOMINATOR, 'Invalid initial price');
		if (conditionalYesBpsValue >= 5_000) {
			noAmount = completeSets;
			yesAmount = Math.mulDiv(completeSets, BPS_DENOMINATOR - conditionalYesBpsValue, conditionalYesBpsValue);
		} else {
			yesAmount = completeSets;
			noAmount = Math.mulDiv(completeSets, conditionalYesBpsValue, BPS_DENOMINATOR - conditionalYesBpsValue);
		}
		require(yesAmount > 0 && noAmount > 0, 'Initial reserves round to zero');
	}
}
