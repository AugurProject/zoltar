import { tryParseDecimalInput } from '@zoltar/ui-core-shared/forms/decimal.js'
import * as tradingCopy from '../../../copy/trading.js'
import * as collateralCopy from '../../../copy/collateral.js'
import * as statoblastAppCopy from '../../../copy/app.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { getWalletActiveAppChainGuardState } from '@zoltar/ui-core-shared/transactions/actionGuards.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { formatAdditionalCurrencyBalance, formatCurrencyBalanceWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
import { tryParseBigIntListInput } from '@zoltar/ui-core-shared/forms/inputs.js'
import { getReportingOutcomeLabel } from '../../reporting/lib/reporting.js'
import { previewLinearFeeCheckpoint, type LinearFeeState } from '@zoltar/statoblast-shared/statoblast/linearFees'
import { isValidScalarOutcomeIndex } from '@zoltar/ui-core-shared/lib/scalarOutcome.js'
import type { DeploymentStatus, ReportingOutcomeKey, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ShareMigrationTarget, ShareMigrationTargetsState, TradingShareBalances } from '../../../types/contracts.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import { ETH_GAS_RESERVE_ATTO_ETH, getSpendableEthBalance } from '@zoltar/ui-core-shared/lib/ethGasReserve.js'

export const NO_MINT_CAPACITY_NO_ACTIVE_CAPACITY_OWNERSHIP_MESSAGE = 'No mint capacity. No position has an active commitment.'
export const NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE = 'You need matching Yes, No, and Invalid shares to redeem complete sets.'
export const UNDEFINED_COMPLETE_SET_EXCHANGE_RATE_MESSAGE = 'Minting is unavailable because this question has complete-set shares but no collateral.'
export const MINTING_PAUSED_DURING_DISPUTE_MESSAGE = tradingCopy.mintingPausedDuringDispute

/** True once an ordinary or fork-continuation escalation game has started. The flags stay set after the game, so use `isMintingPausedByEscalation` to tell a paused operating pool from one that finalization or a fork closed. */
export function hasEscalationGame(pool: { hasEscalationGame: boolean }) {
	return pool.hasEscalationGame
}

export function hasUndefinedCompleteSetExchangeRate(settlementCollateralAttoEth: bigint | undefined, shareTokenSupplyAttoShares: bigint | undefined) {
	if (settlementCollateralAttoEth === undefined || shareTokenSupplyAttoShares === undefined) return undefined
	return settlementCollateralAttoEth === 0n && shareTokenSupplyAttoShares !== 0n
}

/** Use contract-reported backing capacity; unknown capacity or an escalation game keeps minting closed. */
export function getPoolMintingCapacityAttoEth(pool: { mintingCapacityAttoEth?: bigint | undefined; hasEscalationGame: boolean }) {
	return hasEscalationGame(pool) ? 0n : (pool.mintingCapacityAttoEth ?? 0n)
}

export function getRemainingMintCapacity(mintingCapacityAttoEth: bigint | undefined, settlementCollateralAttoEth: bigint | undefined, shareTokenSupplyAttoShares?: bigint | undefined) {
	if (mintingCapacityAttoEth === undefined || settlementCollateralAttoEth === undefined) return undefined
	if (hasUndefinedCompleteSetExchangeRate(settlementCollateralAttoEth, shareTokenSupplyAttoShares) === true) return 0n
	return mintingCapacityAttoEth > settlementCollateralAttoEth ? mintingCapacityAttoEth - settlementCollateralAttoEth : 0n
}

/** The largest mint that fits both the remaining capacity and the wallet ETH left after the gas reserve. */
export function getMaximumMintAmount(walletEthBalanceAttoEth: bigint | undefined, remainingMintCapacityAttoEth: bigint | undefined) {
	if (walletEthBalanceAttoEth === undefined || remainingMintCapacityAttoEth === undefined) return undefined
	const spendableEthAttoEth = getSpendableEthBalance(walletEthBalanceAttoEth)
	return spendableEthAttoEth < remainingMintCapacityAttoEth ? spendableEthAttoEth : remainingMintCapacityAttoEth
}

/** Projects the question's cash after its linear fee stream accrues up to `currentTimestamp`. */
export function estimateMintCheckpoint({
	centralSettlement,
	centralCheckpointTimestamp,
	linearFee,
	currentTimestamp,
	feeEndTimestamp,
	lastFeeCheckpointNativeTime,
	settlementCollateralAttoEth,
}: {
	centralCheckpointTimestamp?: bigint | undefined
	centralSettlement?: boolean | undefined
	linearFee?: LinearFeeState | undefined
	currentTimestamp: bigint | undefined
	feeEndTimestamp: bigint | undefined
	lastFeeCheckpointNativeTime: bigint | undefined
	settlementCollateralAttoEth: bigint | undefined
}) {
	if (linearFee === undefined || currentTimestamp === undefined || feeEndTimestamp === undefined || lastFeeCheckpointNativeTime === undefined || settlementCollateralAttoEth === undefined) return undefined
	if (centralSettlement === true) {
		if (centralCheckpointTimestamp === undefined) return undefined
		// The simulated checkpoint includes historical pauses. Only future elapsed time
		// can accrue again, bounded by the stream's remaining duration in native time.
		const elapsed = currentTimestamp > centralCheckpointTimestamp ? currentTimestamp - centralCheckpointTimestamp : 0n
		const remaining = linearFee.endTime > lastFeeCheckpointNativeTime ? linearFee.endTime - lastFeeCheckpointNativeTime : 0n
		const scale = linearFee.rateScale ?? 1n
		if (scale <= 0n) return undefined
		const fees = ((elapsed < remaining ? elapsed : remaining) * linearFee.rateAttoEthPerSecond) / scale
		const estimatedRetentionFeeAttoEth = fees < settlementCollateralAttoEth ? fees : settlementCollateralAttoEth
		return { estimatedRetentionFeeAttoEth, settlementCollateralAfterFeesAttoEth: settlementCollateralAttoEth - estimatedRetentionFeeAttoEth }
	}
	return previewLinearFeeCheckpoint({ linearFee, currentTimestamp, feeEndTimestamp, lastFeeCheckpointNativeTime, settlementCollateralAttoEth })
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

export function convertAttoSharesToSettlementCollateralAttoEth(amountAttoShares: undefined, settlementCollateralAttoEth: bigint | undefined, shareTokenSupplyAttoShares: bigint | undefined): undefined
export function convertAttoSharesToSettlementCollateralAttoEth(amountAttoShares: bigint, settlementCollateralAttoEth: bigint | undefined, shareTokenSupplyAttoShares: bigint | undefined): bigint
export function convertAttoSharesToSettlementCollateralAttoEth(amountAttoShares: bigint | undefined, settlementCollateralAttoEth: bigint | undefined, shareTokenSupplyAttoShares: bigint | undefined): bigint | undefined
export function convertAttoSharesToSettlementCollateralAttoEth(amountAttoShares: bigint | undefined, settlementCollateralAttoEth: bigint | undefined, shareTokenSupplyAttoShares: bigint | undefined) {
	if (amountAttoShares === undefined) return undefined
	if (settlementCollateralAttoEth === undefined || shareTokenSupplyAttoShares === undefined) return amountAttoShares
	if (shareTokenSupplyAttoShares === 0n) return amountAttoShares
	return (amountAttoShares * settlementCollateralAttoEth) / shareTokenSupplyAttoShares
}

export function getShareSettlementBalances(shareBalances: TradingShareBalances | undefined, settlementCollateralAttoEth: bigint | undefined, shareTokenSupplyAttoShares: bigint | undefined) {
	if (shareBalances === undefined) return undefined
	return {
		invalid: convertAttoSharesToSettlementCollateralAttoEth(shareBalances.invalidAttoShares, settlementCollateralAttoEth, shareTokenSupplyAttoShares),
		no: convertAttoSharesToSettlementCollateralAttoEth(shareBalances.noAttoShares, settlementCollateralAttoEth, shareTokenSupplyAttoShares),
		yes: convertAttoSharesToSettlementCollateralAttoEth(shareBalances.yesAttoShares, settlementCollateralAttoEth, shareTokenSupplyAttoShares),
	}
}

/** Whether loaded balances hold any Yes, No, or Invalid shares. */
export function hasShares(shareBalances: TradingShareBalances | undefined) {
	return shareBalances !== undefined && (shareBalances.yesAttoShares > 0n || shareBalances.noAttoShares > 0n || shareBalances.invalidAttoShares > 0n)
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

/**
 * Why `ShareToken.migrate` would revert for these targets, or undefined when it would not. It creates a missing
 * child pool only for a single target, and it reverts when every target already holds the whole source balance.
 * A target absent from `shareMigrationTargets` (an undeployed scalar child) has no pool yet.
 */
function getShareMigrationTargetBlocker(shareMigrationTargets: readonly ShareMigrationTarget[], targetOutcomeIndexes: readonly bigint[], selectedShareOutcome: ReportingOutcomeKey, selectedOutcomeBalance: bigint) {
	const targets = targetOutcomeIndexes.map(outcomeIndex => shareMigrationTargets.find(target => target.outcomeIndex === outcomeIndex))
	if (targets.length > 1 && targets.some(target => target?.canonicalPool === undefined)) return tradingCopy.missingChildPoolBlocker
	const alreadyMigrated = targets.every(target => target !== undefined && isShareMigrationTargetComplete(target, selectedShareOutcome, selectedOutcomeBalance))
	return alreadyMigrated ? tradingCopy.formatSharesAlreadyMigratedReason(getReportingOutcomeLabel(selectedShareOutcome)) : undefined
}

function isShareMigrationTargetComplete(target: ShareMigrationTarget, selectedShareOutcome: ReportingOutcomeKey, selectedOutcomeBalance: bigint) {
	const migratedAttoShares = getSelectedOutcomeShareBalance(target.migratedAttoShares, selectedShareOutcome)
	return migratedAttoShares !== undefined && migratedAttoShares >= selectedOutcomeBalance
}

type ShareMigrationDefaultsInput = {
	selectedShareOutcome: ReportingOutcomeKey
	shareBalances: TradingShareBalances | undefined
	shareMigrationTargets: ShareMigrationTargetsState | undefined
	tradingForkUniverse: ZoltarUniverseSummary | undefined
}

/**
 * The categorical child universes a migration of the selected balance can still reach, leaving out children that already
 * hold the whole balance. Undefined before a categorical fork or while the share token's view of the children is not loaded.
 */
function getShareMigrationCandidates({ selectedShareOutcome, shareBalances, shareMigrationTargets, tradingForkUniverse }: ShareMigrationDefaultsInput) {
	if (tradingForkUniverse === undefined || !tradingForkUniverse.hasForked) return undefined
	if (tradingForkUniverse.forkQuestionDetails?.marketType === 'scalar') return undefined
	if (shareMigrationTargets === undefined || 'unavailableReason' in shareMigrationTargets) return undefined
	const selectedOutcomeBalance = getSelectedOutcomeShareBalance(shareBalances, selectedShareOutcome)
	return tradingForkUniverse.childUniverses.flatMap(child => {
		const target = shareMigrationTargets.find(candidate => candidate.outcomeIndex === child.outcomeIndex)
		if (target !== undefined && selectedOutcomeBalance !== undefined && selectedOutcomeBalance > 0n && isShareMigrationTargetComplete(target, selectedShareOutcome, selectedOutcomeBalance)) return []
		return [{ hasPool: target?.canonicalPool !== undefined, outcomeIndex: child.outcomeIndex }]
	})
}

/**
 * The child universes a categorical migration starts with, and what "Select all" restores. Once the share token's view of
 * the children is loaded, it leaves out children that already hold the whole selected balance and, because a batch with a
 * missing child pool reverts, keeps only children with pools whenever more than one candidate remains; with no pooled
 * candidate it selects nothing, so the user picks a single child, whose pool the migration creates.
 */
export function getDefaultShareMigrationTargetOutcomeIndexes(input: ShareMigrationDefaultsInput) {
	const { tradingForkUniverse } = input
	if (tradingForkUniverse === undefined || !tradingForkUniverse.hasForked) return ''
	if (tradingForkUniverse.forkQuestionDetails?.marketType === 'scalar') return ''
	const candidates = getShareMigrationCandidates(input)
	if (candidates === undefined) return tradingForkUniverse.childUniverses.map(child => child.outcomeIndex).join(', ')
	const selectable = candidates.length > 1 ? candidates.filter(candidate => candidate.hasPool) : candidates
	return selectable.map(candidate => candidate.outcomeIndex.toString()).join(', ')
}

/** Why the default selection is empty for a held balance: every child already holds it, or several children remain and none has a pool. */
function getEmptyShareMigrationDefaultReason(input: ShareMigrationDefaultsInput) {
	const selectedOutcomeBalance = getSelectedOutcomeShareBalance(input.shareBalances, input.selectedShareOutcome)
	if (selectedOutcomeBalance === undefined || selectedOutcomeBalance === 0n || input.tradingForkUniverse?.childUniverses.length === 0) return undefined
	const candidates = getShareMigrationCandidates(input)
	if (candidates === undefined) return undefined
	if (candidates.length === 0) return tradingCopy.formatSharesMigratedIntoEveryChildReason(getReportingOutcomeLabel(input.selectedShareOutcome))
	if (candidates.length > 1 && candidates.every(candidate => !candidate.hasPool)) return tradingCopy.noChildPoolForBatchMigration
	return undefined
}

export function isTradingSystemDeployed(deploymentStatuses: DeploymentStatus[]) {
	return deploymentStatuses.length > 0 && deploymentStatuses.every(step => step.deployed)
}

/** The one parser for complete-set mint and redeem amounts, shared by the guards, the collateral quote and submission so they never disagree. */
export function parseCompleteSetAmountInput(input: string, decimals: number) {
	return tryParseDecimalInput(input, decimals)
}

export function getMintingQuestionEndReason(currentTimestamp: bigint | undefined, questionEndTime: bigint | undefined) {
	return currentTimestamp !== undefined && questionEndTime !== undefined && currentTimestamp >= questionEndTime ? tradingCopy.mintingClosedAtQuestionEnd : undefined
}

export function getTradingMintGuardMessage({
	collateral,
	currentTimestamp,
	questionEndTime,
	accountAddress,
	escalationGameActive = false,
	usesSharedBacking = false,
	settlementCollateralAttoEth,
	ethBalanceAttoEth,
	mintingCapacityAttoEth,
	hasSelectedPool,
	isOnActiveAppChain,
	mintAmountInput,
	shareTokenSupplyAttoShares,
	totalPoolHeldAttoRep,
}: {
	currentTimestamp?: bigint | undefined
	questionEndTime?: bigint | undefined
	collateral?: { balance: bigint; decimals: number; symbol: string } | undefined
	accountAddress: Address | undefined
	/** An open escalation game closes minting; it explains a zero capacity before any capacity message. */
	escalationGameActive?: boolean
	usesSharedBacking?: boolean
	settlementCollateralAttoEth: bigint | undefined
	ethBalanceAttoEth: bigint | undefined
	mintingCapacityAttoEth: bigint | undefined
	hasSelectedPool: boolean
	isOnActiveAppChain: boolean
	mintAmountInput: string
	shareTokenSupplyAttoShares: bigint | undefined
	totalPoolHeldAttoRep: bigint | undefined
}) {
	if (!hasSelectedPool) return 'Select a question before minting.'
	const walletGuardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason: commonCopy.formatConnectWalletBefore('minting complete sets') })
	if (walletGuardState.blocked) return walletGuardState.reason
	const questionEndReason = getMintingQuestionEndReason(currentTimestamp, questionEndTime)
	if (questionEndReason !== undefined) return questionEndReason
	if (escalationGameActive) return MINTING_PAUSED_DURING_DISPUTE_MESSAGE

	const undefinedExchangeRate = hasUndefinedCompleteSetExchangeRate(settlementCollateralAttoEth, shareTokenSupplyAttoShares)
	if (undefinedExchangeRate === undefined) return 'Loading mint capacity…'
	if (undefinedExchangeRate) return UNDEFINED_COMPLETE_SET_EXCHANGE_RATE_MESSAGE

	const remainingCapacity = getRemainingMintCapacity(mintingCapacityAttoEth, settlementCollateralAttoEth, shareTokenSupplyAttoShares)
	if (!usesSharedBacking && remainingCapacity === undefined) return 'Loading mint capacity…'
	if (!usesSharedBacking && remainingCapacity === 0n) {
		if ((totalPoolHeldAttoRep ?? 0n) > 0n && mintingCapacityAttoEth === 0n) return NO_MINT_CAPACITY_NO_ACTIVE_CAPACITY_OWNERSHIP_MESSAGE

		return 'No mint capacity remaining.'
	}

	const trimmedAmount = mintAmountInput.trim()
	if (trimmedAmount === '') return tradingCopy.mintAmountRequired
	const mintAmount = parseCompleteSetAmountInput(trimmedAmount, collateral?.decimals ?? 18)
	if (mintAmount === undefined) return 'Enter a valid mint amount.'

	if (mintAmount <= 0n) return tradingCopy.mintAmountRequired
	if (!usesSharedBacking && remainingCapacity !== undefined && mintAmount > remainingCapacity) return `Max mint capacity is ${formatCurrencyBalanceWithUnit(remainingCapacity, collateral?.symbol ?? 'ETH', collateral?.decimals ?? 18)}.`
	if (collateral !== undefined) return collateral.balance < mintAmount ? collateralCopy.formatInsufficientBalance(collateral.symbol) : undefined
	if (ethBalanceAttoEth === undefined) return statoblastAppCopy.loadingWalletEthBalance
	const spendableEthAttoEth = getSpendableEthBalance(ethBalanceAttoEth)
	if (mintAmount > spendableEthAttoEth) return `Need ${formatAdditionalCurrencyBalance(mintAmount - spendableEthAttoEth, 'ETH')} in this wallet to mint the selected amount and keep ${formatCurrencyBalanceWithUnit(ETH_GAS_RESERVE_ATTO_ETH, 'ETH')} for gas.`
	return undefined
}

export function getTradingRedeemCompleteSetGuardMessage({
	shareDecimals = 18,
	accountAddress,
	hasSelectedPool,
	isOnActiveAppChain,
	loadingTradingDetails,
	redeemAmountInput,
	shareBalances,
}: {
	shareDecimals?: number
	accountAddress: Address | undefined
	settlementCollateralAttoEth: bigint | undefined
	hasSelectedPool: boolean
	isOnActiveAppChain: boolean
	loadingTradingDetails: boolean
	redeemAmountInput: string
	shareBalances: TradingShareBalances | undefined
	shareTokenSupplyAttoShares: bigint | undefined
}) {
	if (!hasSelectedPool) return 'Select a question before redeeming complete sets.'
	const walletGuardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason: commonCopy.formatConnectWalletBefore('redeeming complete sets') })
	if (walletGuardState.blocked) return walletGuardState.reason
	if (loadingTradingDetails) return 'Loading wallet share balances…'

	const maxRedeemableCompleteSetsAttoShares = getMaxRedeemableCompleteSets(shareBalances)
	if (maxRedeemableCompleteSetsAttoShares === undefined) return 'Loading wallet share balances…'
	if (maxRedeemableCompleteSetsAttoShares === 0n) return NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE

	const trimmedAmount = redeemAmountInput.trim()
	if (trimmedAmount === '') return tradingCopy.redeemAmountRequired
	const redeemAmount = parseCompleteSetAmountInput(trimmedAmount, shareDecimals)
	if (redeemAmount === undefined) return 'Enter a valid redeem amount.'

	if (redeemAmount <= 0n) return tradingCopy.redeemAmountRequired
	if (redeemAmount > maxRedeemableCompleteSetsAttoShares) return `Max redeemable amount is ${formatCurrencyBalanceWithUnit(maxRedeemableCompleteSetsAttoShares, 'sets', shareDecimals)}.`
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
	shareMigrationTargets,
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
	shareMigrationTargets: ShareMigrationTargetsState | undefined
	targetOutcomeIndexesInput: string
	tradingForkUniverse: ZoltarUniverseSummary | undefined
}) {
	if (!hasSelectedPool) return 'Select a question before migrating shares.'
	const walletGuardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason: commonCopy.formatConnectWalletBefore('migrating shares') })
	if (walletGuardState.blocked) return walletGuardState.reason
	if (loadingTradingForkUniverse) return tradingCopy.loadingForkTargetUniverses
	if (tradingForkUniverse === undefined) return tradingCopy.forkTargetsRefreshRequired
	if (!tradingForkUniverse.hasForked) return tradingCopy.shareMigrationRequiresFork

	const targetOutcomeIndexes = tryParseBigIntListInput(targetOutcomeIndexesInput)
	if (targetOutcomeIndexes === undefined) {
		if (targetOutcomeIndexesInput.trim() !== '') return 'Select valid target child universes.'
		if (loadingTradingDetails) return 'Select at least one target child universe.'
		return getEmptyShareMigrationDefaultReason({ selectedShareOutcome, shareBalances, shareMigrationTargets, tradingForkUniverse }) ?? 'Select at least one target child universe.'
	}
	if (new Set(targetOutcomeIndexes.map(outcomeIndex => outcomeIndex.toString())).size !== targetOutcomeIndexes.length) return 'Select each target child universe only once.'

	if (!areShareMigrationTargetOutcomeIndexesValid(tradingForkUniverse, targetOutcomeIndexes)) return 'Select valid target child universes.'
	if (loadingTradingDetails) return 'Loading wallet share balances…'

	const selectedOutcomeBalance = getSelectedOutcomeShareBalance(shareBalances, selectedShareOutcome)
	if (selectedOutcomeBalance === undefined) return 'Loading wallet share balances…'
	if (selectedOutcomeBalance === 0n) return `No ${getReportingOutcomeLabel(selectedShareOutcome)} shares available to migrate.`
	if (shareMigrationTargets === undefined) return tradingCopy.loadingShareMigrationTargetPools
	if ('unavailableReason' in shareMigrationTargets) return shareMigrationTargets.unavailableReason
	return getShareMigrationTargetBlocker(shareMigrationTargets, targetOutcomeIndexes, selectedShareOutcome, selectedOutcomeBalance)
}

/** Without `questionOutcome` only the pool and wallet are checked; with it, the pool must be resolved and the wallet must hold winning shares. */
export function getTradingRedeemSharesGuardMessage({
	accountAddress,
	hasSelectedPool,
	isOnActiveAppChain,
	questionOutcome,
	shareBalances,
}: {
	accountAddress: Address | undefined
	hasSelectedPool: boolean
	isOnActiveAppChain: boolean
	questionOutcome?: ReportingOutcomeKey | 'none' | undefined
	shareBalances?: TradingShareBalances | undefined
}) {
	if (!hasSelectedPool) return tradingCopy.shareRedemptionPoolRequiredReason
	const walletGuardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason: tradingCopy.shareRedemptionWalletRequiredReason })
	if (walletGuardState.blocked) return walletGuardState.reason
	if (questionOutcome === undefined) return undefined
	if (questionOutcome === 'none') return tradingCopy.poolResolutionRequired
	const winningAttoShares = getSelectedOutcomeShareBalance(shareBalances, questionOutcome)
	if (winningAttoShares === undefined) return tradingCopy.loadingWalletShareBalances
	if (winningAttoShares === 0n) return tradingCopy.formatNoWinningSharesReason(getReportingOutcomeLabel(questionOutcome))
	return undefined
}
