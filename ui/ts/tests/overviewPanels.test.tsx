/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { fireEvent, within } from './testUtils/queries'
import { OverviewPanels } from '../components/OverviewPanels.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { act } from 'preact/test-utils'

describe('OverviewPanels', () => {
	type MetricElement = {
		classList: {
			contains: (token: string) => boolean
		}
		firstElementChild: MetricElement | null
		getAttribute: (name: string) => string | null
		parentElement: MetricElement | null
	}

	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let setClientWidthResolver = (_resolver: (element: MetricElement) => number) => undefined
	let setMeasureWidthResolver = (_resolver: (element: MetricElement) => number) => undefined
	let triggerResizeObservers = () => undefined

	async function renderOverviewPanels(overrides: Partial<Parameters<typeof OverviewPanels>[0]> = {}) {
		const baseProps: Parameters<typeof OverviewPanels>[0] = {
			activeUniverseId: 0n,
			accountState: {
				address: undefined,
				chainId: '0x1',
				ethBalance: undefined,
				wethBalance: undefined,
			},
			isConnectingWallet: false,
			isLoadingRepPrices: false,
			isRefreshingRepPrices: false,
			isLoadingUniverseRepBalance: false,
			isRefreshing: false,
			onConnect: () => undefined,
			onGoToGenesisUniverse: () => undefined,
			onRefreshRepPrices: () => undefined,
			parentUniverseId: undefined,
			repPerEthPrice: undefined,
			repPerEthSource: undefined,
			repPerEthSourceUrl: undefined,
			repUsdcPrice: undefined,
			repUsdcSource: undefined,
			repUsdcSourceUrl: undefined,
			universeForkTime: undefined,
			universeHasForked: false,
			universeLabel: 'Genesis universe',
			universePresentation: undefined,
			universeRepBalance: undefined,
			walletBootstrapComplete: true,
		}

		const renderedComponent = await renderIntoDocument(
			<OverviewPanels
				{...baseProps}
				{...overrides}
				accountState={{
					...baseProps.accountState,
					...overrides.accountState,
				}}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		return within(document.body)
	}

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
		let resolveClientWidth = (_element: MetricElement) => 0
		let resolveMeasureWidth = (_element: MetricElement) => 0
		const resizeObservers: MockResizeObserver[] = []
		const originalGetBoundingClientRect = domEnvironment.window.HTMLElement.prototype.getBoundingClientRect

		Object.defineProperty(domEnvironment.window.HTMLElement.prototype, 'clientWidth', {
			configurable: true,
			get() {
				return resolveClientWidth(this)
			},
		})

		domEnvironment.window.HTMLElement.prototype.getBoundingClientRect = function () {
			if (this.classList.contains('currency-value-measure')) return new domEnvironment.window.DOMRect(0, 0, resolveMeasureWidth(this), 0)
			return originalGetBoundingClientRect.call(this)
		}

		class MockResizeObserver implements ResizeObserver {
			callback: ResizeObserverCallback

			constructor(callback: ResizeObserverCallback) {
				this.callback = callback
				resizeObservers.push(this)
			}

			disconnect() {}

			observe(_target: Element, _options?: ResizeObserverOptions) {}

			unobserve(_target: Element) {}
		}

		Reflect.set(globalThis, 'ResizeObserver', MockResizeObserver)
		setClientWidthResolver = nextResolver => {
			resolveClientWidth = nextResolver
		}
		setMeasureWidthResolver = nextResolver => {
			resolveMeasureWidth = nextResolver
		}

		triggerResizeObservers = () => {
			for (const observer of resizeObservers) {
				observer.callback([], observer)
			}
		}
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		Reflect.deleteProperty(globalThis, 'ResizeObserver')
		setClientWidthResolver = (_resolver: (element: MetricElement) => number) => undefined
		setMeasureWidthResolver = (_resolver: (element: MetricElement) => number) => undefined
		triggerResizeObservers = () => undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('shows an enabled connect wallet button when disconnected and idle', async () => {
		const documentQueries = await renderOverviewPanels()
		const connectButton = documentQueries.getByRole('button', { name: 'Connect wallet' })

		if (!(connectButton instanceof HTMLButtonElement)) throw new Error('Expected connect button')
		expect(connectButton.disabled).toBe(false)
	})

	test('shows a disabled spinner button while a wallet connection request is pending', async () => {
		const documentQueries = await renderOverviewPanels({
			isConnectingWallet: true,
		})
		const connectButton = documentQueries.getByRole('button', { name: 'Connecting...' })

		if (!(connectButton instanceof HTMLButtonElement)) throw new Error('Expected connect button')
		expect(connectButton.disabled).toBe(true)
	})

	test('keeps the connect wallet button idle during bootstrap-only loading', async () => {
		const documentQueries = await renderOverviewPanels({
			walletBootstrapComplete: false,
		})
		const connectButton = documentQueries.getByRole('button', { name: 'Connect wallet' })

		if (!(connectButton instanceof HTMLButtonElement)) throw new Error('Expected connect button')
		expect(connectButton.disabled).toBe(false)
		expect(documentQueries.getByText('Connecting...')).toBeDefined()
	})

	test('renders the REP/ETH panel from the canonical REP per ETH quote', async () => {
		const documentQueries = await renderOverviewPanels({
			repPerEthPrice: 2439024390243902439024n,
		})
		expect(documentQueries.getByTitle('2 439.024390243902439024')).toBeDefined()
		expect(documentQueries.queryByText(/0\.00041/)).toBeNull()
	})

	test('renders a refresh button for REP prices and wires it to the provided handler', async () => {
		const onRefreshRepPrices = mock(() => undefined)
		const documentQueries = await renderOverviewPanels({
			onRefreshRepPrices,
		})
		const refreshButton = documentQueries.getByRole('button', { name: 'Refresh REP prices' })
		fireEvent.click(refreshButton)

		expect(onRefreshRepPrices).toHaveBeenCalledTimes(1)
	})

	test('keeps stale REP prices visible while the refresh control shows an in-flight refresh', async () => {
		const documentQueries = await renderOverviewPanels({
			isLoadingRepPrices: false,
			isRefreshingRepPrices: true,
			repPerEthPrice: 2439024390243902439024n,
			repUsdcPrice: 1234567n,
		})

		const refreshButton = documentQueries.getByRole('button', { name: 'Refresh REP prices' })
		if (!(refreshButton instanceof HTMLButtonElement)) throw new Error('Expected refresh button')

		expect(refreshButton.disabled).toBe(true)
		expect(refreshButton.title).toBe('Refreshing REP prices...')
		expect(documentQueries.getByTitle('2 439.024390243902439024')).toBeDefined()
		expect(documentQueries.getByTitle('1.234567 USDC')).toBeDefined()
	})

	test('surfaces a forked Zoltar status in the operations header', async () => {
		const documentQueries = await renderOverviewPanels({
			universeForkTime: 123n,
			universeHasForked: true,
		})

		expect(documentQueries.getByText('Forked')).toBeDefined()
		expect(document.body.textContent?.includes('Zoltar forked on')).toBe(true)
	})

	test('renders the forked badge in the dedicated route-header badge slot', async () => {
		await renderOverviewPanels({
			universeHasForked: true,
		})

		const routeHeaderMain = document.body.querySelector('.route-header-main')
		if (!(routeHeaderMain instanceof HTMLElement)) throw new Error('Expected route header main')
		const routeTitleRow = routeHeaderMain.querySelector('.route-title-row')
		if (!(routeTitleRow instanceof HTMLElement)) throw new Error('Expected route title row')
		const badgeSlot = routeHeaderMain.querySelector('.route-header-badge')
		if (!(badgeSlot instanceof HTMLElement)) throw new Error('Expected route header badge slot')

		expect(routeTitleRow.querySelector('.route-header-badge')).toBeNull()
		expect(routeHeaderMain.children[1]).toBe(badgeSlot)
		expect(badgeSlot.textContent).toContain('Read-only')
		expect(badgeSlot.textContent).toContain('Forked')
	})

	test('distinguishes browser simulation from public network state', async () => {
		const documentQueries = await renderOverviewPanels({
			readBackendStatus: {
				blockNumber: 12n,
				blockTimestamp: undefined,
				rpcSource: 'default',
				rpcUrl: 'browser-simulation',
				transportMode: 'provider',
			},
		})

		expect(documentQueries.getByText('Simulation')).toBeDefined()
		expect(document.body.textContent ?? '').toContain('Simulation mode uses browser-local contract state.')
	})

	test('shows the parent universe metric for child universes', async () => {
		const documentQueries = await renderOverviewPanels({
			activeUniverseId: 11n,
			parentUniverseId: 3n,
			universeLabel: 'Universe 11',
		})

		const parentUniverseLink = documentQueries.getByRole('link', { name: 'Universe 3' })
		expect(parentUniverseLink).toBeDefined()
		expect(document.body.textContent?.includes('Parent Universe')).toBe(true)
	})

	test('hides the parent universe metric for genesis', async () => {
		const documentQueries = await renderOverviewPanels({
			activeUniverseId: 0n,
			parentUniverseId: 0n,
		})

		expect(documentQueries.queryByText('Parent Universe')).toBeNull()
	})

	test('labels provider-mode reads as the wallet provider instead of the fallback RPC host', async () => {
		const documentQueries = await renderOverviewPanels({
			readBackendStatus: {
				blockNumber: 100n,
				blockTimestamp: undefined,
				rpcSource: 'default',
				rpcUrl: 'https://ethereum.dark.florist',
				transportMode: 'provider',
			},
		})

		const readSource = documentQueries.getByText('wallet provider reads @ 100')
		expect(readSource.getAttribute('title')).toBe('Reads are using the connected wallet provider. Configured fallback RPC: https://ethereum.dark.florist')
		expect(document.body.textContent?.includes('ethereum.dark.florist')).toBe(false)
	})

	test('keeps browser-simulation reads labeled as browser simulation', async () => {
		const documentQueries = await renderOverviewPanels({
			readBackendStatus: {
				blockNumber: 12n,
				blockTimestamp: undefined,
				rpcSource: 'default',
				rpcUrl: 'browser-simulation',
				transportMode: 'provider',
			},
		})

		expect(documentQueries.getByText('browser simulation · provider via default @ 12')).toBeDefined()
		expect(document.body.textContent?.includes('wallet provider')).toBe(false)
	})

	test('compacts a large ETH balance without affecting the adjacent WETH metric', async () => {
		setClientWidthResolver(element => {
			if (!element.classList.contains('currency-value')) return 0
			if (element.getAttribute('title') === '999 999 990 000 ETH') return 80
			if (element.getAttribute('title') === '10 000 WETH') return 160
			return 160
		})

		setMeasureWidthResolver(element => {
			const parentTitle = element.parentElement?.firstElementChild?.getAttribute('title')
			if (parentTitle === '999 999 990 000 ETH') return 180
			if (parentTitle === '10 000 WETH') return 110
			return 80
		})

		const documentQueries = await renderOverviewPanels({
			accountState: {
				address: '0x1234567890123456789012345678901234567890',
				chainId: '0x1',
				ethBalance: 999999990000n * 10n ** 18n,
				wethBalance: 10000n * 10n ** 18n,
			},
			universeRepBalance: 5n * 10n ** 18n,
		})

		await act(() => {
			triggerResizeObservers()
		})

		const ethButton = documentQueries.getByRole('button', { name: 'Copy exact value 999 999 990 000' })
		const wethButton = documentQueries.getByRole('button', { name: 'Copy exact value 10 000' })

		expect(ethButton.textContent).toBe('≈ 1T ETH')
		expect(wethButton.textContent).toBe('≈ 10 000.00 WETH')
	})
})
