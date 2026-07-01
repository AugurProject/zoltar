/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, waitFor, within } from './testUtils/queries'
import { h } from 'preact'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { zeroAddress } from '@zoltar/shared/ethereum'
import { MarketSection } from '../components/MarketSection.js'
import { getDefaultMarketFormState, getDefaultZoltarMigrationFormState } from '../lib/marketForm.js'
import type { AccountState } from '../types/app.js'
import type { MarketSectionProps } from '../types/components.js'
import type { ZoltarUniverseSummary } from '../types/contracts.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled } from './testUtils/transactionActionButton.js'

function createDeferred<T>() {
	let resolve: (value: T) => void = () => undefined
	let reject: (reason?: unknown) => void = () => undefined
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve
		reject = promiseReject
	})
	return { promise, reject, resolve }
}

function createAccountState(overrides: Partial<AccountState> = {}): AccountState {
	return {
		address: zeroAddress,
		chainId: '0x1',
		ethBalance: 0n,
		wethBalance: 0n,
		...overrides,
	}
}

function createZoltarUniverse(overrides: Partial<ZoltarUniverseSummary> = {}): ZoltarUniverseSummary {
	return {
		childUniverses: [],
		forkThreshold: 100n,
		forkQuestionDetails: undefined,
		forkTime: 0n,
		forkingOutcomeIndex: 0n,
		hasForked: false,
		parentUniverseId: 0n,
		reputationToken: zeroAddress,
		totalTheoreticalSupply: 1000n,
		universeId: 1n,
		...overrides,
	}
}

function createBinaryForkQuestion() {
	return {
		answerUnit: '',
		createdAt: 1n,
		description: 'Fork question',
		displayValueMax: 2n,
		displayValueMin: 0n,
		endTime: 2n,
		exists: true,
		marketType: 'binary' as const,
		numTicks: 2n,
		outcomeLabels: ['Yes', 'No'],
		questionId: '0x01',
		startTime: 1n,
		title: 'Fork question title',
	}
}

function createMarketSectionProps(overrides: Partial<MarketSectionProps> = {}): MarketSectionProps {
	return {
		accountState: createAccountState(),
		activeUniverseId: 1n,
		activeView: 'questions',
		hasLoadedZoltarQuestions: false,
		loadingZoltarForkAccess: false,
		zoltarForkActiveAction: undefined,
		loadingZoltarQuestionCount: false,
		loadingZoltarQuestions: false,
		loadingZoltarUniverse: false,
		marketForm: getDefaultMarketFormState(),
		marketCreating: false,
		marketError: undefined,
		marketResult: undefined,
		onActiveViewChange: () => undefined,
		onApproveZoltarForkRep: () => undefined,
		onCreateChildUniverseForOutcomeIndex: () => undefined,
		onCreateMarket: () => undefined,
		onForkZoltar: () => undefined,
		onLoadZoltarQuestionPage: async () => undefined,
		onLoadZoltarQuestions: async () => undefined,
		onMarketFormChange: () => undefined,
		onMigrateInternalRep: () => undefined,
		onPrepareRepForMigration: () => undefined,
		onResetMarket: () => undefined,
		onUseQuestionForFork: () => undefined,
		onUseQuestionForPool: () => undefined,
		onZoltarForkQuestionIdChange: () => undefined,
		onZoltarMigrationFormChange: () => undefined,
		zoltarChildUniverseError: undefined,
		zoltarChildUniversePendingOutcomeIndex: undefined,
		zoltarForkApproval: {
			error: undefined,
			loading: false,
			value: 0n,
		},
		zoltarForkError: undefined,
		zoltarForkPending: false,
		zoltarForkQuestionId: '',
		zoltarForkRepBalance: 0n,
		zoltarMigrationChildRepBalances: {},
		zoltarMigrationActiveAction: undefined,
		zoltarMigrationError: undefined,
		zoltarMigrationForm: getDefaultZoltarMigrationFormState(),
		zoltarMigrationPending: false,
		zoltarMigrationPreparedRepBalance: 0n,
		zoltarMigrationResult: undefined,
		zoltarQuestionCount: 0n,
		zoltarQuestionPage: undefined,
		zoltarQuestions: [],
		zoltarUniverse: createZoltarUniverse(),
		zoltarUniverseState: 'ready',
		...overrides,
	}
}

describe('MarketSection', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
		window.history.replaceState({}, '', 'http://localhost/')
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('renders the Markets title without local view tabs in the section header', async () => {
		const renderedComponent = await renderIntoDocument(h(MarketSection, createMarketSectionProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		const questionsTitle = document.body.querySelector('h3')
		if (!(questionsTitle instanceof HTMLElement)) throw new Error('Expected to find the Markets section heading')
		expect(questionsTitle.textContent).toBe('Markets')

		const sectionHeader = questionsTitle.closest('.section-block-header')
		if (sectionHeader === null) throw new Error('Expected Markets title to render inside a section header')
		expect(sectionHeader.querySelector('[role="tablist"][aria-label="Market views"]')).toBeNull()
	})

	test('auto-loads questions once when opening the questions view without loaded data', async () => {
		const calls: string[] = []
		const initialProps = createMarketSectionProps({
			activeUniverseId: 7n,
			loadingZoltarQuestions: false,
			onLoadZoltarQuestionPage: async (pageIndex, pageSize) => {
				calls.push(`${pageIndex}:${pageSize}`)
			},
			zoltarQuestionCount: 3n,
			zoltarUniverse: createZoltarUniverse({ universeId: 7n }),
		})

		const renderedComponent = await renderIntoDocument(h(MarketSection, initialProps))
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(within(document.body).getByText('Loading questions...')).not.toBeNull()
		await waitFor(() => {
			expect(calls).toEqual(['0:10'])
		})

		await act(() => {
			render(
				h(MarketSection, {
					...initialProps,
					onLoadZoltarQuestionPage: async (pageIndex, pageSize) => {
						calls.push(`rerender:${pageIndex}:${pageSize}`)
					},
				}),
				renderedComponent.container,
			)
		})

		expect(calls).toEqual(['0:10'])
	})

	test('stops showing a loading state when a requested question page fails to load', async () => {
		const failedPageLoad = createDeferred<void>()
		const initialProps = createMarketSectionProps({
			onLoadZoltarQuestionPage: async (pageIndex, pageSize) => {
				if (pageIndex === 1 && pageSize === 10) return await failedPageLoad.promise
			},
			zoltarQuestionCount: 12n,
			zoltarQuestionPage: {
				pageIndex: 0,
				pageSize: 10,
				questionCount: 12n,
				questions: [createBinaryForkQuestion()],
			},
		})
		const renderedComponent = await renderIntoDocument(h(MarketSection, initialProps))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const nextPageButton = documentQueries.getByRole('button', { name: 'Next Page' })
		await act(() => {
			fireEvent.click(nextPageButton)
		})
		expect(documentQueries.getByText('Loading questions...')).not.toBeNull()

		void failedPageLoad.promise.catch(() => undefined)
		failedPageLoad.reject(new Error('page load failed'))
		await waitFor(() => {
			expect(documentQueries.queryByText('Loading questions...')).toBeNull()
			expect(documentQueries.getByText('Questions for this page have not loaded yet.')).not.toBeNull()
		})
	})

	test('does not auto-load questions while the question count is unresolved', async () => {
		const calls: string[] = []
		const renderedComponent = await renderIntoDocument(
			h(
				MarketSection,
				createMarketSectionProps({
					onLoadZoltarQuestionPage: async () => {
						calls.push('load')
					},
					zoltarQuestionCount: undefined,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(calls).toEqual([])
	})

	test('does not auto-load questions when the resolved count is zero', async () => {
		const calls: string[] = []
		const renderedComponent = await renderIntoDocument(
			h(
				MarketSection,
				createMarketSectionProps({
					onLoadZoltarQuestionPage: async () => {
						calls.push('load')
					},
					zoltarQuestionCount: 0n,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(calls).toEqual([])
	})

	test('does not auto-load questions when they are already loaded', async () => {
		const calls: string[] = []
		const renderedComponent = await renderIntoDocument(
			h(
				MarketSection,
				createMarketSectionProps({
					onLoadZoltarQuestionPage: async () => {
						calls.push('load')
					},
					zoltarQuestionCount: 3n,
					zoltarQuestionPage: {
						pageIndex: 0,
						pageSize: 10,
						questionCount: 3n,
						questions: [createBinaryForkQuestion()],
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(calls).toEqual([])
	})

	test('auto-loads questions once after the count resolves above zero even when the universe is unresolved', async () => {
		const calls: string[] = []
		const initialProps = createMarketSectionProps({
			activeUniverseId: 12n,
			loadingZoltarQuestionCount: true,
			onLoadZoltarQuestionPage: async (pageIndex, pageSize) => {
				calls.push(`${pageIndex}:${pageSize}`)
			},
			zoltarQuestionCount: undefined,
			zoltarUniverse: undefined,
			zoltarUniverseState: 'unknown',
		})

		const renderedComponent = await renderIntoDocument(h(MarketSection, initialProps))
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(calls).toEqual([])

		await act(() => {
			render(
				h(
					MarketSection,
					createMarketSectionProps({
						...initialProps,
						loadingZoltarQuestionCount: false,
						zoltarQuestionCount: 3n,
					}),
				),
				renderedComponent.container,
			)
		})

		await waitFor(() => {
			expect(calls).toEqual(['0:10'])
		})
	})

	test('does not auto-load questions again on rerender when the active universe id is unchanged', async () => {
		const calls: string[] = []
		const initialProps = createMarketSectionProps({
			activeUniverseId: 13n,
			onLoadZoltarQuestionPage: async (pageIndex, pageSize) => {
				calls.push(`${pageIndex}:${pageSize}`)
			},
			zoltarQuestionCount: 3n,
			zoltarUniverse: undefined,
			zoltarUniverseState: 'unknown',
		})

		const renderedComponent = await renderIntoDocument(h(MarketSection, initialProps))
		cleanupRenderedComponent = renderedComponent.cleanup
		await waitFor(() => {
			expect(calls).toEqual(['0:10'])
		})

		await act(() => {
			render(
				h(
					MarketSection,
					createMarketSectionProps({
						...initialProps,
						onLoadZoltarQuestionPage: async (pageIndex, pageSize) => {
							calls.push(`rerender:${pageIndex}:${pageSize}`)
						},
					}),
				),
				renderedComponent.container,
			)
		})

		expect(calls).toEqual(['0:10'])
	})

	test('retries question auto-load when the user leaves and re-enters the failed page', async () => {
		const calls: string[] = []
		const initialLoad = createDeferred<void>()
		const firstPageQuestion = createBinaryForkQuestion()
		const secondPageQuestion = {
			...createBinaryForkQuestion(),
			questionId: '0x02',
			title: 'Second page question',
		}
		const renderedComponent = await renderIntoDocument(
			h(
				MarketSection,
				createMarketSectionProps({
					activeUniverseId: 9n,
					loadingZoltarQuestions: false,
					onLoadZoltarQuestionPage: async (pageIndex, pageSize) => {
						calls.push(`load:${pageIndex}:${pageSize}`)
						if (pageIndex === 1 && pageSize === 10) return await initialLoad.promise
					},
					zoltarQuestionCount: 12n,
					zoltarQuestionPage: {
						pageIndex: 0,
						pageSize: 10,
						questionCount: 12n,
						questions: [firstPageQuestion],
					},
					zoltarUniverse: undefined,
					zoltarUniverseState: 'unknown',
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Next Page' }))
		})
		await act(async () => {
			initialLoad.reject(new Error('temporary failure'))
			await expect(initialLoad.promise).rejects.toThrow('temporary failure')
		})
		await waitFor(() => {
			expect(calls).toEqual(['load:1:10'])
		})

		await act(() => {
			render(
				h(
					MarketSection,
					createMarketSectionProps({
						activeUniverseId: 9n,
						loadingZoltarQuestions: false,
						onLoadZoltarQuestionPage: async (pageIndex, pageSize) => {
							calls.push(`retry:${pageIndex}:${pageSize}`)
						},
						zoltarQuestionCount: 12n,
						zoltarQuestionPage: {
							pageIndex: 0,
							pageSize: 10,
							questionCount: 12n,
							questions: [firstPageQuestion],
						},
						zoltarUniverse: undefined,
						zoltarUniverseState: 'unknown',
					}),
				),
				renderedComponent.container,
			)
		})

		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Previous Page' }))
		})
		await act(() => {
			render(
				h(
					MarketSection,
					createMarketSectionProps({
						activeUniverseId: 9n,
						loadingZoltarQuestions: false,
						onLoadZoltarQuestionPage: async (pageIndex, pageSize) => {
							calls.push(`retry:${pageIndex}:${pageSize}`)
						},
						zoltarQuestionCount: 12n,
						zoltarQuestionPage: {
							pageIndex: 0,
							pageSize: 10,
							questionCount: 12n,
							questions: [firstPageQuestion],
						},
						zoltarUniverse: undefined,
						zoltarUniverseState: 'unknown',
					}),
				),
				renderedComponent.container,
			)
		})
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Next Page' }))
		})
		await act(() => {
			render(
				h(
					MarketSection,
					createMarketSectionProps({
						activeUniverseId: 9n,
						loadingZoltarQuestions: false,
						onLoadZoltarQuestionPage: async (pageIndex, pageSize) => {
							calls.push(`retry:${pageIndex}:${pageSize}`)
						},
						zoltarQuestionCount: 12n,
						zoltarQuestionPage: {
							pageIndex: 1,
							pageSize: 10,
							questionCount: 12n,
							questions: [secondPageQuestion],
						},
						zoltarUniverse: undefined,
						zoltarUniverseState: 'unknown',
					}),
				),
				renderedComponent.container,
			)
		})

		await waitFor(() => {
			expect(calls).toEqual(['load:1:10', 'retry:1:10'])
		})
	})

	test('invalidates stale paged question data when the question count changes', async () => {
		const calls: string[] = []
		const initialProps = createMarketSectionProps({
			onLoadZoltarQuestionPage: async () => undefined,
			zoltarQuestionCount: 1n,
			zoltarQuestionPage: {
				pageIndex: 0,
				pageSize: 10,
				questionCount: 1n,
				questions: [createBinaryForkQuestion()],
			},
		})
		const renderedComponent = await renderIntoDocument(h(MarketSection, initialProps))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			render(
				h(
					MarketSection,
					createMarketSectionProps({
						...initialProps,
						onLoadZoltarQuestionPage: async (pageIndex, pageSize) => {
							calls.push(`${pageIndex}:${pageSize}`)
						},
						zoltarQuestionCount: 2n,
					}),
				),
				renderedComponent.container,
			)
		})

		await waitFor(() => {
			expect(calls).toEqual(['0:10'])
		})
	})

	test('shows a not-yet-loaded question state instead of rendering an empty page', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				MarketSection,
				createMarketSectionProps({
					loadingZoltarQuestionCount: false,
					loadingZoltarQuestions: false,
					onLoadZoltarQuestionPage: async () => undefined,
					zoltarQuestionCount: 3n,
					zoltarQuestionPage: {
						pageIndex: 1,
						pageSize: 10,
						questionCount: 3n,
						questions: [],
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('No questions were returned for the selected page.')).toBeNull()
		expect(documentQueries.getByText('Loading questions...')).not.toBeNull()
	})

	test('opens the create question view from the empty questions state', async () => {
		const selectedViews: string[] = []
		const renderedComponent = await renderIntoDocument(
			h(
				MarketSection,
				createMarketSectionProps({
					onActiveViewChange: view => {
						selectedViews.push(view)
					},
					zoltarQuestionCount: 0n,
					zoltarQuestionPage: {
						pageIndex: 0,
						pageSize: 10,
						questionCount: 0n,
						questions: [],
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Create Question' }))
		})

		expect(selectedViews).toEqual(['create'])
	})

	test('selects a paginated question for the fork workflow', async () => {
		const selectedQuestionIds: string[] = []
		const selectedViews: string[] = []
		const question = createBinaryForkQuestion()
		const renderedComponent = await renderIntoDocument(
			h(
				MarketSection,
				createMarketSectionProps({
					onActiveViewChange: view => {
						selectedViews.push(view)
					},
					onUseQuestionForFork: questionId => {
						selectedQuestionIds.push(questionId)
					},
					zoltarQuestionCount: 1n,
					zoltarQuestionPage: {
						pageIndex: 0,
						pageSize: 10,
						questionCount: 1n,
						questions: [question],
					},
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const useForForkButton = documentQueries.getByRole('button', { name: 'Use For Fork' })
		await act(() => {
			useForForkButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
		})

		expect(selectedQuestionIds).toEqual([question.questionId])
		expect(selectedViews).toEqual(['fork'])
	})

	test('does not render redundant universe summary cards for questions view', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				MarketSection,
				createMarketSectionProps({
					activeView: 'questions',
					zoltarQuestionCount: 4n,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Active Root Universe')).toBeNull()
		expect(documentQueries.queryByText('The root universe is active and unforked. Question creation and fork preparation remain the primary workflows.')).toBeNull()
		expect(documentQueries.queryByText('Forked Universe')).toBeNull()
		expect(documentQueries.queryByText('Universe Context')).toBeNull()
	})

	test('opens the fork workflow in a modal instead of rendering it inline', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				MarketSection,
				createMarketSectionProps({
					activeView: 'fork',
					zoltarQuestionCount: 2n,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('dialog')).toBeNull()
		const openForkButton = documentQueries.getByRole('button', { name: 'Fork Zoltar' })
		await act(() => {
			openForkButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
		})
		const modal = documentQueries.getByRole('dialog')
		expect(modal).not.toBeNull()
		expect(documentQueries.getAllByText('Fork Zoltar').length > 0).toBe(true)
		expectTransactionButtonDisabled(modal as HTMLElement, 'Fork Zoltar', 'Select a valid fork question before forking Zoltar.')
	})

	test('opens root-universe child-universe deployment in a modal', async () => {
		let createChildUniverseCallCount = 0
		const renderedComponent = await renderIntoDocument(
			h(
				MarketSection,
				createMarketSectionProps({
					activeView: 'questions',
					onCreateChildUniverseForOutcomeIndex: () => {
						createChildUniverseCallCount += 1
					},
					zoltarUniverse: createZoltarUniverse({
						childUniverses: [
							{
								exists: false,
								forkTime: 1n,
								outcomeIndex: 1n,
								outcomeLabel: 'Yes',
								parentUniverseId: 1n,
								reputationToken: zeroAddress,
								universeId: 2n,
							},
						],
						forkQuestionDetails: createBinaryForkQuestion(),
						hasForked: true,
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		fireEvent.click(documentQueries.getByRole('button', { name: 'Create child universe' }))
		const modal = await waitFor(() => documentQueries.getByRole('dialog'))
		const modalQueries = within(modal)
		expect(modalQueries.getByText('Create Child Universe')).not.toBeNull()
		expect(modalQueries.getByText('Selected Child Universe')).not.toBeNull()

		fireEvent.click(modalQueries.getByRole('button', { name: 'Deploy Universe' }))
		expect(createChildUniverseCallCount).toBe(1)
	})
})
