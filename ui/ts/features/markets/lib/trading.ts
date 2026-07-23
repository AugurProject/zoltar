import type { Address } from '@zoltar/shared/ethereum'
import { getWalletMainnetGuardState } from '../../../lib/actionGuards.js'
import { assertNever } from '../../../lib/assert.js'
import { formatCurrencyBalance } from '../../../lib/formatters.js'
import { tryParseBigIntListInput } from '../../../lib/inputs.js'
import { tryParseTradingAmountInput } from './marketForm.js'
import { getReportingOutcomeLabel } from '../../reporting/lib/reporting.js'
import { isValidScalarOutcomeIndex } from './scalarOutcome.js'
import type { DeploymentStatus } from '../../../types/contracts.js'
import type { ReportingOutcomeKey, TradingShareBalances, ZoltarUniverseSummary } from '../../../types/contracts.js'

const PRICE_PRECISION = 10n ** 18n
const PERCENT_MULTIPLIER = 100n

type CollateralizationDisplayState = 'value' | 'noActiveAllowance' | 'unavailable'
type CollateralizationTone = 'success' | 'danger'

export const MARKET_NOT_FINALIZED_MESSAGE = 'This market has not finalized.'
export const SHARE_MIGRATION_AFTER_FORK_MESSAGE = 'Share migration is only available after this universe has forked.'
export const NO_MINT_CAPACITY_NO_ACTIVE_ALLOWANCE_MESSAGE = 'No mint capacity. No active security bond allowance.'
export const NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE = 'Need matching Invalid, Yes, and No shares to redeem complete sets.'
export const UNDEFINED_COMPLETE_SET_EXCHANGE_RATE_MESSAGE = 'Minting is unavailable because this pool has complete-set shares but no collateral.'

const HIDDEN_TRADING_GUARD_MESSAGES = [NO_MINT_CAPACITY_NO_ACTIVE_ALLOWANCE_MESSAGE, NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE]

export function hasUndefinedCompleteSetExchangeRate(completeSetCollateralAmount: bigint | undefined, shareTokenSupply: bigint | undefined) {
	if (completeSetCollateralAmount === undefined || shareTokenSupply === undefined) return undefined
	return completeSetCollateralAmount === 0n && shareTokenSupply !== 0n
}

export function getRemainingMintCapacity(totalSecurityBondAllowance: bigint | undefined, completeSetCollateralAmount: bigint | undefined, shareTokenSupply?: bigint | undefined) {
	if (totalSecurityBondAllowance === undefined || completeSetCollateralAmount === undefined) return undefined
	if (hasUndefinedCompleteSetExchangeRate(completeSetCollateralAmount, shareTokenSupply) === true) return 0n
	return totalSecurityBondAllowance > completeSetCollateralAmount ? totalSecurityBondAllowance - completeSetCollateralAmount : 0n
}

function getCollateralizationPercent(repDeposit: bigint | undefined, securityBondAllowance: bigint | undefined, repPerEthPrice: bigint | undefined) {
	if (repDeposit === undefined || securityBondAllowance === undefined || repPerEthPrice === undefined || repPerEthPrice === 0n || securityBondAllowance === 0n) return undefined
	return (repDeposit * PERCENT_MULTIPLIER * PRICE_PRECISION * PRICE_PRECISION) / (securityBondAllowance * repPerEthPrice)
}

export function getPoolCollateralizationPercent(totalRepDeposit: bigint | undefined, totalSecurityBondAllowance: bigint | undefined, repPerEthPrice: bigint | undefined) {
	return getCollateralizationPercent(totalRepDeposit, totalSecurityBondAllowance, repPerEthPrice)
}

export function getVaultCollateralizationPercent(repDepositShare: bigint | undefined, securityBondAllowance: bigint | undefined, repPerEthPrice: bigint | undefined) {
	return getCollateralizationPercent(repDepositShare, securityBondAllowance, repPerEthPrice)
}

export function getCollateralizationTone(collateralizationPercent: bigint | undefined, securityMultiplier: bigint | undefined): CollateralizationTone | undefined {
	if (collateralizationPercent === undefined || securityMultiplier === undefined) return undefined
	return collateralizationPercent < securityMultiplier * PERCENT_MULTIPLIER * PRICE_PRECISION ? 'danger' : 'success'
}

export function getCollateralizationDisplayState(securityBondAllowance: bigint | undefined, collateralizationPercent: bigint | undefined): CollateralizationDisplayState {
	if (securityBondAllowance === 0n) return 'noActiveAllowance'
	return collateralizationPercent === undefined ? 'unavailable' : 'value'
}

export function hasRepBackedPoolWithNoActiveAllowance(totalRepDeposit: bigint | undefined, totalSecurityBondAllowance: bigint | undefined) {
	return (totalRepDeposit ?? 0n) > 0n && (totalSecurityBondAllowance ?? 0n) === 0n
}

export function getMaxRedeemableCompleteSets(shareBalances: TradingShareBalances | undefined) {
	if (shareBalances === undefined) return undefined
	if (shareBalances.invalid <= shareBalances.yes && shareBalances.invalid <= shareBalances.no) return shareBalances.invalid
	if (shareBalances.yes <= shareBalances.invalid && shareBalances.yes <= shareBalances.no) return shareBalances.yes
	return shareBalances.no
}

function formatCompleteSetAmount(value: bigint) {
	const formattedValue = formatCurrencyBalance(value)
	return `${formattedValue} complete ${formattedValue === '1' ? 'set' : 'sets'}`
}

function divideRoundedUp(numerator: bigint, denominator: bigint) {
	if (denominator <= 0n) throw new RangeError('Denominator must be greater than zero')
	return (numerator + denominator - 1n) / denominator
}

export function convertShareAmountToCollateralAmount(shareAmount: undefined, completeSetCollateralAmount: bigint | undefined, shareTokenSupply: bigint | undefined): undefined
export function convertShareAmountToCollateralAmount(shareAmount: bigint, completeSetCollateralAmount: bigint | undefined, shareTokenSupply: bigint | undefined): bigint
export function convertShareAmountToCollateralAmount(shareAmount: bigint | undefined, completeSetCollateralAmount: bigint | undefined, shareTokenSupply: bigint | undefined): bigint | undefined
export function convertShareAmountToCollateralAmount(shareAmount: bigint | undefined, completeSetCollateralAmount: bigint | undefined, shareTokenSupply: bigint | undefined) {
	if (shareAmount === undefined) return undefined
	if (completeSetCollateralAmount === undefined || shareTokenSupply === undefined) return shareAmount
	if (shareTokenSupply === 0n) return shareAmount
	return (shareAmount * completeSetCollateralAmount) / shareTokenSupply
}

export function convertCollateralAmountToShareAmount(collateralAmount: bigint, completeSetCollateralAmount: bigint | undefined, shareTokenSupply: bigint | undefined) {
	if (completeSetCollateralAmount === undefined || shareTokenSupply === undefined) return collateralAmount
	if (completeSetCollateralAmount === 0n) {
		if (shareTokenSupply !== 0n) return undefined
		return collateralAmount
	}
	return divideRoundedUp(collateralAmount * shareTokenSupply, completeSetCollateralAmount)
}

export function getSelectedOutcomeShareBalance(shareBalances: TradingShareBalances | undefined, outcome: ReportingOutcomeKey) {
	if (shareBalances === undefined) return undefined
	switch (outcome) {
		case 'invalid':
			return shareBalances.invalid
		case 'yes':
			return shareBalances.yes
		case 'no':
			return shareBalances.no
		default:
			return assertNever(outcome)
	}
}

export function getTradingGuardDisplayMessage(message: string | undefined) {
	if (message === undefined) return undefined

	for (const hiddenMessage of HIDDEN_TRADING_GUARD_MESSAGES) {
		if (message === hiddenMessage) return undefined
	}

	return message
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

export function getTradingMintGuardMessage({
	accountAddress,
	completeSetCollateralAmount,
	ethBalance,
	hasSelectedPool,
	isMainnet,
	mintAmountInput,
	shareTokenSupply,
	totalRepDeposit,
	totalSecurityBondAllowance,
}: {
	accountAddress: Address | undefined
	completeSetCollateralAmount: bigint | undefined
	ethBalance: bigint | undefined
	hasSelectedPool: boolean
	isMainnet: boolean
	mintAmountInput: string
	shareTokenSupply: bigint | undefined
	totalRepDeposit: bigint | undefined
	totalSecurityBondAllowance: bigint | undefined
}) {
	if (!hasSelectedPool) return 'Select a pool before minting.'
	const walletGuardState = getWalletMainnetGuardState({ accountAddress, isMainnet, walletRequiredReason: 'Connect a wallet before minting complete sets.' })
	if (walletGuardState.blocked) return walletGuardState.reason

	const undefinedExchangeRate = hasUndefinedCompleteSetExchangeRate(completeSetCollateralAmount, shareTokenSupply)
	if (undefinedExchangeRate === undefined) return 'Loading mint capacity.'
	if (undefinedExchangeRate) return UNDEFINED_COMPLETE_SET_EXCHANGE_RATE_MESSAGE

	const remainingCapacity = getRemainingMintCapacity(totalSecurityBondAllowance, completeSetCollateralAmount, shareTokenSupply)
	if (remainingCapacity === undefined) return 'Loading mint capacity.'
	if (remainingCapacity === 0n) {
		if (hasRepBackedPoolWithNoActiveAllowance(totalRepDeposit, totalSecurityBondAllowance)) return NO_MINT_CAPACITY_NO_ACTIVE_ALLOWANCE_MESSAGE

		return 'No mint capacity remaining.'
	}

	const trimmedAmount = mintAmountInput.trim()
	if (trimmedAmount === '') return 'Enter a mint amount greater than zero.'
	const mintAmount = tryParseTradingAmountInput(trimmedAmount)
	if (mintAmount === undefined) return 'Enter a valid mint amount.'

	if (mintAmount <= 0n) return 'Enter a mint amount greater than zero.'
	if (mintAmount > remainingCapacity) return `Max mint capacity is ${formatCurrencyBalance(remainingCapacity)} ETH.`
	if (ethBalance === undefined) return 'Loading wallet ETH balance.'
	if (mintAmount > ethBalance) return `Need ${formatCurrencyBalance(mintAmount - ethBalance)} more ETH in this wallet to mint the selected amount.`
	return undefined
}

export function getTradingRedeemCompleteSetGuardMessage({
	accountAddress,
	completeSetCollateralAmount,
	hasSelectedPool,
	isMainnet,
	loadingTradingDetails,
	redeemAmountInput,
	shareBalances,
	shareTokenSupply,
}: {
	accountAddress: Address | undefined
	completeSetCollateralAmount: bigint | undefined
	hasSelectedPool: boolean
	isMainnet: boolean
	loadingTradingDetails: boolean
	redeemAmountInput: string
	shareBalances: TradingShareBalances | undefined
	shareTokenSupply: bigint | undefined
}) {
	if (!hasSelectedPool) return 'Select a pool before redeeming complete sets.'
	const walletGuardState = getWalletMainnetGuardState({ accountAddress, isMainnet, walletRequiredReason: 'Connect a wallet before redeeming complete sets.' })
	if (walletGuardState.blocked) return walletGuardState.reason
	if (loadingTradingDetails) return 'Loading wallet share balances.'

	const maxRedeemableCompleteSets = getMaxRedeemableCompleteSets(shareBalances)
	if (maxRedeemableCompleteSets === undefined) return 'Loading wallet share balances.'
	if (maxRedeemableCompleteSets === 0n) return NEED_MATCHING_COMPLETE_SET_SHARES_MESSAGE

	const trimmedAmount = redeemAmountInput.trim()
	if (trimmedAmount === '') return 'Enter a redeem amount greater than zero.'
	const redeemAmount = tryParseTradingAmountInput(trimmedAmount)
	if (redeemAmount === undefined) return 'Enter a valid redeem amount.'

	if (redeemAmount <= 0n) return 'Enter a redeem amount greater than zero.'
	const redeemShareAmount = convertCollateralAmountToShareAmount(redeemAmount, completeSetCollateralAmount, shareTokenSupply)
	if (redeemShareAmount === undefined) return 'Redeeming is unavailable because this pool has complete-set shares but no collateral.'
	if (redeemShareAmount > maxRedeemableCompleteSets) {
		const maxRedeemableCollateralAmount = convertShareAmountToCollateralAmount(maxRedeemableCompleteSets, completeSetCollateralAmount, shareTokenSupply)
		return `Max redeemable amount is ${formatCompleteSetAmount(maxRedeemableCollateralAmount)}.`
	}
	return undefined
}

export function getTradingMigrateSharesGuardMessage({
	accountAddress,
	hasSelectedPool,
	isMainnet,
	loadingTradingForkUniverse,
	loadingTradingDetails,
	selectedShareOutcome,
	shareBalances,
	targetOutcomeIndexesInput,
	tradingForkUniverse,
}: {
	accountAddress: Address | undefined
	hasSelectedPool: boolean
	isMainnet: boolean
	loadingTradingForkUniverse: boolean
	loadingTradingDetails: boolean
	selectedShareOutcome: ReportingOutcomeKey
	shareBalances: TradingShareBalances | undefined
	targetOutcomeIndexesInput: string
	tradingForkUniverse: ZoltarUniverseSummary | undefined
}) {
	if (!hasSelectedPool) return 'Select a pool before migrating shares.'
	const walletGuardState = getWalletMainnetGuardState({ accountAddress, isMainnet, walletRequiredReason: 'Connect a wallet before migrating shares.' })
	if (walletGuardState.blocked) return walletGuardState.reason
	if (loadingTradingForkUniverse) return 'Loading fork target universes.'
	if (tradingForkUniverse === undefined || !tradingForkUniverse.hasForked) return 'Refresh the fork target universes.'

	const targetOutcomeIndexes = tryParseBigIntListInput(targetOutcomeIndexesInput)
	if (targetOutcomeIndexes === undefined) return targetOutcomeIndexesInput.trim() === '' ? 'Select at least one target child universe.' : 'Select valid target child universes.'

	if (!areShareMigrationTargetOutcomeIndexesValid(tradingForkUniverse, targetOutcomeIndexes)) return 'Select valid target child universes.'
	if (loadingTradingDetails) return 'Loading wallet share balances.'

	const selectedOutcomeBalance = getSelectedOutcomeShareBalance(shareBalances, selectedShareOutcome)
	if (selectedOutcomeBalance === undefined) return 'Loading wallet share balances.'
	if (selectedOutcomeBalance === 0n) return `No ${getReportingOutcomeLabel(selectedShareOutcome)} shares available to migrate.`
	return undefined
}

export function getTradingRedeemSharesGuardMessage({ accountAddress, hasSelectedPool, isMainnet }: { accountAddress: Address | undefined; hasSelectedPool: boolean; isMainnet: boolean }) {
	if (!hasSelectedPool) return 'Select a pool before redeeming shares.'
	const walletGuardState = getWalletMainnetGuardState({ accountAddress, isMainnet, walletRequiredReason: 'Connect a wallet before redeeming shares.' })
	if (walletGuardState.blocked) return walletGuardState.reason
	return undefined
}
