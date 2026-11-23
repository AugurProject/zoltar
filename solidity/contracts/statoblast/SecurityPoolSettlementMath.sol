// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

/// @dev Claim weights trade at the book's net cash per unit, including redemption dust.
library SecurityPoolSettlementMath {
	uint256 internal constant SCALE = 1e9;
	uint256 internal constant LIMIT = 1 << 128;

	function netCash(uint256 cash, uint256 remainder) internal pure returns (uint256) {
		require(cash < LIMIT, 'Settlement cash too large');
		return cash * SCALE - remainder;
	}
	function mintUnits(uint256 cash, uint256 units, uint256 net) internal pure returns (uint256 added) {
		if (cash == 0) return 0;
		if (units == 0) return cash * SCALE;
		require(net != 0, 'Settlement backing exhausted');
		added = Math.mulDiv(cash * SCALE, units, net);
		require(added != 0 && Math.mulDiv(added, net, units) >= (cash - 1) * SCALE, 'Settlement purchase below unit precision');
	}
	function rawValue(uint256 weight, uint256 net, uint256 units, Math.Rounding rounding) internal pure returns (uint256) {
		return weight == 0 || units == 0 ? 0 : Math.mulDiv(weight, net, units * SCALE, rounding);
	}
	function scaledValue(uint256 weight, uint256 net, uint256 units) internal pure returns (uint256) {
		return weight == 0 || units == 0 ? 0 : Math.mulDiv(weight, net, units);
	}
	/// @dev A partial burn rounds down; the last burn consumes every remaining unit.
	function unitsForRedeemedShares(uint256 units, uint256 supply, uint256 burnedShares) internal pure returns (uint256) {
		return burnedShares == supply ? units : Math.mulDiv(units, burnedShares, supply);
	}
	function cashForUnits(uint256 cash, uint256 units, uint256 remainder, uint256 burned) internal pure returns (uint256) {
		if (burned == 0) return 0;
		return burned == units ? cash : rawValue(burned, netCash(cash, remainder), units, Math.Rounding.Floor);
	}
	function feeCash(uint256 fees, uint256 net, uint256 units, uint256 remainder) internal pure returns (uint256 cash, uint256 nextRemainder) {
		uint256 earned = scaledValue(fees, net, units) + remainder;
		return (earned / SCALE, earned % SCALE);
	}
	function principal(uint256 previous, uint256 supply, uint256 shares, uint256 addedUnits) internal pure returns (uint256) {
		return supply == 0 ? addedUnits : Math.mulDiv(previous, shares, supply, Math.Rounding.Ceil);
	}
	function requiredCash(uint256 units, uint256 numerator, uint256 denominator, uint256 remainder) internal pure returns (uint256) {
		return Math.ceilDiv(Math.mulDiv(units, numerator, denominator, Math.Rounding.Ceil) + remainder, SCALE);
	}
	function validateFeePrecision(uint256 principalUnits, uint256 net, uint256 units, uint256 annualBps) internal pure {
		uint256 denominator = 10_000 * 365 days;
		uint256 rate = Math.mulDiv(principalUnits, annualBps, denominator);
		require(rate != 0 && rate <= type(uint96).max, 'Fee precision rate unsupported');
		uint256 remainder = mulmod(principalUnits, annualBps, denominator);
		require(Math.mulDiv(remainder, net, units * 10_000) < SCALE, 'Fee precision annual loss exceeds limit');
	}
	function feeBudget(uint256 questionUnits, uint256 supply, uint256 minimumRate, uint256 net, uint256 totalUnits) internal pure returns (uint256) {
		if (net == 0 || totalUnits == 0) return 0;
		uint256 reservedCash = Math.mulDiv(supply, minimumRate, 1e18, Math.Rounding.Ceil);
		if (reservedCash > rawValue(questionUnits, net, totalUnits, Math.Rounding.Floor)) return 0;
		uint256 reservedUnits = Math.mulDiv(reservedCash, totalUnits * SCALE, net, Math.Rounding.Ceil);
		return questionUnits > reservedUnits ? questionUnits - reservedUnits : 0;
	}
}
