/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { maxUint256 } from '@zoltar/core-shared/evm/ethereum'
import { deriveTokenApprovalRequirement, formatTokenApprovalUnavailableMessage, parseTokenApprovalAmountInput, resolveTokenApprovalStatusMessage, shouldDisplayMaxTokenApprovalAmount } from '../transactions/tokenApproval.js'

const ONE = 10n ** 18n
// Approved amounts above uint200 are displayed as unlimited.
const maxUint200 = 2n ** 200n - 1n

describe('token approval helpers', () => {
	test('derives the approval requirement and exact default target from required and approved amounts', () => {
		const requirement = deriveTokenApprovalRequirement(25n * ONE, 24n * ONE)

		expect(requirement.requiredAmount).toBe(25n * ONE)
		expect(requirement.approvedAmount).toBe(24n * ONE)
		expect(requirement.neededAmount).toBe(ONE)
		expect(requirement.targetAmount).toBe(25n * ONE)
		expect(requirement.hasSufficientApproval).toBe(false)
	})

	test('marks zero or fully covered requirements as satisfied', () => {
		expect(deriveTokenApprovalRequirement(0n, undefined)).toEqual({
			approvedAmount: undefined,
			hasSufficientApproval: true,
			neededAmount: 0n,
			requiredAmount: 0n,
			targetAmount: undefined,
		})
		expect(deriveTokenApprovalRequirement(25n * ONE, 25n * ONE).hasSufficientApproval).toBe(true)
	})

	test('parses blank approval input as the default exact-target mode', () => {
		expect(parseTokenApprovalAmountInput('', 'Approval amount', 18)).toEqual({ kind: 'default' })
		expect(parseTokenApprovalAmountInput('   ', 'Approval amount', 18)).toEqual({ kind: 'default' })
	})

	test('rejects max approval input instead of requesting an unlimited allowance', () => {
		expect(() => parseTokenApprovalAmountInput('max', 'Approval amount', 18)).toThrow('Approval amount must be a decimal number.')
		expect(() => parseTokenApprovalAmountInput('MAX', 'Approval amount', 18)).toThrow('Approval amount must be a decimal number.')
	})

	test.each([
		{ amount: undefined, expected: false, label: 'unavailable' },
		{ amount: 0n, expected: false, label: 'zero' },
		{ amount: maxUint200 - 1n, expected: false, label: 'below maxUint200' },
		{ amount: maxUint200, expected: false, label: 'maxUint200 boundary' },
		{ amount: maxUint200 + 1n, expected: true, label: 'above maxUint200' },
		{ amount: maxUint256, expected: true, label: 'maxUint256' },
	])('reports $label as max display: $expected', ({ amount, expected }) => {
		expect(shouldDisplayMaxTokenApprovalAmount(amount)).toBe(expected)
	})

	test('parses custom approval input using token decimals', () => {
		expect(parseTokenApprovalAmountInput('1.25', 'Approval amount', 18)).toEqual({
			amount: 125n * 10n ** 16n,
			kind: 'custom',
		})
		expect(parseTokenApprovalAmountInput('12.5', 'Approval amount', 6)).toEqual({
			amount: 12_500_000n,
			kind: 'custom',
		})
	})

	const shortfallRequirement = deriveTokenApprovalRequirement(25n * ONE, 24n * ONE)

	/** Resolves the status of approving ETH before an initial report, defaulting to the 25-needed, 24-approved shortfall. */
	const statusMessage = (overrides: Partial<Parameters<typeof resolveTokenApprovalStatusMessage>[0]>) =>
		resolveTokenApprovalStatusMessage({
			actionLabel: 'submitting the initial report',
			amountValidationMessage: undefined,
			draftAmount: '',
			guardMessage: undefined,
			nextApprovalAmount: shortfallRequirement.targetAmount,
			requiredAmount: shortfallRequirement.requiredAmount,
			requirement: shortfallRequirement,
			tokenLabel: 'ETH',
			tokenUnits: 18,
			...overrides,
		})

	test('resolveTokenApprovalStatusMessage hides loading-only approval states', () => {
		const requirement = deriveTokenApprovalRequirement(25n * ONE, undefined)

		expect(statusMessage({ nextApprovalAmount: requirement.targetAmount, requiredAmount: requirement.requiredAmount, requirement })).toBeUndefined()
	})

	test('resolveTokenApprovalStatusMessage prioritizes guard and validation messages', () => {
		expect(statusMessage({ guardMessage: 'Connect a wallet before approving tokens.' })).toBe('Connect a wallet before approving tokens.')
		expect(statusMessage({ amountValidationMessage: 'Approval amount must be a decimal number.', draftAmount: '24', nextApprovalAmount: 24n * ONE })).toBe('Approval amount must be a decimal number.')
	})

	test.each([
		{ label: 'no next approval amount', nextApprovalAmount: undefined },
		{ label: 'the exact default target', nextApprovalAmount: shortfallRequirement.targetAmount },
	])('resolveTokenApprovalStatusMessage formats the needed shortfall in token units with $label', ({ nextApprovalAmount }) => {
		expect(statusMessage({ nextApprovalAmount })).toBe('Need 1.00\u00a0more\u00a0ETH approved before submitting the initial report.')
	})

	test('resolveTokenApprovalStatusMessage rounds a fractional shortfall upward like the approval button', () => {
		const requirement = deriveTokenApprovalRequirement(121_153_846_238_653_846n, 0n)
		expect(statusMessage({ nextApprovalAmount: requirement.targetAmount, requiredAmount: requirement.requiredAmount, requirement })).toBe('Need ≈ 0.13\u00a0more\u00a0ETH approved before submitting the initial report.')
	})

	test('resolveTokenApprovalStatusMessage formats a partial custom approval in token units', () => {
		expect(statusMessage({ draftAmount: '24.5', nextApprovalAmount: 24_500_000_000_000_000_000n })).toBe('Approving 24.50\u00a0ETH will still leave 0.50\u00a0more\u00a0ETH needed before submitting the initial report.')
	})

	test('formats unavailable approval status messages with sanitized reasons', () => {
		expect(
			formatTokenApprovalUnavailableMessage({
				actionLabel: 'depositing REP',
				reason: 'Failed to load token approval: execution reverted',
				tokenLabel: 'REP',
			}),
		).toBe('Unable to verify REP approval before depositing REP. Retry loading the approval status before continuing.')
	})
})
