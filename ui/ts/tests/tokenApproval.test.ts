/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { maxUint256 } from 'viem'
import { deriveTokenApprovalRequirement, formatTokenApprovalNeededMessage, formatTokenApprovalPartialMessage, formatTokenApprovalUnavailableMessage, maxUint200, parseTokenApprovalAmountInput, resolveTokenApprovalStatusMessage, shouldDisplayMaxTokenApprovalAmount } from '../lib/tokenApproval.js'

const ONE = 10n ** 18n

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

	test('parses max approval input as unlimited allowance', () => {
		expect(parseTokenApprovalAmountInput('max', 'Approval amount', 18)).toEqual({
			amount: maxUint256,
			kind: 'max',
		})
		expect(parseTokenApprovalAmountInput('MAX', 'Approval amount', 18)).toEqual({
			amount: maxUint256,
			kind: 'max',
		})
	})

	test('flags approvals above uint200 max for compact max display', () => {
		expect(shouldDisplayMaxTokenApprovalAmount(maxUint200)).toBe(false)
		expect(shouldDisplayMaxTokenApprovalAmount(maxUint200 + 1n)).toBe(true)
		expect(shouldDisplayMaxTokenApprovalAmount(undefined)).toBe(false)
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

	test('formats shared shortage and partial-approval messages in token units', () => {
		const requirement = deriveTokenApprovalRequirement(25n * ONE, 24n * ONE)

		expect(
			formatTokenApprovalNeededMessage({
				actionLabel: 'submitting the initial report',
				requirement,
				tokenLabel: 'ETH',
				tokenUnits: 18,
			}),
		).toBe('Need 1 more ETH approved before submitting the initial report.')

		expect(
			formatTokenApprovalPartialMessage({
				actionLabel: 'submitting the initial report',
				nextApprovedAmount: 24_500_000_000_000_000_000n,
				requiredAmount: 25n * ONE,
				tokenLabel: 'ETH',
				tokenUnits: 18,
			}),
		).toBe('Approving 24.5 ETH will still leave 0.5 more ETH needed before submitting the initial report.')
	})

	test('resolveTokenApprovalStatusMessage hides loading-only approval states', () => {
		const requirement = deriveTokenApprovalRequirement(25n * ONE, undefined)

		expect(
			resolveTokenApprovalStatusMessage({
				actionLabel: 'submitting the initial report',
				amountValidationMessage: undefined,
				draftAmount: '',
				guardMessage: undefined,
				nextApprovalAmount: requirement.targetAmount,
				requiredAmount: requirement.requiredAmount,
				requirement,
				tokenLabel: 'ETH',
				tokenUnits: 18,
			}),
		).toBeUndefined()
	})

	test('resolveTokenApprovalStatusMessage prioritizes guard and validation messages', () => {
		const requirement = deriveTokenApprovalRequirement(25n * ONE, 24n * ONE)

		expect(
			resolveTokenApprovalStatusMessage({
				actionLabel: 'submitting the initial report',
				amountValidationMessage: undefined,
				draftAmount: '',
				guardMessage: 'Connect a wallet before approving tokens.',
				nextApprovalAmount: requirement.targetAmount,
				requiredAmount: requirement.requiredAmount,
				requirement,
				tokenLabel: 'ETH',
				tokenUnits: 18,
			}),
		).toBe('Connect a wallet before approving tokens.')

		expect(
			resolveTokenApprovalStatusMessage({
				actionLabel: 'submitting the initial report',
				amountValidationMessage: 'Approval amount must be a decimal number',
				draftAmount: '24',
				guardMessage: undefined,
				nextApprovalAmount: 24n * ONE,
				requiredAmount: requirement.requiredAmount,
				requirement,
				tokenLabel: 'ETH',
				tokenUnits: 18,
			}),
		).toBe('Approval amount must be a decimal number')
	})

	test('resolveTokenApprovalStatusMessage preserves needed and partial approval copy', () => {
		const requirement = deriveTokenApprovalRequirement(25n * ONE, 24n * ONE)

		expect(
			resolveTokenApprovalStatusMessage({
				actionLabel: 'submitting the initial report',
				amountValidationMessage: undefined,
				draftAmount: '',
				guardMessage: undefined,
				nextApprovalAmount: requirement.targetAmount,
				requiredAmount: requirement.requiredAmount,
				requirement,
				tokenLabel: 'ETH',
				tokenUnits: 18,
			}),
		).toBe('Need 1 more ETH approved before submitting the initial report.')

		expect(
			resolveTokenApprovalStatusMessage({
				actionLabel: 'submitting the initial report',
				amountValidationMessage: undefined,
				draftAmount: '24.5',
				guardMessage: undefined,
				nextApprovalAmount: 24_500_000_000_000_000_000n,
				requiredAmount: 25n * ONE,
				requirement,
				tokenLabel: 'ETH',
				tokenUnits: 18,
			}),
		).toBe('Approving 24.5 ETH will still leave 0.5 more ETH needed before submitting the initial report.')
	})

	test('formats unavailable approval status messages with sanitized reasons', () => {
		expect(
			formatTokenApprovalUnavailableMessage({
				actionLabel: 'depositing REP',
				reason: 'Failed to load token approval: execution reverted',
				tokenLabel: 'REP',
			}),
		).toBe('Unable to verify REP approval before depositing REP. Reason: execution reverted. Retry loading the approval status before continuing.')
	})
})
