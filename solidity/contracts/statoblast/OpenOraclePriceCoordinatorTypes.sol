// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

uint256 constant PRICE_VALID_FOR_SECONDS = 5 minutes;
// Sepolia test deployments have sparse oracle activity, so their prices stay valid longer.
uint256 constant SEPOLIA_CHAIN_ID = 11155111;
uint256 constant SEPOLIA_PRICE_VALID_FOR_SECONDS = 1 hours;
uint256 constant OPEN_ORACLE_PERCENTAGE_PRECISION = 1e7;
// Minimum positive public bounty; sponsors and settlers pay their own transaction gas.
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
