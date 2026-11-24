import { describe, expect, test } from 'bun:test'
import { deriveQuestionLedgerLifecycleState } from '@zoltar/ui-statoblast-shared/features/question-ledgers/lib/questionLedgerState.js'

describe('question ledger state axes', () => {
	test.each<[Parameters<typeof deriveQuestionLedgerLifecycleState>[0], ReturnType<typeof deriveQuestionLedgerLifecycleState>]>([
		[{ questionOutcome: 'none', systemState: 'operational' }, 'operational'],
		[{ questionOutcome: 'yes', systemState: 'operational' }, 'ended'],
		[{ questionOutcome: 'none', systemState: 'operational', universeHasForked: true }, 'poolForked'],
		[{ questionOutcome: 'yes', systemState: 'operational', universeHasForked: true }, 'ended'],
		[{ questionOutcome: 'yes', systemState: 'forkMigration' }, 'forkMigration'],
		[{ questionOutcome: 'none', systemState: undefined }, undefined],
	])('derives lifecycle state from %o', (input, expected) => {
		expect(deriveQuestionLedgerLifecycleState(input)).toBe(expected)
	})
})
