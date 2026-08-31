/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { render } from 'preact'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import type { MarketDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import { QuestionsView } from '../../../features/zoltarSurface/components/ZoltarSection.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'

const question: MarketDetails = {
	answerUnit: '',
	createdAt: 1n,
	description: 'A reusable resolution question',
	displayValueMax: 2n,
	displayValueMin: 0n,
	endTime: 3n,
	exists: true,
	marketType: 'binary',
	numTicks: 2n,
	outcomeLabels: ['Yes', 'No'],
	questionId: '0x01',
	startTime: 1n,
	title: 'Will the event happen?',
}

describe('QuestionsView', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		restoreDomEnvironment = installDomEnvironment().cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('renders the question registry without cross-application actions', async () => {
		const loadPage = mock(async () => undefined)
		const activeViews: string[] = []
		const selectedQuestionIds: string[] = []
		const renderedComponent = await renderIntoDocument(
			<QuestionsView
				canFork={true}
				hasForked={false}
				loadingZoltarQuestions={false}
				onActiveViewChange={view => activeViews.push(view)}
				onLoadZoltarQuestionPage={loadPage}
				onZoltarForkQuestionIdChange={questionId => selectedQuestionIds.push(questionId)}
				requestContextKey={0}
				zoltarQuestionPage={{ pageIndex: 0, pageSize: 10, questionCount: 1n, questions: [question] }}
				zoltarQuestionsError={undefined}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Browse Questions' })).not.toBeNull()
		expect(documentQueries.getByText(/reusable questions in the global registry/)).not.toBeNull()
		expect(document.body.textContent).not.toContain('UNIVERSE')
		expect(document.body.textContent).not.toContain('questions in the active universe')
		expect(documentQueries.getByText(question.title)).not.toBeNull()
		expect(document.body.textContent).not.toContain('Statoblast')
		expect(document.body.textContent).not.toContain('Open Oracle')
		expect(document.body.textContent).not.toContain('Security Pool')

		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Use for fork' }))
		})
		expect(selectedQuestionIds).toEqual([question.questionId])
		expect(activeViews).toEqual(['fork'])
		expect(loadPage).toHaveBeenCalledWith(0, 10)
	})

	test('retries a failed automatic page load without leaking its rejection', async () => {
		let requestCount = 0
		const loadPage = mock(async () => {
			requestCount += 1
			if (requestCount === 1) throw new Error('Page read failed')
		})
		const renderedComponent = await renderIntoDocument(
			<QuestionsView canFork={false} hasForked={false} loadingZoltarQuestions={false} onActiveViewChange={() => undefined} onLoadZoltarQuestionPage={loadPage} onZoltarForkQuestionIdChange={() => undefined} requestContextKey={0} zoltarQuestionPage={undefined} zoltarQuestionsError='Page read failed' />,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => await Promise.resolve())
		expect(loadPage).toHaveBeenCalledTimes(1)
		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Retry questions' }))
		})
		await act(async () => await Promise.resolve())
		expect(loadPage).toHaveBeenCalledTimes(2)
	})

	test('omits universe fork actions when no universe is available', async () => {
		const renderedComponent = await renderIntoDocument(
			<QuestionsView
				canFork={false}
				hasForked={false}
				loadingZoltarQuestions={false}
				onActiveViewChange={() => undefined}
				onLoadZoltarQuestionPage={async () => undefined}
				onZoltarForkQuestionIdChange={() => undefined}
				requestContextKey={0}
				zoltarQuestionPage={{ pageIndex: 0, pageSize: 10, questionCount: 1n, questions: [question] }}
				zoltarQuestionsError={undefined}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(within(document.body).queryByRole('button', { name: 'Use for fork' })).toBeNull()
		expect(within(document.body).getByText(question.title)).toBeDefined()
		expect(document.body.textContent).not.toContain('fork the active universe')
		expect(within(document.body).getByText('Find reusable questions in the global registry and inspect their resolution terms.')).toBeDefined()
	})

	test('reloads the current page when its request context changes', async () => {
		const loadPage = mock(async () => undefined)
		const view = (requestContextKey: number) => (
			<QuestionsView canFork={false} hasForked={false} loadingZoltarQuestions={false} onActiveViewChange={() => undefined} onLoadZoltarQuestionPage={loadPage} onZoltarForkQuestionIdChange={() => undefined} requestContextKey={requestContextKey} zoltarQuestionPage={undefined} zoltarQuestionsError={undefined} />
		)
		const renderedComponent = await renderIntoDocument(view(0))
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(loadPage).toHaveBeenCalledTimes(1)

		await act(async () => {
			render(view(1), renderedComponent.container)
			await Promise.resolve()
		})

		expect(loadPage).toHaveBeenCalledTimes(2)
		expect(loadPage).toHaveBeenLastCalledWith(0, 10)
	})

	test('clamps and reloads a page that is out of range in a replacement environment', async () => {
		const loadPage = mock(async () => undefined)
		const view = (requestContextKey: number, pageIndex: number, questionCount: bigint, questions: MarketDetails[]) => (
			<QuestionsView
				canFork={false}
				hasForked={false}
				loadingZoltarQuestions={false}
				onActiveViewChange={() => undefined}
				onLoadZoltarQuestionPage={loadPage}
				onZoltarForkQuestionIdChange={() => undefined}
				requestContextKey={requestContextKey}
				zoltarQuestionPage={{ pageIndex, pageSize: 10, questionCount, questions }}
				zoltarQuestionsError={undefined}
			/>
		)
		const renderedComponent = await renderIntoDocument(view(0, 0, 41n, [question]))
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)

		for (let pageIndex = 1; pageIndex <= 4; pageIndex += 1) {
			await act(() => {
				fireEvent.click(documentQueries.getByRole('button', { name: 'Next page' }))
			})
			await act(() => {
				render(view(0, pageIndex, 41n, [question]), renderedComponent.container)
			})
		}
		expect(loadPage).toHaveBeenLastCalledWith(4, 10)

		await act(async () => {
			render(view(1, 4, 1n, []), renderedComponent.container)
			await Promise.resolve()
		})
		expect(loadPage).toHaveBeenLastCalledWith(0, 10)

		await act(() => {
			render(view(1, 0, 1n, [question]), renderedComponent.container)
		})
		expect(documentQueries.getByText(question.title)).not.toBeNull()
		expect(documentQueries.getByText('Page 1 of 1')).not.toBeNull()
	})
})
