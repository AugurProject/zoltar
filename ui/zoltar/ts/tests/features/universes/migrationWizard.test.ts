/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { formatCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import type { ZoltarChildUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { deriveMigrationWizard, getOutcomeLabelForIndex, getSubmittableOutcomeIndexes, resolveMigrationWizardStep, toggleMigrationOutcome, type MigrationWizardInput } from '@zoltar/ui-zoltar-shared/features/universes/lib/migrationWizard.js'

const REP = 10n ** 18n
const CHILD_REP = '0x00000000000000000000000000000000000000b2' as const

function child(outcomeIndex: bigint, outcomeLabel: string, exists: boolean): ZoltarChildUniverseSummary {
	return { exists, forkTime: 0n, outcomeIndex, outcomeLabel, parentUniverseId: 0n, reputationToken: exists ? CHILD_REP : zeroAddress, universeId: 100n + outcomeIndex }
}

const childUniverses = [child(1n, 'Yes', true), child(2n, 'No', false)]

function input(overrides: Partial<MigrationWizardInput> = {}): MigrationWizardInput {
	return {
		amountInput: '',
		approvalLoading: false,
		approvedAttoRep: 0n,
		balancesLoading: false,
		childHeldAttoRep: { '101': 0n },
		childMigratedAttoRep: { '101': 0n },
		childUniverses,
		migrationBalanceAttoRep: 0n,
		requiresApproval: true,
		selectedOutcomeIndexes: [],
		walletRepAttoRep: 1_200n * REP,
		...overrides,
	}
}

const statuses = (wizard: ReturnType<typeof deriveMigrationWizard>) => wizard.steps.map(step => `${step.id}:${step.status}`)

describe('deriveMigrationWizard', () => {
	test('starts on outcome selection and explains what is missing', () => {
		const wizard = deriveMigrationWizard(input())
		expect(statuses(wizard)).toEqual(['outcomes:incomplete', 'amount:incomplete', 'approve:incomplete', 'review:incomplete'])
		expect(wizard.steps[0]?.reason).toBe('Select at least one outcome.')
		expect(wizard.steps[3]?.reason).toBe('Select at least one outcome.')
		expect(wizard.reachableStepId).toBe('outcomes')
		expect(wizard.outcomes.map(outcome => [outcome.label, outcome.exists])).toEqual([
			['Yes', true],
			['No', false],
		])
	})

	test('requires approval for wallet REP and lists outcomes in the order they were picked', () => {
		const wizard = deriveMigrationWizard(input({ amountInput: '1200', selectedOutcomeIndexes: [2n, 1n] }))
		expect(wizard.selectedOutcomes.map(outcome => outcome.label)).toEqual(['No', 'Yes'])
		expect(wizard.maxAmountAttoRep).toBe(1_200n * REP)
		expect(wizard.walletRepToBurnAttoRep).toBe(1_200n * REP)
		expect(wizard.fromMigrationBalanceAttoRep).toBe(0n)
		expect(statuses(wizard)).toEqual(['outcomes:complete', 'amount:complete', 'approve:incomplete', 'review:incomplete'])
		expect(wizard.steps[2]?.reason).toBe(`Approve ${formatCurrencyBalance(1_200n * REP)} REP to continue.`)
		expect(wizard.reachableStepId).toBe('approve')
	})

	test('is ready to review once the approval covers the wallet REP', () => {
		const wizard = deriveMigrationWizard(input({ amountInput: '1200', approvedAttoRep: 1_200n * REP, selectedOutcomeIndexes: [1n] }))
		expect(statuses(wizard)).toEqual(['outcomes:complete', 'amount:complete', 'approve:complete', 'review:ready'])
		expect(wizard.reachableStepId).toBe('review')
	})

	test('uses the existing migration balance first and skips approval when it covers the amount', () => {
		const wizard = deriveMigrationWizard(input({ amountInput: '300', migrationBalanceAttoRep: 500n * REP, selectedOutcomeIndexes: [1n] }))
		expect(wizard.fromMigrationBalanceAttoRep).toBe(300n * REP)
		expect(wizard.walletRepToBurnAttoRep).toBe(0n)
		expect(wizard.steps[2]).toEqual({ id: 'approve', reason: 'Your migration balance covers this amount, so no wallet REP needs approval.', status: 'notNeeded' })
		expect(wizard.steps[3]?.status).toBe('ready')
	})

	test('limits partial migrations by the outcome that already received the most', () => {
		const wizard = deriveMigrationWizard(input({ amountInput: '450', childMigratedAttoRep: { '101': 400n * REP }, migrationBalanceAttoRep: 500n * REP, selectedOutcomeIndexes: [1n, 2n], walletRepAttoRep: 0n }))
		expect(wizard.reusableMigrationBalanceAttoRep).toBe(100n * REP)
		expect(wizard.maxAmountAttoRep).toBe(100n * REP)
		expect(wizard.steps[1]).toEqual({ id: 'amount', reason: `You can migrate at most ${formatCurrencyBalance(100n * REP)} REP to these outcomes.`, status: 'blocked' })
		expect(wizard.reachableStepId).toBe('amount')
	})

	test('skips approval for outcome-universe REP, which is burned directly', () => {
		const wizard = deriveMigrationWizard(input({ amountInput: '10', requiresApproval: false, selectedOutcomeIndexes: [1n] }))
		expect(wizard.steps[2]?.status).toBe('notNeeded')
		expect(wizard.walletRepToBurnAttoRep).toBe(10n * REP)
		expect(wizard.steps[3]?.status).toBe('ready')
	})

	test.each([
		{ amountInput: 'abc', reason: 'Enter a valid REP amount.' },
		{ amountInput: '0', reason: 'Enter an amount greater than zero.' },
	])('rejects amount $amountInput', ({ amountInput, reason }) => {
		const wizard = deriveMigrationWizard(input({ amountInput, selectedOutcomeIndexes: [1n] }))
		expect(wizard.steps[1]).toEqual({ id: 'amount', reason, status: 'incomplete' })
		expect(wizard.amountAttoRep).toBeUndefined()
	})

	test('waits for unread balances and reports failed reads', () => {
		const unread = input({ amountInput: '10', childMigratedAttoRep: {}, selectedOutcomeIndexes: [1n] })
		expect(deriveMigrationWizard({ ...unread, balancesLoading: true }).steps[1]).toEqual({ id: 'amount', reason: 'Loading migration balances…', status: 'loading' })
		expect(deriveMigrationWizard(unread).steps[1]).toEqual({ id: 'amount', reason: 'Could not read migration balances. Retry to continue.', status: 'blocked' })
		const walletUnread = deriveMigrationWizard(input({ amountInput: '10', selectedOutcomeIndexes: [1n], walletRepAttoRep: undefined }))
		expect(walletUnread.steps[1]?.status).toBe('blocked')
		const coveredWithoutWallet = deriveMigrationWizard(input({ amountInput: '10', migrationBalanceAttoRep: 10n * REP, selectedOutcomeIndexes: [1n], walletRepAttoRep: undefined }))
		expect(coveredWithoutWallet.steps[1]?.status).toBe('complete')
	})

	test('marks the migration complete when every outcome received the whole balance and the wallet is empty', () => {
		const everyOutcomeCreated = [child(1n, 'Yes', true), child(2n, 'No', true)]
		const complete = deriveMigrationWizard(input({ childHeldAttoRep: { '101': 5n * REP, '102': 5n * REP }, childMigratedAttoRep: { '101': 5n * REP, '102': 5n * REP }, childUniverses: everyOutcomeCreated, migrationBalanceAttoRep: 5n * REP, walletRepAttoRep: 0n }))
		expect(complete.migrationComplete).toBe(true)
		expect(complete.outcomes.every(outcome => outcome.fullyMigrated)).toBe(true)
		const walletLeft = deriveMigrationWizard(input({ childMigratedAttoRep: { '101': 5n * REP, '102': 5n * REP }, childUniverses: everyOutcomeCreated, migrationBalanceAttoRep: 5n * REP, walletRepAttoRep: 1n }))
		expect(walletLeft.migrationComplete).toBe(false)
		expect(deriveMigrationWizard(input({ migrationBalanceAttoRep: 5n * REP, walletRepAttoRep: 0n })).migrationComplete).toBe(false)
	})
})

describe('migration wizard helpers', () => {
	test('reusable migration balance is zero once an outcome received more than the balance', () => {
		const wizard = deriveMigrationWizard(input({ childMigratedAttoRep: { '101': 60n * REP }, migrationBalanceAttoRep: 50n * REP, selectedOutcomeIndexes: [1n] }))
		expect(wizard.reusableMigrationBalanceAttoRep).toBe(0n)
		expect(wizard.outcomes[0]?.fullyMigrated).toBe(true)
		expect(deriveMigrationWizard(input({ migrationBalanceAttoRep: undefined, selectedOutcomeIndexes: [1n] })).reusableMigrationBalanceAttoRep).toBeUndefined()
	})

	test('resolveMigrationWizardStep never opens a step beyond the reachable one', () => {
		expect(resolveMigrationWizardStep('review', 'amount')).toBe('amount')
		expect(resolveMigrationWizardStep('outcomes', 'review')).toBe('outcomes')
	})

	test('toggleMigrationOutcome keeps pick order', () => {
		expect(toggleMigrationOutcome([2n], 1n)).toEqual([2n, 1n])
		expect(toggleMigrationOutcome([2n, 1n], 2n)).toEqual([1n])
	})

	test('asks for outcomes, not balances, on the amount step when nothing is selected', () => {
		expect(deriveMigrationWizard(input({ amountInput: '10' })).steps[1]).toEqual({ id: 'amount', reason: 'Select at least one outcome.', status: 'incomplete' })
	})

	test('getSubmittableOutcomeIndexes drops outcomes that are not in the universe', () => {
		expect(getSubmittableOutcomeIndexes(childUniverses, [2n, 7n, 1n])).toEqual([2n, 1n])
	})

	test('getOutcomeLabelForIndex names outcomes and falls back to a position', () => {
		expect(getOutcomeLabelForIndex(childUniverses, 2n)).toBe('No')
		expect(getOutcomeLabelForIndex(undefined, 2n)).toBe('Outcome 3')
	})
})
