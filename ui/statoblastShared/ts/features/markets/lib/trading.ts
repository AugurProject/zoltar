import { ORIGIN_POOL_INITIAL_RETENTION_RATE } from '../../security-pools/lib/retentionRate.js'
import * as tradingCopy from '../../../copy/trading.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { getWalletActiveAppChainGuardState } from '@zoltar/ui-core-shared/transactions/actionGuards.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { formatAdditionalCurrencyBalance, formatCurrencyBalanceWithUnit, formatMultiplier } from '@zoltar/ui-core-shared/lib/formatters.js'
import { tryParseBigIntListInput } from '@zoltar/ui-core-shared/forms/inputs.js'
import { tryParseTradingAmountInput } from '@zoltar/ui-core-shared/forms/formInputs.js'
import { getReportingOutcomeLabel } from '../../reporting/lib/reporting.js'
import { isValidScalarOutcomeIndex } from '@zoltar/ui-core-shared/lib/scalarOutcome.js'
import type { DeploymentStatus } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ReportingOutcomeKey, TradingShareBalances, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'

const PRICE_PRECISION = 10n ** 18n

export const NO_MINT_CAPACITY_NO_ACTIVE_CAPACITY_OWNERSHIP_MESSAGE = 'No mint capacity. No active underwriting commitments.'
export const NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE = 'Need matching Invalid, Yes, and No shares to redeem complete sets.'
export const UNDEFINED_COMPLETE_SET_EXCHANGE_RATE_MESSAGE = 'Minting is unavailable because this pool has complete-set shares but no collateral.'

export function hasUndefinedCompleteSetExchangeRate(settlementCollateralAttoEth: bigint | undefined, shareTokenSupplyAttoShares: bigint | undefined) {
	if (settlementCollateralAttoEth === undefined || shareTokenSupplyAttoShares === undefined) return undefined
	return settlementCollateralAttoEth === 0n && shareTokenSupplyAttoShares !== 0n
}

/** Use contract-reported backing capacity; unknown capacity or an escalation game keeps minting closed. */
export function getPoolMintingCapacityAttoEth(pool: { mintingCapacityAttoEth?: bigint | undefined; hasForkContinuationEscalationGame: boolean; ordinaryEscalationGameStarted: boolean }) {
	return pool.ordinaryEscalationGameStarted || pool.hasForkContinuationEscalationGame ? 0n : (pool.mintingCapacityAttoEth ?? 0n)
}

export function getRemainingMintCapacity(mintingCapacityAttoEth: bigint | undefined, settlementCollateralAttoEth: bigint | undefined, shareTokenSupplyAttoShares?: bigint | undefined) {
	if (mintingCapacityAttoEth === undefined || settlementCollateralAttoEth === undefined) return undefined
	if (hasUndefinedCompleteSetExchangeRate(settlementCollateralAttoEth, shareTokenSupplyAttoShares) === true) return 0n
	return mintingCapacityAttoEth > settlementCollateralAttoEth ? mintingCapacityAttoEth - settlementCollateralAttoEth : 0n
}

export function getMaximumMintAmount(walletEthBalanceAttoEth: bigint | undefined, remainingMintCapacityAttoEth: bigint | undefined) {
	if (walletEthBalanceAttoEth === undefined || remainingMintCapacityAttoEth === undefined) return undefined
	return walletEthBalanceAttoEth < remainingMintCapacityAttoEth ? walletEthBalanceAttoEth : remainingMintCapacityAttoEth
}

function rpow(value: bigint, exponent: bigint, baseUnit: bigint) {
	let result = exponent % 2n !== 0n ? value : baseUnit
	let squaredValue = value
	for (let remainingExponent = exponent / 2n; remainingExponent !== 0n; remainingExponent /= 2n) {
		squaredValue = (squaredValue * squaredValue) / baseUnit
		if (remainingExponent % 2n !== 0n) result = (result * squaredValue) / baseUnit
	}
	return result
}

export function estimateMintCheckpoint({
	currentRetentionRate,
	currentTimestamp,
	feeEligibleUnderwritingLimitAttoEth,
	totalUnderwritingLimitAttoEth,
	feeEndTimestamp,
	feeIndexRemainder,
	lastUpdatedFeeAccumulator,
	settlementCollateralAttoEth,
	totalFeesOwedRemainder,
}: {
	currentRetentionRate: bigint | undefined
	currentTimestamp: bigint | undefined
	feeEligibleUnderwritingLimitAttoEth: bigint | undefined
	totalUnderwritingLimitAttoEth: bigint | undefined
	feeEndTimestamp: bigint | undefined
	feeIndexRemainder: bigint | undefined
	lastUpdatedFeeAccumulator: bigint | undefined
	settlementCollateralAttoEth: bigint | undefined
	totalFeesOwedRemainder: bigint | undefined
}) {
	if (
		currentRetentionRate === undefined ||
		currentTimestamp === undefined ||
		feeEligibleUnderwritingLimitAttoEth === undefined ||
		totalUnderwritingLimitAttoEth === undefined ||
		feeEndTimestamp === undefined ||
		feeIndexRemainder === undefined ||
		lastUpdatedFeeAccumulator === undefined ||
		settlementCollateralAttoEth === undefined ||
		totalFeesOwedRemainder === undefined
	)
		return undefined
	const checkpointTimestamp = currentTimestamp < feeEndTimestamp ? currentTimestamp : feeEndTimestamp
	if (lastUpdatedFeeAccumulator >= checkpointTimestamp || feeEligibleUnderwritingLimitAttoEth === 0n) return { estimatedRetentionFeeAttoEth: 0n, settlementCollateralAfterFeesAttoEth: settlementCollateralAttoEth }
	const timeDelta = checkpointTimestamp - lastUpdatedFeeAccumulator
	if (totalUnderwritingLimitAttoEth === 0n || feeEligibleUnderwritingLimitAttoEth > totalUnderwritingLimitAttoEth) return undefined
	const feeBearingCollateral = (settlementCollateralAttoEth * feeEligibleUnderwritingLimitAttoEth) / totalUnderwritingLimitAttoEth
	const pendingDecay = (feeIndexRemainder + totalFeesOwedRemainder) / PRICE_PRECISION
	const decayingCollateral = feeBearingCollateral > pendingDecay ? feeBearingCollateral - pendingDecay : 0n
	const retainedCollateralAttoEth = (decayingCollateral * rpow(currentRetentionRate, timeDelta, PRICE_PRECISION)) / PRICE_PRECISION
	const scaledFeeDelta = (decayingCollateral - retainedCollateralAttoEth) * PRICE_PRECISION + feeIndexRemainder
	const feeIndexDelta = scaledFeeDelta / feeEligibleUnderwritingLimitAttoEth
	const feesOwedDelta = feeIndexDelta * feeEligibleUnderwritingLimitAttoEth + totalFeesOwedRemainder
	const estimatedRetentionFeeAttoEth = feesOwedDelta / PRICE_PRECISION
	return {
		estimatedRetentionFeeAttoEth,
		settlementCollateralAfterFeesAttoEth: settlementCollateralAttoEth - estimatedRetentionFeeAttoEth,
	}
}

/** Forecast at fixed post-mint utilization and fee eligibility; not a resolution-time quote. */
export function estimateMintHoldingFees({
	mintAmountAttoEth,
	settlementCollateralAfterFeesAttoEth,
	mintingCapacityAttoEth,
	feeEligibleUnderwritingLimitAttoEth,
	totalUnderwritingLimitAttoEth,
	currentTimestamp,
	marketEndTimestamp,
	feeEndTimestamp,
}: {
	mintAmountAttoEth: bigint | undefined
	settlementCollateralAfterFeesAttoEth: bigint | undefined
	mintingCapacityAttoEth: bigint | undefined
	feeEligibleUnderwritingLimitAttoEth: bigint | undefined
	totalUnderwritingLimitAttoEth: bigint | undefined
	currentTimestamp: bigint | undefined
	marketEndTimestamp: bigint | undefined
	feeEndTimestamp: bigint | undefined
}) {
	if (
		mintAmountAttoEth === undefined ||
		mintAmountAttoEth <= 0n ||
		settlementCollateralAfterFeesAttoEth === undefined ||
		mintingCapacityAttoEth === undefined ||
		mintingCapacityAttoEth <= 0n ||
		feeEligibleUnderwritingLimitAttoEth === undefined ||
		totalUnderwritingLimitAttoEth === undefined ||
		totalUnderwritingLimitAttoEth <= 0n ||
		feeEligibleUnderwritingLimitAttoEth > totalUnderwritingLimitAttoEth ||
		feeEndTimestamp === undefined
	)
		return undefined
	const collateralAfterMint = settlementCollateralAfterFeesAttoEth + mintAmountAttoEth
	if (collateralAfterMint > mintingCapacityAttoEth) return undefined
	// SecurityPoolUtils.calculateRetentionRate: linear to 80% utilization, then capped.
	const minimumRetentionRate = 999_999_977_880_000_000n
	const utilizationDip = 800_000_000_000_000_000n
	const utilization = (collateralAfterMint * PRICE_PRECISION) / mintingCapacityAttoEth
	const retentionRateAfterMint = utilization >= utilizationDip ? minimumRetentionRate : ORIGIN_POOL_INITIAL_RETENTION_RATE - ((ORIGIN_POOL_INITIAL_RETENTION_RATE - minimumRetentionRate) * ((utilization * PRICE_PRECISION) / utilizationDip)) / PRICE_PRECISION
	if (currentTimestamp === undefined || marketEndTimestamp === undefined || marketEndTimestamp <= currentTimestamp) return { retentionRateAfterMint, holdingFeeAttoEth: undefined }
	const endTimestamp = marketEndTimestamp < feeEndTimestamp ? marketEndTimestamp : feeEndTimestamp
	const duration = endTimestamp > currentTimestamp ? endTimestamp - currentTimestamp : 0n
	// Model the depositor's proportional share of a fee checkpoint at the forecast horizon.
	const feeBearingDeposit = (mintAmountAttoEth * feeEligibleUnderwritingLimitAttoEth) / totalUnderwritingLimitAttoEth
	const holdingFeeAttoEth = feeBearingDeposit - (feeBearingDeposit * rpow(retentionRateAfterMint, duration, PRICE_PRECISION)) / PRICE_PRECISION
	return { retentionRateAfterMint, holdingFeeAttoEth }
}

export function formatStatoblastSecurityMultiplier(statoblastSecurityMultiplierBps: bigint) {
	return formatMultiplier(statoblastSecurityMultiplierBps, 4)
}

export function hasRepBackedPoolWithNoActiveCapacityOwnership(totalPoolHeldAttoRep: bigint | undefined, feeEligibleUnderwritingLimitAttoEth: bigint | undefined) {
	return (totalPoolHeldAttoRep ?? 0n) > 0n && (feeEligibleUnderwritingLimitAttoEth ?? 0n) === 0n
}

function getMaxRedeemableCompleteSets(shareBalances: TradingShareBalances | undefined) {
	if (shareBalances === undefined) return undefined
	if (shareBalances.invalidAttoShares <= shareBalances.yesAttoShares && shareBalances.invalidAttoShares <= shareBalances.noAttoShares) return shareBalances.invalidAttoShares
	if (shareBalances.yesAttoShares <= shareBalances.invalidAttoShares && shareBalances.yesAttoShares <= shareBalances.noAttoShares) return shareBalances.yesAttoShares
	return shareBalances.noAttoShares
}

function divideRoundedUp(numerator: bigint, denominator: bigint) {
	if (denominator <= 0n) throw new RangeError('Denominator must be greater than zero')
	return (numerator + denominator - 1n) / denominator
}

export function convertAttoSharesToSettlementCollateralAttoEth(amountAttoShares: undefined, settlementCollateralAttoEth: bigint | undefined, shareTokenSupplyAttoShares: bigint | undefined): undefined
export function convertAttoSharesToSettlementCollateralAttoEth(amountAttoShares: bigint, settlementCollateralAttoEth: bigint | undefined, shareTokenSupplyAttoShares: bigint | undefined): bigint
export function convertAttoSharesToSettlementCollateralAttoEth(amountAttoShares: bigint | undefined, settlementCollateralAttoEth: bigint | undefined, shareTokenSupplyAttoShares: bigint | undefined): bigint | undefined
export function convertAttoSharesToSettlementCollateralAttoEth(amountAttoShares: bigint | undefined, settlementCollateralAttoEth: bigint | undefined, shareTokenSupplyAttoShares: bigint | undefined) {
	if (amountAttoShares === undefined) return undefined
	if (settlementCollateralAttoEth === undefined || shareTokenSupplyAttoShares === undefined) return amountAttoShares
	if (shareTokenSupplyAttoShares === 0n) return amountAttoShares
	return (amountAttoShares * settlementCollateralAttoEth) / shareTokenSupplyAttoShares
}

export function convertSettlementCollateralAttoEthToAttoShares(amountAttoEth: bigint, settlementCollateralAttoEth: bigint | undefined, shareTokenSupplyAttoShares: bigint | undefined) {
	if (settlementCollateralAttoEth === undefined || shareTokenSupplyAttoShares === undefined) return amountAttoEth
	if (settlementCollateralAttoEth === 0n) {
		if (shareTokenSupplyAttoShares !== 0n) return undefined
		return amountAttoEth
	}
	return divideRoundedUp(amountAttoEth * shareTokenSupplyAttoShares, settlementCollateralAttoEth)
}

export function convertMintSettlementCollateralAttoEthToAttoShares(amountAttoEth: bigint, settlementCollateralAttoEth: bigint | undefined, shareTokenSupplyAttoShares: bigint | undefined) {
	if (settlementCollateralAttoEth === undefined || shareTokenSupplyAttoShares === undefined) return amountAttoEth
	if (shareTokenSupplyAttoShares === 0n) return settlementCollateralAttoEth === 0n ? amountAttoEth : undefined
	if (settlementCollateralAttoEth === 0n) return undefined
	return (amountAttoEth * shareTokenSupplyAttoShares) / settlementCollateralAttoEth
}

export function getShareSettlementBalances(shareBalances: TradingShareBalances | undefined, settlementCollateralAttoEth: bigint | undefined, shareTokenSupplyAttoShares: bigint | undefined) {
	if (shareBalances === undefined) return undefined
	return {
		invalid: convertAttoSharesToSettlementCollateralAttoEth(shareBalances.invalidAttoShares, settlementCollateralAttoEth, shareTokenSupplyAttoShares),
		no: convertAttoSharesToSettlementCollateralAttoEth(shareBalances.noAttoShares, settlementCollateralAttoEth, shareTokenSupplyAttoShares),
		yes: convertAttoSharesToSettlementCollateralAttoEth(shareBalances.yesAttoShares, settlementCollateralAttoEth, shareTokenSupplyAttoShares),
	}
}

export function getSelectedOutcomeShareBalance(shareBalances: TradingShareBalances | undefined, outcome: ReportingOutcomeKey) {
	if (shareBalances === undefined) return undefined
	switch (outcome) {
		case 'invalid':
			return shareBalances.invalidAttoShares
		case 'yes':
			return shareBalances.yesAttoShares
		case 'no':
			return shareBalances.noAttoShares
		default:
			return assertNever(outcome)
	}
}

function areShareMigrationTargetOutcomeIndexesValid(tradingForkUniverse: ZoltarUniverseSummary, targetOutcomeIndexes: bigint[]) {
	const forkQuestionDetails = tradingForkUniverse.forkQuestionDetails
	if (forkQuestionDetails === undefined) return false

	if (forkQuestionDetails.marketType === 'scalar') {
		const scalarQuestion = forkQuestionDetails
		return targetOutcomeIndexes.every(outcomeIndex => isValidScalarOutcomeIndex(scalarQuestion, outcomeIndex))
	}

	const availableOutcomeIndexSet = new Set(tradingForkUniverse.childUniverses.map(child => child.outcomeIndex.toString()))
	return targetOutcomeIndexes.every(outcomeIndex => availableOutcomeIndexSet.has(outcomeIndex.toString()))
}

export function getDefaultShareMigrationTargetOutcomeIndexes(tradingForkUniverse: ZoltarUniverseSummary | undefined) {
	if (tradingForkUniverse === undefined || !tradingForkUniverse.hasForked) return ''
	if (tradingForkUniverse.forkQuestionDetails?.marketType === 'scalar') return ''
	return tradingForkUniverse.childUniverses.map(child => child.outcomeIndex.toString()).join(', ')
}

export function isTradingSystemDeployed(deploymentStatuses: DeploymentStatus[]) {
	return deploymentStatuses.length > 0 && deploymentStatuses.every(step => step.deployed)
}

export function getTradingOraclePriceGuardMessage(oraclePriceUsable: boolean | undefined) {
	if (oraclePriceUsable === undefined) return tradingCopy.loadingOraclePrice
	if (!oraclePriceUsable) return tradingCopy.staleOraclePrice
	return undefined
}

export function getTradingMintGuardMessage({
	accountAddress,
	settlementCollateralAttoEth,
	ethBalanceAttoEth,
	mintingCapacityAttoEth,
	hasSelectedPool,
	isOnActiveAppChain,
	isPriceValid,
	mintAmountInput,
	shareTokenSupplyAttoShares,
	totalPoolHeldAttoRep,
}: {
	accountAddress: Address | undefined
	settlementCollateralAttoEth: bigint | undefined
	ethBalanceAttoEth: bigint | undefined
	mintingCapacityAttoEth: bigint | undefined
	hasSelectedPool: boolean
	isOnActiveAppChain: boolean
	isPriceValid?: boolean
	mintAmountInput: string
	shareTokenSupplyAttoShares: bigint | undefined
	totalPoolHeldAttoRep: bigint | undefined
}) {
	if (!hasSelectedPool) return 'Select a pool before minting.'
	const walletGuardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason: 'Connect a wallet before minting complete sets.' })
	if (walletGuardState.blocked) return walletGuardState.reason
	if (isPriceValid === false) return tradingCopy.staleOraclePrice

	const undefinedExchangeRate = hasUndefinedCompleteSetExchangeRate(settlementCollateralAttoEth, shareTokenSupplyAttoShares)
	if (undefinedExchangeRate === undefined) return 'Loading mint capacity.'
	if (undefinedExchangeRate) return UNDEFINED_COMPLETE_SET_EXCHANGE_RATE_MESSAGE

	const remainingCapacity = getRemainingMintCapacity(mintingCapacityAttoEth, settlementCollateralAttoEth, shareTokenSupplyAttoShares)
	if (remainingCapacity === undefined) return 'Loading mint capacity.'
	if (remainingCapacity === 0n) {
		if ((totalPoolHeldAttoRep ?? 0n) > 0n && mintingCapacityAttoEth === 0n) return NO_MINT_CAPACITY_NO_ACTIVE_CAPACITY_OWNERSHIP_MESSAGE

		return 'No mint capacity remaining.'
	}

	const trimmedAmount = mintAmountInput.trim()
	if (trimmedAmount === '') return 'Enter a mint amount greater than zero.'
	const mintAmount = tryParseTradingAmountInput(trimmedAmount)
	if (mintAmount === undefined) return 'Enter a valid mint amount.'

	if (mintAmount <= 0n) return 'Enter a mint amount greater than zero.'
	if (mintAmount > remainingCapacity) return `Max mint capacity is ${formatCurrencyBalanceWithUnit(remainingCapacity, 'ETH')}.`
	if (ethBalanceAttoEth === undefined) return 'Loading wallet ETH balance.'
	if (mintAmount > ethBalanceAttoEth) return `Need ${formatAdditionalCurrencyBalance(mintAmount - ethBalanceAttoEth, 'ETH')} in this wallet to mint the selected amount.`
	return undefined
}

export function getTradingRedeemCompleteSetGuardMessage({
	accountAddress,
	settlementCollateralAttoEth,
	hasSelectedPool,
	isOnActiveAppChain,
	loadingTradingDetails,
	redeemAmountInput,
	shareBalances,
	shareTokenSupplyAttoShares,
}: {
	accountAddress: Address | undefined
	settlementCollateralAttoEth: bigint | undefined
	hasSelectedPool: boolean
	isOnActiveAppChain: boolean
	loadingTradingDetails: boolean
	redeemAmountInput: string
	shareBalances: TradingShareBalances | undefined
	shareTokenSupplyAttoShares: bigint | undefined
}) {
	if (!hasSelectedPool) return 'Select a pool before redeeming complete sets.'
	const walletGuardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason: 'Connect a wallet before redeeming complete sets.' })
	if (walletGuardState.blocked) return walletGuardState.reason
	if (loadingTradingDetails) return 'Loading wallet share balances.'

	const maxRedeemableCompleteSetsAttoShares = getMaxRedeemableCompleteSets(shareBalances)
	if (maxRedeemableCompleteSetsAttoShares === undefined) return 'Loading wallet share balances.'
	if (maxRedeemableCompleteSetsAttoShares === 0n) return NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE

	const trimmedAmount = redeemAmountInput.trim()
	if (trimmedAmount === '') return 'Enter a redeem amount greater than zero.'
	const redeemAmount = tryParseTradingAmountInput(trimmedAmount)
	if (redeemAmount === undefined) return 'Enter a valid redeem amount.'

	if (redeemAmount <= 0n) return 'Enter a redeem amount greater than zero.'
	const redeemAmountAttoShares = convertSettlementCollateralAttoEthToAttoShares(redeemAmount, settlementCollateralAttoEth, shareTokenSupplyAttoShares)
	if (redeemAmountAttoShares === undefined) return 'Redeeming is unavailable because this pool has complete-set shares but no collateral.'
	if (redeemAmountAttoShares > maxRedeemableCompleteSetsAttoShares) {
		const maximumRedeemableAmountAttoEth = convertAttoSharesToSettlementCollateralAttoEth(maxRedeemableCompleteSetsAttoShares, settlementCollateralAttoEth, shareTokenSupplyAttoShares)
		return `Max redeemable amount is ${formatCurrencyBalanceWithUnit(maximumRedeemableAmountAttoEth, 'ETH')}.`
	}
	return undefined
}

export function getTradingMigrateSharesGuardMessage({
	accountAddress,
	hasSelectedPool,
	isOnActiveAppChain,
	loadingTradingForkUniverse,
	loadingTradingDetails,
	selectedShareOutcome,
	shareBalances,
	targetOutcomeIndexesInput,
	tradingForkUniverse,
}: {
	accountAddress: Address | undefined
	hasSelectedPool: boolean
	isOnActiveAppChain: boolean
	loadingTradingForkUniverse: boolean
	loadingTradingDetails: boolean
	selectedShareOutcome: ReportingOutcomeKey
	shareBalances: TradingShareBalances | undefined
	targetOutcomeIndexesInput: string
	tradingForkUniverse: ZoltarUniverseSummary | undefined
}) {
	if (!hasSelectedPool) return 'Select a pool before migrating shares.'
	const walletGuardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason: 'Connect a wallet before migrating shares.' })
	if (walletGuardState.blocked) return walletGuardState.reason
	if (loadingTradingForkUniverse) return 'Loading fork target universes.'
	if (tradingForkUniverse === undefined || !tradingForkUniverse.hasForked) return 'Refresh the fork target universes.'

	const targetOutcomeIndexes = tryParseBigIntListInput(targetOutcomeIndexesInput)
	if (targetOutcomeIndexes === undefined) return targetOutcomeIndexesInput.trim() === '' ? 'Select at least one target child universe.' : 'Select valid target child universes.'
	if (new Set(targetOutcomeIndexes.map(outcomeIndex => outcomeIndex.toString())).size !== targetOutcomeIndexes.length) return 'Select each target child universe only once.'

	if (!areShareMigrationTargetOutcomeIndexesValid(tradingForkUniverse, targetOutcomeIndexes)) return 'Select valid target child universes.'
	if (loadingTradingDetails) return 'Loading wallet share balances.'

	const selectedOutcomeBalance = getSelectedOutcomeShareBalance(shareBalances, selectedShareOutcome)
	if (selectedOutcomeBalance === undefined) return 'Loading wallet share balances.'
	if (selectedOutcomeBalance === 0n) return `No ${getReportingOutcomeLabel(selectedShareOutcome)} shares available to migrate.`
	return undefined
}

export function getTradingRedeemSharesGuardMessage({ accountAddress, hasSelectedPool, isOnActiveAppChain }: { accountAddress: Address | undefined; hasSelectedPool: boolean; isOnActiveAppChain: boolean }) {
	if (!hasSelectedPool) return 'Select a pool before redeeming shares.'
	const walletGuardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason: 'Connect a wallet before redeeming shares.' })
	if (walletGuardState.blocked) return walletGuardState.reason
	return undefined
}
