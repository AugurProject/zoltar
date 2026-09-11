/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import type { MarketDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import { Question, getQuestionTitle } from '@zoltar/ui-core-shared/components/Question.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'

const questionBase = {
	answerUnit: '',
	createdAt: 1n,
	description: 'Description',
	displayValueMax: 1n,
	displayValueMin: 0n,
	endTime: 2n,
	exists: true,
	marketType: 'binary',
	numTicks: 1n,
	outcomeLabels: ['Yes', 'No'],
	questionId: '0x0000000000000000000000000000000000000000000000000000000000000001',
	startTime: 0n,
	title: 'Question title',
} satisfies MarketDetails

// Renders the question summary and reads back the metric labels and values the component shows.
async function renderQuestionSummaryFields(question: MarketDetails) {
	const rendered = await renderIntoDocument(<Question question={question} />)
	cleanupRendered = rendered.cleanup
	return [...rendered.container.querySelectorAll('.metric-label')].map(labelElement => ({ label: labelElement.textContent ?? '', value: labelElement.nextElementSibling?.textContent ?? '' }))
}
let cleanupRendered: (() => Promise<void>) | undefined

void describe('question helpers', () => {
	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRendered?.()
			cleanupRendered = undefined
		},
	})

	void test('falls back to Untitled question when the title is empty', () => {
		expect(getQuestionTitle({ ...questionBase, title: '' })).toBe('Untitled question')
	})

	void test('keeps a non-empty title unchanged', () => {
		expect(getQuestionTitle(questionBase)).toBe('Question title')
	})

	void test('builds binary question summary fields with clarity labels', async () => {
		const fields = await renderQuestionSummaryFields(questionBase)

		expect(fields.map(field => field.label)).toEqual(['Question Type', 'Question ID', 'Created', 'End Time', 'Outcomes'])
		expect(fields.find(field => field.label === 'Question Type')?.value).toBe('Binary')
		expect(fields.find(field => field.label === 'Outcomes')?.value).toBe('Yes, No, Invalid')
	})

	void test('builds scalar question summary fields with scalar-specific details', async () => {
		const fields = await renderQuestionSummaryFields({
			...questionBase,
			answerUnit: 'USD',
			displayValueMax: 10n * 10n ** 18n,
			displayValueMin: 1n * 10n ** 18n,
			marketType: 'scalar',
			numTicks: 100n,
			outcomeLabels: [],
		})

		expect(fields.map(field => field.label)).toEqual(['Question Type', 'Question ID', 'Created', 'End Time', 'Outcomes', 'Ticks', 'Display Range', 'Answer Unit'])
		expect(fields.find(field => field.label === 'Question Type')?.value).toBe('Scalar')
		expect(fields.find(field => field.label === 'Outcomes')?.value).toBe('Scalar, Invalid')
		expect(fields.find(field => field.label === 'Ticks')?.value).toBe('100')
		expect(fields.find(field => field.label === 'Display Range')?.value).toBe('1 to 10\u00a0USD')
		expect(fields.find(field => field.label === 'Answer Unit')?.value).toBe('USD')
	})

	void test('preserves existing invalid outcomes without duplicating them', async () => {
		const fields = await renderQuestionSummaryFields({
			...questionBase,
			marketType: 'categorical',
			outcomeLabels: ['Above', 'Invalid', 'Below'],
		})

		expect(fields.find(field => field.label === 'Outcomes')?.value).toBe('Above, Invalid, Below')
	})
})
