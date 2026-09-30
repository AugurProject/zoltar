import { createMarketDetails } from '@zoltar/ui-core-shared/tests/testUtils/marketFixtures.js'
/// <reference types="bun-types" />

import { getAddress, zeroAddress, zeroHash } from '@zoltar/core-shared/evm/ethereum'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
import { getLocalEntityScope } from '@zoltar/ui-core-shared/hooks/useLocalEntities.js'
import { resetLocalEntityStoreForTesting, setEntityFavorite } from '@zoltar/ui-core-shared/lib/localEntityStore.js'
import { securityPoolDownloadStore, toCachedSecurityPool } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/poolBrowse.js'
import type { ListedSecurityPool } from '@zoltar/ui-statoblast-shared/types/contracts.js'
import { SecurityPoolsSection } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityPoolsSection.js'
import { SelectedPoolRepPriceContext } from '@zoltar/ui-statoblast-shared/features/security-pools/components/RepPriceStatusLabel.js'
import { VaultMetricGrid } from '@zoltar/ui-statoblast-shared/features/security-pools/components/VaultMetricGrid.js'
import { resolveRepPrice } from '@zoltar/ui-statoblast-shared/features/security-pools/lib/uiPriceOracle.js'
import type { SecurityPoolRouteContentProps, SecurityPoolsOverviewRouteContentProps, SecurityPoolsSectionProps } from '@zoltar/ui-zoltar-shared/features/types.js'
import { describe, expect, test } from 'bun:test'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { createAccountState, createSecurityPoolWorkflowProps, createSelectedPool as createBuilderSelectedPool } from './workflow/builders.js'

installTestRouting()

// Section fixtures describe a pool that already has vaults.
function createSelectedPool(overrides: Partial<ListedSecurityPool> = {}): ListedSecurityPool {
	return createBuilderSelectedPool({ vaultCount: 3n, ...overrides })
}

function createOverviewProps(overrides: Partial<SecurityPoolsOverviewRouteContentProps> = {}): SecurityPoolsOverviewRouteContentProps {
	return { activeUniverseId: 1n, currentTimestamp: undefined, securityPools: [], ...overrides }
}

function createCreatePoolProps(overrides: Partial<SecurityPoolRouteContentProps> = {}): SecurityPoolRouteContentProps {
	return {
		accountState: createAccountState(),
		checkingDuplicateOriginPool: false,
		duplicateOriginPoolExists: false,
		loadingMarketDetails: false,
		marketDetails: undefined,
		onCreateSecurityPool: () => undefined,
		onResetSecurityPoolCreation: () => undefined,
		onSecurityPoolFormChange: () => undefined,
		poolCreationMarketDetails: undefined,
		repPerEthPrice: undefined,
		repPerEthSource: undefined,
		repPerEthSourceUrl: undefined,
		securityPools: [],
		securityPoolCreating: false,
		securityPoolError: undefined,
		securityPoolForm: {
			initialReportPriorityFeeNanoEth: '10',
			marketId: '',
			statoblastSecurityMultiplierBps: '',
		},
		securityPoolResult: undefined,
		zoltarUniverseHasForked: false,
		...overrides,
	}
}

// Glossary definitions stay in the DOM while collapsed, so the sentence text excludes them.
function getTextWithoutTermDefinitions(element: Element | null) {
	if (element === null) throw new Error('Expected the element to be rendered')
	const clone = element.cloneNode(true)
	if (!(clone instanceof window.Element)) throw new Error('Expected an element clone')
	for (const popover of Array.from(clone.querySelectorAll('.term-popover'))) popover.remove()
	return clone.textContent
}

function createSecurityPoolsSectionProps(overrides: Partial<SecurityPoolsSectionProps> = {}): SecurityPoolsSectionProps {
	return {
		activeView: 'browse',
		createPool: createCreatePoolProps(),
		onActiveViewChange: () => undefined,
		overview: createOverviewProps(),
		workflow: createSecurityPoolWorkflowProps(),
		...overrides,
	}
}

void describe('SecurityPoolsSection', () => {
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

	void test('opens a pasted pool address from the browse search without reading the registry', async () => {
		const calls: string[] = []
		const props = createSecurityPoolsSectionProps({
			activeView: 'browse',
			onLoadUniverseDirectoryPools: () => calls.push('universes'),
			onOpenSecurityPool: address => calls.push(address),
			overview: createOverviewProps(),
		})
		const renderedComponent = await renderIntoDocument(h(SecurityPoolsSection, props))
		cleanupRenderedComponent = renderedComponent.cleanup
		const page = within(document.body)
		const input = page.getByRole('textbox', { name: 'Search or paste a pool address' })
		expect(calls).toEqual([])
		await act(() => fireEvent.input(input, { target: { value: '0x123' } }))
		expect(page.queryByRole('button', { name: 'Open pool at this address' })).toBeNull()
		const address = '0x1111111111111111111111111111111111111111'
		await act(() => fireEvent.input(input, { target: { value: address } }))
		await act(() => fireEvent.click(page.getByRole('button', { name: 'Open pool at this address' })))
		expect(calls).toEqual([address])
	})

	void test('hides the route summary in browse mode without rendering local route tabs', async () => {
		const renderedComponent = await renderIntoDocument(h(SecurityPoolsSection, createSecurityPoolsSectionProps()))
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('tab', { name: 'Browse' })).toBeNull()
		expect(documentQueries.queryByRole('tab', { name: 'Create pool' })).toBeNull()
		expect(documentQueries.queryByRole('tab', { name: 'Manage Pool' })).toBeNull()
		expect(documentQueries.queryByText('Mode')).toBeNull()
		expect(document.body.querySelector('.route-summary-strip')).toBeNull()
		expect(documentQueries.queryByText('Loaded pools')).toBeNull()
		expect(documentQueries.queryByText('Selected pool')).toBeNull()
		expect(documentQueries.queryByText('Pool status')).toBeNull()
		expect(documentQueries.queryByText('Next step')).toBeNull()
		expect(document.body.textContent?.includes('Use the state badge and the guidance line on each card to decide whether you are browsing an active pool, a reporting state, or a fork workflow.')).toBe(false)
		expect(document.body.textContent?.includes('Filters apply only to the currently loaded page. Use pagination to inspect other pools.')).toBe(false)
	})

	void test('opens the browse view with only favorites and no discovery controls', async () => {
		const renderedComponent = await renderIntoDocument(h(SecurityPoolsSection, createSecurityPoolsSectionProps()))
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(within(document.body).getByText('Favorites (0)')).not.toBeNull()
		expect(within(document.body).queryByRole('button', { name: /Discover|Downloaded/ })).toBeNull()
	})

	void test('opens a created pool through the single pool navigation and returns to browse without a refresh', async () => {
		const createdPoolAddress = getAddress('0x00000000000000000000000000000000000000a4')
		const activeViewChanges: string[] = []
		const refreshCalls: string[] = []
		const openedPools: Array<[string, bigint]> = []

		const renderedComponent = await renderIntoDocument(
			h(
				SecurityPoolsSection,
				createSecurityPoolsSectionProps({
					activeView: 'create',
					onActiveViewChange: activeView => {
						activeViewChanges.push(activeView)
					},
					onOpenSecurityPool: (securityPoolAddress, universeId) => {
						openedPools.push([securityPoolAddress, universeId])
					},
					createPool: createCreatePoolProps({
						securityPoolResult: {
							deployPoolHash: zeroHash,
							initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
							questionId: '0x01',
							securityPoolAddress: createdPoolAddress,
							statoblastSecurityMultiplierBps: 20_000n,
							universeId: 1n,
						},
					}),
					workflow: createSecurityPoolWorkflowProps({
						onRefreshSelectedPoolData: address => {
							if (address !== undefined) {
								refreshCalls.push(address)
							}
						},
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		fireEvent.click(documentQueries.getByRole('button', { name: /^Open pool:/ }))
		expect(openedPools).toEqual([[createdPoolAddress, 1n]])
		expect(activeViewChanges).toEqual([])
		expect(refreshCalls).toEqual([])

		fireEvent.click(documentQueries.getByRole('button', { name: 'Return to browse' }))
		expect(activeViewChanges).toEqual(['browse'])
		expect(refreshCalls).toEqual([])
	})

	void test('Create another pool button is wired in create mode', async () => {
		let resetCount = 0
		const renderedComponent = await renderIntoDocument(
			h(
				SecurityPoolsSection,
				createSecurityPoolsSectionProps({
					activeView: 'create',
					createPool: createCreatePoolProps({
						securityPoolResult: {
							deployPoolHash: zeroHash,
							initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n,
							questionId: '0x01',
							securityPoolAddress: '0x00000000000000000000000000000000000000a5',
							statoblastSecurityMultiplierBps: 20_000n,
							universeId: 1n,
						},
						onResetSecurityPoolCreation: () => {
							resetCount += 1
						},
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		fireEvent.click(within(document.body).getByRole('button', { name: 'Create another pool' }))
		expect(resetCount).toBe(1)
	})

	void test('describes the create and universe views with glossary terms', async () => {
		const createRender = await renderIntoDocument(h(SecurityPoolsSection, createSecurityPoolsSectionProps({ activeView: 'create' })))
		cleanupRenderedComponent = createRender.cleanup
		expect(getTextWithoutTermDefinitions(document.body.querySelector('.route-description'))).toBe('Set up a security pool for one question. Vaults secure it with REP; traders mint its shares with ETH.')
		const securityPoolTerm = within(document.body).getByRole('button', { name: 'security pool' })
		expect(securityPoolTerm.getAttribute('aria-expanded')).toBe('false')
		await act(() => {
			fireEvent.click(securityPoolTerm)
		})
		expect(securityPoolTerm.getAttribute('aria-expanded')).toBe('true')
		expect(within(document.body).getByRole('link', { name: 'Read more in the guide' }).getAttribute('href')).toBe('https://augurproject.github.io/zoltar/docs/reference/glossary.html#security-pool')
		await cleanupRenderedComponent()
		cleanupRenderedComponent = undefined

		const universesRender = await renderIntoDocument(h(SecurityPoolsSection, createSecurityPoolsSectionProps({ activeView: 'universes' })))
		cleanupRenderedComponent = universesRender.cleanup
		expect(getTextWithoutTermDefinitions(document.body.querySelector('.route-description'))).toBe('Security pools grouped by universe. A fork creates child universes, each with its own REP and pools.')
		expect(within(document.body).getByRole('button', { name: 'universe' }).getAttribute('aria-expanded')).toBe('false')
	})

	void test('shows the role guide on browse until it is dismissed', async () => {
		window.localStorage.removeItem('statoblast.firstRunRoleGuideDismissed')
		const firstRender = await renderIntoDocument(h(SecurityPoolsSection, createSecurityPoolsSectionProps({ activeView: 'browse' })))
		cleanupRenderedComponent = firstRender.cleanup
		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'New here? Start with your role' })).not.toBeNull()
		for (const guide of ['How vaults work', 'How shares and trading work', 'How reporting works']) expect(documentQueries.getByRole('link', { name: guide }).getAttribute('target')).toBe('_blank')
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Dismiss the role guide' }))
		})
		expect(documentQueries.queryByRole('heading', { name: 'New here? Start with your role' })).toBeNull()
		expect(window.localStorage.getItem('statoblast.firstRunRoleGuideDismissed')).toBe('true')
		await cleanupRenderedComponent()
		cleanupRenderedComponent = undefined

		const secondRender = await renderIntoDocument(h(SecurityPoolsSection, createSecurityPoolsSectionProps({ activeView: 'browse' })))
		cleanupRenderedComponent = secondRender.cleanup
		expect(within(document.body).queryByRole('heading', { name: 'New here? Start with your role' })).toBeNull()
		window.localStorage.removeItem('statoblast.firstRunRoleGuideDismissed')
	})

	void test('renders one route heading in create and empty pool page modes', async () => {
		const createRender = await renderIntoDocument(h(SecurityPoolsSection, createSecurityPoolsSectionProps({ activeView: 'create' })))
		cleanupRenderedComponent = createRender.cleanup
		expect(within(document.body).getAllByRole('heading', { name: 'Create pool' })).toHaveLength(1)
		await cleanupRenderedComponent()
		cleanupRenderedComponent = undefined

		const manageRender = await renderIntoDocument(h(SecurityPoolsSection, createSecurityPoolsSectionProps({ activeView: 'operate' })))
		cleanupRenderedComponent = manageRender.cleanup
		expect(within(document.body).getAllByRole('heading', { name: 'Security pool' })).toHaveLength(1)
	})

	void test('keeps the route summary hidden even when the selected pool is resolved in operate mode', async () => {
		const selectedPool = createSelectedPool()
		const renderedComponent = await renderIntoDocument(
			h(
				SecurityPoolsSection,
				createSecurityPoolsSectionProps({
					activeView: 'operate',
					overview: createOverviewProps({
						securityPools: [selectedPool],
					}),
					workflow: createSecurityPoolWorkflowProps({
						checkedSecurityPoolAddress: zeroAddress,
						securityPoolAddress: zeroAddress,
						securityPools: [selectedPool],
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.querySelector('.route-summary-strip')).toBeNull()
		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Loaded pools')).toBeNull()
		expect(documentQueries.queryByText('Selected pool')).toBeNull()
		expect(documentQueries.queryByText('Pool status')).toBeNull()
		expect(documentQueries.queryByText('Next step')).toBeNull()
		expect(documentQueries.queryByRole('textbox', { name: 'Security pool address' })).toBeNull()
		expect(document.body.querySelector('.pool-address-display')).not.toBeNull()
		expect(document.body.querySelector('.selected-pool-context-details')).toBeNull()
		const objectHeader = document.body.querySelector('.selected-pool-object-header')
		if (!(objectHeader instanceof HTMLElement)) throw new Error('Expected the selected-pool object header')
		expect(within(objectHeader).getByRole('heading', { name: 'Will this resolve?' })).not.toBeNull()
		expect(within(objectHeader).queryByText('Pool-held REP')).toBeNull()
		expect(document.body.querySelector('.pool-reference-details')?.textContent).toContain('Pool-held REP')
	})

	void test('labels vault health with the one resolved REP price', async () => {
		const selectedPoolRepPrice = resolveRepPrice({ now: 1n, setting: 'uniswap', uniswapPrice: 10n ** 18n })
		const renderedComponent = await renderIntoDocument(
			h(
				SelectedPoolRepPriceContext.Provider,
				{ value: selectedPoolRepPrice },
				h(VaultMetricGrid, { claimableFeesAttoEth: 0n, isCurrentlyHealthy: true, repPerEthPrice: selectedPoolRepPrice.price, repPerEthSource: undefined, repPerEthSourceUrl: undefined, selectedPoolStatoblastSecurityMultiplierBps: 20_000n, underwritingLimitAttoEth: 10n ** 18n, vaultAttoRepBacking: 10n ** 18n }),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(document.body.querySelector('.vault-health-status .rep-price-status')?.textContent).toBe('via Uniswap · live')
		expect(document.body.querySelector('.vault-detail-hero-primary .rep-price-status')).toBeNull()
	})

	void test('keeps the route summary hidden in operate mode until the selected pool resolves', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				SecurityPoolsSection,
				createSecurityPoolsSectionProps({
					activeView: 'operate',
					workflow: createSecurityPoolWorkflowProps({
						securityPoolAddress: '0x0000000000000000000000000000000000000001',
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.querySelector('.route-summary-strip')).toBeNull()
	})

	void test('hides the truth auction metric when a listed pool has no truth auction address', async () => {
		const renderedComponent = await renderIntoDocument(
			h(
				SecurityPoolsSection,
				createSecurityPoolsSectionProps({
					overview: createOverviewProps({
						securityPools: [createSelectedPool()],
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const metricLabels = Array.from(document.body.querySelectorAll('.metric-label')).map(element => element.textContent?.trim() ?? '')
		expect(metricLabels.includes('Manager')).toBe(false)
		expect(metricLabels.includes('Truth auction')).toBe(false)
	})

	void test('filters the browse registry by search text and the derived ended state', async () => {
		const operationalPool = createSelectedPool({
			marketDetails: createMarketDetails({ title: 'First pool question' }),
			questionOutcome: 'none',
			questionId: '0x01',
			securityPoolAddress: '0x0000000000000000000000000000000000000001',
			systemState: 'operational',
		})
		const endedPool = createSelectedPool({
			marketDetails: createMarketDetails({ title: 'Second pool question' }),
			questionOutcome: 'yes',
			questionId: '0x02',
			securityPoolAddress: '0x0000000000000000000000000000000000000002',
			systemState: 'operational',
		})
		const scope = getLocalEntityScope('statoblast', 'pool')
		securityPoolDownloadStore.record(
			scope,
			[operationalPool, endedPool].map(pool => ({ data: toCachedSecurityPool(pool), id: pool.securityPoolAddress })),
		)
		for (const pool of [operationalPool, endedPool]) setEntityFavorite(scope, pool.securityPoolAddress, true)
		const renderedComponent = await renderIntoDocument(
			h(
				SecurityPoolsSection,
				createSecurityPoolsSectionProps({
					overview: createOverviewProps({
						securityPools: [operationalPool, endedPool],
					}),
				}),
			),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const searchInput = documentQueries.getByPlaceholderText('Address, question ID, or text')
		if (!(searchInput instanceof HTMLInputElement)) throw new Error('Expected search input')
		searchInput.value = 'second'
		await act(() => {
			searchInput.dispatchEvent(new window.Event('input', { bubbles: true }))
		})
		expect(documentQueries.queryByText('First pool question')).toBeNull()
		expect(documentQueries.getAllByText('Second pool question').length).toBeGreaterThan(0)

		searchInput.value = ''
		await act(() => {
			searchInput.dispatchEvent(new window.Event('input', { bubbles: true }))
		})

		const systemStateSelect = documentQueries.getByLabelText('System state')
		if (!(systemStateSelect instanceof window.HTMLSelectElement)) throw new Error('Expected system state filter')
		systemStateSelect.value = 'ended'
		await act(() => {
			systemStateSelect.dispatchEvent(new window.Event('change', { bubbles: true }))
		})
		expect(documentQueries.queryByText('First pool question')).toBeNull()
		expect(documentQueries.getAllByText('Second pool question').length).toBeGreaterThan(0)
	})
})
