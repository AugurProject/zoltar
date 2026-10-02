import * as securityPoolCopy from '../../../copy/securityPool.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS } from '@zoltar/statoblast-shared/initialReport/oracleInitialReport'
import type { MarketDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import { getWalletActiveAppChainGuardState } from '@zoltar/ui-core-shared/transactions/actionGuards.js'
import { tryParseInitialReportPriorityFeeInput } from './priorityFee.js'
import { formatMultiplier } from '@zoltar/ui-core-shared/lib/formatters.js'
import { tryParseStatoblastSecurityMultiplierBpsInput } from '../../markets/lib/marketForm.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'

const MINIMUM_STATOBLAST_SECURITY_MULTIPLIER_BPS = 10_002n

export function getStatoblastSecurityMultiplierValidationMessage(statoblastSecurityMultiplier: string) {
	const input = statoblastSecurityMultiplier.trim()
	if (input === '') return `Enter a security multiplier of at least ${formatMultiplier(MINIMUM_STATOBLAST_SECURITY_MULTIPLIER_BPS, 4)}.`
	const statoblastSecurityMultiplierBps = tryParseStatoblastSecurityMultiplierBpsInput(input)
	if (statoblastSecurityMultiplierBps === undefined) return 'Enter a multiplier with at most 4 decimal places.'
	if (statoblastSecurityMultiplierBps < MINIMUM_STATOBLAST_SECURITY_MULTIPLIER_BPS) return `Security multiplier must be at least ${formatMultiplier(MINIMUM_STATOBLAST_SECURITY_MULTIPLIER_BPS, 4)}.`
	return undefined
}

export function getInitialReportPriorityFeeValidationMessage(initialReportPriorityFeeNanoEth: string) {
	const input = initialReportPriorityFeeNanoEth.trim()
	if (input === '') return 'Enter an initial-report priority fee in nanoETH per gas.'
	const priorityFeeAttoEthPerGas = tryParseInitialReportPriorityFeeInput(input)
	if (priorityFeeAttoEthPerGas === undefined) return 'Enter a nanoETH value with at most 9 decimal places.'
	if (priorityFeeAttoEthPerGas <= 0n) return 'Initial-report priority fee must be greater than 0\u00a0nanoETH per gas.'
	if (priorityFeeAttoEthPerGas > MAX_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS) return 'Initial-report priority fee is too large for OpenOracle report limits.'
	return undefined
}

export function getSecurityPoolCreateDisabledReason({
	accountAddress,
	currentTimestamp,
	checkingDuplicateOriginPool,
	duplicateOriginPoolExists,
	initialReportPriorityFeeNanoEth,
	isOnActiveAppChain,
	marketDetails,
	securityPoolCreating,
	statoblastSecurityMultiplier,
	zoltarUniverseHasForked,
}: {
	accountAddress: Address | undefined
	currentTimestamp?: bigint | undefined
	checkingDuplicateOriginPool: boolean
	duplicateOriginPoolExists: boolean
	initialReportPriorityFeeNanoEth: string
	isOnActiveAppChain: boolean
	marketDetails: MarketDetails | undefined
	securityPoolCreating: boolean
	statoblastSecurityMultiplier: string
	zoltarUniverseHasForked: boolean
}) {
	const walletGuardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason: commonCopy.formatConnectWalletBefore('creating a security pool') })
	if (walletGuardState.blocked) return walletGuardState.reason
	const statoblastSecurityMultiplierValidationMessage = getStatoblastSecurityMultiplierValidationMessage(statoblastSecurityMultiplier)
	if (statoblastSecurityMultiplierValidationMessage !== undefined) return statoblastSecurityMultiplierValidationMessage
	if (checkingDuplicateOriginPool) return 'Checking whether a pool already exists for this question, security multiplier, and priority fee.'
	if (securityPoolCreating) return 'Security pool creation is already in progress.'
	if (duplicateOriginPoolExists) return 'A pool for this question, security multiplier, and priority fee already exists.'
	if (marketDetails === undefined) return 'Enter an exact binary Yes / No question before creating a pool.'
	if (marketDetails.marketType !== 'binary') return 'Security pools can only be created for exact binary Yes / No questions.'
	if (currentTimestamp !== undefined && marketDetails.endTime <= currentTimestamp) return securityPoolCopy.questionEndedReason
	if (zoltarUniverseHasForked) return 'Security pools cannot be created after this universe has forked.'
	return getInitialReportPriorityFeeValidationMessage(initialReportPriorityFeeNanoEth)
}
