// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolSettlementMath } from '../../statoblast/SecurityPoolSettlementMath.sol';
import { OraclePriceMath } from '../../statoblast/OraclePriceMath.sol';
import { TwoWayConstantProductMath } from '../../trading/TwoWayConstantProductMath.sol';

contract InvariantMathHarness {
	function conditionalYesBps(uint256 yesReserve, uint256 noReserve) external pure returns (uint256) {
		return TwoWayConstantProductMath.conditionalYesBps(yesReserve, noReserve);
	}

	function mintUnits(uint256 deposit, uint256 units, uint256 netCash) external pure returns (uint256) {
		return SecurityPoolSettlementMath.mintUnits(deposit, units, netCash);
	}

	function cashForUnits(uint256 cash, uint256 units, uint256 remainder, uint256 burned) external pure returns (uint256) {
		return SecurityPoolSettlementMath.cashForUnits(cash, units, remainder, burned);
	}

	function feeBudget(uint256 questionUnits, uint256 supply, uint256 minimumRate, uint256 netCash, uint256 units) external pure returns (uint256) {
		return SecurityPoolSettlementMath.feeBudget(questionUnits, supply, minimumRate, netCash, units);
	}

	function requiredCash(uint256 units, uint256 numerator, uint256 denominator, uint256 remainder) external pure returns (uint256) {
		return SecurityPoolSettlementMath.requiredCash(units, numerator, denominator, remainder);
	}

	function conservativePrice(uint256 price, uint256 uncertainty) external pure returns (uint256) {
		return OraclePriceMath.conservativePrice(price, uncertainty);
	}

	function liquidationPrice(uint256 price, uint256 uncertainty) external pure returns (uint256) {
		return OraclePriceMath.liquidationPrice(price, uncertainty);
	}

	function bounds(uint256 price, uint256 uncertainty) external pure returns (uint256, uint256) {
		return (
			OraclePriceMath.liquidationPrice(price, uncertainty),
			OraclePriceMath.conservativePrice(price, uncertainty)
		);
	}
}
