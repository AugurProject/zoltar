// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { ISecurityPoolForker } from './interfaces/ISecurityPoolForker.sol';
import { IUniformPriceDualCapBatchAuction } from './interfaces/IUniformPriceDualCapBatchAuction.sol';

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

	function configureForkMigratedVault(ISecurityPool parent, ISecurityPool child, address vault, uint256 childRepBackingUnits, uint256 childCapacityOwnershipAttoRep, uint256 childFeeIndex, uint256 parentFeeIndex)
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
		uint256 lastDepositTargetHealthFactorBps = parent.lastDepositTargetHealthFactorBpsByVault(vault);
		if (lastDepositTargetHealthFactorBps == 0)
			lastDepositTargetHealthFactorBps = child.lastDepositTargetHealthFactorBpsByVault(vault);
		child.configureVault(vault, childRepBackingUnits, childCapacityOwnershipAttoRep, childFeeIndex, lastDepositTargetHealthFactorBps, child.vaultBadDebtAttoEth(vault) + migratedBadDebtAttoEth, resultingChildTotalBadDebtAttoEth);
		parent.configureVault(vault, 0, 0, parentFeeIndex, 0, 0, resultingParentTotalBadDebtAttoEth);
		emit VaultBadDebtMigrated(parent, child, vault, migratedBadDebtAttoEth, resultingParentTotalBadDebtAttoEth, resultingChildTotalBadDebtAttoEth);
	}

	function creditForkAuctionVault(ISecurityPool securityPool, address vault, uint256 auctionRepBackingUnits, uint256 newCapacityOwnershipAttoRep, uint256 badDebtToAssignAttoEth, uint256 auctionFeeIndexAtFinalization) external returns (uint256 resultingTotalRepBackingUnits) {
		securityPool.updateVaultFees(vault);
		(
			uint256 currentVaultRepBackingUnits,
			uint256 currentCapacityOwnershipAttoRep,
			,
			uint256 currentFeeIndex
		) = securityPool.securityVaults(vault);
		uint256 lastDepositTargetHealthFactorBps = securityPool.lastDepositTargetHealthFactorBpsByVault(vault);
		securityPool.configureFinalizedAuctionVault(vault, currentVaultRepBackingUnits + auctionRepBackingUnits, currentCapacityOwnershipAttoRep + newCapacityOwnershipAttoRep, currentFeeIndex, lastDepositTargetHealthFactorBps, securityPool.vaultBadDebtAttoEth(vault) + badDebtToAssignAttoEth, securityPool.totalBadDebtAttoEth());
		securityPool.assignFinalizedAuctionFees(vault, newCapacityOwnershipAttoRep, auctionFeeIndexAtFinalization);
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

	function calculateFeeAccrual(uint256 settlementCollateralAttoEth, uint256 retentionRate, uint256 timeDelta, uint256 indexRemainder, uint256 feeEligibleCapacityOwnershipAttoRep, uint256 feesOwedRemainder)
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
		feeIndexDelta = scaledFeeDelta / feeEligibleCapacityOwnershipAttoRep;
		nextIndexRemainder = scaledFeeDelta % feeEligibleCapacityOwnershipAttoRep;
		uint256 feesOwedDelta = feeIndexDelta * feeEligibleCapacityOwnershipAttoRep + feesOwedRemainder;
		creditedFeesAttoEth = feesOwedDelta / PRICE_PRECISION;
		nextFeesOwedRemainder = feesOwedDelta % PRICE_PRECISION;
	}

	function calculateVaultFee(uint256 capacityOwnershipAttoRep, uint256 feeIndexDelta, uint256 remainder) external pure returns (uint256 feesAttoEth, uint256 nextRemainder) {
		uint256 numerator = capacityOwnershipAttoRep * feeIndexDelta + remainder;
		return (numerator / PRICE_PRECISION, numerator % PRICE_PRECISION);
	}

	function getUnassignedPositionFeeAccounting(address securityPoolAddress) external view returns (uint256 feeIndexAtFinalization, uint256 claimableFeesAttoEth) {
		ISecurityPool securityPool = ISecurityPool(payable(securityPoolAddress));
		ISecurityPoolForker forker = ISecurityPoolForker(securityPool.securityPoolForker());
		feeIndexAtFinalization = forker.getUnassignedPositionFeeIndex(securityPool);
		address truthAuction = securityPool.truthAuction();
		if (truthAuction == address(0) || IUniformPriceDualCapBatchAuction(truthAuction).totalAttoRepPurchased() == 0)
			return (feeIndexAtFinalization, 0);
		(, uint256 capacityOwnershipAttoRep, ) = forker.getUnassignedPosition(securityPool);
		claimableFeesAttoEth = Math.mulDiv(capacityOwnershipAttoRep, securityPool.feeIndex() - feeIndexAtFinalization, PRICE_PRECISION);
	}

	function calculateMintingCapacityAttoEth(uint256 capacityOwnershipAttoRep, uint256 repEthPrice, uint256 securityMultiplierBps) external pure returns (uint256) {
		if (repEthPrice == 0 || capacityOwnershipAttoRep == 0) return 0;
		uint256 capacityValueAttoEth = Math.mulDiv(capacityOwnershipAttoRep, PRICE_PRECISION, repEthPrice);
		return Math.mulDiv(capacityValueAttoEth, BPS_DENOMINATOR, securityMultiplierBps);
	}

	function calculateVaultOpenInterestAttoEth(uint256 activeOpenInterestAttoEth, uint256 vaultCapacityOwnershipAttoRep, uint256 totalCapacityOwnershipAttoRep) external pure returns (uint256) {
		if (totalCapacityOwnershipAttoRep == 0 || vaultCapacityOwnershipAttoRep == 0) return 0;
		return
			Math.mulDiv(activeOpenInterestAttoEth, vaultCapacityOwnershipAttoRep, totalCapacityOwnershipAttoRep, Math.Rounding.Ceil);
	}

	function calculateUnassignedPositionHealth(ISecurityPool securityPool, uint256 settlementCollateralAttoEth, uint256 repBackingUnits, uint256 capacityOwnershipAttoRep, uint256 badDebtAttoEth) private view returns (uint256 openInterestAttoEth, bool healthy) {
		if (capacityOwnershipAttoRep == 0) return (0, true);
		uint256 grossOpenInterestAttoEth = Math.mulDiv(settlementCollateralAttoEth, capacityOwnershipAttoRep, securityPool.totalCapacityOwnershipAttoRep(), Math.Rounding.Ceil);
		openInterestAttoEth = grossOpenInterestAttoEth > badDebtAttoEth ? grossOpenInterestAttoEth - badDebtAttoEth : 0;
		healthy = isVaultHealthyAtFactor(securityPool.backingUnitsToAttoRep(repBackingUnits), 0, openInterestAttoEth, securityPool.priceOracleManagerAndOperatorQueuer().lastPrice(), securityPool.statoblastSecurityMultiplierBps(), BPS_DENOMINATOR);
	}

	function _isUnassignedPositionHealthy(ISecurityPool securityPool, address securityPoolForker, uint256 settlementCollateralAttoEth) private view returns (bool) {
		uint256 repBackingUnits;
		uint256 capacityOwnershipAttoRep;
		uint256 badDebtAttoEth;
		(repBackingUnits, capacityOwnershipAttoRep, badDebtAttoEth) = ISecurityPoolForker(securityPoolForker).getUnassignedPosition(securityPool);
		(, bool healthy) = calculateUnassignedPositionHealth(securityPool, settlementCollateralAttoEth, repBackingUnits, capacityOwnershipAttoRep, badDebtAttoEth);
		return healthy;
	}

	function requireUnassignedPositionHealthy(ISecurityPool securityPool, address securityPoolForker, uint256 settlementCollateralAttoEth) external view {
		require(_isUnassignedPositionHealthy(securityPool, securityPoolForker, settlementCollateralAttoEth), 'Unassigned position unhealthy');
	}

	function calculateBundledLiquidationTransfer(uint256 targetBackingUnits, uint256 targetCapacityOwnershipAttoRep, uint256 targetOpenInterestAttoEth, uint256 requestedDebtAttoEth, uint256 repEthPrice, uint256 currentPoolHeldAttoRepBalance, uint256 currentTotalRepBackingUnits, uint256 minimumRemainingAttoRep)
		external
		pure
		returns (
			uint256 debtToMoveAttoEth,
			uint256 capacityOwnershipToMoveAttoRep,
			uint256 vaultAttoRepBackingToTransfer,
			uint256 backingUnitsToTransfer
		)
	{
		if (
			targetCapacityOwnershipAttoRep == 0 ||
			targetOpenInterestAttoEth == 0 ||
			requestedDebtAttoEth == 0 ||
			repEthPrice == 0
		) return (0, 0, 0, 0);
		uint256 reservedBackingUnits;
		if (minimumRemainingAttoRep != 0) {
			if (currentTotalRepBackingUnits == 0 || currentPoolHeldAttoRepBalance == 0) {
				reservedBackingUnits = Math.mulDiv(minimumRemainingAttoRep, PRICE_PRECISION, 1);
			} else {
				reservedBackingUnits = Math.mulDiv(minimumRemainingAttoRep, currentTotalRepBackingUnits, currentPoolHeldAttoRepBalance, Math.Rounding.Ceil);
			}
		}
		if (reservedBackingUnits >= targetBackingUnits) return (0, 0, 0, 0);
		uint256 transferableBackingUnits = targetBackingUnits - reservedBackingUnits;
		uint256 transferableVaultRepBackingAttoRep =
			currentTotalRepBackingUnits == 0
				? transferableBackingUnits / PRICE_PRECISION
				: Math.mulDiv(transferableBackingUnits, currentPoolHeldAttoRepBalance, currentTotalRepBackingUnits);
		uint256 maximumFundedDebtAttoEth = Math.mulDiv(transferableVaultRepBackingAttoRep, PRICE_PRECISION * BPS_DENOMINATOR, repEthPrice * (BPS_DENOMINATOR + LIQUIDATION_REP_BONUS_BPS));
		uint256 boundedRequestedDebtAttoEth =
			requestedDebtAttoEth > targetOpenInterestAttoEth ? targetOpenInterestAttoEth : requestedDebtAttoEth;
		debtToMoveAttoEth =
			boundedRequestedDebtAttoEth < maximumFundedDebtAttoEth
				? boundedRequestedDebtAttoEth
				: maximumFundedDebtAttoEth;
		if (debtToMoveAttoEth == 0) return (0, 0, 0, 0);
		capacityOwnershipToMoveAttoRep =
			debtToMoveAttoEth == targetOpenInterestAttoEth
				? targetCapacityOwnershipAttoRep
				: Math.mulDiv(targetCapacityOwnershipAttoRep, debtToMoveAttoEth, targetOpenInterestAttoEth);
		if (capacityOwnershipToMoveAttoRep == 0) return (0, 0, 0, 0);
		if (capacityOwnershipToMoveAttoRep > targetCapacityOwnershipAttoRep)
			capacityOwnershipToMoveAttoRep = targetCapacityOwnershipAttoRep;
		backingUnitsToTransfer = calculateLiquidationBackingUnitsAward(debtToMoveAttoEth, repEthPrice, currentPoolHeldAttoRepBalance, currentTotalRepBackingUnits);
		require(backingUnitsToTransfer <= transferableBackingUnits, 'Award unfunded');
		vaultAttoRepBackingToTransfer =
			currentTotalRepBackingUnits == 0
				? backingUnitsToTransfer / PRICE_PRECISION
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
