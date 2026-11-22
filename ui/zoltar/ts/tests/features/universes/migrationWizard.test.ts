/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { formatCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import type { ZoltarChildUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js'
import { deriveMigrationWizard, formatMigrationOutcomeText, formatOutcomeList, getMigrationOutcomeTextForIndex, getOutcomeLabelForIndex, getSubmittableOutcomeIndexes, resolveMigrationWizardStep, toggleMigrationOutcome, type MigrationWizardInput } from '@zoltar/ui-zoltar-shared/features/universes/lib/migrationWizard.js'
import { formatShortUniverseId } from '@zoltar/ui-core-shared/lib/universeLabels.js'

const ATTO_REP_PER_REP = 10n ** 18n
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
		outcomesExhaustive: true,
		requiresApproval: true,
		selectedOutcomeIndexes: [],
		walletRepAttoRep: 1_200n * ATTO_REP_PER_REP,
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
		expect(wizard.maxAmountAttoRep).toBe(1_200n * ATTO_REP_PER_REP)
		expect(wizard.walletRepToBurnAttoRep).toBe(1_200n * ATTO_REP_PER_REP)
		expect(wizard.fromMigrationBalanceAttoRep).toBe(0n)
		expect(statuses(wizard)).toEqual(['outcomes:complete', 'amount:complete', 'approve:incomplete', 'review:incomplete'])
		expect(wizard.steps[2]?.reason).toBe(`Approve ${formatCurrencyBalance(1_200n * ATTO_REP_PER_REP)} REP to continue.`)
		expect(wizard.reachableStepId).toBe('approve')
	})

	test('is ready to review once the approval covers the wallet REP', () => {
		const wizard = deriveMigrationWizard(input({ amountInput: '1200', approvedAttoRep: 1_200n * ATTO_REP_PER_REP, selectedOutcomeIndexes: [1n] }))
		expect(statuses(wizard)).toEqual(['outcomes:complete', 'amount:complete', 'approve:complete', 'review:ready'])
		expect(wizard.reachableStepId).toBe('review')
	})

	test('limits a migration to seven new child universes while allowing existing children', () => {
		const children = Array.from({ length: 9 }, (_, index) => child(BigInt(index), `Outcome ${index}`, index === 8))
		const wizardInput = input({ amountInput: '1', childUniverses: children, childMigratedAttoRep: { '108': 0n }, requiresApproval: false })
		const all = deriveMigrationWizard({ ...wizardInput, selectedOutcomeIndexes: children.map(outcome => outcome.outcomeIndex) })
		expect(all.steps[0]?.status).toBe('blocked')
		expect(all.steps[3]?.status).toBe('incomplete')
		const withinLimit = deriveMigrationWizard({ ...wizardInput, selectedOutcomeIndexes: children.slice(1).map(outcome => outcome.outcomeIndex) })
		expect(withinLimit.steps[3]?.status).toBe('ready')
	})

	test('uses the existing migration balance first and skips approval when it covers the amount', () => {
		const wizard = deriveMigrationWizard(input({ amountInput: '300', migrationBalanceAttoRep: 500n * ATTO_REP_PER_REP, selectedOutcomeIndexes: [1n] }))
		expect(wizard.fromMigrationBalanceAttoRep).toBe(300n * ATTO_REP_PER_REP)
		expect(wizard.walletRepToBurnAttoRep).toBe(0n)
		expect(wizard.steps[2]).toEqual({ id: 'approve', reason: 'Your migration balance covers this amount, so no wallet REP needs approval.', status: 'notNeeded' })
		expect(wizard.steps[3]?.status).toBe('ready')
	})

	test('limits partial migrations by the outcome that already received the most', () => {
		const wizard = deriveMigrationWizard(input({ amountInput: '450', childMigratedAttoRep: { '101': 400n * ATTO_REP_PER_REP }, migrationBalanceAttoRep: 500n * ATTO_REP_PER_REP, selectedOutcomeIndexes: [1n, 2n], walletRepAttoRep: 0n }))
		expect(wizard.reusableMigrationBalanceAttoRep).toBe(100n * ATTO_REP_PER_REP)
		expect(wizard.maxAmountAttoRep).toBe(100n * ATTO_REP_PER_REP)
		expect(wizard.steps[1]).toEqual({ id: 'amount', reason: `You can migrate at most ${formatCurrencyBalance(100n * ATTO_REP_PER_REP)} REP to these outcomes.`, status: 'blocked' })
		expect(wizard.reachableStepId).toBe('amount')
	})

	test('skips approval for outcome-universe REP, which is burned directly', () => {
		const wizard = deriveMigrationWizard(input({ amountInput: '10', requiresApproval: false, selectedOutcomeIndexes: [1n] }))
		expect(wizard.steps[2]?.status).toBe('notNeeded')
		expect(wizard.walletRepToBurnAttoRep).toBe(10n * ATTO_REP_PER_REP)
		expect(wizard.steps[3]?.status).toBe('ready')
	})

	test.each([{ amountInput: 'abc', reason: 'Enter a valid REP amount.' }])('rejects amount $amountInput', ({ amountInput, reason }) => {
		const wizard = deriveMigrationWizard(input({ amountInput, selectedOutcomeIndexes: [1n] }))
		expect(wizard.steps[1]).toEqual({ id: 'amount', reason, status: 'incomplete' })
		expect(wizard.amountAttoRep).toBeUndefined()
	})

	test('waits for unread balances and reports failed reads', () => {
		const unread = input({ amountInput: '10', childMigratedAttoRep: {}, selectedOutcomeIndexes: [1n] })
		expect(deriveMigrationWizard({ ...unread, balancesLoading: true }).steps[1]).toEqual({ id: 'amount', reason: 'Loading migration balances…', status: 'loading' })
		expect(deriveMigrationWizard(unread).steps[1]).toEqual({ id: 'amount', reason: 'Migration balances could not be loaded. Retry to continue.', status: 'blocked' })
		const walletUnread = deriveMigrationWizard(input({ amountInput: '10', selectedOutcomeIndexes: [1n], walletRepAttoRep: undefined }))
		expect(walletUnread.steps[1]?.status).toBe('blocked')
		const coveredWithoutWallet = deriveMigrationWizard(input({ amountInput: '10', migrationBalanceAttoRep: 10n * ATTO_REP_PER_REP, selectedOutcomeIndexes: [1n], walletRepAttoRep: undefined }))
		expect(coveredWithoutWallet.steps[1]?.status).toBe('complete')
	})

	test('marks the migration complete when every outcome received the whole balance and the wallet is empty', () => {
		const everyOutcomeCreated = [child(1n, 'Yes', true), child(2n, 'No', true)]
		const complete = deriveMigrationWizard(
			input({ childHeldAttoRep: { '101': 5n * ATTO_REP_PER_REP, '102': 5n * ATTO_REP_PER_REP }, childMigratedAttoRep: { '101': 5n * ATTO_REP_PER_REP, '102': 5n * ATTO_REP_PER_REP }, childUniverses: everyOutcomeCreated, migrationBalanceAttoRep: 5n * ATTO_REP_PER_REP, walletRepAttoRep: 0n }),
		)
		expect(complete.migrationComplete).toBe(true)
		expect(complete.outcomes.every(outcome => outcome.fullyMigrated)).toBe(true)
		const walletLeft = deriveMigrationWizard(input({ childMigratedAttoRep: { '101': 5n * ATTO_REP_PER_REP, '102': 5n * ATTO_REP_PER_REP }, childUniverses: everyOutcomeCreated, migrationBalanceAttoRep: 5n * ATTO_REP_PER_REP, walletRepAttoRep: 1n }))
		expect(walletLeft.migrationComplete).toBe(false)
		expect(deriveMigrationWizard(input({ migrationBalanceAttoRep: 5n * ATTO_REP_PER_REP, walletRepAttoRep: 0n })).migrationComplete).toBe(false)
	})

	test('never marks a scalar migration complete from the loaded subset of outcomes', () => {
		// A scalar fork only loads the ticks the user picked; every other tick can still receive the whole migration balance.
		const pickedTick = [child(7n, '70 °C', true)]
		const scalar = deriveMigrationWizard(input({ childHeldAttoRep: { '107': 5n * ATTO_REP_PER_REP }, childMigratedAttoRep: { '107': 5n * ATTO_REP_PER_REP }, childUniverses: pickedTick, migrationBalanceAttoRep: 5n * ATTO_REP_PER_REP, outcomesExhaustive: false, walletRepAttoRep: 0n }))
		expect(scalar.outcomes.every(outcome => outcome.fullyMigrated)).toBe(true)
		expect(scalar.migrationComplete).toBe(false)
	})
})

describe('migration wizard helpers', () => {
	test('reusable migration balance is zero once an outcome received more than the balance', () => {
		const wizard = deriveMigrationWizard(input({ childMigratedAttoRep: { '101': 60n * ATTO_REP_PER_REP }, migrationBalanceAttoRep: 50n * ATTO_REP_PER_REP, selectedOutcomeIndexes: [1n] }))
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

	test('#1477: look-alike, invisible and bidi-override labels stay distinct and carry their index and child universe', () => {
		const labels = ['Yes', 'Y\u0435s', 'Yes\u2063', '\u202EseY']
		const spoofed = labels.map((label, position) => ({ ...child(BigInt(position + 1), label, true), universeId: (1n << 200n) + BigInt(position + 1) * 0x1111n }))
		const wizard = deriveMigrationWizard(input({ childUniverses: spoofed, selectedOutcomeIndexes: [2n, 4n] }))
		const rows = wizard.outcomes.map(formatMigrationOutcomeText)
		expect(new Set(rows).size).toBe(labels.length)
		for (const [position, row] of rows.entries()) {
			const outcome = spoofed[position]
			if (outcome === undefined) throw new Error('Missing spoofed outcome')
			// Label first, then the index and child universe, the same order as the cards.
			expect(row).toEndWith(` #${outcome.outcomeIndex.toString()} · ${formatShortUniverseId(outcome.universeId)}`)
			expect(row).toContain(formatShortUniverseId(outcome.universeId))
			// Invisible and direction-changing characters are shown, never passed through to the page.
			expect(row).not.toMatch(/[\u2063\u202E]/u)
		}
		if (rows[1] === undefined || rows[2] === undefined || rows[3] === undefined) throw new Error('Missing outcome rows')
		expect(rows[2]).toContain('\\u{2063}')
		expect(rows[3]).toContain('\\u{202E}seY')
		// The review lists each selected child universe with its own index and ID, so a comma in a label cannot add an outcome.
		expect(wizard.selectedOutcomes.map(formatMigrationOutcomeText)).toEqual([rows[1], rows[3]])
		expect(formatOutcomeList(wizard.selectedOutcomes)).toBe('Y\u0435s #2, \\u{202E}seY #4')
		expect(getMigrationOutcomeTextForIndex(spoofed, 3n)).toBe(rows[2])
		expect(getMigrationOutcomeTextForIndex(undefined, 3n)).toBe('Outcome 3')
		const comma = deriveMigrationWizard(input({ childUniverses: [child(6n, 'No, Yes', true)], selectedOutcomeIndexes: [6n] }))
		expect(formatOutcomeList(comma.selectedOutcomes)).toBe('No, Yes #6')
	})

	test('#1477: a categorical label built from its own index does not repeat it, but a mismatched one does', () => {
		const categorical = [child(1n, 'Outcome 1: Alpha', true), child(2n, 'Outcome 2', true), child(3n, 'Outcome 1: Beta', true), child(4n, 'Outcome 40', true)]
		const wizard = deriveMigrationWizard(input({ childUniverses: categorical, selectedOutcomeIndexes: [1n, 2n, 3n, 4n] }))
		expect(wizard.outcomes.map(formatMigrationOutcomeText)).toEqual(['Outcome 1: Alpha · 0x65', 'Outcome 2 · 0x66', 'Outcome 1: Beta #3 · 0x67', 'Outcome 40 #4 · 0x68'])
		expect(formatOutcomeList(wizard.selectedOutcomes)).toBe('Outcome 1: Alpha, Outcome 2, Outcome 1: Beta #3, Outcome 40 #4')
	})

	test('getOutcomeLabelForIndex names outcomes and falls back to a position', () => {
		expect(getOutcomeLabelForIndex(childUniverses, 2n)).toBe('No')
		expect(getOutcomeLabelForIndex(undefined, 2n)).toBe('Outcome 2')
	})
})
