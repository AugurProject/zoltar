/// <reference types="bun-types" />

import { installActiveEnvironmentForTesting } from '../../lib/activeEnvironment.js'
import { getUniversePresentation } from '../../lib/userCopy.js'
import { installDomTestLifecycle } from '../testUtils/domTestLifecycle.js'
import { createFakeBackend, createFakeSimulationProfile } from '../testUtils/fakeBackend.js'
import { fireEvent, waitFor, within } from '../testUtils/queries.js'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'
import { installTestRouting } from '../testUtils/testRouting.js'
import { SEPOLIA_NETWORK_PROFILE } from '../../wallet/networkProfile.js'
import { OverviewPanels, type OverviewRepPricesProps } from '../../app/components/OverviewPanels.js'
import type { AccountState } from '../../types/app.js'
import { describe, expect, mock, test } from 'bun:test'
import { act } from 'preact/test-utils'

installTestRouting()
describe('OverviewPanels', () => {
	type MetricElement = {
		classList: {
			contains: (token: string) => boolean
		}
		firstElementChild: MetricElement | null
		getAttribute: (name: string) => string | null
		parentElement: MetricElement | null
		querySelector: (selector: string) => MetricElement | null
	}

	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let setClientWidthResolver = (_resolver: (element: MetricElement) => number) => undefined
	let setMeasureWidthResolver = (_resolver: (element: MetricElement) => number) => undefined
	let triggerResizeObservers = () => undefined

	const connectedAccount: AccountState = {
		address: '0x1234567890123456789012345678901234567890',
		chainId: '0xaa36a7',
		ethBalanceAttoEth: undefined,
		wethBalanceAttoEth: undefined,
	}

	function getAccountMenuTrigger() {
		const trigger = document.body.querySelector('.account-menu > .account-menu-trigger')
		if (!(trigger instanceof HTMLElement)) throw new Error('Expected the account menu trigger')
		expect(trigger.getAttribute('aria-label')).toBe('Account Menu 0x123456…567890')
		return trigger
	}

	function openAccountMenu() {
		fireEvent.click(getAccountMenuTrigger())
	}

	type OverviewPanelsOverrides = Partial<Omit<Parameters<typeof OverviewPanels>[0], 'repPrices'>> & { repPrices?: Partial<OverviewRepPricesProps> | undefined }

	async function renderOverviewPanels(overrides: OverviewPanelsOverrides = {}) {
		const baseRepPrices: OverviewRepPricesProps = {
			isLoading: false,
			isRefreshing: false,
			onRefresh: () => undefined,
			repPerEthFailure: undefined,
			repPerEthPrice: undefined,
			repPerEthSource: undefined,
			repPerEthSourceUrl: undefined,
			repUsdcFailure: undefined,
			repUsdcPrice: undefined,
			repUsdcSource: undefined,
			repUsdcSourceUrl: undefined,
		}
		const baseProps: Parameters<typeof OverviewPanels>[0] = {
			applicationTitle: 'Zoltar',
			activeUniverseId: 0n,
			accountState: {
				address: undefined,
				chainId: '0xaa36a7',
				ethBalanceAttoEth: undefined,
				wethBalanceAttoEth: undefined,
			},
			isConnectingWallet: false,
			isManagingWallet: false,
			isLoadingUniverseRepBalance: false,
			isRefreshing: false,
			onConnect: () => undefined,
			onChangeWallet: () => undefined,
			onDisconnectWallet: () => undefined,
			onGoToGenesisUniverse: () => undefined,
			onSwitchNetwork: () => undefined,
			universeForkTime: undefined,
			universeHasForked: false,
			universePresentation: undefined,
			universeRepBalanceAttoRep: undefined,
			walletBootstrapComplete: true,
		}
		const { repPrices: repPricesOverride, ...propOverrides } = overrides
		const repPrices = 'repPrices' in overrides && repPricesOverride === undefined ? undefined : { ...baseRepPrices, ...repPricesOverride }

		const renderedComponent = await renderIntoDocument(
			<OverviewPanels
				{...baseProps}
				{...propOverrides}
				accountState={{
					...baseProps.accountState,
					...propOverrides.accountState,
				}}
				repPrices={repPrices}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		return within(document.body)
	}

	installDomTestLifecycle({
		beforeTest: domEnvironment => {
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
		},
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
			Reflect.deleteProperty(globalThis, 'ResizeObserver')
			setClientWidthResolver = (_resolver: (element: MetricElement) => number) => undefined
			setMeasureWidthResolver = (_resolver: (element: MetricElement) => number) => undefined
			triggerResizeObservers = () => undefined
		},
	})

	test('shows an enabled connect wallet button when disconnected and idle', async () => {
		const documentQueries = await renderOverviewPanels()
		const connectButton = documentQueries.getByRole('button', { name: 'Connect wallet' })

		if (!(connectButton instanceof HTMLButtonElement)) throw new Error('Expected connect button')
		expect(connectButton.disabled).toBe(false)
	})

	test('identifies the Zoltar application in its operations header', async () => {
		const documentQueries = await renderOverviewPanels()
		expect(documentQueries.getByRole('heading', { level: 2, name: 'Zoltar' })).toBeDefined()
		expect(document.body.textContent).not.toContain('Augur Statoblast')
	})

	test('shows one concise missing-universe recovery action', async () => {
		const onGoToGenesisUniverse = mock(() => undefined)
		const documentQueries = await renderOverviewPanels({
			onGoToGenesisUniverse,
			activeUniverseId: 7n,
			universePresentation: getUniversePresentation('missing'),
		})

		expect(documentQueries.getAllByText('Choose another universe.')).toHaveLength(1)
		expect(documentQueries.getAllByRole('button', { name: 'Go to Genesis universe' })).toHaveLength(1)
		expect(documentQueries.queryByText('Go to Genesis universe', { selector: 'p' })).toBeNull()
		fireEvent.click(documentQueries.getByRole('button', { name: 'Go to Genesis universe' }))
		expect(onGoToGenesisUniverse).toHaveBeenCalledTimes(1)
	})

	test('uses the application-owned title supplied by a dependent app', async () => {
		const documentQueries = await renderOverviewPanels({ applicationTitle: 'Augur Statoblast' })
		expect(documentQueries.getByRole('heading', { level: 2, name: 'Augur Statoblast' })).toBeDefined()
		expect(document.body.textContent).not.toContain('Zoltar')
	})

	test('keeps the active Sepolia deployment target visible while disconnected', async () => {
		const resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ profile: SEPOLIA_NETWORK_PROFILE }))
		try {
			const documentQueries = await renderOverviewPanels({
				accountState: {
					address: undefined,
					chainId: SEPOLIA_NETWORK_PROFILE.chainIdHex,
					ethBalanceAttoEth: undefined,
					wethBalanceAttoEth: undefined,
				},
			})

			expect(documentQueries.getByText('Sepolia')).not.toBeNull()
			expect(documentQueries.queryByText('Read-only')).toBeNull()
			expect(documentQueries.queryByText('Not configured on Sepolia')).toBeNull()
			expect(documentQueries.getByRole('button', { name: 'Connect wallet' })).not.toBeNull()
		} finally {
			resetEnvironment()
		}
	})

	test('distinguishes missing liquidity from a failed REP price request', async () => {
		const documentQueries = await renderOverviewPanels({
			accountState: connectedAccount,
			repPrices: { repPerEthFailure: 'no-liquidity', repUsdcFailure: 'rpc-error' },
		})
		openAccountMenu()

		expect(documentQueries.getByText('No liquidity available')).not.toBeNull()
		expect(documentQueries.getByText('Quote failed')).not.toBeNull()
		const priceFailures = document.querySelectorAll('.rep-price-failure')
		expect(priceFailures).toHaveLength(2)
		for (const failure of Array.from(priceFailures)) expect(failure.classList.contains('currency-value')).toBe(true)
		expect(documentQueries.getByRole('button', { name: 'Refresh REP prices' })).not.toBeNull()
	})

	test('renders an application-provided REP per ETH source label', async () => {
		const documentQueries = await renderOverviewPanels({
			accountState: connectedAccount,
			repPrices: { repPerEthPrice: 2n * 10n ** 18n, repPerEthSourceLabel: <span>Custom oracle</span> },
		})
		openAccountMenu()

		expect(documentQueries.getByText('Custom oracle')).not.toBeNull()
	})

	test('shows a disabled spinner button while a wallet connection request is pending', async () => {
		const documentQueries = await renderOverviewPanels({
			isConnectingWallet: true,
		})
		const connectButton = documentQueries.getByRole('button', { name: 'Connecting…' })

		if (!(connectButton instanceof HTMLButtonElement)) throw new Error('Expected connect button')
		expect(connectButton.disabled).toBe(true)
	})

	test('offers account management and wrong-network recovery for a connected wallet', async () => {
		const onChangeWallet = mock(() => undefined)
		const onDisconnectWallet = mock(() => undefined)
		const onSwitchNetwork = mock(() => undefined)
		const documentQueries = await renderOverviewPanels({
			accountState: { ...connectedAccount, chainId: '0x1' },
			onChangeWallet,
			onDisconnectWallet,
			onSwitchNetwork,
		})

		openAccountMenu()
		expect(documentQueries.queryByRole('button', { name: 'Copy Address' })).toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Address Copied' })).toBeNull()
		fireEvent.click(documentQueries.getByRole('button', { name: 'Change wallet' }))
		fireEvent.click(documentQueries.getByRole('button', { name: 'Switch to Sepolia' }))
		fireEvent.click(documentQueries.getByRole('button', { name: 'Disconnect' }))

		expect(onChangeWallet).toHaveBeenCalledTimes(1)
		expect(onSwitchNetwork).toHaveBeenCalledTimes(1)
		expect(onDisconnectWallet).toHaveBeenCalledTimes(1)
	})

	test('discloses the account popover with keyboard-dismissable disclosure semantics', async () => {
		const documentQueries = await renderOverviewPanels({ accountState: connectedAccount })
		const trigger = getAccountMenuTrigger()
		expect(trigger.getAttribute('aria-expanded')).toBe('false')
		expect(document.body.querySelector('.account-menu-popover')).toBeNull()

		fireEvent.click(trigger)
		const popover = document.body.querySelector('.account-menu-popover')
		if (!(popover instanceof HTMLElement)) throw new Error('Expected the account popover')
		expect(trigger.getAttribute('aria-expanded')).toBe('true')
		expect(trigger.getAttribute('aria-controls')).toBe(popover.id)
		expect(documentQueries.getByRole('group', { name: 'Account details' })).toBe(popover)

		fireEvent.keyDown(document, { key: 'Escape' })
		await waitFor(() => expect(document.body.querySelector('.account-menu-popover')).toBeNull())
		expect(document.activeElement).toBe(trigger)
	})

	test('provides the responsive account-address presentation for a normal provider wallet', async () => {
		const address = '0x1234567890123456789012345678901234567890'
		const documentQueries = await renderOverviewPanels({ accountState: connectedAccount })

		expect(document.body.querySelector('.account-menu-trigger .wallet-chip .address-value-abbreviated')?.textContent).toBe('0x123456…567890')
		expect(document.body.querySelector('.account-menu-trigger .wallet-chip .address-value')?.getAttribute('title')).toBe(address)
		openAccountMenu()
		const addressButton = documentQueries.getByRole('button', { name: `Copy address ${address}` })
		expect(addressButton.closest('.account-menu-popover')).not.toBeNull()
		expect(addressButton.textContent).toBe(address)
	})

	test('identifies recognized and unknown wrong networks in the environment badge', async () => {
		let documentQueries = await renderOverviewPanels({
			accountState: { ...connectedAccount, chainId: '0x2105' },
		})

		expect(documentQueries.getByText('Wrong Network (Base)')).not.toBeNull()
		expect(document.body.querySelector('.account-menu-trigger .wallet-chip.is-danger')).not.toBeNull()

		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		documentQueries = await renderOverviewPanels({
			accountState: { ...connectedAccount, chainId: '0xcc6b' },
		})

		expect(documentQueries.getByText('Wrong Network (52331)')).not.toBeNull()
		openAccountMenu()
		expect(document.body.querySelector('.account-menu-network dt')?.textContent).toBe('Network')
		expect(document.body.querySelector('.account-menu-metrics [data-wallet-asset="ETH"]')?.textContent).toBe('—')
	})

	test('keeps the connect wallet button idle during bootstrap-only loading', async () => {
		const documentQueries = await renderOverviewPanels({
			walletBootstrapComplete: false,
		})
		const connectButton = documentQueries.getByRole('button', { name: 'Connect wallet' })

		if (!(connectButton instanceof HTMLButtonElement)) throw new Error('Expected connect button')
		expect(connectButton.disabled).toBe(false)
		expect(document.body.querySelector('.account-menu')).toBeNull()
	})

	test('renders the REP/ETH panel from the canonical REP per ETH quote', async () => {
		const documentQueries = await renderOverviewPanels({
			accountState: connectedAccount,
			repPrices: { repPerEthPrice: 2439024390243902439024n },
		})
		openAccountMenu()
		expect(documentQueries.getByTitle('2 439.024390243902439024')).toBeDefined()
		expect(documentQueries.queryByText(/0\.00041/)).toBeNull()
	})

	test('keeps existing prices visible while refreshing', async () => {
		const queries = await renderOverviewPanels({ accountState: connectedAccount, repPrices: { isLoading: true, isRefreshing: true, repPerEthPrice: 2439024390243902439024n, repUsdcPrice: 1234567n } })
		openAccountMenu()
		expect(queries.getByTitle('2 439.024390243902439024')).toBeDefined()
		expect(queries.getByTitle('1.234567 USDC')).toBeDefined()
	})

	test('renders a refresh button for REP prices and wires it to the provided handler', async () => {
		const onRefreshRepPrices = mock(() => undefined)
		const documentQueries = await renderOverviewPanels({
			accountState: connectedAccount,
			repPrices: { onRefresh: onRefreshRepPrices },
		})
		openAccountMenu()
		const refreshButton = documentQueries.getByRole('button', { name: 'Refresh REP prices' })
		fireEvent.click(refreshButton)

		expect(onRefreshRepPrices).toHaveBeenCalledTimes(1)
	})

	test('lists WETH only for applications that use it', async () => {
		await renderOverviewPanels({ accountState: connectedAccount })
		openAccountMenu()
		expect([...document.body.querySelectorAll('.account-menu-metrics [data-wallet-asset]')].map(asset => asset.getAttribute('data-wallet-asset'))).toEqual(['ETH', 'REP'])
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined

		await renderOverviewPanels({ accountState: connectedAccount, showWethBalance: true })
		openAccountMenu()
		expect([...document.body.querySelectorAll('.account-menu-metrics [data-wallet-asset]')].map(asset => asset.getAttribute('data-wallet-asset'))).toEqual(['ETH', 'WETH', 'REP'])
	})

	test('keeps stale REP prices visible while the refresh control shows an in-flight refresh', async () => {
		const documentQueries = await renderOverviewPanels({
			accountState: connectedAccount,
			repPrices: { isLoading: false, isRefreshing: true, repPerEthPrice: 2439024390243902439024n, repUsdcPrice: 1234567n },
		})
		openAccountMenu()

		const refreshButton = documentQueries.getByRole('button', { name: 'Refresh REP prices' })
		if (!(refreshButton instanceof HTMLButtonElement)) throw new Error('Expected refresh button')

		expect(refreshButton.disabled).toBe(true)
		expect(refreshButton.title).toBe('Refreshing REP prices…')
		expect(documentQueries.getByTitle('2 439.024390243902439024')).toBeDefined()
		expect(documentQueries.getByTitle('1.234567 USDC')).toBeDefined()
	})

	test('explains a forked universe politely and links to the application migration flow', async () => {
		const documentQueries = await renderOverviewPanels({
			migrateRepHref: '#/zoltar?zoltarView=universes',
			universeForkTime: 123n,
			universeHasForked: true,
		})

		const notice = document.body.querySelector('.universe-fork-notice')
		if (!(notice instanceof HTMLElement)) throw new Error('Expected the fork notice')
		expect(notice.getAttribute('role')).toBe('status')
		expect(documentQueries.getByText(/This universe forked on/)).toBeDefined()
		expect(notice.textContent).toContain('Migrate your REP to a child universe.')
		expect(document.body.textContent).not.toContain('continue to use Augur')
		expect(document.body.textContent).not.toContain('Migration required')
		expect(documentQueries.getByRole('link', { name: 'Migrate REP' }).getAttribute('href')).toBe('#/zoltar?zoltarView=universes')
	})

	test('places both critical notices directly below the top bar', async () => {
		const backend = createFakeBackend({ accountAddress: '0x1234567890123456789012345678901234567890' })
		backend.getChainId = async () => '0x1'
		const restore = installActiveEnvironmentForTesting(backend)
		try {
			await renderOverviewPanels({ universeHasForked: true })
			await waitFor(() => expect(document.body.querySelector('.mainnet-disabled-notice')).not.toBeNull())
			const toolbar = document.body.querySelector('.header-toolbar')
			const mainnet = document.body.querySelector('.mainnet-disabled-notice')
			const fork = document.body.querySelector('.universe-fork-notice')
			expect(toolbar?.nextElementSibling).toBe(mainnet)
			expect(mainnet?.nextElementSibling).toBe(fork)
			expect(mainnet?.getAttribute('role')).toBe('alert')
			expect(fork?.getAttribute('role')).toBe('status')
		} finally {
			restore()
		}
	})

	test('does not render a redundant forked badge in the toolbar badge slot', async () => {
		await renderOverviewPanels({
			universeHasForked: true,
		})

		const brand = document.body.querySelector('.header-toolbar-brand')
		if (!(brand instanceof HTMLElement)) throw new Error('Expected the toolbar brand')
		const title = brand.querySelector('h2.application-brand')
		if (!(title instanceof HTMLElement)) throw new Error('Expected the application title')
		const badgeSlot = brand.querySelector('.environment-badge-row')
		if (!(badgeSlot instanceof HTMLElement)) throw new Error('Expected the toolbar badge slot')

		expect(title.querySelector('.badge')).toBeNull()
		expect(brand.children[1]).toBe(badgeSlot)
		expect(badgeSlot.textContent).not.toContain('Read-only')
		expect(badgeSlot.textContent).not.toContain('Forked')
	})

	test('leaves the simulation label to the simulation strip', async () => {
		const resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ profile: createFakeSimulationProfile() }))
		try {
			const documentQueries = await renderOverviewPanels({
				readBackendStatus: {
					blockNumber: 12n,
					blockTimestamp: undefined,
					rpcSource: 'default',
					rpcUrl: 'browser-simulation',
					transportMode: 'provider',
				},
			})

			expect(documentQueries.queryByText('Simulation')).toBeNull()
			expect(document.body.querySelector('.environment-badge-row')).toBeNull()
			expect(documentQueries.queryByText('Write Network')).toBeNull()
			expect(documentQueries.queryByText('Read Source')).toBeNull()
			expect(documentQueries.queryByText('browser simulation · provider via default @ 12')).toBeNull()
		} finally {
			resetEnvironment()
		}
	})

	test('offers a wrong-network badge and switch action for a simulated wallet on another chain', async () => {
		const resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ profile: createFakeSimulationProfile() }))
		const onSwitchNetwork = mock(() => undefined)
		try {
			const documentQueries = await renderOverviewPanels({
				accountState: {
					address: '0x1234567890123456789012345678901234567890',
					chainId: '0x7a69',
					ethBalanceAttoEth: 5n * 10n ** 18n,
					wethBalanceAttoEth: undefined,
				},
				onSwitchNetwork,
				readBackendStatus: {
					blockNumber: 12n,
					blockTimestamp: undefined,
					rpcSource: 'default',
					rpcUrl: 'browser-simulation',
					transportMode: 'provider',
				},
			})

			expect(documentQueries.getByText('Wrong Network (31337)')).not.toBeNull()
			expect(document.body.querySelector('.account-menu-trigger .wallet-chip.is-danger')).not.toBeNull()
			const switchButton = documentQueries.getByRole('button', { name: 'Switch to Browser Simulation' })
			expect(switchButton.closest('.header-toolbar-controls')).not.toBeNull()
			fireEvent.click(switchButton)
			expect(onSwitchNetwork).toHaveBeenCalledTimes(1)
			openAccountMenu()
			expect(documentQueries.queryByRole('button', { name: 'Change wallet' })).toBeNull()
		} finally {
			resetEnvironment()
		}
	})

	test('keeps the plain simulated account chip while the wallet is on the simulation chain', async () => {
		const resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ profile: createFakeSimulationProfile() }))
		try {
			const documentQueries = await renderOverviewPanels({
				accountState: { ...connectedAccount, chainId: '0x539' },
				readBackendStatus: {
					blockNumber: 12n,
					blockTimestamp: undefined,
					rpcSource: 'default',
					rpcUrl: 'browser-simulation',
					transportMode: 'provider',
				},
			})

			expect(documentQueries.queryByText(/Wrong Network/)).toBeNull()
			expect(document.body.querySelector('.account-menu-trigger .wallet-chip.is-danger')).toBeNull()
			openAccountMenu()
			expect(documentQueries.queryByRole('button', { name: 'Switch to Browser Simulation' })).toBeNull()
			expect(documentQueries.queryByRole('button', { name: 'Disconnect' })).toBeNull()
			expect(document.body.querySelector('.account-menu-network')?.textContent).toContain('12')
		} finally {
			resetEnvironment()
		}
	})

	test('does not repeat a parent universe outside the header', async () => {
		const documentQueries = await renderOverviewPanels({
			activeUniverseId: 11n,
		})

		expect(documentQueries.queryByText('Parent Universe')).toBeNull()
	})

	test('keeps the universe in the top bar and every balance row in the popover', async () => {
		const readMetricValues = () => [...document.body.querySelectorAll('.account-menu-metrics .metric-field-value')].map(value => value.textContent?.trim())
		const readGroups = () => [...document.body.querySelectorAll('.account-menu-metrics .overview-metric-group')].map(group => group.getAttribute('aria-label'))

		await renderOverviewPanels({ walletBootstrapComplete: false })
		expect(document.body.querySelector('.header-toolbar-controls .toolbar-field-value')?.textContent).toBe('Genesis (0x0)')
		expect(document.body.querySelector('.header-toolbar-controls .toolbar-field-value > span')?.getAttribute('title')).toBe('Genesis (0x0)')
		expect(document.body.querySelector('.header-toolbar-controls .wallet-button')?.textContent).toBe('Connect wallet')
		await cleanupRenderedComponent?.()

		const childUniverseId = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdn
		await renderOverviewPanels({ activeUniverseId: childUniverseId })
		expect(document.body.querySelector('.header-toolbar-controls .toolbar-field-value')?.textContent).toBe('Universe 0x12345678…90abcd')
		expect(document.body.querySelector('.header-toolbar-controls .toolbar-field-value > span')?.getAttribute('title')).toBe(`Universe 0x${childUniverseId.toString(16)}`)
		await cleanupRenderedComponent?.()

		await renderOverviewPanels({
			accountState: { ...connectedAccount, ethBalanceAttoEth: 2n * 10n ** 18n, wethBalanceAttoEth: 10n ** 18n },
			showWethBalance: true,
			universeRepBalanceAttoRep: 5n * 10n ** 18n,
		})
		expect(document.body.querySelector('.header-toolbar-controls .account-menu-trigger .wallet-chip .address-value-abbreviated')?.textContent).toBe('0x123456…567890')
		openAccountMenu()
		expect(readGroups()).toEqual(['Balances', 'Prices'])
		expect(readMetricValues().slice(0, 3)).toEqual(['≈ 2.00', '≈ 1.00', '≈ 5.00'])
		expect(document.body.querySelector('.account-menu-metrics .overview-metric-group-caption button')?.getAttribute('aria-label')).toBe('Refresh REP prices')
	})

	test('compacts a large ETH balance without affecting the adjacent WETH metric', async () => {
		// Widths belong to the metric cell around each shrink-to-fit value.
		setClientWidthResolver(element => {
			if (element.classList.contains('currency-value') || element.classList.contains('currency-value-wrap')) return 0
			const title = element.querySelector('.currency-value')?.getAttribute('title')
			if (title === '999 999 990 000') return 80
			if (title === '10 000') return 160
			return 160
		})

		setMeasureWidthResolver(element => {
			const parentTitle = element.parentElement?.firstElementChild?.getAttribute('title')
			if (parentTitle === '999 999 990 000') return 180
			if (parentTitle === '10 000') return 110
			return 80
		})

		const documentQueries = await renderOverviewPanels({
			accountState: { ...connectedAccount, ethBalanceAttoEth: 999999990000n * 10n ** 18n, wethBalanceAttoEth: 10000n * 10n ** 18n },
			showWethBalance: true,
			universeRepBalanceAttoRep: 5n * 10n ** 18n,
		})
		openAccountMenu()

		await act(() => {
			triggerResizeObservers()
		})

		const ethButton = documentQueries.getByRole('button', { name: 'Copy exact value 999 999 990 000' })
		const wethButton = documentQueries.getByRole('button', { name: 'Copy exact value 10 000' })

		expect(ethButton.textContent).toBe('≈ 1T')
		expect(wethButton.textContent).toBe('≈ 10 000.00')
	})
})
