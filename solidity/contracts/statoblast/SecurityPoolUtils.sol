// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { ISecurityPool, SystemState } from './interfaces/ISecurityPool.sol';
import { ISecurityPoolForker } from './interfaces/ISecurityPoolForker.sol';
import { IUniformPriceDualCapBatchAuction } from './interfaces/IUniformPriceDualCapBatchAuction.sol';

import { SecurityPoolForkerForkData } from './SecurityPoolForkerTypes.sol';

library SecurityPoolUtils {
	event VaultBadDebtMigrated(ISecurityPool indexed parentPool, ISecurityPool indexed childPool, address indexed vault, uint256 migratedBadDebtAttoEth, uint256 resultingParentTotalBadDebtAttoEth, uint256 resultingChildTotalBadDebtAttoEth);
	uint256 constant MIGRATION_TIME = 8 weeks;
	uint256 constant AUCTION_TIME = 1 weeks;

	// fees
	uint256 constant PRICE_PRECISION = 1e18;
	uint256 constant BPS_DENOMINATOR = 10_000;
	uint256 constant LIQUIDATION_REP_BONUS_BPS = 500;

	uint256 constant MAX_RETENTION_RATE = 999_999_996_848_000_000; // ≈90% yearly (10% fees)
	uint256 constant MIN_RETENTION_RATE = 999_999_977_880_000_000; // ≈50% yearly (50% fees)
	uint256 constant RETENTION_RATE_DIP = (80 * PRICE_PRECISION) / 100; // 80% utilization

	function calculateInitialEscalationDepositAttoRep(uint256 theoreticalSupplyAttoRep) public pure returns (uint256) {
		uint256 supplyBasedDepositAttoRep = theoreticalSupplyAttoRep / 10_000_000;
		return supplyBasedDepositAttoRep < 1e18 ? 1e18 : supplyBasedDepositAttoRep;
	}

	function calculateMinimumVaultRepDepositAttoRep(uint256 theoreticalSupplyAttoRep, uint256 configuredMinimumAttoRep) public pure returns (uint256) {
		return configuredMinimumAttoRep == 0 ? theoreticalSupplyAttoRep / 100_000 : configuredMinimumAttoRep;
	}

	function configureForkMigratedVault(ISecurityPool parent, ISecurityPool child, address vault, uint256 childRepBackingUnits, uint256 childUnderwritingLimitAttoEth, uint256 childFeeIndex, uint256 parentFeeIndex)
		external
		returns (
			uint256 migratedBadDebtAttoEth,
			uint256 resultingParentTotalBadDebtAttoEth,
			uint256 resultingChildTotalBadDebtAttoEth
		)
	{
		migratedBadDebtAttoEth = parent.vaultBadDebtAttoEth(vault);
		resultingParentTotalBadDebtAttoEth = parent.totalBadDebtAttoEth() - migratedBadDebtAttoEth;
		resultingChildTotalBadDebtAttoEth = child.totalBadDebtAttoEth() + migratedBadDebtAttoEth;
		child.configureVault(vault, childRepBackingUnits, childUnderwritingLimitAttoEth, childFeeIndex, child.vaultBadDebtAttoEth(vault) + migratedBadDebtAttoEth, resultingChildTotalBadDebtAttoEth);
		parent.configureVault(vault, 0, 0, parentFeeIndex, 0, resultingParentTotalBadDebtAttoEth);
		emit VaultBadDebtMigrated(parent, child, vault, migratedBadDebtAttoEth, resultingParentTotalBadDebtAttoEth, resultingChildTotalBadDebtAttoEth);
	}

	function consumeUnassignedCommitment(ISecurityPool securityPool, SecurityPoolForkerForkData storage data, uint256 maximumCommitmentAttoEth) external returns (uint256 commitment, uint256 units) {
		require(securityPool.systemState() == SystemState.Operational, 'Pool inactive');
		commitment = data.auctionedUnderwritingLimitAttoEth - data.claimedAuctionedUnderwritingLimitAttoEth;
		require(commitment != 0, 'No commitment');
		require(commitment <= maximumCommitmentAttoEth, 'Commitment exceeds authorization');
		require(data.truthAuction.totalAttoRepPurchased() == 0, 'Auction claims reserved');
		units = data.unassignedRepBackingUnitsAtFinalization - data.claimedAuctionRepBackingUnits;
		data.claimedAuctionedUnderwritingLimitAttoEth += commitment;
		data.claimedAuctionRepBackingUnits += units;
	}

	function creditForkAuctionVault(ISecurityPool securityPool, address vault, uint256 auctionRepBackingUnits, uint256 newUnderwritingLimitAttoEth, uint256 badDebtToAssignAttoEth, uint256 auctionBadDebtGeneration, uint256 auctionFeeIndexAtFinalization) external returns (uint256 resultingTotalRepBackingUnits) {
		securityPool.updateVaultFees(vault);
		(
			uint256 currentVaultRepBackingUnits,
			uint256 currentUnderwritingLimitAttoEth,
			,
			uint256 currentFeeIndex
		) = securityPool.securityVaults(vault);
		uint256 currentBadDebtToAssignAttoEth =
			auctionBadDebtGeneration == securityPool.getPoolAccountingSnapshot().badDebtGeneration
				? badDebtToAssignAttoEth
				: 0;
		securityPool.configureFinalizedAuctionVault(vault, currentVaultRepBackingUnits + auctionRepBackingUnits, currentUnderwritingLimitAttoEth + newUnderwritingLimitAttoEth, currentFeeIndex, securityPool.vaultBadDebtAttoEth(vault) + currentBadDebtToAssignAttoEth, securityPool.totalBadDebtAttoEth());
		securityPool.assignFinalizedAuctionFees(vault, newUnderwritingLimitAttoEth, auctionFeeIndexAtFinalization);
		return securityPool.totalRepBackingUnits();
	}

	function _rpow(uint256 x, uint256 n, uint256 baseUnit) private pure returns (uint256 z) {
		z = n % 2 != 0 ? x : baseUnit;
		for (n /= 2; n != 0; n /= 2) {
			x = (x * x) / baseUnit;
			if (n % 2 != 0) {
				z = (z * x) / baseUnit;
			}
		}
	}

	function calculateFeeAccrual(uint256 settlementCollateralAttoEth, uint256 retentionRate, uint256 timeDelta, uint256 indexRemainder, uint256 feeEligibleUnderwritingLimitAttoEth, uint256 feesOwedRemainder)
		external
		pure
		returns (
			uint256 feeIndexDelta,
			uint256 nextIndexRemainder,
			uint256 creditedFeesAttoEth,
			uint256 nextFeesOwedRemainder
		)
	{
		// Both carries hold decay that was already counted but not yet credited, and settlement
		// collateral still retains it. Decaying it again would let dust collateral credit more than it holds.
		uint256 pendingDecayAttoEth = (indexRemainder + feesOwedRemainder) / PRICE_PRECISION;
		uint256 decayingCollateralAttoEth =
			settlementCollateralAttoEth > pendingDecayAttoEth ? settlementCollateralAttoEth - pendingDecayAttoEth : 0;
		uint256 resultingCollateralAttoEth =
			(decayingCollateralAttoEth * _rpow(retentionRate, timeDelta, PRICE_PRECISION)) / PRICE_PRECISION;
		uint256 scaledFeeDelta =
			(decayingCollateralAttoEth - resultingCollateralAttoEth) * PRICE_PRECISION + indexRemainder;
		feeIndexDelta = scaledFeeDelta / feeEligibleUnderwritingLimitAttoEth;
		nextIndexRemainder = scaledFeeDelta % feeEligibleUnderwritingLimitAttoEth;
		uint256 feesOwedDelta = feeIndexDelta * feeEligibleUnderwritingLimitAttoEth + feesOwedRemainder;
		creditedFeesAttoEth = feesOwedDelta / PRICE_PRECISION;
		nextFeesOwedRemainder = feesOwedDelta % PRICE_PRECISION;
	}

	function calculateVaultFee(uint256 underwritingLimitAttoEth, uint256 feeIndexDelta, uint256 remainder) external pure returns (uint256 feesAttoEth, uint256 nextRemainder) {
		uint256 numerator = underwritingLimitAttoEth * feeIndexDelta + remainder;
		return (numerator / PRICE_PRECISION, numerator % PRICE_PRECISION);
	}

	function getUnassignedPositionFeeAccounting(address securityPoolAddress) external view returns (uint256 feeIndexAtFinalization, uint256 claimableFeesAttoEth) {
		ISecurityPool securityPool = ISecurityPool(payable(securityPoolAddress));
		ISecurityPoolForker forker = ISecurityPoolForker(securityPool.securityPoolForker());
		(, uint256 underwritingLimitAttoEth, , , uint256 unassignedFeeIndexAtFinalization) = forker.getUnassignedPosition(securityPool);
		feeIndexAtFinalization = unassignedFeeIndexAtFinalization;
		address truthAuction = securityPool.truthAuction();
		if (truthAuction == address(0) || IUniformPriceDualCapBatchAuction(truthAuction).totalAttoRepPurchased() == 0)
			return (feeIndexAtFinalization, 0);
		claimableFeesAttoEth = Math.mulDiv(underwritingLimitAttoEth, securityPool.feeIndex() - feeIndexAtFinalization, PRICE_PRECISION);
	}

	function getBadDebtGeneration(ISecurityPool securityPool) external view returns (uint256) {
		return securityPool.getPoolAccountingSnapshot().badDebtGeneration;
	}

	function calculateVaultOpenInterestAttoEth(uint256 activeOpenInterestAttoEth, uint256 vaultUnderwritingLimitAttoEth, uint256 totalUnderwritingLimitAttoEth) external pure returns (uint256) {
		if (totalUnderwritingLimitAttoEth == 0 || vaultUnderwritingLimitAttoEth == 0) return 0;
		return
			Math.mulDiv(activeOpenInterestAttoEth, vaultUnderwritingLimitAttoEth, totalUnderwritingLimitAttoEth, Math.Rounding.Ceil);
	}

	function calculateBundledLiquidationTransfer(uint256 targetBackingUnits, uint256 targetUnderwritingLimitAttoEth, uint256 targetOpenInterestAttoEth, uint256 requestedDebtAttoEth, uint256 repEthPrice, uint256 currentPoolHeldAttoRepBalance, uint256 currentTotalRepBackingUnits, uint256 minimumRemainingAttoRep)
		external
		pure
		returns (
			uint256 debtToMoveAttoEth,
			uint256 underwritingLimitToMoveAttoEth,
			uint256 vaultAttoRepBackingToTransfer,
			uint256 backingUnitsToTransfer
		)
	{
		if (
			targetUnderwritingLimitAttoEth == 0 ||
			targetOpenInterestAttoEth == 0 ||
			requestedDebtAttoEth == 0 ||
			repEthPrice == 0
		) return (0, 0, 0, 0);
		require(targetOpenInterestAttoEth == targetUnderwritingLimitAttoEth, 'Liquidation uses commitment exposure');
		debtToMoveAttoEth = Math.min(requestedDebtAttoEth, targetUnderwritingLimitAttoEth);
		underwritingLimitToMoveAttoEth = debtToMoveAttoEth;
		uint256 reservedBackingUnits;
		if (minimumRemainingAttoRep != 0 && debtToMoveAttoEth < targetUnderwritingLimitAttoEth) {
			reservedBackingUnits =
				currentPoolHeldAttoRepBalance == 0 || currentTotalRepBackingUnits == 0
					? targetBackingUnits
					: Math.mulDiv(minimumRemainingAttoRep, currentTotalRepBackingUnits, currentPoolHeldAttoRepBalance, Math.Rounding.Ceil);
		}
		uint256 transferableBackingUnits =
			targetBackingUnits > reservedBackingUnits ? targetBackingUnits - reservedBackingUnits : 0;
		backingUnitsToTransfer = Math.min(transferableBackingUnits, calculateLiquidationBackingUnitsAward(debtToMoveAttoEth, repEthPrice, currentPoolHeldAttoRepBalance, currentTotalRepBackingUnits));
		vaultAttoRepBackingToTransfer =
			currentTotalRepBackingUnits == 0
				? 0
				: Math.mulDiv(backingUnitsToTransfer, currentPoolHeldAttoRepBalance, currentTotalRepBackingUnits);
	}

	function calculateLiquidationBackingUnitsAward(uint256 debtToMoveAttoEth, uint256 repEthPrice, uint256 currentPoolHeldAttoRepBalance, uint256 currentTotalRepBackingUnits) public pure returns (uint256 backingUnitsToTransfer) {
		uint256 grossRepAwardAttoRep = Math.mulDiv(debtToMoveAttoEth, repEthPrice * (BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS), PRICE_PRECISION * BPS_DENOMINATOR, Math.Rounding.Ceil);
		backingUnitsToTransfer =
			currentTotalRepBackingUnits == 0 || currentPoolHeldAttoRepBalance == 0
				? Math.mulDiv(grossRepAwardAttoRep, PRICE_PRECISION, 1)
				: Math.mulDiv(grossRepAwardAttoRep, currentTotalRepBackingUnits, currentPoolHeldAttoRepBalance, Math.Rounding.Ceil);
	}

	/// @notice Tests vault health with pool-held vault REP backing and dispute-staked REP.
	/// @dev The migration-safety branch intentionally excludes dispute-staked REP.
	function isVaultHealthy(uint256 poolHeldVaultRepBackingAttoRep, uint256 disputeStakedAttoRep, uint256 openInterestAttoEth, uint256 repEthPrice, uint256 poolSecurityMultiplierBps) external pure returns (bool) {
		return
			isVaultHealthyAtFactor(poolHeldVaultRepBackingAttoRep, disputeStakedAttoRep, openInterestAttoEth, repEthPrice, poolSecurityMultiplierBps, BPS_DENOMINATOR);
	}

	function isVaultHealthyAtFactor(uint256 poolHeldVaultRepBackingAttoRep, uint256 disputeStakedAttoRep, uint256 openInterestAttoEth, uint256 repEthPrice, uint256 poolSecurityMultiplierBps, uint256 healthFactorBps) public pure returns (bool) {
		if (healthFactorBps < BPS_DENOMINATOR) return false;
		if (openInterestAttoEth == 0) return true;
		uint256 baseRequiredRepAttoRep = Math.mulDiv(openInterestAttoEth, repEthPrice, PRICE_PRECISION, Math.Rounding.Ceil);
		uint256 associatedRequiredRepAttoRep = Math.mulDiv(baseRequiredRepAttoRep, poolSecurityMultiplierBps, BPS_DENOMINATOR, Math.Rounding.Ceil);
		associatedRequiredRepAttoRep = Math.mulDiv(associatedRequiredRepAttoRep, healthFactorBps, BPS_DENOMINATOR, Math.Rounding.Ceil);
		if (poolHeldVaultRepBackingAttoRep + disputeStakedAttoRep < associatedRequiredRepAttoRep) return false;
		uint256 migrationSecurityMultiplierBps = BPS_DENOMINATOR + (poolSecurityMultiplierBps - BPS_DENOMINATOR) / 2;
		uint256 liquidationReserveMultiplierBps = BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS;
		if (migrationSecurityMultiplierBps < liquidationReserveMultiplierBps)
			migrationSecurityMultiplierBps = liquidationReserveMultiplierBps;
		uint256 freeRequiredRepAttoRep = Math.mulDiv(baseRequiredRepAttoRep, migrationSecurityMultiplierBps, BPS_DENOMINATOR, Math.Rounding.Ceil);
		freeRequiredRepAttoRep = Math.mulDiv(freeRequiredRepAttoRep, healthFactorBps, BPS_DENOMINATOR, Math.Rounding.Ceil);
		return poolHeldVaultRepBackingAttoRep >= freeRequiredRepAttoRep;
	}

	function _isLiquidationBeyondMinPriceDistance(uint256 poolHeldVaultRepBackingAttoRep, uint256 disputeStakedAttoRep, uint256 openInterestAttoEth, uint256 poolSecurityMultiplierBps, uint256 currentPrice, uint256 minPriceDistanceBps) internal pure returns (bool) {
		if (minPriceDistanceBps == 0) return true;
		if (openInterestAttoEth == 0 || currentPrice == 0) return false;
		uint256 valueScale = PRICE_PRECISION * BPS_DENOMINATOR;
		uint256 associatedRepThreshold =
			((poolHeldVaultRepBackingAttoRep + disputeStakedAttoRep) * valueScale) /
				(openInterestAttoEth * poolSecurityMultiplierBps);
		uint256 migrationSecurityMultiplierBps = BPS_DENOMINATOR + (poolSecurityMultiplierBps - BPS_DENOMINATOR) / 2;
		uint256 liquidationReserveMultiplierBps = BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS;
		if (migrationSecurityMultiplierBps < liquidationReserveMultiplierBps)
			migrationSecurityMultiplierBps = liquidationReserveMultiplierBps;
		uint256 migrationThreshold =
			(poolHeldVaultRepBackingAttoRep * valueScale) / (openInterestAttoEth * migrationSecurityMultiplierBps);
		uint256 thresholdPrice =
			associatedRepThreshold < migrationThreshold ? associatedRepThreshold : migrationThreshold;
		if (currentPrice <= thresholdPrice) return false;
		return ((currentPrice - thresholdPrice) * BPS_DENOMINATOR) / currentPrice >= minPriceDistanceBps;
	}

	// Starts at MAX_RETENTION_RATE, decreases linearly until the 80% utilization dip,
	// and then caps at MIN_RETENTION_RATE.
	function calculateRetentionRate(uint256 settlementCollateralAttoEth, uint256 mintingCapacityAttoEth) external pure returns (uint256 z) {
		if (mintingCapacityAttoEth == 0) return MAX_RETENTION_RATE;
		uint256 utilization = (settlementCollateralAttoEth * PRICE_PRECISION) / mintingCapacityAttoEth;
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
