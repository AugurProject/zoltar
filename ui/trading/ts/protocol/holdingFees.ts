import { loadCompleteSetRedemptionQuote } from '@zoltar/ui-statoblast-shared/protocol/trading.js'
import { loadCentralSecurityPoolQuestion } from '@zoltar/ui-statoblast-shared/protocol/securityPoolState.js'
import { attoSharesToRecoveryAttoRep } from '../lib/shareValue.js'
import type { LinearFeeState } from '@zoltar/statoblast-shared/statoblast/linearFees'
import type { WalletClient } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_QuestionLedger_QuestionLedger } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { estimateMintCheckpoint } from '@zoltar/ui-statoblast-shared/features/markets/lib/trading.js'
import type { LiveMarket } from './liveMarket.js'
import * as copy from '../copy/availability.js'

export type FeeAccounting = Readonly<{
	linearFee?: LinearFeeState
	priceValidUntil?: bigint
	centralCheckpointTimestamp?: bigint
	centralSettlement?: boolean
	settlementCollateralAttoEth: bigint
	totalUnderwritingLimitAttoEth: bigint
	feeEligibleUnderwritingLimitAttoEth: bigint
	lastFeeCheckpointNativeTime: bigint
}>

/** Pin the checkpoint and share supply to the simulation block, including after the user's other transactions. */
export async function loadTransactionFeeMarket(client: WalletClient, market: LiveMarket, blockNumber: bigint, timestamp: bigint): Promise<LiveMarket> {
	const abi = statoblast_QuestionLedger_QuestionLedger.abi
	const capital = await client.readContract({ abi, address: market.pool, functionName: 'securityPoolCustody', blockNumber })
	const central = await loadCentralSecurityPoolQuestion(client, market.pool, capital, blockNumber)
	return projectTransactionFeeMarket(market, central, timestamp)
}

/** Quote the exact burn size after the same checkpoint the redemption performs. */
export async function loadRedemptionPayout(client: WalletClient, market: LiveMarket, amount: bigint, blockNumber: bigint) {
	return (await loadCompleteSetRedemptionQuote(client, market.pool, amount, blockNumber)).cash
}

/** The size-specific REP quote retains fractional recovery precision through the chosen burn. */
export async function loadRedemptionRecoveryPayout(client: WalletClient, market: LiveMarket, amount: bigint, blockNumber: bigint) {
	return (await loadCompleteSetRedemptionQuote(client, market.pool, amount, blockNumber)).rep
}

export function projectTransactionFeeMarket(market: LiveMarket, central: Awaited<ReturnType<typeof loadCentralSecurityPoolQuestion>>, timestamp: bigint): LiveMarket {
	const feeEndTime = central.feeEndTimestamp
	const recovery = central.settlementRecoveryAttoRep
	const feeAccounting = central
	const checkpoint = estimateMintCheckpoint({ ...feeAccounting, currentTimestamp: timestamp, feeEndTimestamp: feeEndTime })
	if (checkpoint === undefined) throw new Error(copy.holdingFeesUnavailableReason)
	return {
		...market,
		shareTokenSupplyAttoShares: central.shareTokenSupplyAttoShares,
		settlementRecoveryAttoRep: recovery,
		settlementCollateralAttoEth: checkpoint.settlementCollateralAfterFeesAttoEth,
		feeEligibleUnderwritingLimitAttoEth: feeAccounting.feeEligibleUnderwritingLimitAttoEth,
		totalUnderwritingLimitAttoEth: feeAccounting.totalUnderwritingLimitAttoEth,
		valuation: { timestamp, feeEndTime, projectedCollateralAttoEth: checkpoint.settlementCollateralAfterFeesAttoEth, feeAccounting },
	}
}

function projectedCollateral(market: LiveMarket, deadline: bigint) {
	const valuation = market.valuation
	if (valuation?.feeAccounting !== undefined) return estimateMintCheckpoint({ ...valuation.feeAccounting, currentTimestamp: deadline, feeEndTimestamp: valuation.feeEndTime })?.settlementCollateralAfterFeesAttoEth
	// A market loaded without fee accounting has no fee stream to project.
	return market.settlementCollateralAttoEth
}

/** A minimum approved today must remain payable through the signed transaction's validity, without other state changes. */
export function sellHoldingFeeBlocker(market: LiveMarket, completeSets: bigint, minimumAttoEth: bigint, deadline: bigint, currentPayoutAttoEth?: bigint, currentRecoveryAttoRep?: bigint) {
	const collateral = projectedCollateral(market, deadline)
	if (collateral === undefined) return copy.holdingFeesUnavailableReason
	const feeLoss = market.settlementCollateralAttoEth > collateral && market.shareTokenSupplyAttoShares > 0n ? ((market.settlementCollateralAttoEth - collateral) * completeSets + market.shareTokenSupplyAttoShares - 1n) / market.shareTokenSupplyAttoShares : 0n
	let payout = market.shareTokenSupplyAttoShares === 0n ? completeSets : (completeSets * collateral) / market.shareTokenSupplyAttoShares
	if (currentPayoutAttoEth !== undefined) payout = currentPayoutAttoEth > feeLoss ? currentPayoutAttoEth - feeLoss : 0n
	return (payout === 0n && (currentRecoveryAttoRep ?? attoSharesToRecoveryAttoRep(completeSets, market)) === 0n) || payout < minimumAttoEth ? copy.holdingFeesBoundsReason : undefined
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
