// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

library SecurityPoolUtils {
	// fees
	uint256 constant PRICE_PRECISION = 1e18;
	uint256 constant BPS_DENOMINATOR = 10_000;
	uint256 constant MINIMUM_SECURITY_MULTIPLIER_BPS = 10_500;

	function calculateInitialEscalationDepositAttoRep(uint256 theoreticalSupplyAttoRep) public pure returns (uint256) {
		uint256 supplyBasedDepositAttoRep = theoreticalSupplyAttoRep / 10_000_000;
		return supplyBasedDepositAttoRep < 1e18 ? 1e18 : supplyBasedDepositAttoRep;
	}

	function calculateMinimumVaultRepDepositAttoRep(uint256 theoreticalSupplyAttoRep, uint256 configuredMinimumAttoRep) public pure returns (uint256) {
		return configuredMinimumAttoRep == 0 ? theoreticalSupplyAttoRep / 100_000 : configuredMinimumAttoRep;
	}
}
