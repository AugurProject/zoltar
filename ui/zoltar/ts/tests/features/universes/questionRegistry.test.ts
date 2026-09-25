/// <reference types="bun-types" />

import type { MarketDetails, MarketDetailsPage } from '@zoltar/ui-core-shared/types/contracts.js'
import { insertCreatedQuestion, mergeQuestionLists } from '@zoltar/ui-zoltar-shared/features/universes/lib/questionRegistry.js'
import { describe, expect, test } from 'bun:test'

function createQuestion(questionId: string, title = `Question ${questionId}`): MarketDetails {
	return {
		answerUnit: '',
		createdAt: 1n,
		description: '',
		displayValueMax: 2n,
		displayValueMin: 0n,
		endTime: 2n,
		exists: true,
		marketType: 'binary',
		numTicks: 2n,
		outcomeLabels: ['Yes', 'No'],
		questionId,
		startTime: 1n,
		title,
	}
}

function createPage(pageIndex: number, pageSize: number, questionCount: bigint, questions: MarketDetails[]): MarketDetailsPage {
	return { pageIndex, pageSize, questionCount, questions }
}

describe('questionRegistry', () => {
	test('merges question lists by normalized id, replacing in place', () => {
		const first = createQuestion('0x01')
		const second = createQuestion('0x02')
		const updatedFirst = createQuestion('0x1', 'Updated')
		expect(mergeQuestionLists([first, second], [updatedFirst])).toEqual([updatedFirst, second])
		expect(mergeQuestionLists([first], [second])).toEqual([first, second])
	})

	test('adds the created question to the loaded list and count when no page is loaded', () => {
		const existing = createQuestion('0x01')
		const created = createQuestion('0x02')
		expect(insertCreatedQuestion({ questionCount: 1n, questionPage: undefined, questions: [existing] }, created, 2n)).toEqual({ questionCount: 2n, questionPage: undefined, questions: [existing, created] })
		expect(insertCreatedQuestion({ questionCount: undefined, questionPage: undefined, questions: [] }, created, 5n)).toEqual({ questionCount: 5n, questionPage: undefined, questions: [created] })
	})

	test('appends the created question when it directly follows the loaded page', () => {
		const existing = createQuestion('0x01')
		const created = createQuestion('0x02')
		const result = insertCreatedQuestion({ questionCount: 1n, questionPage: createPage(0, 10, 1n, [existing]), questions: [existing] }, created, 2n)
		expect(result.questionPage).toEqual(createPage(0, 10, 2n, [existing, created]))
	})

	test('keeps a full or earlier page unchanged apart from the new count', () => {
		const pageQuestions = [createQuestion('0x01'), createQuestion('0x02')]
		const created = createQuestion('0x03')
		const fullPage = insertCreatedQuestion({ questionCount: 2n, questionPage: createPage(0, 2, 2n, pageQuestions), questions: pageQuestions }, created, 3n)
		expect(fullPage.questionPage).toEqual(createPage(0, 2, 3n, pageQuestions))
		expect(fullPage.questions).toEqual([...pageQuestions, created])

		const earlierPage = insertCreatedQuestion({ questionCount: 25n, questionPage: createPage(0, 10, 25n, pageQuestions), questions: pageQuestions }, created, 26n)
		expect(earlierPage.questionPage?.questions).toEqual(pageQuestions)
		expect(earlierPage.questionPage?.questionCount).toBe(26n)
	})

	test('does not append when the page is out of step with the registry count', () => {
		const existing = createQuestion('0x01')
		const created = createQuestion('0x03')
		// Another question was created concurrently, so the created one is not the next entry after this page.
		const result = insertCreatedQuestion({ questionCount: 1n, questionPage: createPage(0, 10, 1n, [existing]), questions: [existing] }, created, 3n)
		expect(result.questionPage?.questions).toEqual([existing])
		expect(result.questionPage?.questionCount).toBe(3n)
	})

	test('replaces a created question the page already shows without duplicating it', () => {
		const existing = createQuestion('0x01')
		const stale = createQuestion('0x02', 'Stale')
		const created = createQuestion('0x0002', 'Fresh')
		const result = insertCreatedQuestion({ questionCount: 2n, questionPage: createPage(0, 10, 2n, [existing, stale]), questions: [existing, stale] }, created, 2n)
		expect(result.questionPage).toEqual(createPage(0, 10, 2n, [existing, created]))
		expect(result.questions).toEqual([existing, created])
	})
})
