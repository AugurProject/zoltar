import { maxUint256, zeroAddress } from 'viem'
import type { OpenOracleReportSummary } from '../types/contracts.js'
import { formatCurrencyInputBalance } from './formatters.js'
import { parseDecimalInput } from './decimal.js'
import { ETH_ADDRESS, REP_ADDRESS, quoteExactInput, quoteRepForEthV3 } from './uniswapQuoter.js'

const OPEN_ORACLE_PRICE_PRECISION = 10n ** 18n
const ONE_REP = 10n ** 18n
export const OPEN_ORACLE_APPROVAL_AMOUNT = maxUint256

type OpenOracleReportStatus = 'Awaiting Initial Report' | 'Pending' | 'Disputed' | 'Settled'
export type OpenOracleSelectedReportActionMode = 'initial-report' | 'dispute' | 'read-only'
export type OpenOracleInitialReportPriceSource = 'Uniswap V4' | 'Uniswap V3 fallback' | 'Manual override' | 'Unavailable'
export type OpenOracleInitialReportQuoteSource = Exclude<OpenOracleInitialReportPriceSource, 'Manual override' | 'Unavailable'>
export type OpenOracleInitialReportQuoteFailureKind = 'unsupported-pair' | 'quote-failed'
type OpenOracleInitialReportPriceLoadResult =
	| {
			status: 'success'
			price: bigint
			priceSource: OpenOracleInitialReportQuoteSource
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
	approvedToken1Amount: bigint | undefined
	approvedToken2Amount: bigint | undefined
	blockReason: string | undefined
	canSubmit: boolean
	price: bigint | undefined
	priceInput: string
	priceSource: OpenOracleInitialReportPriceSource
	token1Decimals: number | undefined
	token2Decimals: number | undefined
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

export function formatOpenOracleFeePercentage(feePercentage: bigint | undefined) {
	if (feePercentage === undefined) return 'Unavailable'
	return `${(Number(feePercentage) / 100000).toLocaleString(undefined, { maximumFractionDigits: 6 })}%`
}

export function formatOpenOracleMultiplier(multiplier: bigint | undefined) {
	if (multiplier === undefined) return 'Unavailable'
	return `${(Number(multiplier) / 100).toFixed(2)}x`
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

function supportsOpenOracleV3Fallback(token1: Parameters<typeof quoteExactInput>[1], token2: Parameters<typeof quoteExactInput>[2]) {
	return (token1 === REP_ADDRESS && token2 === ETH_ADDRESS) || (token1 === ETH_ADDRESS && token2 === REP_ADDRESS)
}

function extractOpenOracleQuoteFailureReason(error: unknown) {
	if (error instanceof Error) return error.message
	if (typeof error === 'string') return error
	try {
		return JSON.stringify(error)
	} catch {
		return undefined
	}
}

function sanitizeOpenOracleFailureReason(reason: string | undefined) {
	if (reason === undefined) return undefined

	let sanitized = reason.trim().replace(/\s+/g, ' ')
	if (sanitized === '' || ((sanitized.startsWith('{') || sanitized.startsWith('[')) && (sanitized.endsWith('}') || sanitized.endsWith(']')))) {
		return undefined
	}

	sanitized = sanitized.replace(/^(failed to [^:]+:\s*)+/i, '')
	sanitized = sanitized.replace(/\.$/, '')
	if (sanitized === '') return undefined

	const maxLength = 140
	return sanitized.length > maxLength ? `${sanitized.slice(0, maxLength - 3).trimEnd()}...` : sanitized
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
	const sanitizedReason = sanitizeOpenOracleFailureReason(reason)

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
	const resolvedTokenLabel = tokenLabel?.trim() || 'token'
	const segments = [`Unable to verify ${resolvedTokenLabel} approval for this report.`]
	const sanitizedReason = sanitizeOpenOracleFailureReason(reason)

	if (sanitizedReason !== undefined) {
		segments.push(`Reason: ${sanitizedReason}.`)
	}
	segments.push('Retry loading the report or approval status before submitting the initial report.')

	return segments.join(' ')
}

export async function loadOpenOracleInitialReportPriceResult(client: Parameters<typeof quoteExactInput>[0], token1: Parameters<typeof quoteExactInput>[1], token2: Parameters<typeof quoteExactInput>[2], token1Amount: bigint): Promise<OpenOracleInitialReportPriceLoadResult> {
	const attemptedSources: OpenOracleInitialReportQuoteSource[] = ['Uniswap V4']

	try {
		const token2Amount = await quoteExactInput(client, token1, token2, token1Amount)
		const price = calculateOpenOraclePrice(token1Amount, token2Amount)
		if (price !== undefined) {
			return { price, priceSource: 'Uniswap V4', status: 'success', token2Amount }
		}
		return { attemptedSources, failureKind: 'quote-failed', reason: 'Uniswap V4 returned an unusable quote', status: 'failure' }
	} catch (error) {
		if (!supportsOpenOracleV3Fallback(token1, token2)) {
			return {
				attemptedSources,
				failureKind: 'unsupported-pair',
				reason: extractOpenOracleQuoteFailureReason(error),
				status: 'failure',
			}
		}

		attemptedSources.push('Uniswap V3 fallback')
		try {
			if (token1 === REP_ADDRESS && token2 === ETH_ADDRESS) {
				const ethPerRep = await quoteRepForEthV3(client, ONE_REP)
				const token2Amount = (token1Amount * ethPerRep) / ONE_REP
				const price = calculateOpenOraclePrice(token1Amount, token2Amount)
				if (price !== undefined) {
					return { price, priceSource: 'Uniswap V3 fallback', status: 'success', token2Amount }
				}
			}
			if (token1 === ETH_ADDRESS && token2 === REP_ADDRESS) {
				const ethPerRep = await quoteRepForEthV3(client, ONE_REP)
				const token2Amount = (token1Amount * ONE_REP) / ethPerRep
				const price = calculateOpenOraclePrice(token1Amount, token2Amount)
				if (price !== undefined) {
					return { price, priceSource: 'Uniswap V3 fallback', status: 'success', token2Amount }
				}
			}
			return { attemptedSources, failureKind: 'quote-failed', reason: 'Uniswap V3 fallback returned an unusable quote', status: 'failure' }
		} catch (fallbackError) {
			return {
				attemptedSources,
				failureKind: 'quote-failed',
				reason: extractOpenOracleQuoteFailureReason(fallbackError),
				status: 'failure',
			}
		}
	}
}

export async function loadOpenOracleInitialReportPrice(
	client: Parameters<typeof quoteExactInput>[0],
	token1: Parameters<typeof quoteExactInput>[1],
	token2: Parameters<typeof quoteExactInput>[2],
	token1Amount: bigint,
): Promise<{ price: bigint; priceSource: OpenOracleInitialReportQuoteSource; token2Amount: bigint } | undefined> {
	const result = await loadOpenOracleInitialReportPriceResult(client, token1, token2, token1Amount)
	if (result.status === 'failure') return undefined

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
	defaultPriceSource,
	priceInput,
	quoteAttemptedSources,
	quoteFailureReason,
	reportDetails,
	token1AllowanceError,
	token2AllowanceError,
	token1Decimals,
	token2Decimals,
}: {
	approvedToken1Amount: bigint | undefined
	approvedToken2Amount: bigint | undefined
	defaultPrice: string | undefined
	defaultPriceSource: OpenOracleInitialReportPriceSource | undefined
	priceInput: string
	quoteAttemptedSources: OpenOracleInitialReportQuoteSource[] | undefined
	quoteFailureReason: string | undefined
	reportDetails:
		| {
				exactToken1Report: bigint
				token1?: string | undefined
				token1Symbol?: string | undefined
				token2?: string | undefined
				token2Symbol?: string | undefined
		  }
		| undefined
	token1AllowanceError: string | undefined
	token2AllowanceError: string | undefined
	token1Decimals: number | undefined
	token2Decimals: number | undefined
}): OpenOracleInitialReportSubmissionDetails {
	const resolvedPriceInput = priceInput.trim() === '' ? (defaultPrice ?? '') : priceInput.trim()
	let price: bigint | undefined
	try {
		price = resolvedPriceInput === '' ? undefined : parseOpenOraclePriceInput(resolvedPriceInput)
	} catch {
		price = undefined
	}

	const amount1 = reportDetails?.exactToken1Report
	const amount2 = amount1 === undefined || price === undefined ? undefined : calculateOpenOracleToken2Amount(amount1, price)
	const priceSource = priceInput.trim() === '' ? (defaultPrice === undefined ? 'Unavailable' : (defaultPriceSource ?? 'Manual override')) : defaultPrice !== undefined && priceInput.trim() === defaultPrice ? (defaultPriceSource ?? 'Manual override') : 'Manual override'

	let blockReason: string | undefined
	if (reportDetails === undefined) {
		blockReason = 'Load a report first'
	} else if (resolvedPriceInput === '') {
		blockReason = formatOpenOracleInitialReportPriceUnavailableMessage({
			attemptedSources: quoteAttemptedSources,
			reason: quoteFailureReason,
			token1Label: reportDetails.token1Symbol ?? reportDetails.token1,
			token2Label: reportDetails.token2Symbol ?? reportDetails.token2,
		})
	} else if (price === undefined || price <= 0n || amount2 === undefined || amount2 <= 0n) {
		blockReason = 'Invalid price'
	} else if (approvedToken1Amount === undefined && token1AllowanceError !== undefined) {
		blockReason = formatOpenOracleInitialReportApprovalStatusUnavailableMessage({
			reason: token1AllowanceError,
			tokenLabel: reportDetails.token1Symbol ?? reportDetails.token1,
		})
	} else if (approvedToken2Amount === undefined && token2AllowanceError !== undefined) {
		blockReason = formatOpenOracleInitialReportApprovalStatusUnavailableMessage({
			reason: token2AllowanceError,
			tokenLabel: reportDetails.token2Symbol ?? reportDetails.token2,
		})
	} else if (amount1 === undefined || approvedToken1Amount === undefined || approvedToken1Amount < amount1) {
		blockReason = 'Token1 approval required'
	} else if (approvedToken2Amount === undefined || approvedToken2Amount < amount2) {
		blockReason = 'Token2 approval required'
	}

	return {
		amount1,
		amount2,
		approvedToken1Amount,
		approvedToken2Amount,
		blockReason,
		canSubmit: blockReason === undefined,
		price,
		priceInput: resolvedPriceInput,
		priceSource,
		token1Decimals,
		token2Decimals,
	}
}
