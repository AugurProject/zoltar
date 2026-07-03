/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { fireEvent, waitFor, within } from './testUtils/queries'
import { render } from 'preact'
import { SecurityPoolsOverviewSection } from '../components/SecurityPoolsOverviewSection.js'
import { deriveHasForkActivity } from '../lib/forkAuction.js'
import type { AccountState } from '../types/app.js'
import type { ListedSecurityPool, MarketDetails, SecurityPoolPage } from '../types/contracts.js'
import type { SecurityPoolsOverviewSectionProps } from '../types/components.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { act } from 'preact/test-utils'
import { zeroAddress } from 'viem'

function createAccountState(overrides: Partial<AccountState> = {}): AccountState {
	return {
		address: zeroAddress,
		chainId: '0x1',
		ethBalance: 0n,
		wethBalance: 0n,
		...overrides,
	}
}

function createDeferred<T>() {
	let resolve: (value: T) => void = () => undefined
	let reject: (reason?: unknown) => void = () => undefined
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve
		reject = promiseReject
	})
	return { promise, reject, resolve }
}

function createMarketDetails(overrides: Partial<MarketDetails> = {}): MarketDetails {
	return {
		answerUnit: '',
		createdAt: 1n,
		description: 'Question description',
		displayValueMax: 100n,
		displayValueMin: 0n,
		endTime: 2n,
		exists: true,
		marketType: 'binary',
		numTicks: 2n,
		outcomeLabels: ['Yes', 'No'],
		questionId: '0x01',
		startTime: 1n,
		title: 'Will this resolve?',
		...overrides,
	}
}

function createSecurityPool(overrides: Partial<ListedSecurityPool> = {}): ListedSecurityPool {
	const securityPool: ListedSecurityPool = {
		completeSetCollateralAmount: 0n,
		currentRetentionRate: 10n,
		hasForkActivity: false,
		forkOutcome: 'none',
		forkOwnSecurityPool: false,
		lastOraclePrice: undefined,
		lastOracleSettlementTimestamp: 0n,
		managerAddress: zeroAddress,
		marketDetails: createMarketDetails(),
		migratedRep: 0n,
		parent: zeroAddress,
		questionOutcome: 'none',
		questionId: '0x01',
		securityMultiplier: 2n,
		securityPoolAddress: zeroAddress,
		shareTokenSupply: 0n,
		systemState: 'operational',
		totalRepDeposit: 0n,
		totalSecurityBondAllowance: 5n * 10n ** 18n,
		truthAuctionAddress: zeroAddress,
		truthAuctionStartedAt: 0n,
		universeHasForked: false,
		universeId: 1n,
		hasLoadedVaults: true,
		vaultCount: 0n,
		vaults: [],
		...overrides,
	}
	return {
		...securityPool,
		hasForkActivity: overrides.hasForkActivity ?? deriveHasForkActivity(securityPool),
	}
}

function createProps(overrides: Partial<SecurityPoolsOverviewSectionProps> = {}): SecurityPoolsOverviewSectionProps {
	const defaultPools = [createSecurityPool()]
	const securityPools = overrides.securityPools ?? defaultPools
	const defaultPage: SecurityPoolPage = {
		pageIndex: 0,
		pageSize: 6,
		poolCount: BigInt(securityPools.length),
		pools: securityPools,
	}
	return {
		accountState: createAccountState(),
		checkedSecurityPoolAddress: undefined,
		environmentRefreshKey: 0,
		closeLiquidationModal: () => undefined,
		hasLoadedSecurityPools: true,
		hasLoadedSecurityPoolPage: true,
		liquidationAmount: '',
		liquidationMaxAmount: undefined,
		liquidationManagerAddress: undefined,
		liquidationModalOpen: false,
		liquidationSecurityPoolAddress: undefined,
		liquidationTargetVault: '',
		liquidationTimeoutMinutes: '5',
		loadingPoolOracleManager: false,
		loadingSecurityPoolPage: false,
		loadingSecurityPools: false,
		onLiquidationAmountChange: () => undefined,
		onLiquidationTimeoutMinutesChange: () => undefined,
		onLoadPoolOracleManager: () => undefined,
		onLoadSecurityPoolPage: () => undefined,
		onLoadSecurityPools: () => undefined,
		onOpenLiquidationModal: () => undefined,
		onQueueLiquidation: () => undefined,
		onSelectSecurityPool: () => undefined,
		poolOracleManagerDetails: undefined,
		repPerEthPrice: undefined,
		repPerEthSource: undefined,
		repPerEthSourceUrl: undefined,
		securityPoolBrowseCount: overrides.securityPoolPage?.poolCount ?? BigInt(securityPools.length),
		securityPoolPage: overrides.securityPoolPage ?? defaultPage,
		securityPoolOverviewActiveAction: undefined,
		securityPoolOverviewError: undefined,
		securityPoolLiquidationError: undefined,
		securityPoolOverviewResult: undefined,
		securityPools,
		...overrides,
	}
}

describe('SecurityPoolsOverviewSection', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

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

	function getSecurityPoolCard(headingText: string): HTMLElement {
		const normalizedHeadingText = headingText.trim().replace(/\s+/g, ' ')
		const titleHeading = within(document.body)
			.getAllByRole('heading')
			.find(node => {
				const normalizedNodeText = (node.textContent ?? '').replace(/\s+/g, ' ').trim()
				return normalizedNodeText.includes(normalizedHeadingText)
			})
		if (titleHeading === undefined) {
			throw new Error(`Expected security pool card heading for "${headingText}"`)
		}
		const poolCard = titleHeading.closest('.entity-card')
		if (!(poolCard instanceof HTMLElement)) {
			throw new Error(`Expected security pool card for "${headingText}"`)
		}
		return poolCard
	}

	test('does not render a local liquidation transaction notice', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					securityPoolOverviewResult: {
						action: 'queueLiquidation',
						hash: '0x1234000000000000000000000000000000000000000000000000000000000000',
						securityPoolAddress: zeroAddress,
					},
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('heading', { name: 'Liquidation Submitted' })).toBeNull()
		expect(documentQueries.queryByText('Check State')).toBeNull()
		expect(documentQueries.queryByText('0x1234000000000000000000000000000000000000000000000000000000000000')).toBeNull()
	})

	test('reloads the current browse page when the environment refresh key changes', async () => {
		const onLoadSecurityPoolPage = mock(() => undefined)
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					environmentRefreshKey: 0,
					onLoadSecurityPoolPage,
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => {
			expect(onLoadSecurityPoolPage).toHaveBeenCalledTimes(1)
		})

		await act(() => {
			render(
				<SecurityPoolsOverviewSection
					{...createProps({
						environmentRefreshKey: 1,
						onLoadSecurityPoolPage,
					})}
				/>,
				renderedComponent.container,
			)
		})

		await waitFor(() => {
			expect(onLoadSecurityPoolPage).toHaveBeenCalledTimes(2)
			expect(onLoadSecurityPoolPage).toHaveBeenLastCalledWith(0, 6)
		})
	})

	test('hides stale pool page data while an environment refresh reload is pending', async () => {
		const deferredPageLoad = createDeferred<void>()
		let pageLoadCount = 0
		const onLoadSecurityPoolPage = mock(() => {
			pageLoadCount += 1
			return pageLoadCount === 2 ? deferredPageLoad.promise : undefined
		})
		const securityPoolPage: SecurityPoolPage = {
			pageIndex: 0,
			pageSize: 6,
			poolCount: 12n,
			pools: [
				createSecurityPool({
					marketDetails: createMarketDetails({ title: 'Previous environment pool' }),
					securityPoolAddress: '0x0000000000000000000000000000000000000100',
				}),
			],
		}
		const initialProps = createProps({
			environmentRefreshKey: 0,
			onLoadSecurityPoolPage,
			securityPoolPage,
		})
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...initialProps} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => {
			expect(onLoadSecurityPoolPage).toHaveBeenCalledTimes(1)
		})
		expect(within(document.body).getByText('Previous environment pool')).not.toBeNull()
		expect(within(document.body).getByText('Page 1 of 2')).not.toBeNull()

		await act(() => {
			render(<SecurityPoolsOverviewSection {...initialProps} environmentRefreshKey={1} />, renderedComponent.container)
		})

		await waitFor(() => {
			expect(onLoadSecurityPoolPage).toHaveBeenCalledTimes(2)
		})
		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Previous environment pool')).toBeNull()
		expect(documentQueries.queryByText('Page 1 of 2')).toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Next Page' }).hasAttribute('disabled')).toBe(true)
		expect(documentQueries.getByText('Refreshing pools.')).not.toBeNull()

		deferredPageLoad.resolve()
		await act(async () => {
			await deferredPageLoad.promise
		})
	})

	test('keeps pool-list load errors inline instead of opening liquidation', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					securityPoolOverviewError: 'Failed to load security pools',
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('alert').textContent).toContain('Failed to load security pools')
		expect(documentQueries.queryByRole('dialog', { name: 'Liquidate Vault' })).toBeNull()
	})

	test('shows Finalized as Yes for resolved operational pools', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					securityPools: [
						createSecurityPool({
							questionOutcome: 'yes',
						}),
					],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const badgeTexts = Array.from(document.body.querySelectorAll('.entity-card .badge')).map(element => element.textContent?.trim() ?? '')
		expect(badgeTexts).toContain('Finalized as Yes')
	})

	test('shows Fork Migration for parent pools with child pools even when the loaded parent outcome is resolved', async () => {
		const parentPoolTitle = 'Parent pool'
		const parentPool = createSecurityPool({
			hasForkActivity: false,
			marketDetails: createMarketDetails({ title: 'Parent pool' }),
			questionOutcome: 'yes',
			securityPoolAddress: '0x0000000000000000000000000000000000000100',
			universeHasForked: true,
		})
		const childPool = createSecurityPool({
			marketDetails: createMarketDetails({ title: 'Child pool' }),
			parent: parentPool.securityPoolAddress,
			questionOutcome: 'yes',
			securityPoolAddress: '0x0000000000000000000000000000000000000101',
		})
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					securityPools: [parentPool, childPool],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const parentCard = getSecurityPoolCard(parentPoolTitle)
		const parentCardQueries = within(parentCard)
		expect(parentCardQueries.getByText('Fork Migration')).not.toBeNull()
		expect(parentCardQueries.queryByText('Finalized as Yes')).toBeNull()
	})

	test('shows Fork Migration for pools already in fork migration flow', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					securityPools: [
						createSecurityPool({
							forkOutcome: 'yes',
							migratedRep: 1n,
							systemState: 'poolForked',
						}),
					],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const badgeTexts = Array.from(document.body.querySelectorAll('.entity-card .badge')).map(element => element.textContent?.trim() ?? '')
		expect(badgeTexts).toContain('Fork Migration')
	})

	test('describes Fork Finalized auction-state guidance without implying the truth auction is already complete', async () => {
		const auctionPoolTitle = 'Truth auction pool'
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					securityPools: [
						createSecurityPool({
							forkOutcome: 'yes',
							hasForkActivity: true,
							marketDetails: createMarketDetails({ title: auctionPoolTitle }),
							migratedRep: 1n,
							parent: '0x0000000000000000000000000000000000000100',
							systemState: 'forkTruthAuction',
							truthAuctionAddress: '0x0000000000000000000000000000000000000001',
							truthAuctionStartedAt: 10n,
							universeHasForked: true,
						}),
					],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const auctionPoolCard = getSecurityPoolCard(auctionPoolTitle)
		const auctionPoolCardQueries = within(auctionPoolCard)
		expect(auctionPoolCardQueries.getByText('Migration has moved into the truth-auction phase, where bidding and settlement determine the child-universe recovery path.')).not.toBeNull()
		expect(auctionPoolCardQueries.queryByText('Migration has moved into the truth-auction phase, where the child universe is finalized.')).toBeNull()
	})

	test('shows Fork Finalized for child pools with completed fork history', async () => {
		const childPoolTitle = 'Finalized child pool'
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					securityPools: [
						createSecurityPool({
							forkOutcome: 'yes',
							hasForkActivity: true,
							marketDetails: createMarketDetails({ title: childPoolTitle }),
							migratedRep: 1n,
							parent: '0x0000000000000000000000000000000000000100',
							systemState: 'operational',
							truthAuctionAddress: '0x0000000000000000000000000000000000000001',
							truthAuctionStartedAt: 10n,
							universeHasForked: true,
						}),
					],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const badgeTexts = Array.from(document.body.querySelectorAll('.entity-card .badge')).map(element => element.textContent?.trim() ?? '')
		expect(badgeTexts).toContain('Fork Finalized')
		const childPoolCard = getSecurityPoolCard(childPoolTitle)
		const childPoolCardQueries = within(childPoolCard)
		expect(childPoolCardQueries.getByText('This pool has already gone through a fork lifecycle and now acts as a historical reference point.')).not.toBeNull()
		expect(childPoolCardQueries.queryByText('This parent pool has already gone through a fork lifecycle and now acts as a historical reference point.')).toBeNull()
	})

	test('shows Fork Migration instead of Operational for root-universe pools after Zoltar has forked', async () => {
		const rootPoolTitle = 'Forked root-universe pool'

		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					securityPools: [
						createSecurityPool({
							hasForkActivity: false,
							marketDetails: createMarketDetails({ title: 'Forked root-universe pool' }),
							questionOutcome: 'none',
							systemState: 'operational',
							universeHasForked: true,
						}),
					],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const poolCard = getSecurityPoolCard(rootPoolTitle)
		const poolCardQueries = within(poolCard)
		expect(poolCardQueries.getByText('Fork Migration')).not.toBeNull()
		expect(poolCardQueries.queryByText('Operational')).toBeNull()
	})

	test('does not duplicate refresh guidance when the pool list is empty', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					hasLoadedSecurityPools: true,
					securityPools: [],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('button', { name: 'Refresh pools' })).toBeNull()
		expect(documentQueries.queryByText('Refresh pools to check again.')).toBeNull()
	})

	test('opens security pool creation from the empty pool-list state', async () => {
		let createSecurityPoolClicks = 0
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					hasLoadedSecurityPools: true,
					onCreateSecurityPool: () => {
						createSecurityPoolClicks += 1
					},
					securityPools: [],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Create Security Pool' }))
		})

		expect(createSecurityPoolClicks).toBe(1)
	})

	test('keeps the empty pool-list CTA visible during a background refresh', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					hasLoadedSecurityPoolPage: true,
					loadingSecurityPoolPage: true,
					onCreateSecurityPool: () => undefined,
					securityPools: [],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'No security pools' })).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Create Security Pool' })).not.toBeNull()
		expect(documentQueries.queryByText('Refreshing pools.')).toBeNull()
	})

	test('shows a loading browse state before the first pool page loads', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					hasLoadedSecurityPoolPage: false,
					loadingSecurityPoolPage: false,
					securityPoolPage: undefined,
					securityPools: [],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Refreshing pools.')).not.toBeNull()
		expect(documentQueries.queryByText('None yet')).toBeNull()
	})

	test('does not show the empty pool-list CTA before the first pool page loads', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					hasLoadedSecurityPoolPage: false,
					loadingSecurityPoolPage: false,
					onCreateSecurityPool: () => undefined,
					securityPoolPage: undefined,
					securityPools: [],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const hasLoadingOrLoadCopy = documentQueries.queryByText('Refreshing pools.') !== null || documentQueries.queryByText('Load security pools to check what is available in this universe.') !== null
		expect(hasLoadingOrLoadCopy).toBe(true)
		expect(documentQueries.queryByRole('heading', { name: 'No security pools' })).toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Create Security Pool' })).toBeNull()
	})

	test('offers an explicit retry action when the pool list fails to load', async () => {
		const requestedPages: string[] = []
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					hasLoadedSecurityPoolPage: false,
					loadingSecurityPoolPage: false,
					onLoadSecurityPoolPage: (pageIndex, pageSize) => {
						requestedPages.push(`${pageIndex}:${pageSize}`)
					},
					securityPoolOverviewError: 'Failed to load security pools.',
					securityPoolPage: undefined,
					securityPools: [],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const retryButton = within(document.body).getByRole('button', { name: 'Retry Loading Pools' })
		expect(within(document.body).queryByRole('button', { name: 'Load Security Pools' })).toBeNull()
		await act(() => {
			fireEvent.click(retryButton)
		})

		expect(requestedPages).toContain('0:6')
	})

	test('does not infer browse page count from selected-pool cache before the first pool page loads', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					hasLoadedSecurityPoolPage: false,
					loadingSecurityPoolPage: false,
					securityPoolBrowseCount: undefined,
					securityPoolPage: undefined,
					securityPools: [
						createSecurityPool({
							marketDetails: createMarketDetails({ title: 'Selected-pool cache entry' }),
							securityPoolAddress: '0x0000000000000000000000000000000000000abc',
						}),
					],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Page 1 of 1')).toBeNull()
		expect(documentQueries.queryByText('Selected-pool cache entry')).toBeNull()
		expect(documentQueries.getByText('Refreshing pools.')).not.toBeNull()
	})

	test('filters the pool list by the derived Ended state', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					securityPools: [
						createSecurityPool({
							marketDetails: createMarketDetails({ title: 'Operational pool' }),
							questionOutcome: 'none',
							securityPoolAddress: '0x0000000000000000000000000000000000000001',
						}),
						createSecurityPool({
							marketDetails: createMarketDetails({ title: 'Ended pool' }),
							questionOutcome: 'yes',
							securityPoolAddress: '0x0000000000000000000000000000000000000002',
						}),
					],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const systemStateSelect = documentQueries.getByLabelText('System State')
		if (!(systemStateSelect instanceof window.HTMLSelectElement)) throw new Error('Expected system state filter')
		systemStateSelect.value = 'ended'
		await act(() => {
			systemStateSelect.dispatchEvent(new window.Event('change', { bubbles: true }))
		})

		expect(documentQueries.queryByText('Operational pool')).toBeNull()
		expect(documentQueries.getAllByText('Ended pool').length).toBeGreaterThan(0)
	})

	test('clamps the current page when the loaded pool count shrinks', async () => {
		const loadPageCalls: Array<{ pageIndex: number; pageSize: number }> = []
		const initialProps = createProps({
			onLoadSecurityPoolPage: (pageIndex, pageSize) => {
				loadPageCalls.push({ pageIndex, pageSize })
			},
			securityPoolPage: {
				pageIndex: 0,
				pageSize: 6,
				poolCount: 12n,
				pools: [
					createSecurityPool({
						marketDetails: createMarketDetails({ title: 'Paged pool' }),
						securityPoolAddress: '0x0000000000000000000000000000000000000300',
					}),
				],
			},
		})
		const renderedComponent = await renderIntoDocument(<SecurityPoolsOverviewSection {...initialProps} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await waitFor(() => {
			expect(loadPageCalls.some(call => call.pageIndex === 0)).toBe(true)
		})
		const nextPageButton = documentQueries.getByRole('button', { name: 'Next Page' })
		await act(() => {
			nextPageButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
		})
		expect(documentQueries.queryByText('Page 2 of 2')).toBeNull()
		expect(loadPageCalls.some(call => call.pageIndex === 1)).toBe(true)

		const shrunkProps = createProps({
			onLoadSecurityPoolPage: initialProps.onLoadSecurityPoolPage,
			securityPoolPage: {
				pageIndex: 0,
				pageSize: 6,
				poolCount: 1n,
				pools: [
					createSecurityPool({
						marketDetails: createMarketDetails({ title: 'Shrunk pool' }),
						securityPoolAddress: '0x0000000000000000000000000000000000000301',
					}),
				],
			},
		})
		await act(() => {
			render(<SecurityPoolsOverviewSection {...shrunkProps} />, renderedComponent.container)
		})

		expect(documentQueries.getByText('Page 1 of 1')).not.toBeNull()
		expect(loadPageCalls.some(call => call.pageIndex === 0)).toBe(true)
	})

	test('stops showing a loading state when a requested pool page fails to load', async () => {
		const failedPageLoad = createDeferred<void>()
		const loadPageCalls: number[] = []
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					onLoadSecurityPoolPage: async pageIndex => {
						loadPageCalls.push(pageIndex)
						if (pageIndex === 1) return await failedPageLoad.promise
					},
					securityPoolPage: {
						pageIndex: 0,
						pageSize: 6,
						poolCount: 12n,
						pools: [
							createSecurityPool({
								marketDetails: createMarketDetails({ title: 'Paged pool' }),
								securityPoolAddress: '0x0000000000000000000000000000000000000400',
							}),
						],
					},
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await waitFor(() => {
			expect(loadPageCalls.includes(0)).toBe(true)
		})
		const nextPageButton = documentQueries.getByRole('button', { name: 'Next Page' })
		await act(() => {
			nextPageButton.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
		})
		expect(documentQueries.getByText('Refreshing pools.')).not.toBeNull()

		void failedPageLoad.promise.catch(() => undefined)
		failedPageLoad.reject(new Error('page load failed'))
		await act(async () => {
			await failedPageLoad.promise.catch(() => undefined)
		})
		await waitFor(() => {
			expect(documentQueries.queryByText('Refreshing pools.')).toBeNull()
			expect(documentQueries.getByRole('button', { name: 'Load Security Pools' })).not.toBeNull()
		})
	})

	test('shows a deferred vault placeholder when browse mode has not loaded vault details yet', async () => {
		const deferredPoolTitle = 'Deferred vault pool'
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					securityPools: [
						createSecurityPool({
							hasLoadedVaults: false,
							marketDetails: createMarketDetails({ title: 'Deferred vault pool' }),
							securityPoolAddress: '0x0000000000000000000000000000000000000200',
							vaultCount: 2n,
							vaults: [],
						}),
					],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const poolCard = getSecurityPoolCard(deferredPoolTitle)
		const poolCardQueries = within(poolCard)
		expect(poolCardQueries.getByText('Open this pool to load 2 vaults.')).not.toBeNull()
		expect(poolCardQueries.queryByText('No vaults in this pool yet.')).toBeNull()
	})

	test('renders browse-mode vault previews and opens liquidation review for a vault', async () => {
		const previewPoolTitle = 'Pool with preview vaults'
		let liquidationRequest: { managerAddress: string; securityPoolAddress: string; vaultAddress: string; maxAmount: bigint | undefined } | undefined
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					onOpenLiquidationModal: (managerAddress, securityPoolAddress, vaultAddress, maxAmount) => {
						liquidationRequest = {
							managerAddress,
							securityPoolAddress,
							vaultAddress,
							maxAmount,
						}
					},
					securityPools: [
						createSecurityPool({
							managerAddress: '0x0000000000000000000000000000000000000502',
							marketDetails: createMarketDetails({ title: 'Pool with preview vaults' }),
							securityPoolAddress: '0x0000000000000000000000000000000000000500',
							vaultCount: 5n,
							vaults: [
								{
									escalationEscrowedRep: 0n,
									repDepositShare: 10n,
									securityBondAllowance: 5n,
									unpaidEthFees: 0n,
									vaultAddress: '0x0000000000000000000000000000000000000501',
								},
							],
						}),
					],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const poolCard = getSecurityPoolCard(previewPoolTitle)
		const poolCardQueries = within(poolCard)
		expect(poolCardQueries.queryByText('Open this pool to load 1 vault.')).toBeNull()
		expect(poolCardQueries.getAllByRole('button', { name: 'Copy address 0x0000000000000000000000000000000000000501' }).length).toBeGreaterThan(0)
		const liquidationReviewButton = poolCardQueries.getByRole('button', { name: 'Review Liquidation' })
		expect(liquidationReviewButton).not.toBeNull()
		await act(() => {
			fireEvent.click(liquidationReviewButton)
		})
		expect(liquidationRequest).toEqual({
			managerAddress: '0x0000000000000000000000000000000000000502',
			securityPoolAddress: '0x0000000000000000000000000000000000000500',
			vaultAddress: '0x0000000000000000000000000000000000000501',
			maxAmount: 5n,
		})
		expect(poolCardQueries.getByText('Showing 1 of 5 active vaults in this preview, newest activity first.')).not.toBeNull()
		expect(poolCardQueries.getByText('+4 more vaults')).not.toBeNull()
	})

	test('preserves the loader-provided vault preview order instead of re-ranking by allowance', async () => {
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					securityPools: [
						createSecurityPool({
							marketDetails: createMarketDetails({ title: 'Ordered vault preview pool' }),
							securityPoolAddress: '0x0000000000000000000000000000000000000700',
							vaultCount: 3n,
							vaults: [
								{
									escalationEscrowedRep: 0n,
									repDepositShare: 10n,
									securityBondAllowance: 1n,
									unpaidEthFees: 0n,
									vaultAddress: '0x0000000000000000000000000000000000000701',
								},
								{
									escalationEscrowedRep: 0n,
									repDepositShare: 10n,
									securityBondAllowance: 9n,
									unpaidEthFees: 0n,
									vaultAddress: '0x0000000000000000000000000000000000000702',
								},
								{
									escalationEscrowedRep: 0n,
									repDepositShare: 10n,
									securityBondAllowance: 5n,
									unpaidEthFees: 0n,
									vaultAddress: '0x0000000000000000000000000000000000000703',
								},
							],
						}),
					],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const poolCard = getSecurityPoolCard('Ordered vault preview pool')
		const previewRows = Array.from(poolCard.querySelectorAll('.security-pool-browse-vault-row'))
		expect(previewRows).toHaveLength(3)
		const previewAddresses = previewRows.map(row => {
			if (!(row instanceof HTMLElement)) throw new Error('Expected vault preview row element')
			const copyButton = within(row).getByRole('button', { name: /Copy address / })
			return copyButton.getAttribute('aria-label')?.replace('Copy address ', '')
		})
		expect(previewAddresses).toEqual(['0x0000000000000000000000000000000000000701', '0x0000000000000000000000000000000000000702', '0x0000000000000000000000000000000000000703'])
	})

	test('keeps the connected wallet vault visible when it is appended outside the top browse preview', async () => {
		const viewerVaultAddress = '0x0000000000000000000000000000000000000604'
		const renderedComponent = await renderIntoDocument(
			<SecurityPoolsOverviewSection
				{...createProps({
					accountState: createAccountState({ address: viewerVaultAddress }),
					securityPools: [
						createSecurityPool({
							marketDetails: createMarketDetails({ title: 'Viewer vault preview pool' }),
							securityPoolAddress: '0x0000000000000000000000000000000000000600',
							vaultCount: 6n,
							vaults: [
								{
									escalationEscrowedRep: 0n,
									repDepositShare: 10n,
									securityBondAllowance: 8n,
									unpaidEthFees: 0n,
									vaultAddress: '0x0000000000000000000000000000000000000601',
								},
								{
									escalationEscrowedRep: 0n,
									repDepositShare: 10n,
									securityBondAllowance: 7n,
									unpaidEthFees: 0n,
									vaultAddress: '0x0000000000000000000000000000000000000602',
								},
								{
									escalationEscrowedRep: 0n,
									repDepositShare: 10n,
									securityBondAllowance: 6n,
									unpaidEthFees: 0n,
									vaultAddress: '0x0000000000000000000000000000000000000603',
								},
								{
									escalationEscrowedRep: 0n,
									repDepositShare: 10n,
									securityBondAllowance: 1n,
									unpaidEthFees: 0n,
									vaultAddress: viewerVaultAddress,
								},
							],
						}),
					],
				})}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const poolCard = getSecurityPoolCard('Viewer vault preview pool')
		const poolCardQueries = within(poolCard)
		expect(poolCardQueries.getAllByRole('button', { name: `Copy address ${viewerVaultAddress}` }).length).toBeGreaterThan(0)
		expect(poolCardQueries.getByText('Showing 4 of 6 active vaults in this preview, newest activity first.')).not.toBeNull()
		expect(poolCardQueries.getByText('+2 more vaults')).not.toBeNull()
	})
})
