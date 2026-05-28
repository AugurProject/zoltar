/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { fireEvent, within } from '@testing-library/dom'
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
			accountState: {
				address: undefined,
				chainId: '0x1',
				ethBalance: undefined,
				wethBalance: undefined,
			},
			isConnectingWallet: false,
			isLoadingRepPrices: false,
			isLoadingUniverseRepBalance: false,
			isRefreshing: false,
			onConnect: () => undefined,
			onGoToGenesisUniverse: () => undefined,
			onRefreshRepPrices: () => undefined,
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

	test('surfaces a forked Zoltar status in the operations header', async () => {
		const documentQueries = await renderOverviewPanels({
			universeForkTime: 123n,
			universeHasForked: true,
		})

		expect(documentQueries.getByText('Forked')).toBeDefined()
		expect(document.body.textContent?.includes('Zoltar forked on')).toBe(true)
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
