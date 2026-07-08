/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Question } from '../components/Question.js'
import { ChainTimestampContext } from '../lib/chainTimestamp.js'
import type { MarketDetails } from '../types/contracts.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

function createQuestion(overrides: Partial<MarketDetails> = {}): MarketDetails {
	return {
		answerUnit: '',
		createdAt: 120n,
		description: 'Description',
		displayValueMax: 1n,
		displayValueMin: 0n,
		endTime: 180n,
		exists: true,
		marketType: 'binary',
		numTicks: 1n,
		outcomeLabels: ['Yes', 'No'],
		questionId: '0x0000000000000000000000000000000000000000000000000000000000000001',
		startTime: 0n,
		title: 'Question title',
		...overrides,
	}
}

describe('Question component', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let restoreDomEnvironment: (() => void) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('inherits the shared chain timestamp for route-level relative time rendering', async () => {
		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={240n}>
				<Question question={createQuestion()} showTitle={false} />
			</ChainTimestampContext.Provider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent?.includes('(2m ago)')).toBe(true)
		expect(document.body.textContent?.includes('(1m ago)')).toBe(true)
	})

	test('omits description copy when the question has no resolution context', async () => {
		const renderedComponent = await renderIntoDocument(<Question question={createQuestion({ description: '' })} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent?.includes('No resolution notes or supporting context provided.')).toBe(false)
		expect(document.body.textContent?.includes('Add resolution notes, evidence sources, and edge-case handling before users rely on this question.')).toBe(false)
	})

	test('omits description copy in preview mode when the question has no resolution context', async () => {
		const renderedComponent = await renderIntoDocument(<Question question={createQuestion({ description: '' })} variant='preview' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.textContent?.includes('No resolution notes or supporting context provided.')).toBe(false)
		expect(document.body.textContent?.includes('Add resolution notes, evidence sources, and edge-case handling before users rely on this question.')).toBe(false)
	})

	test('does not render an empty preview heading when title and description are both hidden', async () => {
		const renderedComponent = await renderIntoDocument(<Question question={createQuestion({ description: '' })} showTitle={false} variant='preview' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.querySelector('.question-summary-heading')).toBeNull()
	})

	test('renders preview timestamps as separate timeline cards with relative sublabels', async () => {
		const renderedComponent = await renderIntoDocument(
			<ChainTimestampContext.Provider value={240n}>
				<Question question={createQuestion()} variant='preview' />
			</ChainTimestampContext.Provider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const timelineItems = document.body.querySelectorAll('.question-preview-timeline-item')
		const relativeValues = document.body.querySelectorAll('.question-preview-timeline-value .timestamp-value-relative')

		expect(timelineItems).toHaveLength(2)
		expect(relativeValues).toHaveLength(2)
		expect(relativeValues[0]?.textContent).toContain('2m ago')
		expect(relativeValues[1]?.textContent).toContain('1m ago')
	})
})
