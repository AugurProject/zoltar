/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from '@testing-library/dom'
import { h } from 'preact'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { zeroAddress } from 'viem'
import { MarketSection } from '../components/MarketSection.js'
import { getDefaultMarketFormState, getDefaultZoltarMigrationFormState } from '../lib/marketForm.js'
import type { AccountState } from '../types/app.js'
import type { MarketSectionProps } from '../types/components.js'
import type { ZoltarUniverseSummary } from '../types/contracts.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled } from './testUtils/transactionActionButton.js'

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
		onLoadZoltarQuestions: () => undefined,
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

	test('renders the Zoltar title and view tabs in the same section header', async () => {
		const renderedComponent = await renderIntoDocument(h(MarketSection, createMarketSectionProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		const zoltarTitle = document.body.querySelector('h3')
		if (!(zoltarTitle instanceof HTMLElement)) throw new Error('Expected to find the Zoltar section heading')
		expect(zoltarTitle.textContent).toBe('Zoltar')

		const sectionHeader = zoltarTitle.closest('.section-block-header')
		if (sectionHeader === null) throw new Error('Expected Zoltar title to render inside a section header')

		const tabList = sectionHeader.querySelector('[role="tablist"][aria-label="Zoltar views"]')
		if (!(tabList instanceof HTMLElement)) throw new Error('Expected to find the Zoltar view tab list inside the section header')
		expect(tabList.closest('.section-block-header')).toBe(sectionHeader)

		const tabButtons = Array.from(tabList.querySelectorAll('[role="tab"]'))
		const tabLabels = tabButtons.map(button => button.textContent?.trim() ?? '')
		expect(tabLabels).toEqual(['Questions', 'Create Question', 'Fork Zoltar', 'Migrate REP'])

		const migrateRepButton = tabButtons.find(button => button.textContent?.trim() === 'Migrate REP')
		if (!(migrateRepButton instanceof HTMLButtonElement)) throw new Error('Expected to find the Migrate REP button')
		expect(migrateRepButton.disabled).toBe(true)
	})

	test('auto-loads questions once when opening the questions view without loaded data', async () => {
		const calls: string[] = []
		const initialProps = createMarketSectionProps({
			hasLoadedZoltarQuestions: false,
			loadingZoltarQuestions: false,
			onLoadZoltarQuestions: () => {
				calls.push('load')
			},
			zoltarQuestionCount: 3n,
			zoltarUniverse: createZoltarUniverse({ universeId: 7n }),
		})

		const renderedComponent = await renderIntoDocument(h(MarketSection, initialProps))
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(calls).toEqual(['load'])

		await act(() => {
			render(
				h(MarketSection, {
					...initialProps,
					onLoadZoltarQuestions: () => {
						calls.push('rerender')
					},
				}),
				renderedComponent.container,
			)
		})

		expect(calls).toEqual(['load'])
	})

	test('does not auto-load questions when they are already loaded', async () => {
		const calls: string[] = []
		const renderedComponent = await renderIntoDocument(
			h(
				MarketSection,
				createMarketSectionProps({
					hasLoadedZoltarQuestions: true,
					onLoadZoltarQuestions: () => {
						calls.push('load')
					},
					zoltarQuestionCount: 3n,
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(calls).toEqual([])
	})

	test('retries question auto-load when the previous automatic load fails', async () => {
		const calls: string[] = []
		const renderedComponent = await renderIntoDocument(
			h(
				MarketSection,
				createMarketSectionProps({
					hasLoadedZoltarQuestions: false,
					loadingZoltarQuestions: false,
					onLoadZoltarQuestions: () => {
						calls.push('load')
						return Promise.reject(new Error('temporary failure'))
					},
					zoltarQuestionCount: 3n,
					zoltarUniverse: createZoltarUniverse({ universeId: 9n }),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		await Promise.resolve()
		await Promise.resolve()

		await act(() => {
			render(
				h(
					MarketSection,
					createMarketSectionProps({
						hasLoadedZoltarQuestions: false,
						loadingZoltarQuestions: false,
						onLoadZoltarQuestions: () => {
							calls.push('retry')
						},
						zoltarQuestionCount: 3n,
						zoltarUniverse: createZoltarUniverse({ universeId: 9n }),
					}),
				),
				renderedComponent.container,
			)
		})

		expect(calls).toEqual(['load', 'retry'])
	})

	test('shows the universe stage banner and sticky context for questions view', async () => {
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
		expect(documentQueries.getAllByText('Active Root Universe').length).toBeGreaterThan(0)
		expect(documentQueries.getByText('The root universe is active and unforked. Question creation and fork preparation remain the primary workflows.')).not.toBeNull()
		expect(documentQueries.queryByText('Available')).toBeNull()
		expect(documentQueries.queryByText('Blocked')).toBeNull()
		expect(documentQueries.getAllByText('Universe').length).toBeGreaterThan(0)
		expect(documentQueries.getAllByText('Questions').length).toBeGreaterThan(0)
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
		const openForkButton = documentQueries.getByRole('button', { name: 'Open Fork Flow' })
		await act(() => {
			openForkButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
		})
		expect(documentQueries.getByRole('dialog')).not.toBeNull()
		expect(documentQueries.getAllByText('Fork Zoltar').length > 0).toBe(true)
		expectTransactionButtonDisabled(document.body, 'Fork Zoltar', 'Select a valid fork question before forking Zoltar.')
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
		fireEvent.click(documentQueries.getByRole('button', { name: 'Open Universe Flow' }))
		await Promise.resolve()

		const modal = documentQueries.getByRole('dialog')
		const modalQueries = within(modal)
		expect(modalQueries.getByText('Create Child Universe')).not.toBeNull()
		expect(modalQueries.getByText('Selected Child Universe')).not.toBeNull()

		fireEvent.click(modalQueries.getByRole('button', { name: 'Deploy Universe' }))
		expect(createChildUniverseCallCount).toBe(1)
	})
})
