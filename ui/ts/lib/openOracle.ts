import { zeroAddress, type Address } from 'viem'
import type { OpenOracleReportDetails, OpenOracleReportSummary } from '../types/contracts.js'
import { parseDecimalInput } from './decimal.js'
import { formatWriteErrorMessage, getErrorDetail, sanitizeErrorDetail } from './errors.js'
import { formatCurrencyBalance, formatCurrencyInputBalance } from './formatters.js'
import { deriveTokenApprovalRequirement, formatTokenApprovalUnavailableMessage, type TokenApprovalRequirement } from './tokenApproval.js'
import { quoteBestExactInputWithSource, quoteBestV3ExactInputWithSource, quoteExactInput, WETH_ADDRESS } from './uniswapQuoter.js'

const OPEN_ORACLE_PRICE_PRECISION = 10n ** 18n
const OPEN_ORACLE_BOUNTY_BUFFER_NUMERATOR = 12n
const OPEN_ORACLE_BOUNTY_BUFFER_DENOMINATOR = 10n

type OpenOracleReportStatus = 'Awaiting Initial Report' | 'Pending' | 'Disputed' | 'Settled'
export type OpenOracleSelectedReportActionMode = 'initial-report' | 'dispute' | 'read-only'
export type OpenOracleInitialReportPriceSource = 'Uniswap V4' | 'Uniswap V3' | 'Manual override' | 'Unavailable'
export type OpenOracleInitialReportQuoteSource = Exclude<OpenOracleInitialReportPriceSource, 'Manual override' | 'Unavailable'>
export type OpenOracleInitialReportQuoteFailureKind = 'unsupported-pair' | 'quote-failed'
type OpenOracleGateMessage = {
	kind: 'hidden-loading' | 'visible'
	message: string
}

type OpenOracleReportActionAvailability = {
	canAct: boolean
	message: string | undefined
}

type OpenOracleInitialReportPriceLoadResult =
	| {
			status: 'success'
			price: bigint
			priceSource: OpenOracleInitialReportQuoteSource
			priceSourceUrl: string | undefined
			token2Amount: bigint
	  }
	| {
			attemptedSources: OpenOracleInitialReportQuoteSource[]
			failureKind: OpenOracleInitialReportQuoteFailureKind
			reason: string | undefined
			status: 'failure'
	  }

type OpenOracleInitialReportSubmissionDetails = {
	amount1: bigint | undefined
	amount2: bigint | undefined
	blockMessage: OpenOracleGateMessage | undefined
	canSubmit: boolean
	canWrapRequiredWeth: boolean
	hasWethWrapAction: boolean
	price: bigint | undefined
	priceInput: string
	priceSource: OpenOracleInitialReportPriceSource
	priceSourceUrl: string | undefined
	requiredWethWrapAmount: bigint | undefined
	token1Approval: TokenApprovalRequirement
	token1Decimals: number | undefined
	token2Approval: TokenApprovalRequirement
	token2Decimals: number | undefined
	wrapRequiredWethMessage: OpenOracleGateMessage | undefined
}

function formatOpenOracleInitialReportLifecycleMessage(status: OpenOracleReportStatus) {
	switch (status) {
		case 'Pending':
		case 'Disputed':
			return 'This report already has an initial report.'
		case 'Settled':
			return 'This report is already settled and can no longer accept an initial report.'
		case 'Awaiting Initial Report':
			return undefined
	}
}

export function formatOpenOracleInitialReportWriteErrorMessage(error: unknown, fallbackMessage = 'Failed to submit initial report') {
	const genericMessage = formatWriteErrorMessage(error, fallbackMessage)
	if (genericMessage === 'Action canceled in wallet.') {
		return genericMessage
	}

	const detail = getErrorDetail(error, fallbackMessage)
	const normalizedDetail = detail?.toLowerCase()
	if (normalizedDetail === undefined) {
		return 'Transaction failed while submitting the initial report. Reload the report and try again.'
	}

	if (genericMessage === detail) {
		return detail
	}

	if (normalizedDetail.includes('report submitted')) {
		return 'This report already has an initial report.'
	}
	if (normalizedDetail.includes('report id')) {
		return 'This report is no longer valid. Reload it before submitting the initial report again.'
	}
	if (normalizedDetail.includes('token1 amount')) {
		return 'The required token1 amount changed on-chain. Reload the report before submitting the initial report again.'
	}
	if (normalizedDetail.includes('token2 amount')) {
		return 'The selected price produces an invalid token2 amount for the initial report.'
	}
	if (normalizedDetail.includes('state hash')) {
		return 'This report changed on-chain. Reload the report before submitting the initial report again.'
	}
	if (
		normalizedDetail.includes('allowance') ||
		normalizedDetail.includes('balance') ||
		normalizedDetail.includes('transfer amount exceeds') ||
		normalizedDetail.includes('transferfrom') ||
		normalizedDetail.includes('transfer from') ||
		normalizedDetail.includes('erc20insufficientallowance') ||
		normalizedDetail.includes('erc20insufficientbalance') ||
		normalizedDetail.includes('safeerc20')
	) {
		return 'Transaction failed while submitting the initial report. Wallet balance or token approval changed since the last refresh. Reload the report and verify both token balances and approvals before submitting the initial report again.'
	}

	return `Transaction failed while submitting the initial report. Reason: ${detail}`
}

export function formatOpenOracleSettleWriteErrorMessage(error: unknown, fallbackMessage = 'Failed to settle report') {
	const genericMessage = formatWriteErrorMessage(error, fallbackMessage)
	if (genericMessage === 'Action canceled in wallet.') {
		return genericMessage
	}

	const detail = getErrorDetail(error, fallbackMessage)
	const normalizedDetail = detail?.toLowerCase()
	if (normalizedDetail === undefined) {
		return 'Transaction failed while settling the report. Reload the report and try again.'
	}

	if (genericMessage === detail) {
		return detail
	}

	if (normalizedDetail.includes('0x98bdb2e0') || normalizedDetail.includes('invalidgaslimit') || normalizedDetail.includes('invalid gas limit')) {
		return 'This report requires a higher settlement gas limit because it executes a callback on settlement. Retry with the updated UI.'
	}
	if (normalizedDetail.includes('settlement')) {
		return 'This report is not ready to settle yet.'
	}
	if (normalizedDetail.includes('report settled')) {
		return 'This report is already settled.'
	}
	if (normalizedDetail.includes('no initial report')) {
		return 'Submit an initial report before settling this report.'
	}

	return `Transaction failed while settling the report. Reason: ${detail}`
}

export function formatOpenOracleDisputeWriteErrorMessage(error: unknown, fallbackMessage = 'Failed to dispute report') {
	const genericMessage = formatWriteErrorMessage(error, fallbackMessage)
	if (genericMessage === 'Action canceled in wallet.') {
		return genericMessage
	}

	const detail = getErrorDetail(error, fallbackMessage)
	const normalizedDetail = detail?.toLowerCase()
	if (normalizedDetail === undefined) {
		return 'Transaction failed while disputing the report. Reload the report and try again.'
	}

	if (genericMessage === detail) {
		return detail
	}

	if (normalizedDetail.includes('dispute too early')) {
		return 'This report is not ready to dispute yet.'
	}
	if (normalizedDetail.includes('dispute period expired')) {
		return 'Dispute window closed. Settle Report instead.'
	}
	if (normalizedDetail.includes('report settled')) {
		return 'This report is already settled.'
	}
	if (normalizedDetail.includes('no report to dispute')) {
		return 'Submit an initial report before disputing this report.'
	}

	return `Transaction failed while disputing the report. Reason: ${detail}`
}

function createHiddenLoadingGateMessage(message: string): OpenOracleGateMessage {
	return { kind: 'hidden-loading', message }
}

function createVisibleGateMessage(message: string): OpenOracleGateMessage {
	return { kind: 'visible', message }
}

function formatOpenOraclePriceLoadError(v4Error: unknown, v3Error?: unknown) {
	const v4Detail = getErrorDetail(v4Error)
	const v3Detail = getErrorDetail(v3Error)
	const v4Message = v4Detail === undefined ? 'Uniswap V4 quote failed.' : `Uniswap V4 quote failed: ${v4Detail}.`

	if (v3Error !== undefined) {
		const v3Message = v3Detail === undefined ? 'Uniswap V3 quote failed.' : `Uniswap V3 quote failed: ${v3Detail}`
		return `Failed to fetch price from Uniswap. ${v4Message} ${v3Message}`
	}

	return `Failed to fetch price from Uniswap. ${v4Message} Uniswap V3 did not run.`
}

export function getOpenOracleReportStatus(report: Pick<OpenOracleReportSummary, 'currentReporter' | 'disputeOccurred' | 'isDistributed' | 'reportTimestamp'>): OpenOracleReportStatus {
	if (report.isDistributed) return 'Settled'
	if (report.reportTimestamp === 0n || report.currentReporter === zeroAddress) return 'Awaiting Initial Report'
	if (report.disputeOccurred) return 'Disputed'
	return 'Pending'
}

export function getOpenOracleReportStatusTone(status: OpenOracleReportStatus): 'blocked' | 'muted' | 'error' | 'ok' {
	switch (status) {
		case 'Awaiting Initial Report':
			return 'blocked'
		case 'Pending':
			return 'muted'
		case 'Disputed':
			return 'error'
		case 'Settled':
			return 'ok'
	}
}

export function getOpenOracleSelectedReportActionMode(report: Pick<OpenOracleReportSummary, 'currentReporter' | 'disputeOccurred' | 'isDistributed' | 'reportTimestamp'>): OpenOracleSelectedReportActionMode {
	const status = getOpenOracleReportStatus(report)
	switch (status) {
		case 'Awaiting Initial Report':
			return 'initial-report'
		case 'Pending':
		case 'Disputed':
			return 'dispute'
		case 'Settled':
			return 'read-only'
	}
}

function hasOpenOracleInitialReport(report: Pick<OpenOracleReportDetails, 'currentReporter' | 'reportTimestamp'>) {
	return report.reportTimestamp !== 0n && report.currentReporter !== zeroAddress
}

function getOpenOracleLifecycleClockValue(report: Pick<OpenOracleReportDetails, 'currentBlockNumber' | 'currentTime' | 'timeType'>) {
	return report.timeType ? report.currentTime : report.currentBlockNumber
}

export function getOpenOracleDisputeAvailability(report: Pick<OpenOracleReportDetails, 'currentBlockNumber' | 'currentReporter' | 'currentTime' | 'disputeDelay' | 'isDistributed' | 'reportTimestamp' | 'settlementTime' | 'timeType'>): OpenOracleReportActionAvailability {
	if (!hasOpenOracleInitialReport(report)) {
		return {
			canAct: false,
			message: 'Submit an initial report before disputing this report.',
		}
	}
	if (report.isDistributed) {
		return {
			canAct: false,
			message: 'This report is already settled.',
		}
	}

	const currentClock = getOpenOracleLifecycleClockValue(report)
	const disputeStart = report.reportTimestamp + report.disputeDelay
	const settlementStart = report.reportTimestamp + report.settlementTime

	if (currentClock < disputeStart) {
		return {
			canAct: false,
			message: 'This report is not ready to dispute yet.',
		}
	}
	if (currentClock > settlementStart) {
		return {
			canAct: false,
			message: 'Dispute window closed. Settle Report instead.',
		}
	}

	return {
		canAct: true,
		message: undefined,
	}
}

export function getOpenOracleSettleAvailability(report: Pick<OpenOracleReportDetails, 'currentBlockNumber' | 'currentReporter' | 'currentTime' | 'isDistributed' | 'reportTimestamp' | 'settlementTime' | 'timeType'>): OpenOracleReportActionAvailability {
	if (!hasOpenOracleInitialReport(report)) {
		return {
			canAct: false,
			message: 'Submit an initial report before settling this report.',
		}
	}
	if (report.isDistributed) {
		return {
			canAct: false,
			message: 'This report is already settled.',
		}
	}

	const currentClock = getOpenOracleLifecycleClockValue(report)
	const settlementStart = report.reportTimestamp + report.settlementTime

	if (currentClock < settlementStart) {
		return {
			canAct: false,
			message: 'This report is not ready to settle yet.',
		}
	}

	return {
		canAct: true,
		message: undefined,
	}
}

export function formatOpenOracleFeePercentage(feePercentage: bigint | undefined) {
	if (feePercentage === undefined) return '—'
	return `${(Number(feePercentage) / 100000).toLocaleString(undefined, { maximumFractionDigits: 6 })}%`
}

export function formatOpenOracleMultiplier(multiplier: bigint | undefined) {
	if (multiplier === undefined) return '—'
	return `${(Number(multiplier) / 100).toFixed(2)}x`
}

export function addOpenOracleBountyBuffer(requiredBounty: bigint) {
	if (requiredBounty <= 0n) return requiredBounty
	return (requiredBounty * OPEN_ORACLE_BOUNTY_BUFFER_NUMERATOR + OPEN_ORACLE_BOUNTY_BUFFER_DENOMINATOR - 1n) / OPEN_ORACLE_BOUNTY_BUFFER_DENOMINATOR
}

function calculateOpenOraclePrice(token1Amount: bigint, token2Amount: bigint) {
	if (token1Amount <= 0n || token2Amount <= 0n) return undefined
	return (token1Amount * OPEN_ORACLE_PRICE_PRECISION) / token2Amount
}

function calculateOpenOracleToken2Amount(token1Amount: bigint, price: bigint) {
	if (token1Amount <= 0n || price <= 0n) return undefined
	return (token1Amount * OPEN_ORACLE_PRICE_PRECISION) / price
}

function parseOpenOraclePriceInput(value: string) {
	return parseDecimalInput(value, 'Price')
}

export function formatOpenOraclePriceInput(price: bigint | undefined) {
	return price === undefined ? '' : formatCurrencyInputBalance(price)
}

function resolveOpenOracleTokenLabel({ fallbackLabel, tokenAddress, tokenSymbol }: { fallbackLabel: string; tokenAddress: string | undefined; tokenSymbol: string | undefined }) {
	const resolvedSymbol = tokenSymbol?.trim()
	if (resolvedSymbol !== undefined && resolvedSymbol !== '') return resolvedSymbol

	const resolvedAddress = tokenAddress?.trim()
	if (resolvedAddress !== undefined && resolvedAddress !== '') return resolvedAddress

	return fallbackLabel
}

function isCanonicalMainnetWeth(tokenAddress: string | undefined) {
	return tokenAddress?.toLowerCase() === WETH_ADDRESS.toLowerCase()
}

function formatOpenOracleQuoteAttemptedSources(attemptedSources: OpenOracleInitialReportQuoteSource[]) {
	if (attemptedSources.length === 0) return undefined
	if (attemptedSources.length === 1) return attemptedSources[0]

	const [firstSource, ...remainingSources] = attemptedSources
	const lastSource = remainingSources.pop()
	if (lastSource === undefined) return firstSource

	if (remainingSources.length === 0) return `${firstSource}, then ${lastSource}`
	return `${firstSource}, ${remainingSources.join(', ')}, then ${lastSource}`
}

export function formatOpenOracleInitialReportPriceUnavailableMessage({ attemptedSources, reason, token1Label, token2Label }: { attemptedSources: OpenOracleInitialReportQuoteSource[] | undefined; reason: string | undefined; token1Label: string | undefined; token2Label: string | undefined }) {
	const resolvedToken1Label = token1Label?.trim() || 'Token1'
	const resolvedToken2Label = token2Label?.trim() || 'Token2'
	const segments = [`Automatic price quote unavailable for ${resolvedToken1Label} / ${resolvedToken2Label}.`]
	const attemptedSourceText = attemptedSources === undefined ? undefined : formatOpenOracleQuoteAttemptedSources(attemptedSources)
	const sanitizedReason = sanitizeErrorDetail(reason)

	if (attemptedSourceText !== undefined) {
		segments.push(`Tried: ${attemptedSourceText}.`)
	}
	if (sanitizedReason !== undefined) {
		segments.push(`Reason: ${sanitizedReason}.`)
	}
	segments.push('Enter a price manually to submit the initial report.')

	return segments.join(' ')
}

export function formatOpenOracleInitialReportApprovalStatusUnavailableMessage({ reason, tokenLabel }: { reason: string | undefined; tokenLabel: string | undefined }) {
	return formatTokenApprovalUnavailableMessage({
		actionLabel: 'submitting the initial report',
		reason,
		tokenLabel,
	})
}

export function formatOpenOracleInitialReportBalanceStatusUnavailableMessage({ reason, tokenLabel }: { reason: string | undefined; tokenLabel: string | undefined }) {
	const resolvedTokenLabel = tokenLabel?.trim() || 'token'
	const segments = [`Unable to verify ${resolvedTokenLabel} balance for this report.`]
	const sanitizedReason = sanitizeErrorDetail(reason)

	if (sanitizedReason !== undefined) {
		segments.push(`Reason: ${sanitizedReason}.`)
	}
	segments.push('Retry loading the report or balance status before submitting the initial report.')

	return segments.join(' ')
}

function formatOpenOracleInitialReportInsufficientBalanceMessage({ available, required, tokenAddress, tokenDecimals, tokenLabel }: { available: bigint; required: bigint; tokenAddress: string | undefined; tokenDecimals: number | undefined; tokenLabel: string }) {
	const resolvedDecimals = tokenDecimals ?? 18
	const segments = [`Insufficient ${tokenLabel} balance for this report. Need ${formatCurrencyBalance(required, resolvedDecimals)}, wallet has ${formatCurrencyBalance(available, resolvedDecimals)}.`]

	if (isCanonicalMainnetWeth(tokenAddress)) {
		segments.push('Wrap ETH into WETH first.')
	}

	return segments.join(' ')
}

export async function loadOpenOracleInitialReportPriceResult(client: Parameters<typeof quoteExactInput>[0], token1: Parameters<typeof quoteExactInput>[1], token2: Parameters<typeof quoteExactInput>[2], token1Amount: bigint): Promise<OpenOracleInitialReportPriceLoadResult> {
	let v4Failure: unknown = 'Uniswap V4 returned an unusable quote'

	try {
		const { amountOut: token2Amount, source } = await quoteBestExactInputWithSource(client, token1, token2, token1Amount)
		const price = calculateOpenOraclePrice(token1Amount, token2Amount)
		if (price !== undefined) {
			return { price, priceSource: 'Uniswap V4', priceSourceUrl: source.poolUrl, status: 'success', token2Amount }
		}
	} catch (error) {
		v4Failure = error
	}

	const attemptedSources: OpenOracleInitialReportQuoteSource[] = ['Uniswap V4', 'Uniswap V3']
	try {
		const { amountOut: token2Amount, source } = await quoteBestV3ExactInputWithSource(client, token1, token2, token1Amount)
		const price = calculateOpenOraclePrice(token1Amount, token2Amount)
		if (price !== undefined) {
			return { price, priceSource: 'Uniswap V3', priceSourceUrl: source.poolUrl, status: 'success', token2Amount }
		}

		return {
			attemptedSources,
			failureKind: 'quote-failed',
			reason: formatOpenOraclePriceLoadError(v4Failure, 'Uniswap V3 returned an unusable quote'),
			status: 'failure',
		}
	} catch (v3Error) {
		return {
			attemptedSources,
			failureKind: 'quote-failed',
			reason: formatOpenOraclePriceLoadError(v4Failure, v3Error),
			status: 'failure',
		}
	}
}

export async function loadOpenOracleInitialReportPrice(client: Parameters<typeof quoteExactInput>[0], token1: Parameters<typeof quoteExactInput>[1], token2: Parameters<typeof quoteExactInput>[2], token1Amount: bigint): Promise<{ price: bigint; priceSource: OpenOracleInitialReportQuoteSource; token2Amount: bigint }> {
	const result = await loadOpenOracleInitialReportPriceResult(client, token1, token2, token1Amount)
	if (result.status === 'failure') {
		throw new Error(result.reason ?? 'Failed to fetch price from Uniswap')
	}

	return {
		price: result.price,
		priceSource: result.priceSource,
		token2Amount: result.token2Amount,
	}
}

export function deriveOpenOracleInitialReportSubmissionDetails({
	approvedToken1Amount,
	approvedToken2Amount,
	defaultPrice,
	defaultPriceError,
	defaultPriceSource,
	defaultPriceSourceUrl,
	priceInput,
	quoteAttemptedSources,
	quoteFailureReason,
	reportDetails,
	token1Balance,
	token1BalanceError,
	token1AllowanceError,
	token2AllowanceError,
	token2Balance,
	token2BalanceError,
	token1Decimals,
	token2Decimals,
	walletEthBalance,
}: {
	approvedToken1Amount: bigint | undefined
	approvedToken2Amount: bigint | undefined
	defaultPrice: string | undefined
	defaultPriceError: string | undefined
	defaultPriceSource: OpenOracleInitialReportPriceSource | undefined
	defaultPriceSourceUrl: string | undefined
	priceInput: string
	quoteAttemptedSources: OpenOracleInitialReportQuoteSource[] | undefined
	quoteFailureReason: string | undefined
	reportDetails:
		| {
				currentReporter: Address
				disputeOccurred: boolean
				exactToken1Report: bigint
				isDistributed: boolean
				reportTimestamp: bigint
				token1?: string | undefined
				token1Symbol?: string | undefined
				token2?: string | undefined
				token2Symbol?: string | undefined
		  }
		| undefined
	token1Balance: bigint | undefined
	token1BalanceError: string | undefined
	token1AllowanceError: string | undefined
	token2AllowanceError: string | undefined
	token2Balance: bigint | undefined
	token2BalanceError: string | undefined
	token1Decimals: number | undefined
	token2Decimals: number | undefined
	walletEthBalance: bigint | undefined
}): OpenOracleInitialReportSubmissionDetails {
	const trimmedPriceInput = priceInput.trim()
	const resolvedPriceInput = trimmedPriceInput === '' ? (defaultPrice ?? '') : trimmedPriceInput
	let price: bigint | undefined
	try {
		price = resolvedPriceInput === '' ? undefined : parseOpenOraclePriceInput(resolvedPriceInput)
	} catch {
		price = undefined
	}

	const amount1 = reportDetails?.exactToken1Report
	const amount2 = amount1 === undefined || price === undefined ? undefined : calculateOpenOracleToken2Amount(amount1, price)
	const priceSource = trimmedPriceInput === '' ? (defaultPrice === undefined ? 'Unavailable' : (defaultPriceSource ?? 'Manual override')) : defaultPrice !== undefined && trimmedPriceInput === defaultPrice ? (defaultPriceSource ?? 'Manual override') : 'Manual override'
	const priceSourceUrl = priceSource === 'Uniswap V4' || priceSource === 'Uniswap V3' ? defaultPriceSourceUrl : undefined
	const token1Label = resolveOpenOracleTokenLabel({
		fallbackLabel: 'Token1',
		tokenAddress: reportDetails?.token1,
		tokenSymbol: reportDetails?.token1Symbol,
	})
	const token2Label = resolveOpenOracleTokenLabel({
		fallbackLabel: 'Token2',
		tokenAddress: reportDetails?.token2,
		tokenSymbol: reportDetails?.token2Symbol,
	})
	const reportStatus =
		reportDetails === undefined
			? undefined
			: getOpenOracleReportStatus({
					currentReporter: reportDetails.currentReporter,
					disputeOccurred: reportDetails.disputeOccurred,
					isDistributed: reportDetails.isDistributed,
					reportTimestamp: reportDetails.reportTimestamp,
				})
	const token1Approval = deriveTokenApprovalRequirement(amount1, approvedToken1Amount)
	const token2Approval = deriveTokenApprovalRequirement(amount2, approvedToken2Amount)
	const token1BalanceShortage = amount1 === undefined || token1Balance === undefined || token1Balance >= amount1 ? undefined : amount1 - token1Balance
	const token2BalanceShortage = amount2 === undefined || token2Balance === undefined || token2Balance >= amount2 ? undefined : amount2 - token2Balance
	const hasWethWrapAction = reportDetails !== undefined && (isCanonicalMainnetWeth(reportDetails.token1) || isCanonicalMainnetWeth(reportDetails.token2))
	const requiredWethWrapAmount =
		reportDetails === undefined
			? undefined
			: isCanonicalMainnetWeth(reportDetails.token1) && token1BalanceShortage !== undefined && token1BalanceShortage > 0n
				? token1BalanceShortage
				: isCanonicalMainnetWeth(reportDetails.token2) && token2BalanceShortage !== undefined && token2BalanceShortage > 0n
					? token2BalanceShortage
					: undefined
	const canWrapRequiredWeth = requiredWethWrapAmount !== undefined && requiredWethWrapAmount > 0n && walletEthBalance !== undefined && walletEthBalance >= requiredWethWrapAmount
	const wrapRequiredWethMessage = !hasWethWrapAction
		? undefined
		: requiredWethWrapAmount !== undefined && requiredWethWrapAmount > 0n
			? walletEthBalance === undefined
				? createHiddenLoadingGateMessage('Loading wallet ETH balance.')
				: walletEthBalance < requiredWethWrapAmount
					? createVisibleGateMessage(`Wallet has ${formatCurrencyBalance(walletEthBalance)} ETH, need ${formatCurrencyBalance(requiredWethWrapAmount)} ETH to wrap the required WETH.`)
					: undefined
			: (isCanonicalMainnetWeth(reportDetails?.token1) && token1Balance === undefined) || (isCanonicalMainnetWeth(reportDetails?.token2) && token2Balance === undefined)
				? createHiddenLoadingGateMessage('Loading current WETH balance.')
				: undefined

	let blockMessage: OpenOracleGateMessage | undefined
	if (reportDetails === undefined) {
		blockMessage = createVisibleGateMessage('Load a report first')
	} else if (reportStatus !== undefined && reportStatus !== 'Awaiting Initial Report') {
		blockMessage = createVisibleGateMessage(formatOpenOracleInitialReportLifecycleMessage(reportStatus) ?? 'This report already has an initial report.')
	} else if (resolvedPriceInput === '') {
		blockMessage =
			defaultPriceError !== undefined
				? createVisibleGateMessage(defaultPriceError)
				: quoteAttemptedSources === undefined && quoteFailureReason === undefined
					? createHiddenLoadingGateMessage('Loading automatic price quote.')
					: createVisibleGateMessage(
							formatOpenOracleInitialReportPriceUnavailableMessage({
								attemptedSources: quoteAttemptedSources,
								reason: quoteFailureReason,
								token1Label,
								token2Label,
							}),
						)
	} else if (price === undefined || price <= 0n || amount2 === undefined || amount2 <= 0n) {
		blockMessage = createVisibleGateMessage('Invalid price')
	} else if (approvedToken1Amount === undefined && token1AllowanceError !== undefined) {
		blockMessage = createVisibleGateMessage(
			formatOpenOracleInitialReportApprovalStatusUnavailableMessage({
				reason: token1AllowanceError,
				tokenLabel: token1Label,
			}),
		)
	} else if (approvedToken2Amount === undefined && token2AllowanceError !== undefined) {
		blockMessage = createVisibleGateMessage(
			formatOpenOracleInitialReportApprovalStatusUnavailableMessage({
				reason: token2AllowanceError,
				tokenLabel: token2Label,
			}),
		)
	} else if (token1Balance === undefined && token1BalanceError !== undefined) {
		blockMessage = createVisibleGateMessage(
			formatOpenOracleInitialReportBalanceStatusUnavailableMessage({
				reason: token1BalanceError,
				tokenLabel: token1Label,
			}),
		)
	} else if (token2Balance === undefined && token2BalanceError !== undefined) {
		blockMessage = createVisibleGateMessage(
			formatOpenOracleInitialReportBalanceStatusUnavailableMessage({
				reason: token2BalanceError,
				tokenLabel: token2Label,
			}),
		)
	} else if (token1Balance === undefined) {
		blockMessage = createHiddenLoadingGateMessage(`Loading current ${token1Label} balance.`)
	} else if (token2Balance === undefined) {
		blockMessage = createHiddenLoadingGateMessage(`Loading current ${token2Label} balance.`)
	} else if (amount1 !== undefined && token1Balance < amount1) {
		blockMessage = createVisibleGateMessage(
			formatOpenOracleInitialReportInsufficientBalanceMessage({
				available: token1Balance,
				required: amount1,
				tokenAddress: reportDetails.token1,
				tokenDecimals: token1Decimals,
				tokenLabel: token1Label,
			}),
		)
	} else if (amount2 !== undefined && token2Balance < amount2) {
		blockMessage = createVisibleGateMessage(
			formatOpenOracleInitialReportInsufficientBalanceMessage({
				available: token2Balance,
				required: amount2,
				tokenAddress: reportDetails.token2,
				tokenDecimals: token2Decimals,
				tokenLabel: token2Label,
			}),
		)
	} else if (approvedToken1Amount === undefined) {
		blockMessage = createHiddenLoadingGateMessage(`Loading current ${token1Label} approval.`)
	} else if (approvedToken2Amount === undefined) {
		blockMessage = createHiddenLoadingGateMessage(`Loading current ${token2Label} approval.`)
	} else if (!token1Approval.hasSufficientApproval) {
		blockMessage = createVisibleGateMessage(`${token1Label} approval required`)
	} else if (!token2Approval.hasSufficientApproval) {
		blockMessage = createVisibleGateMessage(`${token2Label} approval required`)
	}

	return {
		amount1,
		amount2,
		blockMessage,
		canSubmit: blockMessage === undefined,
		canWrapRequiredWeth,
		hasWethWrapAction,
		price,
		priceInput: resolvedPriceInput,
		priceSource,
		priceSourceUrl,
		requiredWethWrapAmount,
		token1Approval,
		token1Decimals,
		token2Approval,
		token2Decimals,
		wrapRequiredWethMessage,
	}
}
