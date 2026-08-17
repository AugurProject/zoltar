import type { Address } from '@zoltar/shared/ethereum'
import { MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS } from '@zoltar/shared/oracleInitialReport'
import type { MarketDetails } from '../../../types/contracts.js'
import { getWalletActiveAppChainGuardState } from '../../../lib/actionGuards.js'
import { tryParseDecimalInput } from '../../../lib/decimal.js'
import { tryParseStatoblastSecurityMultiplierBpsInput } from '../../markets/lib/marketForm.js'

export function getStatoblastSecurityMultiplierValidationMessage(statoblastSecurityMultiplier: string) {
	const input = statoblastSecurityMultiplier.trim()
	if (input === '') return 'Enter a Statoblast security multiplier of at least 1.0002x.'
	const statoblastSecurityMultiplierBps = tryParseStatoblastSecurityMultiplierBpsInput(input)
	if (statoblastSecurityMultiplierBps === undefined) return 'Enter a multiplier in x with at most 4 decimal places.'
	if (statoblastSecurityMultiplierBps <= 10_001n) return 'Statoblast security multiplier must be at least 1.0002x.'
	return undefined
}

export function getInitialReportPriorityFeeValidationMessage(initialReportPriorityFeeGwei: string) {
	const input = initialReportPriorityFeeGwei.trim()
	if (input === '') return 'Enter an initial-report priority fee in gwei.'
	const priorityFeeAttoEthPerGas = tryParseDecimalInput(input, 9)
	if (priorityFeeAttoEthPerGas === undefined) return 'Enter a gwei value with at most 9 decimal places.'
	if (priorityFeeAttoEthPerGas <= 0n) return 'Initial-report priority fee must be greater than 0\u00a0gwei.'
	if (priorityFeeAttoEthPerGas > MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS) return 'Initial-report priority fee is too large for Open Oracle report limits.'
	return undefined
}

export function getSecurityPoolCreateDisabledReason({
	accountAddress,
	checkingDuplicateOriginPool,
	duplicateOriginPoolExists,
	initialReportPriorityFeeGwei,
	isOnActiveAppChain,
	marketDetails,
	securityPoolCreating,
	statoblastSecurityMultiplier,
	zoltarUniverseHasForked,
}: {
	accountAddress: Address | undefined
	checkingDuplicateOriginPool: boolean
	duplicateOriginPoolExists: boolean
	initialReportPriorityFeeGwei: string
	isOnActiveAppChain: boolean
	marketDetails: MarketDetails | undefined
	securityPoolCreating: boolean
	statoblastSecurityMultiplier: string
	zoltarUniverseHasForked: boolean
}) {
	const walletGuardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason: 'Connect a wallet before creating a security pool.' })
	if (walletGuardState.blocked) return walletGuardState.reason
	const statoblastSecurityMultiplierValidationMessage = getStatoblastSecurityMultiplierValidationMessage(statoblastSecurityMultiplier)
	if (statoblastSecurityMultiplierValidationMessage !== undefined) return statoblastSecurityMultiplierValidationMessage
	if (checkingDuplicateOriginPool) return 'Checking whether a pool already exists for this question, Statoblast security multiplier, and priority fee.'
	if (securityPoolCreating) return 'Security pool creation is already in progress.'
	if (duplicateOriginPoolExists) return 'A pool for this question, Statoblast security multiplier, and priority fee already exists.'
	if (marketDetails === undefined) return 'Enter an exact binary Yes / No question before creating a pool.'
	if (marketDetails.marketType !== 'binary') return 'Security pools can only be created for exact binary Yes / No questions.'
	if (zoltarUniverseHasForked) return 'Security pools cannot be created after this universe has forked.'
	return getInitialReportPriorityFeeValidationMessage(initialReportPriorityFeeGwei)
}
