/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { getReportingReportGuardMessage, getReportingWithdrawGuardMessage } from '@zoltar/ui-statoblast-shared/features/reporting/lib/reportingGuards.js'
import { getReportableVaultRepAttoRep } from '@zoltar/ui-statoblast-shared/features/reporting/lib/reportingMaxContribution.js'
import type { VaultReportingLimits } from '@zoltar/ui-statoblast-shared/types/contracts.js'

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
		viewerReportableVaultRepAttoRep: 10n,
		viewerVaultExists: true,
		...overrides,
	}
}

/** A 10 REP vault in a 12 REP pool with no commitments, no minimum, and backing units that convert exactly. */
function createVaultReportingLimits(overrides: Partial<VaultReportingLimits> = {}): VaultReportingLimits {
	return {
		minimumVaultRepDepositAttoRep: 0n,
		repPerEthPrice: ATTO_REP_PER_REP,
		statoblastSecurityMultiplierBps: 20_000n,
		totalPoolHeldAttoRep: 12n * ATTO_REP_PER_REP,
		totalRepBackingUnits: 12n * ATTO_REP_PER_REP,
		totalUnderwritingLimitAttoEth: 0n,
		underwritingLimitAttoEth: 0n,
		vaultRepBackingUnits: 10n * ATTO_REP_PER_REP,
		...overrides,
	}
}

describe('reportable vault REP', () => {
	const backing = 10n * ATTO_REP_PER_REP
	test.each<{ expected: bigint | undefined; name: string; limits: VaultReportingLimits | undefined; disputeStakedAttoRep?: bigint }>([
		{ expected: undefined, name: 'is unknown until the pool limits load', limits: undefined },
		{ expected: backing, name: 'is the whole backing without commitments or a minimum', limits: createVaultReportingLimits() },
		{ expected: backing, name: 'empties the vault when the escrow takes every backing unit', limits: createVaultReportingLimits({ minimumVaultRepDepositAttoRep: ATTO_REP_PER_REP }) },
		// A pool whose REP no longer divides evenly into backing units leaves unescrowed units, so the vault must keep its minimum plus the rounding margin.
		{ expected: 9n * ATTO_REP_PER_REP - 3n, name: 'keeps the minimum when the whole backing cannot leave', limits: createVaultReportingLimits({ minimumVaultRepDepositAttoRep: ATTO_REP_PER_REP, totalPoolHeldAttoRep: 12n * ATTO_REP_PER_REP + 7n }) },
		// Commitments of 2 of 4 ETH at 1 REP/ETH and 2× keep 1.5× in pool-held REP: 3 REP for the vault and 6 REP for the pool.
		{ expected: 6n * ATTO_REP_PER_REP, name: 'keeps the pool migration reserve', limits: createVaultReportingLimits({ totalUnderwritingLimitAttoEth: 4n * ATTO_REP_PER_REP, underwritingLimitAttoEth: 2n * ATTO_REP_PER_REP }) },
		{
			expected: 7n * ATTO_REP_PER_REP - 2n,
			name: 'keeps the vault migration reserve',
			limits: createVaultReportingLimits({ totalPoolHeldAttoRep: 20n * ATTO_REP_PER_REP, totalRepBackingUnits: 20n * ATTO_REP_PER_REP, totalUnderwritingLimitAttoEth: 2n * ATTO_REP_PER_REP, underwritingLimitAttoEth: 2n * ATTO_REP_PER_REP }),
		},
		{ expected: 0n, name: 'is zero without a price while the pool has commitments', limits: createVaultReportingLimits({ repPerEthPrice: 0n, totalUnderwritingLimitAttoEth: 4n * ATTO_REP_PER_REP }) },
		{
			expected: 0n,
			name: 'is zero when the vault already lacks its associated backing',
			limits: createVaultReportingLimits({ totalPoolHeldAttoRep: 20n * ATTO_REP_PER_REP, totalRepBackingUnits: 20n * ATTO_REP_PER_REP, totalUnderwritingLimitAttoEth: 6n * ATTO_REP_PER_REP, underwritingLimitAttoEth: 6n * ATTO_REP_PER_REP }),
		},
	])('$name', ({ disputeStakedAttoRep, expected, limits }) => {
		expect(getReportableVaultRepAttoRep({ viewerPoolHeldVaultRepBackingAttoRep: backing, viewerVaultDisputeStakedAttoRep: disputeStakedAttoRep ?? 0n, viewerVaultReportingLimits: limits })).toBe(expected)
	})
})

describe('reporting guards', () => {
	test.each<{ expected: string; name: string; overrides: Partial<ReportGuardInput> }>([
		{ expected: 'Connect a wallet before reporting on a question.', name: 'without a connected wallet', overrides: { accountAddress: undefined } },
		{ expected: 'Select an outcome side before reporting on a question.', name: 'without a selected outcome', overrides: { actualDepositAmount: undefined, selectedOutcome: undefined } },
		{ expected: 'Loading reporting details…', name: 'while reporting details are missing', overrides: { reportingStatus: 'missing' } },
		{
			expected: 'Deposit 3\u00a0more\u00a0REP into your vault’s pool-held backing before reporting.',
			name: 'when the vault lacks pool-held REP backing',
			overrides: { actualDepositAmount: 5n * ATTO_REP_PER_REP, reportAmount: '5', selectedAmount: 5n * ATTO_REP_PER_REP, viewerPoolHeldVaultRepBackingAttoRep: 2n * ATTO_REP_PER_REP, viewerReportableVaultRepAttoRep: 2n * ATTO_REP_PER_REP },
		},
		{
			expected: 'Only 2\u00a0REP is available in your pool vault. Reduce the amount or select Wallet REP.',
			name: 'when the commitment keeps most of the vault backing in the pool',
			overrides: { actualDepositAmount: 5n * ATTO_REP_PER_REP, reportAmount: '5', selectedAmount: 5n * ATTO_REP_PER_REP, viewerPoolHeldVaultRepBackingAttoRep: 10n * ATTO_REP_PER_REP, viewerReportableVaultRepAttoRep: 2n * ATTO_REP_PER_REP, walletFundingAvailable: true },
		},
		{
			expected: 'Increase the report amount slightly to avoid a tie at the minimum bond.',
			name: 'when the contribution preview is invalid',
			overrides: { actualDepositAmount: undefined, contributionPreviewReason: 'Increase the report amount slightly to avoid a tie at the minimum bond.', selectedAmount: ATTO_REP_PER_REP, viewerPoolHeldVaultRepBackingAttoRep: 10n * ATTO_REP_PER_REP, viewerReportableVaultRepAttoRep: 10n * ATTO_REP_PER_REP },
		},
		{
			expected: 'This report uses pool-held REP backing. Deposit REP into your vault before reporting.',
			name: 'without a vault',
			overrides: { viewerPoolHeldVaultRepBackingAttoRep: 0n, viewerReportableVaultRepAttoRep: 0n, viewerVaultExists: false },
		},
		{
			expected: 'Only 2\u00a0REP remains before the selected side reaches the non-decision threshold.',
			name: 'when the contribution would exceed the remaining selected-side threshold capacity',
			overrides: { actualDepositAmount: 5n * ATTO_REP_PER_REP, remainingSelectedOutcomeCapacity: 2n * ATTO_REP_PER_REP, reportAmount: '5', selectedAmount: 5n * ATTO_REP_PER_REP, viewerPoolHeldVaultRepBackingAttoRep: 10n * ATTO_REP_PER_REP, viewerReportableVaultRepAttoRep: 10n * ATTO_REP_PER_REP },
		},
		{ expected: 'The selected side has no remaining capacity.', name: 'when the selected side has no remaining capacity', overrides: { remainingSelectedOutcomeCapacity: 0n } },
	])('blocks report submission $name', ({ expected, overrides }) => {
		expect(getReportingReportGuardMessage(createReportGuardInput(overrides))).toBe(expected)
	})

	test.each(['not-started', 'active'] as const)('allows reporting once the game is %s, leaving lifecycle handling to the shared action matrix', reportingStatus => {
		expect(getReportingReportGuardMessage(createReportGuardInput({ reportingStatus }))).toBeUndefined()
	})

	test.each<{ expected: string | undefined; name: string; input: WithdrawGuardInput }>([
		{ expected: 'Connect a wallet before settling escalation deposits.', name: 'blocks withdrawal without a connected wallet', input: { accountAddress: undefined, isOnActiveAppChain: true, reportingStatus: 'active' } },
		{ expected: 'Switch to Sepolia.', name: 'blocks withdrawal off the active chain', input: { accountAddress: zeroAddress, isOnActiveAppChain: false, reportingStatus: 'active' } },
		{ expected: 'Loading reporting details…', name: 'blocks withdrawal while reporting details are missing', input: { accountAddress: zeroAddress, isOnActiveAppChain: true, reportingStatus: 'missing' } },
		{ expected: undefined, name: 'leaves withdrawal lifecycle handling to the shared action matrix', input: { accountAddress: zeroAddress, isOnActiveAppChain: true, reportingStatus: 'active' } },
	])('$name', ({ expected, input }) => {
		expect(getReportingWithdrawGuardMessage(input)).toBe(expected)
	})
})
