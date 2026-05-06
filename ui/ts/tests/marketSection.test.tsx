/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
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

		const tabButtons = Array.from(tabList.querySelectorAll('button'))
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
})
