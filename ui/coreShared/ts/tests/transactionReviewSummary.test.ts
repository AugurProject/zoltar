/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { buildTransactionReviewSummary, isTransactionReviewConfirmed, resolveBurnConfirmation } from '../transactions/transactionReviewSummary.js'

const rep = { symbol: 'REP', units: 18 }
const toAtto = (value: bigint) => value * 10n ** 18n

describe('buildTransactionReviewSummary', () => {
	test('formats amounts with their token and computes before → after balances', () => {
		const summary = buildTransactionReviewSummary({
			amounts: [{ amount: toAtto(1_000n), label: 'Deposit', token: rep }],
			changes: [
				{ before: toAtto(5_000n), delta: toAtto(1_000n), label: 'Vault REP backing', token: rep },
				{ before: toAtto(2_500n), delta: -toAtto(1_000n), label: 'Wallet REP', token: rep },
			],
		})
		expect(summary.amounts).toEqual([{ label: 'Deposit', value: '1 000\u00a0REP' }])
		expect(summary.changes).toEqual([
			{ after: '6 000\u00a0REP', before: '5 000\u00a0REP', delta: '+1 000\u00a0REP', direction: 'increase', label: 'Vault REP backing' },
			{ after: '1 500\u00a0REP', before: '2 500\u00a0REP', delta: '−1 000\u00a0REP', direction: 'decrease', label: 'Wallet REP' },
		])
		expect(summary.warnings).toEqual([])
		expect(summary.confirmation).toBeUndefined()
	})

	test('keeps the signed change when the starting balance is unknown', () => {
		const [change] = buildTransactionReviewSummary({ changes: [{ before: undefined, delta: -toAtto(3n), label: 'Wallet REP', token: rep }] }).changes
		expect(change).toMatchObject({ after: '—', before: '—', delta: '−3\u00a0REP', direction: 'unknown' })
	})

	test('flags an overdrawn balance as a high-risk warning ahead of other warnings', () => {
		const summary = buildTransactionReviewSummary({
			changes: [{ before: toAtto(1n), delta: -toAtto(2n), label: 'Wallet REP', token: rep }],
			warnings: [
				{ message: 'Queued until a price is available.', severity: 'info' },
				{ message: 'Can be liquidated.', severity: 'caution' },
			],
		})
		expect(summary.changes[0]?.after).toBe('Insufficient')
		expect(summary.warnings.map(warning => warning.severity)).toEqual(['danger', 'caution', 'info'])
		expect(summary.warnings[0]?.message).toBe('Wallet REP is lower than this transaction needs.')
	})
})

describe('resolveBurnConfirmation', () => {
	test('asks for nothing when nothing burns', () => {
		expect(resolveBurnConfirmation({ amount: 0n, token: rep, walletBalance: toAtto(10n) })).toBeUndefined()
	})

	test('uses a checkbox for a burn below half of the wallet balance', () => {
		expect(resolveBurnConfirmation({ amount: toAtto(10n), token: rep, walletBalance: toAtto(100n) })).toEqual({ kind: 'acknowledge', label: 'I understand this burns 10\u00a0REP from my wallet and cannot be undone.' })
	})

	test('shows a typeable amount for fractional burns', () => {
		expect(resolveBurnConfirmation({ amount: toAtto(12_345n) + 678_901_234_567_890_123n, token: rep, universeWide: true, walletBalance: undefined })).toMatchObject({ expectedText: '12 345.6789' })
	})

	test('never asks to type zero for a dust burn', () => {
		const dust = resolveBurnConfirmation({ amount: 5n * 10n ** 13n, token: rep, walletBalance: undefined })
		expect(dust).toMatchObject({ expectedText: '0.00005' })
		expect(isTransactionReviewConfirmed(dust, { acknowledged: false, typed: '0' })).toBe(false)
		expect(isTransactionReviewConfirmed(dust, { acknowledged: false, typed: '0.00005' })).toBe(true)
	})

	test('requires typing the amount for large, unknown-balance, or universe-wide burns', () => {
		for (const input of [
			{ amount: toAtto(60n), walletBalance: toAtto(100n) },
			{ amount: toAtto(1n), walletBalance: undefined },
			{ amount: toAtto(1n), universeWide: true, walletBalance: toAtto(1_000n) },
		]) {
			expect(resolveBurnConfirmation({ ...input, token: rep })).toMatchObject({ kind: 'typed', expectedAmount: input.amount, units: 18 })
		}
		expect(resolveBurnConfirmation({ amount: toAtto(450_000n), token: rep, universeWide: true, walletBalance: undefined })).toMatchObject({ expectedText: '450 000', label: 'Type 450 000 REP to confirm the irreversible burn' })
	})
})

describe('isTransactionReviewConfirmed', () => {
	const typed = resolveBurnConfirmation({ amount: toAtto(450_000n), token: rep, universeWide: true, walletBalance: undefined })
	const acknowledge = resolveBurnConfirmation({ amount: toAtto(1n), token: rep, walletBalance: toAtto(100n) })

	test('passes when no confirmation is required', () => {
		expect(isTransactionReviewConfirmed(undefined, { acknowledged: false, typed: '' })).toBe(true)
	})

	test('requires the acknowledgement checkbox', () => {
		expect(isTransactionReviewConfirmed(acknowledge, { acknowledged: false, typed: '' })).toBe(false)
		expect(isTransactionReviewConfirmed(acknowledge, { acknowledged: true, typed: '' })).toBe(true)
	})

	test('accepts the typed amount with or without grouping and rejects anything else', () => {
		for (const value of ['450 000', '450000', '450,000', '450000.0']) expect(isTransactionReviewConfirmed(typed, { acknowledged: false, typed: value })).toBe(true)
		for (const value of ['', '45000', '450,001', 'max', 'I agree']) expect(isTransactionReviewConfirmed(typed, { acknowledged: true, typed: value })).toBe(false)
	})
})
