// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { OPEN_ORACLE_PERCENTAGE_PRECISION } from './OraclePriceTypes.sol';

library OraclePriceMath {
	uint256 internal constant DISPUTE_GAS_UNITS = 300_000;
	uint256 internal constant REPORT_SECURITY_MULTIPLIER_BPS = 100_000;

	/// @dev Exact ceiling bound for uncertainty below D and price <= floor(MAX_UINT256 * (D - uncertainty) / D).
	/// Funded-report prices are at most uint128.max * 1e18, so even price * D fits uint256.
	function conservativePrice(uint256 price, uint256 uncertainty) internal pure returns (uint256) {
		require(uncertainty < OPEN_ORACLE_PERCENTAGE_PRECISION, 'Invalid oracle uncertainty');
		uint256 maximumPrice = Math.mulDiv(type(uint256).max, OPEN_ORACLE_PERCENTAGE_PRECISION - uncertainty, OPEN_ORACLE_PERCENTAGE_PRECISION);
		require(price <= maximumPrice, 'Conservative oracle price exceeds uint256');
		return
			Math.mulDiv(price, OPEN_ORACLE_PERCENTAGE_PRECISION, OPEN_ORACLE_PERCENTAGE_PRECISION - uncertainty, Math.Rounding.Ceil);
	}
	/// @dev Exact floor bound for every uint256 price and uncertainty below D.
	function liquidationPrice(uint256 price, uint256 uncertainty) internal pure returns (uint256) {
		require(uncertainty < OPEN_ORACLE_PERCENTAGE_PRECISION, 'Invalid oracle uncertainty');
		return Math.mulDiv(price, OPEN_ORACLE_PERCENTAGE_PRECISION, OPEN_ORACLE_PERCENTAGE_PRECISION + uncertainty);
	}
	function maximumPriorityFee(uint256 uncertainty, uint256 protocolFee, uint256 reporterFee, uint256 haltMultiplierBps, uint256 settlementFeeMultiplierBps) internal pure returns (uint256) {
		require(uncertainty < OPEN_ORACLE_PERCENTAGE_PRECISION, 'Target price error must be below one hundred percent');
		require(protocolFee + reporterFee < uncertainty, 'Oracle fees must be below the target price error');
		require(haltMultiplierBps > 0, 'Escalation multiplier zero');
		uint256 maximumReport = Math.mulDiv(type(uint128).max, SecurityPoolUtils.BPS_DENOMINATOR, haltMultiplierBps);
		maximumReport = Math.min(maximumReport, type(uint128).max) / 2;
		uint256 denominator = SecurityPoolUtils.BPS_DENOMINATOR * (uncertainty - protocolFee - reporterFee);
		uint256 numerator = REPORT_SECURITY_MULTIPLIER_BPS * (OPEN_ORACLE_PERCENTAGE_PRECISION + uncertainty);
		uint256 reportMaximum = Math.mulDiv(maximumReport, denominator, numerator) / DISPUTE_GAS_UNITS;
		require(settlementFeeMultiplierBps >= SecurityPoolUtils.BPS_DENOMINATOR, 'Max settlement base fee multiplier must be at least one hundred percent');
		uint256 callbackGas = 4_000_000;
		uint256 paddedGas = Math.ceilDiv((callbackGas + callbackGas / 63 + 310_000) * 12_000, 10_000) + 20_000;
		uint256 maximumAllowance = (uint256(type(uint96).max) - 101) / paddedGas;
		uint256 bountyMaximum =
			Math.mulDiv(maximumAllowance + 1, 10_000, settlementFeeMultiplierBps, Math.Rounding.Ceil) - 1;
		return Math.min(reportMaximum, bountyMaximum);
	}
}
