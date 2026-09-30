import type { Hash, WalletClient } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPool_SecurityPool } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { estimateMintCheckpoint } from '@zoltar/ui-statoblast-shared/features/markets/lib/trading.js'
import type { LiveMarket } from './liveMarket.js'
import * as copy from '../copy/availability.js'

export type FeeAccounting = Readonly<{
	settlementCollateralAttoEth: bigint
	totalUnderwritingLimitAttoEth: bigint
	feeEligibleUnderwritingLimitAttoEth: bigint
	currentRetentionRate: bigint
	lastUpdatedFeeAccumulator: bigint
	feeIndexRemainder: bigint
	totalFeesOwedRemainder: bigint
}>

/** Pin the checkpoint and share supply to the simulation block, including after the user's other transactions. */
export async function loadTransactionFeeMarket(client: WalletClient, market: LiveMarket, blockHash: Hash, timestamp: bigint): Promise<LiveMarket> {
	const abi = statoblast_SecurityPool_SecurityPool.abi
	const [feeAccounting, shareTokenSupplyAttoShares, feeEndTime] = await Promise.all([
		client.readContract({ abi, address: market.pool, functionName: 'getPoolAccountingSnapshot', blockHash }),
		client.readContract({ abi, address: market.pool, functionName: 'shareTokenSupplyAttoShares', blockHash }),
		client.readContract({ abi, address: market.pool, functionName: 'getFeeEpochEndTime', blockHash }),
	])
	const checkpoint = estimateMintCheckpoint({ ...feeAccounting, currentTimestamp: timestamp, feeEndTimestamp: feeEndTime })
	if (checkpoint === undefined) throw new Error(copy.holdingFeesUnavailableReason)
	return {
		...market,
		shareTokenSupplyAttoShares,
		settlementCollateralAttoEth: checkpoint.settlementCollateralAfterFeesAttoEth,
		currentRetentionRate: feeAccounting.currentRetentionRate,
		feeEligibleUnderwritingLimitAttoEth: feeAccounting.feeEligibleUnderwritingLimitAttoEth,
		totalUnderwritingLimitAttoEth: feeAccounting.totalUnderwritingLimitAttoEth,
		valuation: { timestamp, feeEndTime, projectedCollateralAttoEth: checkpoint.settlementCollateralAfterFeesAttoEth, feeAccounting },
	}
}

function projectedCollateral(market: LiveMarket, deadline: bigint) {
	const valuation = market.valuation
	if (valuation?.feeAccounting !== undefined) return estimateMintCheckpoint({ ...valuation.feeAccounting, currentTimestamp: deadline, feeEndTimestamp: valuation.feeEndTime })?.settlementCollateralAfterFeesAttoEth
	if (market.currentRetentionRate === 10n ** 18n || market.feeEligibleUnderwritingLimitAttoEth === 0n) return market.settlementCollateralAttoEth
	return undefined
}

/** A minimum approved today must remain payable through the signed transaction's validity, without other state changes. */
export function sellHoldingFeeBlocker(market: LiveMarket, completeSets: bigint, minimumAttoEth: bigint, deadline: bigint) {
	const collateral = projectedCollateral(market, deadline)
	if (collateral === undefined) return copy.holdingFeesUnavailableReason
	const payout = market.shareTokenSupplyAttoShares === 0n ? completeSets : (completeSets * collateral) / market.shareTokenSupplyAttoShares
	return payout === 0n || payout < minimumAttoEth ? copy.holdingFeesBoundsReason : undefined
}

/** Fee accrual increases complete sets minted per ETH, so both directional deposit ceilings need time coverage. */
export function liquidityHoldingFeeBlocker(market: LiveMarket, amount: bigint, maximumYes: bigint, maximumNo: bigint, deadline: bigint, deposits: Readonly<{ completeSetShares: bigint; yesUsed: bigint; noUsed: bigint }>) {
	const collateral = projectedCollateral(market, deadline)
	if (collateral === undefined) return copy.holdingFeesUnavailableReason
	if (collateral >= market.settlementCollateralAttoEth || market.shareTokenSupplyAttoShares === 0n) return undefined
	if (collateral === 0n || deposits.completeSetShares === 0n) return copy.holdingFeesBoundsReason
	const completeSets = (amount * market.shareTokenSupplyAttoShares) / collateral
	if (completeSets <= deposits.completeSetShares) return undefined
	// The simulated minority-side deposit rounds down. Bound its discarded fraction too, using
	// the actual simulation's mix rather than reserves cached before another user transaction.
	const projectedDeposit = (used: bigint) => (used === deposits.completeSetShares ? completeSets : ((used + 1n) * completeSets + deposits.completeSetShares - 1n) / deposits.completeSetShares - 1n)
	const yesUsed = projectedDeposit(deposits.yesUsed)
	const noUsed = projectedDeposit(deposits.noUsed)
	return yesUsed > maximumYes || noUsed > maximumNo ? copy.holdingFeesBoundsReason : undefined
}
