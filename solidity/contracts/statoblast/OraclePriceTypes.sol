// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

uint256 constant PRICE_VALID_FOR_SECONDS = 5 minutes;
// Sepolia test deployments have sparse oracle activity, so their prices stay valid longer.
uint256 constant SEPOLIA_CHAIN_ID = 11155111;
uint256 constant SEPOLIA_PRICE_VALID_FOR_SECONDS = 1 hours;
uint256 constant OPEN_ORACLE_PERCENTAGE_PRECISION = 1e7;
// Settlement gas the shared feed reserves for its own OpenOracle callback.
uint256 constant FEED_SETTLEMENT_CALLBACK_GAS = 4_000_000;
// Keep these allowances aligned with the SDK bounty calculations in
// shared/statoblast/ts/initialReport/oracleInitialReport.ts and statoblast/securityPoolPrice.ts.
uint256 constant BASE_SETTLEMENT_GAS_ALLOWANCE = 310_000;
uint256 constant SETTLEMENT_GAS_BUFFER_BPS = 12_000;
uint256 constant REWARD_COLLECTION_GAS_ALLOWANCE = 20_000;
// Positive remainder added to the gas-funded public settlement reward.
uint256 constant REQUEST_BOUNTY_OFFSET_ATTO_ETH = 101;
uint8 constant OPEN_ORACLE_FLAG_TIME_TYPE = 1 << 0;
uint8 constant OPEN_ORACLE_FLAG_TRACK_DISPUTES = 1 << 1;
uint8 constant OPEN_ORACLE_FLAG_STORE_ALL = 1 << 2;

interface IStoredOpenOracleGame {
	function storedGame(uint256 reportId)
		external
		view
		returns (
			uint128 currentAmount1,
			uint128 currentAmount2,
			address currentReporter,
			uint48 reportTimestamp,
			uint48 settlementTimestamp
		);
}

/// @dev Gas units a public settlement reward pays for: the callback, its EIP-150 slack,
/// the base settlement allowance with a buffer, and collecting the reward.
function settlementGasUnits(uint256 callbackGas) pure returns (uint256) {
	return
		Math.ceilDiv((callbackGas + callbackGas / 63 + BASE_SETTLEMENT_GAS_ALLOWANCE) * SETTLEMENT_GAS_BUFFER_BPS, 10_000) +
		REWARD_COLLECTION_GAS_ALLOWANCE;
}

/// @dev Sponsor-funded incentive for independent settlement at `feeAllowance` atto-ETH per gas.
function settlementBountyAttoEth(uint256 callbackGas, uint256 feeAllowance) pure returns (uint256) {
	return settlementGasUnits(callbackGas) * feeAllowance + REQUEST_BOUNTY_OFFSET_ATTO_ETH;
}
