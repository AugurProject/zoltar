import type { Address } from 'viem'
import { formatCurrencyBalance } from './formatters.js'
import { parseTradingAmountInput } from './marketForm.js'
import { getReportingOutcomeLabel } from './reporting.js'
import type { ReportingOutcomeKey, SecurityPoolSystemState, TradingShareBalances } from '../types/contracts.js'

const PRICE_PRECISION = 10n ** 18n

export function getRemainingMintCapacity(totalSecurityBondAllowance: bigint | undefined, completeSetCollateralAmount: bigint | undefined) {
	if (totalSecurityBondAllowance === undefined || completeSetCollateralAmount === undefined) return undefined
	return totalSecurityBondAllowance > completeSetCollateralAmount ? totalSecurityBondAllowance - completeSetCollateralAmount : 0n
}

export function getAllowanceBackedRep(totalSecurityBondAllowance: bigint | undefined, lastOraclePrice: bigint | undefined) {
	if (totalSecurityBondAllowance === undefined || lastOraclePrice === undefined) return undefined
	return (totalSecurityBondAllowance * lastOraclePrice) / PRICE_PRECISION
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

export function getSelectedOutcomeShareBalance(shareBalances: TradingShareBalances | undefined, outcome: ReportingOutcomeKey) {
	if (shareBalances === undefined) return undefined
	switch (outcome) {
		case 'invalid':
			return shareBalances.invalid
		case 'yes':
			return shareBalances.yes
		case 'no':
			return shareBalances.no
	}
}

export function getTradingMintGuardMessage({
	accountAddress,
	completeSetCollateralAmount,
	ethBalance,
	hasSelectedPool,
	isMainnet,
	mintAmountInput,
	systemState,
	totalRepDeposit,
	totalSecurityBondAllowance,
	universeHasForked,
}: {
	accountAddress: Address | undefined
	completeSetCollateralAmount: bigint | undefined
	ethBalance: bigint | undefined
	hasSelectedPool: boolean
	isMainnet: boolean
	mintAmountInput: string
	systemState: SecurityPoolSystemState | undefined
	totalRepDeposit: bigint | undefined
	totalSecurityBondAllowance: bigint | undefined
	universeHasForked: boolean | undefined
}) {
	if (!hasSelectedPool) return 'Load a pool before minting.'
	if (accountAddress === undefined) return 'Connect a wallet before minting complete sets.'
	if (!isMainnet) return 'Switch to Ethereum mainnet before minting complete sets.'
	if (universeHasForked === true) return 'Minting is unavailable after this universe has forked.'
	if (systemState !== undefined && systemState !== 'operational') return 'Minting is only available while the pool is operational.'

	const remainingCapacity = getRemainingMintCapacity(totalSecurityBondAllowance, completeSetCollateralAmount)
	if (remainingCapacity === undefined) return 'Loading mint capacity.'
	if (remainingCapacity === 0n) {
		if (hasRepBackedPoolWithNoActiveAllowance(totalRepDeposit, totalSecurityBondAllowance)) {
			return 'No mint capacity. No active security bond allowance.'
		}

		return 'No mint capacity remaining.'
	}

	const trimmedAmount = mintAmountInput.trim()
	if (trimmedAmount === '') return 'Enter a mint amount greater than zero.'

	let mintAmount: bigint
	try {
		mintAmount = parseTradingAmountInput(trimmedAmount, 'Mint amount')
	} catch {
		return 'Enter a valid mint amount.'
	}

	if (mintAmount <= 0n) return 'Enter a mint amount greater than zero.'
	if (mintAmount > remainingCapacity) return `Max mint capacity is ${formatCurrencyBalance(remainingCapacity)} ETH.`
	if (ethBalance === undefined) return 'Loading wallet ETH balance.'
	if (mintAmount > ethBalance) return `Need ${formatCurrencyBalance(mintAmount - ethBalance)} more ETH in this wallet to mint the selected amount.`
	return undefined
}

export function getTradingRedeemCompleteSetGuardMessage({
	accountAddress,
	hasSelectedPool,
	isMainnet,
	loadingTradingDetails,
	redeemAmountInput,
	shareBalances,
	systemState,
	universeHasForked,
}: {
	accountAddress: Address | undefined
	hasSelectedPool: boolean
	isMainnet: boolean
	loadingTradingDetails: boolean
	redeemAmountInput: string
	shareBalances: TradingShareBalances | undefined
	systemState: SecurityPoolSystemState | undefined
	universeHasForked: boolean | undefined
}) {
	if (!hasSelectedPool) return 'Load a pool before redeeming complete sets.'
	if (accountAddress === undefined) return 'Connect a wallet before redeeming complete sets.'
	if (!isMainnet) return 'Switch to Ethereum mainnet before redeeming complete sets.'
	if (universeHasForked === true) return 'Redeeming complete sets is unavailable after this universe has forked.'
	if (systemState !== undefined && systemState !== 'operational') return 'Redeeming complete sets is only available while the pool is operational.'
	if (loadingTradingDetails) return 'Loading wallet share balances.'

	const maxRedeemableCompleteSets = getMaxRedeemableCompleteSets(shareBalances)
	if (maxRedeemableCompleteSets === undefined) return 'Loading wallet share balances.'
	if (maxRedeemableCompleteSets === 0n) return 'Need matching Invalid, Yes, and No shares to redeem complete sets.'

	const trimmedAmount = redeemAmountInput.trim()
	if (trimmedAmount === '') return 'Enter a redeem amount greater than zero.'

	let redeemAmount: bigint
	try {
		redeemAmount = parseTradingAmountInput(trimmedAmount, 'Redeem amount')
	} catch {
		return 'Enter a valid redeem amount.'
	}

	if (redeemAmount <= 0n) return 'Enter a redeem amount greater than zero.'
	if (redeemAmount > maxRedeemableCompleteSets) return `Max redeemable amount is ${formatCurrencyBalance(maxRedeemableCompleteSets)} complete sets.`
	return undefined
}

export function getTradingMigrateSharesGuardMessage({
	accountAddress,
	hasSelectedPool,
	isMainnet,
	loadingTradingDetails,
	selectedOutcome,
	shareBalances,
	universeHasForked,
}: {
	accountAddress: Address | undefined
	hasSelectedPool: boolean
	isMainnet: boolean
	loadingTradingDetails: boolean
	selectedOutcome: ReportingOutcomeKey
	shareBalances: TradingShareBalances | undefined
	universeHasForked: boolean | undefined
}) {
	if (!hasSelectedPool) return 'Load a pool before migrating shares.'
	if (accountAddress === undefined) return 'Connect a wallet before migrating shares.'
	if (!isMainnet) return 'Switch to Ethereum mainnet before migrating shares.'
	if (universeHasForked !== true) return 'Share migration is only available after this universe has forked.'
	if (loadingTradingDetails) return 'Loading wallet share balances.'

	const selectedOutcomeBalance = getSelectedOutcomeShareBalance(shareBalances, selectedOutcome)
	if (selectedOutcomeBalance === undefined) return 'Loading wallet share balances.'
	if (selectedOutcomeBalance === 0n) return `No ${getReportingOutcomeLabel(selectedOutcome)} shares available to migrate.`
	return undefined
}

export function getTradingRedeemSharesGuardMessage({
	accountAddress,
	hasSelectedPool,
	isMainnet,
	questionOutcome,
	systemState,
	universeHasForked,
}: {
	accountAddress: Address | undefined
	hasSelectedPool: boolean
	isMainnet: boolean
	questionOutcome: ReportingOutcomeKey | 'none' | undefined
	systemState: SecurityPoolSystemState | undefined
	universeHasForked: boolean | undefined
}) {
	if (!hasSelectedPool) return 'Load a pool before redeeming shares.'
	if (accountAddress === undefined) return 'Connect a wallet before redeeming shares.'
	if (!isMainnet) return 'Switch to Ethereum mainnet before redeeming shares.'
	if (universeHasForked === true) return 'Redeeming shares is unavailable after this universe has forked.'
	if (systemState !== undefined && systemState !== 'operational') return 'Redeeming shares is only available while the pool is operational.'
	if (questionOutcome === undefined || questionOutcome === 'none') return 'This market has not finalized yet.'
	return undefined
}
