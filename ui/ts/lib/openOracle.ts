import { zeroAddress } from 'viem'
import type { OpenOracleReportSummary } from '../types/contracts.js'
import { parseDecimalInput } from './decimal.js'
import { getErrorDetail } from './errors.js'
import { formatCurrencyBalance, formatCurrencyInputBalance } from './formatters.js'
import { deriveTokenApprovalRequirement, formatTokenApprovalNeededMessage, formatTokenApprovalUnavailableMessage, type TokenApprovalRequirement } from './tokenApproval.js'
import { quoteBestExactInput, quoteBestV3ExactInput, quoteExactInput, WETH_ADDRESS } from './uniswapQuoter.js'

const OPEN_ORACLE_PRICE_PRECISION = 10n ** 18n
const OPEN_ORACLE_BOUNTY_BUFFER_NUMERATOR = 12n
const OPEN_ORACLE_BOUNTY_BUFFER_DENOMINATOR = 10n

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
	blockReason: string | undefined
	canSubmit: boolean
	canWrapEthToWeth: boolean
	ethBalance: bigint | undefined
	price: bigint | undefined
	priceInput: string
	priceSource: OpenOracleInitialReportPriceSource
	requiredWrapEthAmount: bigint | undefined
	token1Approval: TokenApprovalRequirement
	token1Balance: bigint | undefined
	token1Decimals: number | undefined
	token2Approval: TokenApprovalRequirement
	token2Balance: bigint | undefined
	token2Decimals: number | undefined
}

function formatOpenOraclePriceLoadError(v4Error: unknown, v3Error?: unknown) {
	const v4Detail = getErrorDetail(v4Error)
	const v3Detail = getErrorDetail(v3Error)
	const v4Message = v4Detail === undefined ? 'Uniswap V4 quote failed.' : `Uniswap V4 quote failed: ${v4Detail}.`

	if (v3Error !== undefined) {
		const v3Message = v3Detail === undefined ? 'Uniswap V3 fallback failed.' : `Uniswap V3 fallback failed: ${v3Detail}`
		return `Failed to fetch price from Uniswap. ${v4Message} ${v3Message}`
	}

	return `Failed to fetch price from Uniswap. ${v4Message} Uniswap V3 fallback did not run.`
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

function sanitizeOpenOracleFailureReason(reason: string | undefined) {
	if (reason === undefined) return undefined

	let sanitized = reason.trim().replace(/\s+/g, ' ')
	if (sanitized === '' || ((sanitized.startsWith('{') || sanitized.startsWith('[')) && (sanitized.endsWith('}') || sanitized.endsWith(']')))) {
		return undefined
	}

	sanitized = sanitized.replace(/^(failed to [^:.]+[:.]\s*)+/i, '')
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
	return formatTokenApprovalUnavailableMessage({
		actionLabel: 'submitting the initial report',
		reason,
		tokenLabel,
	})
}

export function formatOpenOracleInitialReportBalanceStatusUnavailableMessage({ reason, tokenLabel }: { reason: string | undefined; tokenLabel: string | undefined }) {
	const resolvedTokenLabel = tokenLabel?.trim() || 'token'
	const segments = [`Unable to verify ${resolvedTokenLabel} wallet balance for this report.`]
	const sanitizedReason = sanitizeOpenOracleFailureReason(reason)

	if (sanitizedReason !== undefined) {
		segments.push(`Reason: ${sanitizedReason}.`)
	}
	segments.push('Retry loading the report or wallet balance before submitting the initial report.')

	return segments.join(' ')
}

function isWethToken(tokenAddress: string | undefined) {
	return tokenAddress?.toLowerCase() === WETH_ADDRESS.toLowerCase()
}

function getOpenOracleTokenUnits(tokenAddress: string | undefined, tokenDecimals: number | undefined) {
	if (isWethToken(tokenAddress)) return 18
	return tokenDecimals ?? 18
}

function formatOpenOracleTokenAmount(amount: bigint, tokenAddress: string | undefined, tokenDecimals: number | undefined) {
	return formatCurrencyBalance(amount, getOpenOracleTokenUnits(tokenAddress, tokenDecimals))
}

function formatOpenOracleInitialReportInsufficientBalanceMessage({ availableAmount, requiredAmount, tokenAddress, tokenDecimals, tokenLabel }: { availableAmount: bigint; requiredAmount: bigint; tokenAddress: string | undefined; tokenDecimals: number | undefined; tokenLabel: string | undefined }) {
	const resolvedTokenLabel = tokenLabel?.trim() || 'token'
	return `Insufficient ${resolvedTokenLabel} balance. Need ${formatOpenOracleTokenAmount(requiredAmount, tokenAddress, tokenDecimals)} ${resolvedTokenLabel} for the initial report and only ${formatOpenOracleTokenAmount(availableAmount, tokenAddress, tokenDecimals)} ${resolvedTokenLabel} is available in the connected wallet.`
}

function formatOpenOracleInitialReportWrapRequiredMessage(shortfallAmount: bigint) {
	return `Need ${formatOpenOracleTokenAmount(shortfallAmount, WETH_ADDRESS, 18)} more WETH for this initial report. Wrap ${formatOpenOracleTokenAmount(shortfallAmount, WETH_ADDRESS, 18)} ETH to WETH, then submit the initial report.`
}

function formatOpenOracleInitialReportInsufficientEthToWrapMessage(shortfallAmount: bigint, ethBalance: bigint) {
	return `Need ${formatOpenOracleTokenAmount(shortfallAmount, WETH_ADDRESS, 18)} more WETH for this initial report, but only ${formatOpenOracleTokenAmount(ethBalance, WETH_ADDRESS, 18)} ETH is available to wrap.`
}

export async function loadOpenOracleInitialReportPriceResult(client: Parameters<typeof quoteExactInput>[0], token1: Parameters<typeof quoteExactInput>[1], token2: Parameters<typeof quoteExactInput>[2], token1Amount: bigint): Promise<OpenOracleInitialReportPriceLoadResult> {
	let v4Failure: unknown = 'Uniswap V4 returned an unusable quote'

	try {
		const token2Amount = await quoteBestExactInput(client, token1, token2, token1Amount)
		const price = calculateOpenOraclePrice(token1Amount, token2Amount)
		if (price !== undefined) {
			return { price, priceSource: 'Uniswap V4', status: 'success', token2Amount }
		}
	} catch (error) {
		v4Failure = error
	}

	const attemptedSources: OpenOracleInitialReportQuoteSource[] = ['Uniswap V4', 'Uniswap V3 fallback']
	try {
		const token2Amount = await quoteBestV3ExactInput(client, token1, token2, token1Amount)
		const price = calculateOpenOraclePrice(token1Amount, token2Amount)
		if (price !== undefined) {
			return { price, priceSource: 'Uniswap V3 fallback', status: 'success', token2Amount }
		}

		return {
			attemptedSources,
			failureKind: 'quote-failed',
			reason: formatOpenOraclePriceLoadError(v4Failure, 'Uniswap V3 fallback returned an unusable quote'),
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
	ethBalance,
	ethBalanceError,
	hasConnectedWallet = false,
	priceInput,
	quoteAttemptedSources,
	quoteFailureReason,
	reportDetails,
	token1AllowanceError,
	token1Balance,
	token1BalanceError,
	token2AllowanceError,
	token2Balance,
	token2BalanceError,
	token1Decimals,
	token2Decimals,
}: {
	approvedToken1Amount: bigint | undefined
	approvedToken2Amount: bigint | undefined
	defaultPrice: string | undefined
	defaultPriceError: string | undefined
	defaultPriceSource: OpenOracleInitialReportPriceSource | undefined
	ethBalance?: bigint | undefined
	ethBalanceError?: string | undefined
	hasConnectedWallet?: boolean
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
	token1Balance?: bigint | undefined
	token1BalanceError?: string | undefined
	token2AllowanceError: string | undefined
	token2Balance?: bigint | undefined
	token2BalanceError?: string | undefined
	token1Decimals: number | undefined
	token2Decimals: number | undefined
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
	const token1IsWeth = isWethToken(reportDetails?.token1)
	const token2IsWeth = isWethToken(reportDetails?.token2)
	const resolvedToken1Decimals = getOpenOracleTokenUnits(reportDetails?.token1, token1Decimals)
	const resolvedToken2Decimals = getOpenOracleTokenUnits(reportDetails?.token2, token2Decimals)
	const token1Approval = deriveTokenApprovalRequirement(amount1, approvedToken1Amount)
	const token2Approval = deriveTokenApprovalRequirement(amount2, approvedToken2Amount)
	const requiredWethAmount = (token1IsWeth ? (amount1 ?? 0n) : 0n) + (token2IsWeth ? (amount2 ?? 0n) : 0n)
	const currentWethBalance = token1IsWeth ? token1Balance : token2IsWeth ? token2Balance : undefined
	const requiredWrapEthAmount = requiredWethAmount <= 0n || currentWethBalance === undefined || currentWethBalance >= requiredWethAmount ? undefined : requiredWethAmount - currentWethBalance

	let blockReason: string | undefined
	if (reportDetails === undefined) {
		blockReason = 'Load a report first'
	} else if (resolvedPriceInput === '') {
		blockReason =
			defaultPriceError ??
			formatOpenOracleInitialReportPriceUnavailableMessage({
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
	} else if (approvedToken1Amount === undefined) {
		blockReason = `Loading current ${reportDetails.token1Symbol ?? reportDetails.token1 ?? 'Token1'} approval.`
	} else if (approvedToken2Amount === undefined && token2AllowanceError !== undefined) {
		blockReason = formatOpenOracleInitialReportApprovalStatusUnavailableMessage({
			reason: token2AllowanceError,
			tokenLabel: reportDetails.token2Symbol ?? reportDetails.token2,
		})
	} else if (approvedToken2Amount === undefined) {
		blockReason = `Loading current ${reportDetails.token2Symbol ?? reportDetails.token2 ?? 'Token2'} approval.`
	} else if (hasConnectedWallet && token1Balance === undefined && token1BalanceError !== undefined) {
		blockReason = formatOpenOracleInitialReportBalanceStatusUnavailableMessage({
			reason: token1BalanceError,
			tokenLabel: reportDetails.token1Symbol ?? reportDetails.token1,
		})
	} else if (hasConnectedWallet && token1Balance === undefined) {
		blockReason = `Loading current ${reportDetails.token1Symbol ?? reportDetails.token1 ?? 'Token1'} balance.`
	} else if (hasConnectedWallet && token2Balance === undefined && token2BalanceError !== undefined) {
		blockReason = formatOpenOracleInitialReportBalanceStatusUnavailableMessage({
			reason: token2BalanceError,
			tokenLabel: reportDetails.token2Symbol ?? reportDetails.token2,
		})
	} else if (hasConnectedWallet && token2Balance === undefined) {
		blockReason = `Loading current ${reportDetails.token2Symbol ?? reportDetails.token2 ?? 'Token2'} balance.`
	} else if (hasConnectedWallet && !token1IsWeth && amount1 !== undefined && token1Balance !== undefined && token1Balance < amount1) {
		blockReason = formatOpenOracleInitialReportInsufficientBalanceMessage({
			availableAmount: token1Balance,
			requiredAmount: amount1,
			tokenAddress: reportDetails.token1,
			tokenDecimals: resolvedToken1Decimals,
			tokenLabel: reportDetails.token1Symbol ?? reportDetails.token1,
		})
	} else if (hasConnectedWallet && !token2IsWeth && amount2 !== undefined && token2Balance !== undefined && token2Balance < amount2) {
		blockReason = formatOpenOracleInitialReportInsufficientBalanceMessage({
			availableAmount: token2Balance,
			requiredAmount: amount2,
			tokenAddress: reportDetails.token2,
			tokenDecimals: resolvedToken2Decimals,
			tokenLabel: reportDetails.token2Symbol ?? reportDetails.token2,
		})
	} else if (hasConnectedWallet && requiredWrapEthAmount !== undefined && ethBalance === undefined && ethBalanceError !== undefined) {
		blockReason = formatOpenOracleInitialReportBalanceStatusUnavailableMessage({
			reason: ethBalanceError,
			tokenLabel: 'ETH',
		})
	} else if (hasConnectedWallet && requiredWrapEthAmount !== undefined && ethBalance === undefined) {
		blockReason = 'Loading current ETH balance.'
	} else if (hasConnectedWallet && requiredWrapEthAmount !== undefined && ethBalance !== undefined && ethBalance >= requiredWrapEthAmount) {
		blockReason = formatOpenOracleInitialReportWrapRequiredMessage(requiredWrapEthAmount)
	} else if (hasConnectedWallet && requiredWrapEthAmount !== undefined) {
		blockReason = formatOpenOracleInitialReportInsufficientEthToWrapMessage(requiredWrapEthAmount, ethBalance ?? 0n)
	} else if (!token1Approval.hasSufficientApproval) {
		blockReason =
			formatTokenApprovalNeededMessage({
				actionLabel: 'submitting the initial report',
				requirement: token1Approval,
				tokenLabel: reportDetails.token1Symbol ?? reportDetails.token1 ?? 'Token1',
				tokenUnits: resolvedToken1Decimals,
			}) ?? 'Token1 approval required'
	} else if (!token2Approval.hasSufficientApproval) {
		blockReason =
			formatTokenApprovalNeededMessage({
				actionLabel: 'submitting the initial report',
				requirement: token2Approval,
				tokenLabel: reportDetails.token2Symbol ?? reportDetails.token2 ?? 'Token2',
				tokenUnits: resolvedToken2Decimals,
			}) ?? 'Token2 approval required'
	}

	return {
		amount1,
		amount2,
		blockReason,
		canSubmit: blockReason === undefined,
		canWrapEthToWeth: requiredWrapEthAmount !== undefined && ethBalance !== undefined && ethBalance >= requiredWrapEthAmount,
		ethBalance,
		price,
		priceInput: resolvedPriceInput,
		priceSource,
		requiredWrapEthAmount,
		token1Approval,
		token1Balance,
		token1Decimals: resolvedToken1Decimals,
		token2Approval,
		token2Balance,
		token2Decimals: resolvedToken2Decimals,
	}
}
