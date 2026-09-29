/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { getReportingReportGuardMessage, getReportingWithdrawGuardMessage } from '@zoltar/ui-statoblast-shared/features/reporting/lib/reportingGuards.js'

type ReportGuardInput = Parameters<typeof getReportingReportGuardMessage>[0]
type WithdrawGuardInput = Parameters<typeof getReportingWithdrawGuardMessage>[0]

const ATTO_REP_PER_REP = 10n ** 18n

/** A connected, on-chain, 1-atto-REP report on Yes into an active game, backed by the viewer's vault. */
function createReportGuardInput(overrides: Partial<ReportGuardInput> = {}): ReportGuardInput {
	return {
		actualDepositAmount: 1n,
		accountAddress: zeroAddress,
		contributionPreviewReason: undefined,
		isOnActiveAppChain: true,
		remainingSelectedOutcomeCapacity: undefined,
		reportAmount: '1',
		reportingStatus: 'active',
		selectedAmount: 1n,
		selectedOutcome: 'yes',
		viewerPoolHeldVaultRepBackingAttoRep: 10n,
		viewerVaultExists: true,
		...overrides,
	}
}

describe('reporting guards', () => {
	test.each<{ expected: string; name: string; overrides: Partial<ReportGuardInput> }>([
		{ expected: 'Connect a wallet before reporting on a question.', name: 'without a connected wallet', overrides: { accountAddress: undefined } },
		{ expected: 'Select an outcome side before reporting on a question.', name: 'without a selected outcome', overrides: { actualDepositAmount: undefined, selectedOutcome: undefined } },
		{ expected: 'Enter a valid report amount greater than zero.', name: 'for a zero amount', overrides: { reportAmount: '0', selectedAmount: 0n } },
		{ expected: 'Loading reporting details.', name: 'while reporting details are missing', overrides: { reportingStatus: 'missing' } },
		{
			expected: "Deposit 3\u00a0more\u00a0REP into your vault's pool-held backing before reporting.",
			name: 'when the vault lacks pool-held REP backing',
			overrides: { actualDepositAmount: 5n * ATTO_REP_PER_REP, reportAmount: '5', selectedAmount: 5n * ATTO_REP_PER_REP, viewerPoolHeldVaultRepBackingAttoRep: 2n * ATTO_REP_PER_REP },
		},
		{
			expected: 'Increase the report amount slightly to avoid a tie at the minimum bond.',
			name: 'when the contribution preview is invalid',
			overrides: { actualDepositAmount: undefined, contributionPreviewReason: 'Increase the report amount slightly to avoid a tie at the minimum bond.', selectedAmount: ATTO_REP_PER_REP, viewerPoolHeldVaultRepBackingAttoRep: 10n * ATTO_REP_PER_REP },
		},
		{
			expected: 'This contribution uses pool-held REP backing. Deposit REP into your vault before reporting.',
			name: 'without a vault',
			overrides: { viewerPoolHeldVaultRepBackingAttoRep: 0n, viewerVaultExists: false },
		},
		{
			expected: 'Only 2\u00a0REP remains before the selected side reaches the threshold.',
			name: 'when the contribution would exceed the remaining selected-side threshold capacity',
			overrides: { actualDepositAmount: 5n * ATTO_REP_PER_REP, remainingSelectedOutcomeCapacity: 2n * ATTO_REP_PER_REP, reportAmount: '5', selectedAmount: 5n * ATTO_REP_PER_REP, viewerPoolHeldVaultRepBackingAttoRep: 10n * ATTO_REP_PER_REP },
		},
		{ expected: 'No remaining contribution capacity is available on the selected side.', name: 'when the selected side has no remaining capacity', overrides: { remainingSelectedOutcomeCapacity: 0n } },
	])('blocks report submission $name', ({ expected, overrides }) => {
		expect(getReportingReportGuardMessage(createReportGuardInput(overrides))).toBe(expected)
	})

	test.each(['not-started', 'active'] as const)('allows reporting once the game is %s, leaving lifecycle handling to the shared action matrix', reportingStatus => {
		expect(getReportingReportGuardMessage(createReportGuardInput({ reportingStatus }))).toBeUndefined()
	})

	test.each<{ expected: string | undefined; name: string; input: WithdrawGuardInput }>([
		{ expected: 'Connect a wallet before settling escalation deposits.', name: 'blocks withdrawal without a connected wallet', input: { accountAddress: undefined, isOnActiveAppChain: true, reportingStatus: 'active' } },
		{ expected: 'Switch to Sepolia.', name: 'blocks withdrawal off the active chain', input: { accountAddress: zeroAddress, isOnActiveAppChain: false, reportingStatus: 'active' } },
		{ expected: 'Loading reporting details.', name: 'blocks withdrawal while reporting details are missing', input: { accountAddress: zeroAddress, isOnActiveAppChain: true, reportingStatus: 'missing' } },
		{ expected: undefined, name: 'leaves withdrawal lifecycle handling to the shared action matrix', input: { accountAddress: zeroAddress, isOnActiveAppChain: true, reportingStatus: 'active' } },
	])('$name', ({ expected, input }) => {
		expect(getReportingWithdrawGuardMessage(input)).toBe(expected)
	})
})
