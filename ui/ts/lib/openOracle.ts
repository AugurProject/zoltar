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

export async function loadOpenOracleInitialReportPrice(
	client: Parameters<typeof quoteExactInput>[0],
	token1: Parameters<typeof quoteExactInput>[1],
	token2: Parameters<typeof quoteExactInput>[2],
	token1Amount: bigint,
): Promise<{ price: bigint; priceSource: Exclude<OpenOracleInitialReportPriceSource, 'Manual override' | 'Unavailable'>; token2Amount: bigint } | undefined> {
	try {
		const token2Amount = await quoteExactInput(client, token1, token2, token1Amount)
		const price = calculateOpenOraclePrice(token1Amount, token2Amount)
		if (price === undefined) return undefined
		return { price, priceSource: 'Uniswap V4', token2Amount }
	} catch {
		try {
			if (token1 === REP_ADDRESS && token2 === ETH_ADDRESS) {
				const ethPerRep = await quoteRepForEthV3(client, ONE_REP)
				const token2Amount = (token1Amount * ethPerRep) / ONE_REP
				const price = calculateOpenOraclePrice(token1Amount, token2Amount)
				if (price === undefined) return undefined
				return { price, priceSource: 'Uniswap V3 fallback', token2Amount }
			}
			if (token1 === ETH_ADDRESS && token2 === REP_ADDRESS) {
				const ethPerRep = await quoteRepForEthV3(client, ONE_REP)
				const token2Amount = (token1Amount * ONE_REP) / ethPerRep
				const price = calculateOpenOraclePrice(token1Amount, token2Amount)
				if (price === undefined) return undefined
				return { price, priceSource: 'Uniswap V3 fallback', token2Amount }
			}
		} catch {
			return undefined
		}
		return undefined
	}
}

export function deriveOpenOracleInitialReportSubmissionDetails({
	approvedToken1Amount,
	approvedToken2Amount,
	defaultPrice,
	defaultPriceSource,
	priceInput,
	reportDetails,
	token1Decimals,
	token2Decimals,
}: {
	approvedToken1Amount: bigint | undefined
	approvedToken2Amount: bigint | undefined
	defaultPrice: string | undefined
	defaultPriceSource: OpenOracleInitialReportPriceSource | undefined
	priceInput: string
	reportDetails:
		| {
				exactToken1Report: bigint
		  }
		| undefined
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
		blockReason = 'Price unavailable'
	} else if (price === undefined || price <= 0n || amount2 === undefined || amount2 <= 0n) {
		blockReason = 'Invalid price'
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
