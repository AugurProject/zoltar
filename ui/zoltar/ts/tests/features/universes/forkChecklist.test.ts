/// <reference types="bun-types" />

import { deriveForkChecklist, getForkEligibleQuestions, resolveUseForForkAction, type ForkChecklistInput } from '@zoltar/ui-zoltar-shared/features/universes/lib/forkChecklist.js'
import { formatRelativeTimestamp, formatTimestamp } from '@zoltar/ui-core-shared/lib/formatters.js'
import type { MarketDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import { describe, expect, test } from 'bun:test'

const ATTO_REP = 10n ** 18n

function createQuestion(overrides: Partial<MarketDetails> = {}): MarketDetails {
	return {
		answerUnit: '',
		createdAt: 1n,
		description: '',
		displayValueMax: 2n,
		displayValueMin: 0n,
		endTime: 100n,
		exists: true,
		marketType: 'binary',
		numTicks: 2n,
		outcomeLabels: ['Yes', 'No'],
		questionId: '0x01',
		startTime: 1n,
		title: 'Question',
		...overrides,
	}
}

function createInput(overrides: Partial<ForkChecklistInput> = {}): ForkChecklistInput {
	return {
		approvalLoading: false,
		approvedAttoRep: 450n * ATTO_REP,
		blockingReason: undefined,
		currentTimestamp: 100n,
		forkThresholdAttoRep: 450n * ATTO_REP,
		hasForkEconomics: true,
		question: { kind: 'selected', question: createQuestion() },
		repBalanceAttoRep: 500n * ATTO_REP,
		requiresApproval: true,
		tokenSymbol: 'REP',
		...overrides,
	}
}

const statuses = (input: ForkChecklistInput) => deriveForkChecklist(input).steps.map(step => `${step.key}:${step.status}`)

describe('getForkEligibleQuestions', () => {
	const questions = [createQuestion({ endTime: 50n, questionId: '0x01', title: 'Older election' }), createQuestion({ endTime: 200n, questionId: '0x02', title: 'Future election' }), createQuestion({ endTime: 90n, questionId: '0x03', title: 'Recent match' })]

	test('lists only existing questions whose end time has been reached, most recently ended first', () => {
		expect(getForkEligibleQuestions(questions, 100n).map(question => question.questionId)).toEqual(['0x03', '0x01'])
		expect(getForkEligibleQuestions(questions, 200n).map(question => question.questionId)).toEqual(['0x02', '0x03', '0x01'])
		expect(getForkEligibleQuestions([createQuestion({ endTime: 50n, exists: false })], 100n)).toEqual([])
		expect(getForkEligibleQuestions(questions, undefined)).toEqual([])
	})

	test('filters by title case-insensitively', () => {
		expect(getForkEligibleQuestions(questions, 100n, '  ELECTION ').map(question => question.questionId)).toEqual(['0x01'])
		expect(getForkEligibleQuestions(questions, 100n, 'nothing')).toEqual([])
	})
})

describe('resolveUseForForkAction', () => {
	test('offers the shortcut only for ended questions', () => {
		expect(resolveUseForForkAction(false, createQuestion(), 100n)).toEqual({ disabled: false, kind: 'available', label: 'Use for fork' })
		expect(resolveUseForForkAction(false, createQuestion(), 99n)).toEqual({ disabled: true, kind: 'notEnded', label: 'Fork after it ends' })
		expect(resolveUseForForkAction(true, createQuestion(), 100n)).toEqual({ disabled: true, kind: 'forked', label: 'Already forked' })
		const unknown = { disabled: true, kind: 'unknown', label: 'End time unknown' }
		expect(resolveUseForForkAction(false, undefined, 100n)).toEqual(unknown)
		expect(resolveUseForForkAction(false, createQuestion(), undefined)).toEqual(unknown)
		expect(resolveUseForForkAction(false, createQuestion({ exists: false }), 200n)).toEqual(unknown)
	})
})

describe('deriveForkChecklist', () => {
	test('enables submission once every prerequisite is done', () => {
		const checklist = deriveForkChecklist(createInput())
		expect(checklist.canSubmit).toBe(true)
		expect(checklist.submitBlockedReason).toBeUndefined()
		expect(statuses(createInput())).toEqual(['question:done', 'rep:done', 'approval:done', 'review:pending'])
		expect(checklist.blockingStepKey).toBeUndefined()
		expect(checklist.steps[0].reason).toBe('Question has ended.')
		expect(checklist.steps[1].reason).toBe('You have 500 REP; 450 REP needed.')
		expect(checklist.steps[2].reason).toBe('450 REP approved.')
	})

	test('reports the exact REP shortfall', () => {
		const input = createInput({ repBalanceAttoRep: 120n * ATTO_REP })
		const checklist = deriveForkChecklist(input)
		expect(checklist.steps[1]).toEqual({ key: 'rep', reason: 'You have 120 REP; 450 REP needed (330 short).', status: 'blocked' })
		expect(checklist.canSubmit).toBe(false)
		expect(checklist.submitBlockedReason).toBe(checklist.steps[1].reason)
		expect(checklist.blockingStepKey).toBe('rep')
		expect(checklist.steps[3]).toEqual({ key: 'review', reason: 'Complete the steps above to fork.', status: 'blocked' })
	})

	test('blocks a question that has not ended and gives its end time', () => {
		const checklist = deriveForkChecklist(createInput({ currentTimestamp: 40n }))
		expect(checklist.steps[0].status).toBe('blocked')
		expect(checklist.steps[0].reason).toBe(`The selected question must end before the universe can fork. It ends ${formatTimestamp(100n)} (${formatRelativeTimestamp(100n, 40n)}).`)
		expect(checklist.submitBlockedReason).toBe(checklist.steps[0].reason)
	})

	test('keeps question selection pending until a question is chosen or loaded', () => {
		expect(deriveForkChecklist(createInput({ question: { kind: 'none' } })).steps[0]).toEqual({ key: 'question', reason: 'Select an ended question to continue.', status: 'pending' })
		expect(deriveForkChecklist(createInput({ question: { kind: 'loading' } })).steps[0].status).toBe('pending')
		expect(deriveForkChecklist(createInput({ currentTimestamp: undefined })).steps[0].status).toBe('pending')
		expect(deriveForkChecklist(createInput({ question: { kind: 'unavailable', reason: 'Question not found' } })).steps[0]).toEqual({ key: 'question', reason: 'Question not found', status: 'blocked' })
	})

	test('asks for the missing approval with amounts and skips approval for child REP', () => {
		const approval = deriveForkChecklist(createInput({ approvedAttoRep: 100n * ATTO_REP })).steps[2]
		expect(approval).toEqual({ key: 'approval', reason: 'Approve 450 REP (100 approved).', status: 'pending' })
		expect(deriveForkChecklist(createInput({ approvalLoading: true })).steps[2].status).toBe('pending')
		expect(deriveForkChecklist(createInput({ approvedAttoRep: 0n, requiresApproval: false, tokenSymbol: 'REP7' })).steps[2]).toEqual({ key: 'approval', reason: 'Child-universe REP needs no approval.', status: 'done' })
	})

	test('reports wallet and fork-term blockers on the review step', () => {
		const walletBlocked = deriveForkChecklist(createInput({ blockingReason: 'Switch to Sepolia.' }))
		expect(walletBlocked.canSubmit).toBe(false)
		expect(walletBlocked.submitBlockedReason).toBe('Switch to Sepolia.')
		expect(walletBlocked.blockingStepKey).toBe('review')
		expect(walletBlocked.steps[3]).toEqual({ key: 'review', reason: 'Switch to Sepolia.', status: 'blocked' })
		const disconnected = deriveForkChecklist(createInput({ blockingReason: 'Connect a wallet.', repBalanceAttoRep: undefined, approvedAttoRep: undefined }))
		expect(disconnected.steps[1]).toEqual({ key: 'rep', reason: 'Checked once your wallet and the universe are ready.', status: 'pending' })
		expect(disconnected.submitBlockedReason).toBe('Connect a wallet.')
		expect(disconnected.steps[3]).toEqual({ key: 'review', reason: 'Connect a wallet.', status: 'blocked' })
		const noEconomics = deriveForkChecklist(createInput({ hasForkEconomics: false }))
		expect(noEconomics.canSubmit).toBe(false)
		expect(noEconomics.steps[3]).toEqual({ key: 'review', reason: 'Fork burn and migration-credit terms are unavailable.', status: 'blocked' })
	})
})
