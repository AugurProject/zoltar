// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { OPEN_ORACLE_PERCENTAGE_PRECISION } from './OpenOraclePriceCoordinatorTypes.sol';

library OraclePriceMath {
	uint256 internal constant DISPUTE_GAS_UNITS = 300_000;
	uint256 internal constant REPORT_SECURITY_MULTIPLIER_BPS = 100_000;

	function conservativePrice(uint256 price, uint256 uncertainty) internal pure returns (uint256) {
		return
			Math.mulDiv(price, OPEN_ORACLE_PERCENTAGE_PRECISION, OPEN_ORACLE_PERCENTAGE_PRECISION - uncertainty, Math.Rounding.Ceil);
	}
	function liquidationPrice(uint256 price, uint256 uncertainty) internal pure returns (uint256) {
		return Math.mulDiv(price, OPEN_ORACLE_PERCENTAGE_PRECISION, OPEN_ORACLE_PERCENTAGE_PRECISION + uncertainty);
	}
	function maximumPriorityFee(uint256 uncertainty, uint256 protocolFee, uint256 reporterFee, uint256 haltMultiplierBps) internal pure returns (uint256) {
		require(uncertainty < OPEN_ORACLE_PERCENTAGE_PRECISION, 'Target price error must be below one hundred percent');
		require(protocolFee + reporterFee < uncertainty, 'Oracle fees must be below the target price error');
		require(haltMultiplierBps > 0, 'Escalation multiplier zero');
		uint256 maximumReport = Math.mulDiv(type(uint128).max, SecurityPoolUtils.BPS_DENOMINATOR, haltMultiplierBps);
		maximumReport = Math.min(maximumReport, type(uint128).max) / 2;
		uint256 denominator = SecurityPoolUtils.BPS_DENOMINATOR * (uncertainty - protocolFee - reporterFee);
		uint256 numerator = REPORT_SECURITY_MULTIPLIER_BPS * (OPEN_ORACLE_PERCENTAGE_PRECISION + uncertainty);
		return Math.mulDiv(maximumReport, denominator, numerator) / DISPUTE_GAS_UNITS;
	}
}
