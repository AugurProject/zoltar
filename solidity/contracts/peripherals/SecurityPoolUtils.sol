// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

library SecurityPoolUtils {
	uint256 constant MIGRATION_TIME = 8 weeks;
	uint256 constant AUCTION_TIME = 1 weeks;

	// fees
	uint256 constant PRICE_PRECISION = 1e18;
	uint256 constant BPS_DENOMINATOR = 10_000;
	uint256 constant LIQUIDATION_REP_BONUS_BPS = 500;

	uint256 constant MAX_RETENTION_RATE = 999_999_996_848_000_000; // ≈90% yearly (10% fees)
	uint256 constant MIN_RETENTION_RATE = 999_999_977_880_000_000; // ≈50% yearly (50% fees)
	uint256 constant RETENTION_RATE_DIP = (80 * PRICE_PRECISION) / 100; // 80% utilization

	// smallest vaults
	uint256 constant MIN_SECURITY_BOND_DEBT = 1 ether; // 1 eth
	uint256 constant MIN_REP_DEPOSIT = 10 ether; // 10 rep

	function _rpow(uint256 x, uint256 n, uint256 baseUnit) private pure returns (uint256 z) {
		z = n % 2 != 0 ? x : baseUnit;
		for (n /= 2; n != 0; n /= 2) {
			x = (x * x) / baseUnit;
			if (n % 2 != 0) {
				z = (z * x) / baseUnit;
			}
		}
	}

	function calculateFeeAccrual(
		uint256 collateral,
		uint256 retentionRate,
		uint256 timeDelta,
		uint256 indexRemainder,
		uint256 eligibleAllowance,
		uint256 feesOwedRemainder
	)
		external
		pure
		returns (uint256 feeIndexDelta, uint256 nextIndexRemainder, uint256 creditedFees, uint256 nextFeesOwedRemainder)
	{
		uint256 nextCollateral = (collateral * _rpow(retentionRate, timeDelta, PRICE_PRECISION)) / PRICE_PRECISION;
		uint256 scaledFeeDelta = (collateral - nextCollateral) * PRICE_PRECISION + indexRemainder;
		feeIndexDelta = scaledFeeDelta / eligibleAllowance;
		nextIndexRemainder = scaledFeeDelta % eligibleAllowance;
		uint256 feesOwedDelta = feeIndexDelta * eligibleAllowance + feesOwedRemainder;
		creditedFees = feesOwedDelta / PRICE_PRECISION;
		nextFeesOwedRemainder = feesOwedDelta % PRICE_PRECISION;
	}

	function calculateVaultFee(
		uint256 allowance,
		uint256 feeIndexDelta,
		uint256 remainder
	) external pure returns (uint256 fees, uint256 nextRemainder) {
		uint256 numerator = allowance * feeIndexDelta + remainder;
		return (numerator / PRICE_PRECISION, numerator % PRICE_PRECISION);
	}

	function calculateBundledLiquidationTransfer(
		uint256 targetOwnership,
		uint256 targetAllowance,
		uint256 requestedDebt,
		uint256 repEthPrice,
		uint256 currentTotalRep,
		uint256 currentDenominator
	) external pure returns (uint256 debtToMove, uint256 repToMove, uint256 ownershipToMove) {
		if (targetAllowance == 0 || targetOwnership == 0) return (0, 0, 0);
		debtToMove = requestedDebt > targetAllowance ? targetAllowance : requestedDebt;
		uint256 debtRemaining = targetAllowance - debtToMove;
		if (debtRemaining > 0 && debtRemaining < MIN_SECURITY_BOND_DEBT) debtToMove = targetAllowance;
		if (debtToMove == targetAllowance) {
			ownershipToMove = targetOwnership;
		} else {
			uint256 repNumerator = debtToMove * repEthPrice * (BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS);
			uint256 repDenominator = PRICE_PRECISION * BPS_DENOMINATOR;
			repToMove = repNumerator / repDenominator;
			if (repToMove * repDenominator < repNumerator) repToMove += 1;
			ownershipToMove =
				currentDenominator == 0 || currentTotalRep == 0
					? repToMove * PRICE_PRECISION
					: (repToMove * currentDenominator) / currentTotalRep;
			if (ownershipToMove >= targetOwnership) {
				debtToMove = targetAllowance;
				ownershipToMove = targetOwnership;
			}
		}
		uint256 remainingOwnership = targetOwnership - ownershipToMove;
		uint256 remainingRep =
			currentDenominator == 0
				? remainingOwnership / PRICE_PRECISION
				: (remainingOwnership * currentTotalRep) / currentDenominator;
		if (debtToMove < targetAllowance && remainingRep < MIN_REP_DEPOSIT) {
			debtToMove = targetAllowance;
			ownershipToMove = targetOwnership;
		}
		repToMove =
			currentDenominator == 0
				? ownershipToMove / PRICE_PRECISION
				: (ownershipToMove * currentTotalRep) / currentDenominator;
	}

	function isVaultHealthy(
		uint256 freeRep,
		uint256 escalationRep,
		uint256 securityBondAllowance,
		uint256 repEthPrice,
		uint256 poolSecurityMultiplierBps
	) external pure returns (bool) {
		uint256 valueScale = PRICE_PRECISION * BPS_DENOMINATOR;
		if ((freeRep + escalationRep) * valueScale < securityBondAllowance * poolSecurityMultiplierBps * repEthPrice)
			return false;
		if (securityBondAllowance == 0) return true;
		uint256 migrationSecurityMultiplierBps = BPS_DENOMINATOR + (poolSecurityMultiplierBps - BPS_DENOMINATOR) / 2;
		return freeRep * valueScale > securityBondAllowance * migrationSecurityMultiplierBps * repEthPrice;
	}

	function isLiquidationBeyondMinPriceDistance(
		uint256 freeRep,
		uint256 escalationRep,
		uint256 securityBondAllowance,
		uint256 poolSecurityMultiplierBps,
		uint256 currentPrice,
		uint256 minPriceDistanceBps
	) external pure returns (bool) {
		return
			_isLiquidationBeyondMinPriceDistance(
				freeRep,
				escalationRep,
				securityBondAllowance,
				poolSecurityMultiplierBps,
				currentPrice,
				minPriceDistanceBps
			);
	}

	function _isLiquidationBeyondMinPriceDistance(
		uint256 freeRep,
		uint256 escalationRep,
		uint256 securityBondAllowance,
		uint256 poolSecurityMultiplierBps,
		uint256 currentPrice,
		uint256 minPriceDistanceBps
	) internal pure returns (bool) {
		if (minPriceDistanceBps == 0) return true;
		if (securityBondAllowance == 0 || currentPrice == 0) return false;
		uint256 valueScale = PRICE_PRECISION * BPS_DENOMINATOR;
		uint256 associatedRepThreshold =
			((freeRep + escalationRep) * valueScale) / (securityBondAllowance * poolSecurityMultiplierBps);
		uint256 migrationSecurityMultiplierBps = BPS_DENOMINATOR + (poolSecurityMultiplierBps - BPS_DENOMINATOR) / 2;
		uint256 migrationThreshold = (freeRep * valueScale) / (securityBondAllowance * migrationSecurityMultiplierBps);
		uint256 thresholdPrice =
			associatedRepThreshold < migrationThreshold ? associatedRepThreshold : migrationThreshold;
		if (currentPrice <= thresholdPrice) return false;
		return ((currentPrice - thresholdPrice) * BPS_DENOMINATOR) / currentPrice >= minPriceDistanceBps;
	}

	// Starts at MAX_RETENTION_RATE, decreases linearly until the 80% utilization dip,
	// and then caps at MIN_RETENTION_RATE.
	function calculateRetentionRate(
		uint256 completeSetCollateralAmount,
		uint256 securityBondAllowance
	) external pure returns (uint256 z) {
		if (securityBondAllowance == 0) return MAX_RETENTION_RATE;
		uint256 utilization = (completeSetCollateralAmount * PRICE_PRECISION) / securityBondAllowance;
		if (utilization <= RETENTION_RATE_DIP) {
			uint256 utilizationRatio = (utilization * PRICE_PRECISION) / RETENTION_RATE_DIP;
			uint256 slopeSpan = MAX_RETENTION_RATE - MIN_RETENTION_RATE;
			return MAX_RETENTION_RATE - (slopeSpan * utilizationRatio) / PRICE_PRECISION;
		}
		return MIN_RETENTION_RATE;
	}

	// auction
	uint256 constant MAX_AUCTION_VAULT_HAIRCUT_DIVISOR = 1_000_000;
}
