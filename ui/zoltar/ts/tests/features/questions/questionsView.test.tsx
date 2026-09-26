/// <reference types="bun-types" />

import { getLocalEntityScope } from '@zoltar/ui-core-shared/hooks/useLocalEntities.js'
import { readFavoriteEntries, resetLocalEntityStoreForTesting, setEntityFavorite } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import type { MarketDetails, MarketDetailsPage } from '@zoltar/ui-core-shared/types/contracts.js'
import { QuestionsView } from '@zoltar/ui-zoltar-shared/features/zoltarSurface/components/QuestionsView.js'
import { questionDownloadStore } from '@zoltar/ui-zoltar-shared/lib/questionBrowse.js'
import { describe, expect, mock, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'

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

function createQuestion(index: number): MarketDetails {
	return { ...question, questionId: `0x${index.toString(16).padStart(2, '0')}`, title: `Numbered question ${index.toString()}` }
}

function seedQuestions(questions: readonly MarketDetails[], { favorite = true }: { favorite?: boolean } = {}) {
	const scope = getLocalEntityScope('zoltar', 'question')
	questionDownloadStore.record(
		scope,
		questions.map(item => ({ data: item, id: item.questionId })),
	)
	if (favorite) for (const item of [...questions].reverse()) setEntityFavorite(scope, item.questionId, true)
}

type ViewOverrides = {
	canFork?: boolean
	loadPage?: (pageIndex: number, pageSize: number) => Promise<void>
	onActiveViewChange?: (view: 'create' | 'questions' | 'universes') => void
	onZoltarForkQuestionIdChange?: (questionId: string) => void
	requestContextKey?: number
	zoltarQuestionPage?: MarketDetailsPage | undefined
	zoltarQuestionsError?: string | undefined
}

function view({ canFork = false, loadPage = async () => undefined, onActiveViewChange = () => undefined, onZoltarForkQuestionIdChange = () => undefined, requestContextKey = 0, zoltarQuestionPage, zoltarQuestionsError }: ViewOverrides = {}) {
	return (
		<QuestionsView
			canFork={canFork}
			hasForked={false}
			loadingZoltarQuestions={false}
			onActiveViewChange={onActiveViewChange}
			onLoadZoltarQuestionPage={loadPage}
			onZoltarForkQuestionIdChange={onZoltarForkQuestionIdChange}
			requestContextKey={requestContextKey}
			zoltarQuestionPage={zoltarQuestionPage}
			zoltarQuestionsError={zoltarQuestionsError}
		/>
	)
}

function getRenderedQuestionTitles() {
	return [...document.querySelectorAll('.entity-card h3')].map(heading => heading.textContent)
}

describe('QuestionsView', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
			resetLocalEntityStoreForTesting()
		},
		beforeTest: () => {
			resetLocalEntityStoreForTesting()
		},
	})

	test('renders favorite questions from the local cache without cross-application actions or a chain scan', async () => {
		seedQuestions([question])
		const loadPage = mock(async () => undefined)
		const activeViews: string[] = []
		const selectedQuestionIds: string[] = []
		const renderedComponent = await renderIntoDocument(view({ canFork: true, loadPage, onActiveViewChange: nextView => activeViews.push(nextView), onZoltarForkQuestionIdChange: questionId => selectedQuestionIds.push(questionId) }))
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(renderedComponent.container.querySelector('details')?.open).toBe(false)
		expect(renderedComponent.container.textContent?.match(/End Time/g)).toHaveLength(1)
		expect(renderedComponent.container.querySelector('.entity-card-actions')?.closest('details')).toBeNull()
		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Browse Questions' })).not.toBeNull()
		expect(documentQueries.getByText(/reusable questions in the global registry/)).not.toBeNull()
		expect(document.body.textContent).not.toContain('UNIVERSE')
		expect(document.body.textContent).not.toContain('Search this page')
		expect(documentQueries.getByText(question.title)).not.toBeNull()
		expect(document.body.textContent).not.toContain('Statoblast')
		expect(document.body.textContent).not.toContain('Open Oracle')
		expect(document.body.textContent).not.toContain('Security Pool')

		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Use for fork' }))
		})
		expect(selectedQuestionIds).toEqual([question.questionId])
		expect(activeViews).toEqual(['universes'])
		expect(loadPage).not.toHaveBeenCalled()
	})

	test('scans the registry on request and favorites a question when its details are opened', async () => {
		const loadPage = mock(async () => undefined)
		const renderedComponent = await renderIntoDocument(view({ loadPage }))
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		expect(documentQueries.getByText('No favorite questions yet')).not.toBeNull()

		await act(async () => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Discover questions' }))
			await Promise.resolve()
		})
		expect(loadPage).toHaveBeenCalledWith(0, 10)
		await act(async () => {
			render(view({ loadPage, zoltarQuestionPage: { pageIndex: 0, pageSize: 10, questionCount: 12n, questions: [createQuestion(1), createQuestion(2)] } }), renderedComponent.container)
			await Promise.resolve()
		})
		expect(getRenderedQuestionTitles()).toEqual(['Numbered question 1', 'Numbered question 2'])
		expect(documentQueries.getByText('10 of 12 questions scanned')).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Favorites (0)' })).not.toBeNull()

		const details = document.querySelectorAll('details')[1]
		if (!(details instanceof window.HTMLElement)) throw new Error('Expected question details')
		details.setAttribute('open', '')
		await act(() => {
			details.dispatchEvent(new window.Event('toggle'))
		})
		expect(readFavoriteEntries(getLocalEntityScope('zoltar', 'question')).map(entry => entry.id)).toEqual(['0x02'])
		expect(documentQueries.getByRole('button', { name: 'Favorites (1)' })).not.toBeNull()
	})

	test('searches every downloaded question rather than one page', async () => {
		seedQuestions(
			Array.from({ length: 14 }, (_, index) => createQuestion(index + 1)),
			{ favorite: false },
		)
		const renderedComponent = await renderIntoDocument(view())
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Downloaded (14)' }))
		})
		expect(getRenderedQuestionTitles()).toHaveLength(14)
		const input = documentQueries.getByLabelText('Search downloaded questions')
		if (!(input instanceof window.HTMLInputElement)) throw new Error('Expected search input')
		input.value = 'question 13'
		await act(() => {
			input.dispatchEvent(new window.Event('input', { bubbles: true }))
		})
		expect(getRenderedQuestionTitles()).toEqual(['Numbered question 13'])
		input.value = 'no such question'
		await act(() => {
			input.dispatchEvent(new window.Event('input', { bubbles: true }))
		})
		expect(documentQueries.getByText('No downloaded questions match the current search.')).not.toBeNull()
	})

	test('retries a failed scan without leaking its rejection', async () => {
		let requestCount = 0
		const loadPage = mock(async () => {
			requestCount += 1
			if (requestCount === 1) throw new Error('Page read failed')
		})
		const renderedComponent = await renderIntoDocument(view({ loadPage }))
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		await act(async () => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Discover questions' }))
			await Promise.resolve()
			await Promise.resolve()
		})
		expect(documentQueries.getByText('Unable to load questions.')).not.toBeNull()
		await act(async () => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Retry questions' }))
			await Promise.resolve()
		})
		expect(loadPage).toHaveBeenCalledTimes(2)
		expect(loadPage).toHaveBeenLastCalledWith(0, 10)
	})

	test('offers question creation when the registry scan finds nothing', async () => {
		const activeViews: string[] = []
		const loadPage = mock(async () => undefined)
		const renderedComponent = await renderIntoDocument(view({ loadPage, onActiveViewChange: nextView => activeViews.push(nextView) }))
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		await act(async () => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Discover questions' }))
			await Promise.resolve()
		})
		await act(async () => {
			render(view({ loadPage, onActiveViewChange: nextView => activeViews.push(nextView), zoltarQuestionPage: { pageIndex: 0, pageSize: 10, questionCount: 0n, questions: [] } }), renderedComponent.container)
			await Promise.resolve()
		})
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Create Question' }))
		})
		expect(activeViews).toEqual(['create'])
	})

	test('omits universe fork actions when no universe is available', async () => {
		seedQuestions([question])
		const renderedComponent = await renderIntoDocument(view())
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(within(document.body).queryByRole('button', { name: 'Use for fork' })).toBeNull()
		expect(within(document.body).getByText(question.title)).toBeDefined()
		expect(document.body.textContent).not.toContain('fork the active universe')
		expect(within(document.body).getByText('Find reusable questions in the global registry and inspect their resolution terms.')).toBeDefined()
	})

	test('restarts the registry scan when its request context changes', async () => {
		const loadPage = mock(async () => undefined)
		const renderedComponent = await renderIntoDocument(view({ loadPage }))
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		await act(async () => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Discover questions' }))
			await Promise.resolve()
		})
		await act(async () => {
			render(view({ loadPage, zoltarQuestionPage: { pageIndex: 0, pageSize: 10, questionCount: 41n, questions: [question] } }), renderedComponent.container)
			await Promise.resolve()
		})
		await act(async () => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Discover more' }))
			await Promise.resolve()
		})
		expect(loadPage).toHaveBeenLastCalledWith(1, 10)

		await act(async () => {
			render(view({ loadPage, requestContextKey: 1 }), renderedComponent.container)
			await Promise.resolve()
		})
		await act(async () => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Discover questions' }))
			await Promise.resolve()
		})
		expect(loadPage).toHaveBeenLastCalledWith(0, 10)
	})
})
