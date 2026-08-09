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
		amountOut = _ratioOfSum(reserveOut, netInput, reserveIn);
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
		require(yesReserve > 0 || noReserve > 0, 'Empty reserves');
		return _ratioOfSum(BPS_DENOMINATOR, noReserve, yesReserve);
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

	function _ratioOfSum(uint256 scale, uint256 numeratorPart, uint256 otherPart) private pure returns (uint256) {
		if (otherPart <= type(uint256).max - numeratorPart)
			return Math.mulDiv(scale, numeratorPart, otherPart + numeratorPart);

		// The denominator has 257 bits. The quotient is bounded by `scale`, so an exact
		// binary search can compare 512-bit products without narrowing the denominator.
		uint256 low;
		uint256 high = scale;
		while (low < high) {
			uint256 midpoint = low + (high - low + 1) / 2;
			if (_productOfSumAtMost(midpoint, otherPart, numeratorPart, scale, numeratorPart)) low = midpoint;
			else high = midpoint - 1;
		}
		return low;
	}

	function _productOfSumAtMost(
		uint256 multiplier,
		uint256 first,
		uint256 second,
		uint256 rightMultiplier,
		uint256 rightValue
	) private pure returns (bool) {
		(uint256 firstHigh, uint256 firstLow) = Math.mul512(multiplier, first);
		(uint256 secondHigh, uint256 secondLow) = Math.mul512(multiplier, second);
		(uint256 rightHigh, uint256 rightLow) = Math.mul512(rightMultiplier, rightValue);
		unchecked {
			uint256 lowSum = firstLow + secondLow;
			uint256 carry = lowSum < firstLow ? 1 : 0;
			uint256 highWithoutCarry = firstHigh + secondHigh;
			if (highWithoutCarry < firstHigh) return false;
			uint256 highSum = highWithoutCarry + carry;
			if (highSum < highWithoutCarry) return false;
			return highSum < rightHigh || (highSum == rightHigh && lowSum <= rightLow);
		}
	}
}
