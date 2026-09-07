// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { TwoWayConstantProductMath } from '../TwoWayConstantProductMath.sol';
import { Math } from '../../statoblast/openOracle/openzeppelin/contracts/utils/math/Math.sol';

contract TwoWayConstantProductMathHarness {
	function quoteExactInput(uint256 reserveIn, uint256 reserveOut, uint256 amountIn, uint256 feeBps) external pure returns (uint256 amountOut, uint256 feeAmount) {
		return TwoWayConstantProductMath.quoteExactInput(reserveIn, reserveOut, amountIn, feeBps);
	}

	function quoteExactOutput(uint256 reserveIn, uint256 reserveOut, uint256 amountOut, uint256 feeBps) external pure returns (uint256 amountIn, uint256 feeAmount) {
		return TwoWayConstantProductMath.quoteExactOutput(reserveIn, reserveOut, amountOut, feeBps);
	}

	function initialLiquidityAmounts(uint256 completeSets, uint256 conditionalYesBpsValue) external pure returns (uint256 yesAmount, uint256 noAmount) {
		return TwoWayConstantProductMath.initialLiquidityAmounts(completeSets, conditionalYesBpsValue);
	}

	function proportionalDeposit(uint256 yesReserve, uint256 noReserve, uint256 maxYes, uint256 maxNo) external pure returns (uint256 yesUsed, uint256 noUsed) {
		return TwoWayConstantProductMath.proportionalDeposit(yesReserve, noReserve, maxYes, maxNo);
	}

	function ternary(bool condition, uint256 whenTrue, uint256 whenFalse) external pure returns (uint256) {
		return Math.ternary(condition, whenTrue, whenFalse);
	}

	function mulDiv(uint256 x, uint256 y, uint256 denominator) external pure returns (uint256) {
		return Math.mulDiv(x, y, denominator);
	}
}
