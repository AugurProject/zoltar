import type { Address } from '@zoltar/shared/ethereum'
import { MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_WEI_PER_GAS } from '@zoltar/shared/oracleInitialReport'
import type { MarketDetails } from '../../../types/contracts.js'
import { getWalletMainnetGuardState } from '../../../lib/actionGuards.js'
import { tryParseDecimalInput } from '../../../lib/decimal.js'

export function getInitialReportPriorityFeeValidationMessage(initialReportPriorityFeeGwei: string) {
	const input = initialReportPriorityFeeGwei.trim()
	if (input === '') return 'Enter an initial-report priority fee in gwei.'
	const priorityFeeWeiPerGas = tryParseDecimalInput(input, 9)
	if (priorityFeeWeiPerGas === undefined) return 'Enter a gwei value with at most 9 decimal places.'
	if (priorityFeeWeiPerGas <= 0n) return 'Initial-report priority fee must be greater than 0 gwei.'
	if (priorityFeeWeiPerGas > MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_WEI_PER_GAS) return 'Initial-report priority fee is too large for Open Oracle report limits.'
	return undefined
}

export function getSecurityPoolCreateDisabledReason({
	accountAddress,
	checkingDuplicateOriginPool,
	duplicateOriginPoolExists,
	initialReportPriorityFeeGwei,
	isMainnet,
	marketDetails,
	securityPoolCreating,
	zoltarUniverseHasForked,
}: {
	accountAddress: Address | undefined
	checkingDuplicateOriginPool: boolean
	duplicateOriginPoolExists: boolean
	initialReportPriorityFeeGwei: string
	isMainnet: boolean
	marketDetails: MarketDetails | undefined
	securityPoolCreating: boolean
	zoltarUniverseHasForked: boolean
}) {
	const walletGuardState = getWalletMainnetGuardState({ accountAddress, isMainnet, walletRequiredReason: 'Connect a wallet before creating a security pool.' })
	if (walletGuardState.blocked) return walletGuardState.reason
	if (checkingDuplicateOriginPool) return 'Checking whether a pool already exists for this question, security multiplier, and priority fee.'
	if (securityPoolCreating) return 'Security pool creation is already in progress.'
	if (duplicateOriginPoolExists) return 'A pool for this question, security multiplier, and priority fee already exists.'
	if (marketDetails === undefined) return 'Enter an exact binary Yes / No question before creating a pool.'
	if (marketDetails.marketType !== 'binary') return 'Security pools can only be created for exact binary Yes / No questions.'
	if (zoltarUniverseHasForked) return 'Security pools cannot be created after Zoltar has forked.'
	return getInitialReportPriorityFeeValidationMessage(initialReportPriorityFeeGwei)
}
