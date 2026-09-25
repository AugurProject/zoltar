import * as commonCopy from '../copy/common.js'
import * as reviewCopy from '../copy/transactionReview.js'
import { tryParseDecimalInput } from '../forms/decimal.js'
import { formatCurrencyBalanceWithUnit, formatCurrencyInputBalance, formatTrimmedUnits } from '../lib/formatters.js'

export type TransactionReviewSeverity = 'info' | 'caution' | 'danger'

export type TransactionReviewToken = { symbol: string; units: number }

type TransactionReviewWarning = { message: string; severity: TransactionReviewSeverity }

export type TransactionReviewConfirmation = { kind: 'acknowledge'; label: string } | { expectedAmount: bigint; expectedText: string; kind: 'typed'; label: string; units: number }

type TransactionReviewChangeDirection = 'decrease' | 'increase' | 'unchanged' | 'unknown'

/** Display-ready review content: what moves, how balances change, and what can go wrong. */
export type TransactionReviewSummary = {
	amounts: { label: string; value: string }[]
	changes: { after: string; before: string; delta: string; direction: TransactionReviewChangeDirection; label: string }[]
	confirmation: TransactionReviewConfirmation | undefined
	warnings: TransactionReviewWarning[]
}

type TransactionReviewSummaryInput = {
	amounts?: { amount: bigint; label: string; token: TransactionReviewToken }[]
	/** `delta` is signed: negative values leave the balance, positive values arrive. */
	changes?: { before: bigint | undefined; delta: bigint; label: string; token: TransactionReviewToken }[]
	confirmation?: TransactionReviewConfirmation | undefined
	warnings?: TransactionReviewWarning[]
}

const severityRank: Record<TransactionReviewSeverity, number> = { danger: 0, caution: 1, info: 2 }

function formatTokenAmount(amount: bigint, token: TransactionReviewToken) {
	return formatCurrencyBalanceWithUnit(amount, token.symbol, token.units)
}

function formatSignedTokenAmount(amount: bigint, token: TransactionReviewToken) {
	if (amount === 0n) return formatTokenAmount(0n, token)
	return `${amount > 0n ? '+' : '−'}${formatTokenAmount(amount > 0n ? amount : -amount, token)}`
}

function resolveDirection(before: bigint | undefined, delta: bigint): TransactionReviewChangeDirection {
	if (before === undefined) return 'unknown'
	if (delta === 0n) return 'unchanged'
	return delta > 0n ? 'increase' : 'decrease'
}

export function buildTransactionReviewSummary({ amounts = [], changes = [], confirmation, warnings = [] }: TransactionReviewSummaryInput): TransactionReviewSummary {
	const overdrawn = changes.filter(change => change.before !== undefined && change.before + change.delta < 0n)
	return {
		amounts: amounts.map(row => ({ label: row.label, value: formatTokenAmount(row.amount, row.token) })),
		changes: changes.map(change => {
			const after = change.before === undefined ? undefined : change.before + change.delta
			let afterLabel = commonCopy.metricUnavailablePlaceholder
			if (after !== undefined) afterLabel = after < 0n ? reviewCopy.balanceInsufficient : formatTokenAmount(after, change.token)
			return {
				after: afterLabel,
				before: change.before === undefined ? commonCopy.metricUnavailablePlaceholder : formatTokenAmount(change.before, change.token),
				delta: formatSignedTokenAmount(change.delta, change.token),
				direction: resolveDirection(change.before, change.delta),
				label: change.label,
			}
		}),
		confirmation,
		warnings: [...overdrawn.map(change => ({ message: reviewCopy.formatChangeExceedsBalance(change.label), severity: 'danger' as const })), ...warnings].sort((left, right) => severityRank[left.severity] - severityRank[right.severity]),
	}
}

/**
 * Scales the confirmation to the risk of an irreversible burn: a checkbox for a small share of the wallet,
 * typing the amount when the burn is universe-wide, at least half of the wallet, or the wallet balance is unknown.
 */
export function resolveBurnConfirmation({ amount, token, universeWide = false, walletBalance }: { amount: bigint; token: TransactionReviewToken; universeWide?: boolean; walletBalance: bigint | undefined }): TransactionReviewConfirmation | undefined {
	if (amount <= 0n) return undefined
	const amountLabel = formatTokenAmount(amount, token)
	if (!universeWide && walletBalance !== undefined && amount * 2n < walletBalance) return { kind: 'acknowledge', label: reviewCopy.formatAcknowledgeBurn(amountLabel) }
	// Four decimals keep the typed amount short; fall back to the exact amount when truncation would hide it.
	const truncated = formatTrimmedUnits(amount, token.units, 4)
	const expectedText = tryParseDecimalInput(normalizeTypedAmount(truncated), token.units) === 0n ? formatCurrencyInputBalance(amount, token.units) : truncated
	return { expectedAmount: amount, expectedText, kind: 'typed', label: reviewCopy.formatTypeBurnAmount(`${expectedText} ${token.symbol}`), units: token.units }
}

function normalizeTypedAmount(value: string) {
	return value.replaceAll(/[\s,_ ]/g, '')
}

/** Accepts either the displayed amount (grouping separators optional) or the exact amount. */
export function isTransactionReviewConfirmed(confirmation: TransactionReviewConfirmation | undefined, input: { acknowledged: boolean; typed: string }) {
	if (confirmation === undefined) return true
	if (confirmation.kind === 'acknowledge') return input.acknowledged
	const typed = normalizeTypedAmount(input.typed)
	if (typed === '') return false
	if (typed === normalizeTypedAmount(confirmation.expectedText)) return true
	return tryParseDecimalInput(typed, confirmation.units) === confirmation.expectedAmount
}
