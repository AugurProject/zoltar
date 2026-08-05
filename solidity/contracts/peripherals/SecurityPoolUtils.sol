// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

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
	uint256 constant MIN_COVERAGE_COMMITMENT_ATTO_ETH = 1 ether; // 1 eth
	uint256 constant MIN_REP_DEPOSIT_ATTO_REP = 10 ether; // 10 rep

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
		uint256 settlementCollateralAttoEth,
		uint256 retentionRate,
		uint256 timeDelta,
		uint256 indexRemainder,
		uint256 feeEligibleCoverageCommitmentAttoEth,
		uint256 feesOwedRemainder
	)
		external
		pure
		returns (
			uint256 feeIndexDelta,
			uint256 nextIndexRemainder,
			uint256 creditedFeesAttoEth,
			uint256 nextFeesOwedRemainder
		)
	{
		uint256 resultingSettlementCollateralAttoEth =
			(settlementCollateralAttoEth * _rpow(retentionRate, timeDelta, PRICE_PRECISION)) / PRICE_PRECISION;
		uint256 scaledFeeDelta =
			(settlementCollateralAttoEth - resultingSettlementCollateralAttoEth) * PRICE_PRECISION + indexRemainder;
		feeIndexDelta = scaledFeeDelta / feeEligibleCoverageCommitmentAttoEth;
		nextIndexRemainder = scaledFeeDelta % feeEligibleCoverageCommitmentAttoEth;
		uint256 feesOwedDelta = feeIndexDelta * feeEligibleCoverageCommitmentAttoEth + feesOwedRemainder;
		creditedFeesAttoEth = feesOwedDelta / PRICE_PRECISION;
		nextFeesOwedRemainder = feesOwedDelta % PRICE_PRECISION;
	}

	function calculateVaultFee(
		uint256 coverageCommitmentAttoEth,
		uint256 feeIndexDelta,
		uint256 remainder
	) external pure returns (uint256 feesAttoEth, uint256 nextRemainder) {
		uint256 numerator = coverageCommitmentAttoEth * feeIndexDelta + remainder;
		return (numerator / PRICE_PRECISION, numerator % PRICE_PRECISION);
	}

	function calculateBundledLiquidationTransfer(
		uint256 targetBackingUnits,
		uint256 targetCoverageCommitmentAttoEth,
		uint256 requestedCommitmentTransferAttoEth,
		uint256 repEthPrice,
		uint256 currentPoolHeldAttoRepBalance,
		uint256 currentTotalRepBackingUnits
	)
		external
		pure
		returns (
			uint256 coverageCommitmentToTransferAttoEth,
			uint256 vaultAttoRepBackingToTransfer,
			uint256 backingUnitsToTransfer
		)
	{
		if (targetCoverageCommitmentAttoEth == 0 || requestedCommitmentTransferAttoEth == 0 || repEthPrice == 0)
			return (0, 0, 0);
		bool resolveResidualAsBadDebt = requestedCommitmentTransferAttoEth >= targetCoverageCommitmentAttoEth;
		if (!resolveResidualAsBadDebt && targetCoverageCommitmentAttoEth <= MIN_COVERAGE_COMMITMENT_ATTO_ETH)
			return (0, 0, 0);
		uint256 minimumRemainingAttoRep = resolveResidualAsBadDebt ? 0 : MIN_REP_DEPOSIT_ATTO_REP;
		uint256 reservedBackingUnits;
		if (minimumRemainingAttoRep != 0) {
			if (currentTotalRepBackingUnits == 0 || currentPoolHeldAttoRepBalance == 0) {
				reservedBackingUnits = minimumRemainingAttoRep * PRICE_PRECISION;
			} else {
				reservedBackingUnits = Math.mulDiv(
					minimumRemainingAttoRep,
					currentTotalRepBackingUnits,
					currentPoolHeldAttoRepBalance,
					Math.Rounding.Ceil
				);
			}
		}
		if (reservedBackingUnits >= targetBackingUnits) return (0, 0, 0);
		uint256 transferableBackingUnits = targetBackingUnits - reservedBackingUnits;
		uint256 transferableVaultRepBackingAttoRep =
			currentTotalRepBackingUnits == 0
				? transferableBackingUnits / PRICE_PRECISION
				: Math.mulDiv(transferableBackingUnits, currentPoolHeldAttoRepBalance, currentTotalRepBackingUnits);
		uint256 maximumFundedCoverageCommitmentAttoEth = Math.mulDiv(
			transferableVaultRepBackingAttoRep,
			PRICE_PRECISION * BPS_DENOMINATOR,
			repEthPrice * (BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS)
		);
		uint256 requestedCoverageCommitmentTransferAttoEth =
			requestedCommitmentTransferAttoEth > targetCoverageCommitmentAttoEth
				? targetCoverageCommitmentAttoEth
				: requestedCommitmentTransferAttoEth;
		uint256 remainingRequestedCoverageCommitmentAttoEth =
			targetCoverageCommitmentAttoEth - requestedCoverageCommitmentTransferAttoEth;
		if (
			!resolveResidualAsBadDebt &&
			remainingRequestedCoverageCommitmentAttoEth > 0 &&
			remainingRequestedCoverageCommitmentAttoEth < MIN_COVERAGE_COMMITMENT_ATTO_ETH
		)
			requestedCoverageCommitmentTransferAttoEth =
				targetCoverageCommitmentAttoEth - MIN_COVERAGE_COMMITMENT_ATTO_ETH;
		coverageCommitmentToTransferAttoEth =
			requestedCoverageCommitmentTransferAttoEth < maximumFundedCoverageCommitmentAttoEth
				? requestedCoverageCommitmentTransferAttoEth
				: maximumFundedCoverageCommitmentAttoEth;
		if (coverageCommitmentToTransferAttoEth == 0) return (0, 0, 0);
		backingUnitsToTransfer = _getLiquidationBackingUnitsAward(
			coverageCommitmentToTransferAttoEth,
			repEthPrice,
			currentPoolHeldAttoRepBalance,
			currentTotalRepBackingUnits
		);
		require(backingUnitsToTransfer <= transferableBackingUnits, 'Award unfunded');
		vaultAttoRepBackingToTransfer =
			currentTotalRepBackingUnits == 0
				? backingUnitsToTransfer / PRICE_PRECISION
				: Math.mulDiv(backingUnitsToTransfer, currentPoolHeldAttoRepBalance, currentTotalRepBackingUnits);
	}

	function _getLiquidationBackingUnitsAward(
		uint256 coverageCommitmentToTransferAttoEth,
		uint256 repEthPrice,
		uint256 currentPoolHeldAttoRepBalance,
		uint256 currentTotalRepBackingUnits
	) private pure returns (uint256 backingUnitsToTransfer) {
		uint256 grossRepAwardAttoRep = Math.mulDiv(
			coverageCommitmentToTransferAttoEth,
			repEthPrice * (BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS),
			PRICE_PRECISION * BPS_DENOMINATOR,
			Math.Rounding.Ceil
		);
		backingUnitsToTransfer =
			currentTotalRepBackingUnits == 0 || currentPoolHeldAttoRepBalance == 0
				? grossRepAwardAttoRep * PRICE_PRECISION
				: Math.mulDiv(
					grossRepAwardAttoRep,
					currentTotalRepBackingUnits,
					currentPoolHeldAttoRepBalance,
					Math.Rounding.Ceil
				);
	}

	/// @notice Tests vault health with pool-held vault REP backing and dispute-staked REP.
	/// @dev The migration-safety branch intentionally excludes dispute-staked REP.
	function isVaultHealthy(
		uint256 poolHeldVaultRepBackingAttoRep,
		uint256 disputeStakedAttoRep,
		uint256 coverageCommitmentAttoEth,
		uint256 repEthPrice,
		uint256 poolSecurityMultiplierBps
	) external pure returns (bool) {
		uint256 valueScale = PRICE_PRECISION * BPS_DENOMINATOR;
		if (
			(poolHeldVaultRepBackingAttoRep + disputeStakedAttoRep) * valueScale <
			coverageCommitmentAttoEth * poolSecurityMultiplierBps * repEthPrice
		) return false;
		if (coverageCommitmentAttoEth == 0) return true;
		uint256 migrationSecurityMultiplierBps = BPS_DENOMINATOR + (poolSecurityMultiplierBps - BPS_DENOMINATOR) / 2;
		uint256 liquidationReserveMultiplierBps = BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS;
		if (migrationSecurityMultiplierBps < liquidationReserveMultiplierBps)
			migrationSecurityMultiplierBps = liquidationReserveMultiplierBps;
		return
			poolHeldVaultRepBackingAttoRep * valueScale >
			coverageCommitmentAttoEth * migrationSecurityMultiplierBps * repEthPrice;
	}

	function isLiquidationBeyondMinPriceDistance(
		uint256 poolHeldVaultRepBackingAttoRep,
		uint256 disputeStakedAttoRep,
		uint256 coverageCommitmentAttoEth,
		uint256 poolSecurityMultiplierBps,
		uint256 currentPrice,
		uint256 minPriceDistanceBps
	) external pure returns (bool) {
		return
			_isLiquidationBeyondMinPriceDistance(
				poolHeldVaultRepBackingAttoRep,
				disputeStakedAttoRep,
				coverageCommitmentAttoEth,
				poolSecurityMultiplierBps,
				currentPrice,
				minPriceDistanceBps
			);
	}

	function _isLiquidationBeyondMinPriceDistance(
		uint256 poolHeldVaultRepBackingAttoRep,
		uint256 disputeStakedAttoRep,
		uint256 coverageCommitmentAttoEth,
		uint256 poolSecurityMultiplierBps,
		uint256 currentPrice,
		uint256 minPriceDistanceBps
	) internal pure returns (bool) {
		if (minPriceDistanceBps == 0) return true;
		if (coverageCommitmentAttoEth == 0 || currentPrice == 0) return false;
		uint256 valueScale = PRICE_PRECISION * BPS_DENOMINATOR;
		uint256 associatedRepThreshold =
			((poolHeldVaultRepBackingAttoRep + disputeStakedAttoRep) * valueScale) /
				(coverageCommitmentAttoEth * poolSecurityMultiplierBps);
		uint256 migrationSecurityMultiplierBps = BPS_DENOMINATOR + (poolSecurityMultiplierBps - BPS_DENOMINATOR) / 2;
		uint256 liquidationReserveMultiplierBps = BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS;
		if (migrationSecurityMultiplierBps < liquidationReserveMultiplierBps)
			migrationSecurityMultiplierBps = liquidationReserveMultiplierBps;
		uint256 migrationThreshold =
			(poolHeldVaultRepBackingAttoRep * valueScale) /
				(coverageCommitmentAttoEth * migrationSecurityMultiplierBps);
		uint256 thresholdPrice =
			associatedRepThreshold < migrationThreshold ? associatedRepThreshold : migrationThreshold;
		if (currentPrice <= thresholdPrice) return false;
		return ((currentPrice - thresholdPrice) * BPS_DENOMINATOR) / currentPrice >= minPriceDistanceBps;
	}

	// Starts at MAX_RETENTION_RATE, decreases linearly until the 80% utilization dip,
	// and then caps at MIN_RETENTION_RATE.
	function calculateRetentionRate(
		uint256 settlementCollateralAttoEth,
		uint256 coverageCommitmentAttoEth
	) external pure returns (uint256 z) {
		if (coverageCommitmentAttoEth == 0) return MAX_RETENTION_RATE;
		uint256 utilization = (settlementCollateralAttoEth * PRICE_PRECISION) / coverageCommitmentAttoEth;
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
