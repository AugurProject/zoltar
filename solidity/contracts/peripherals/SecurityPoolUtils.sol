// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.30;

library SecurityPoolUtils {
	uint256 constant MIGRATION_TIME = 8 weeks;
	uint256 constant AUCTION_TIME = 1 weeks;

	// fees
	uint256 constant PRICE_PRECISION = 1e18;

	uint256 constant MAX_RETENTION_RATE = 999_999_996_848_000_000; // ≈90% yearly
	uint256 constant MIN_RETENTION_RATE = 999_999_977_880_000_000; // ≈50% yearly
	uint256 constant RETENTION_RATE_DIP = 80; // 80% utilization

	// smallest vaults
	uint256 constant MIN_SECURITY_BOND_DEBT = 1 ether; // 1 eth
	uint256 constant MIN_REP_DEPOSIT = 10 ether; // 10 rep

	function rpow(uint256 x, uint256 n, uint256 baseUnit) external pure returns (uint256 z) {
		z = n % 2 != 0 ? x : baseUnit;
		for (n /= 2; n != 0; n /= 2) {
			x = (x * x) / baseUnit;
			if (n % 2 != 0) {
				z = (z * x) / baseUnit;
			}
		}
	}
}
