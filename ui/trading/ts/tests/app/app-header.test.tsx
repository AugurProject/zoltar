import { installTradingRouting, tradingRouting } from '../../lib/routing.js'
import { beforeEach, describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { App } from '../../app/App.js'
import * as appCopy from '../../copy/app.js'
import { TradingOverviewPanel } from '../../components/TradingOverviewPanel.js'
import { hasTradingWalletControls, TradingWalletControls } from '../../components/TradingWalletControls.js'
import { routeOwnsLiveWallet, walletSummaryAfterRouteChange, walletSummaryForUniverse } from '../../lib/walletSummaryState.js'
import { filterMarketsByUniverse, walletSummaryAvailability, walletSummaryDiscoveryRetryStart, walletSummaryRefreshState } from '../../features/liveTradingControllerHelpers.js'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import type { LiveMarket } from '../../protocol/live.js'
import { liveTradingControllerServices } from '../../features/liveTradingControllerHelpers.js'
import { waitFor } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'

beforeEach(() => installTradingRouting())

describe('trading header', () => {
	let cleanupRendered: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRendered?.()
			cleanupRendered = undefined
		},
		url: 'http://localhost/#/market',
	})

	test('keeps a requested universe unconfirmed until discovery answers and offers the universe route instead of a header control', async () => {
		window.history.replaceState(undefined, '', '/#/universe?universe=2')
		const rendered = await renderIntoDocument(<App loadLiveDeployment={() => new Promise<DeploymentConfiguration>(() => undefined)} />)
		cleanupRendered = rendered.cleanup
		// The header and the universe route show a loading state, never the unconfirmed ID, so an unknown request cannot flash as a universe.
		expect(rendered.container.querySelector('.header-toolbar-controls .toolbar-field-value')?.textContent).toContain('Loading')
		expect(rendered.container.textContent).not.toContain('Universe 0x2')
		expect(rendered.container.textContent).not.toContain('not deployed')
		expect(rendered.container.querySelector('#app-content .route-header')?.textContent).toContain('Universe')
		expect(rendered.container.querySelector('.header-toolbar-controls select')).toBeNull()
		const universeTab = Array.from(rendered.container.querySelectorAll<HTMLAnchorElement>('.tab-nav a')).find(anchor => anchor.textContent === 'Universe')
		expect(universeTab?.getAttribute('href')).toBe('#/universe?universe=2')
	})

	test('rewrites an unknown universe request to the discovered universe so the URL, header, and routes agree', async () => {
		window.history.replaceState(undefined, '', '/#/universe?universe=7&simulate=1')
		const configuration: DeploymentConfiguration = { chainId: 31_337, chainName: 'Local', rpcUrl: 'http://127.0.0.1:1', securityPoolFactory: `0x${'11'.repeat(20)}`, factory: `0x${'22'.repeat(20)}`, router: `0x${'33'.repeat(20)}`, feeBps: 30 }
		const services = {
			...liveTradingControllerServices,
			createTradingPublicClient: () => ({}),
			validateLiveDeployment: async () => undefined,
			discoverUniverses: async () => ({ start: 0n, count: 0n, total: 0n, previousStart: undefined, nextStart: undefined, markets: [], universeIds: [0n, 2n], selectedUniverseId: 0n }),
		}
		const rendered = await renderIntoDocument(<App initializeEnvironment={async () => undefined} loadLiveDeployment={async () => configuration} liveTradingServices={services} />)
		cleanupRendered = rendered.cleanup
		await waitFor(() => expect(window.location.hash).toBe('#/universe?universe=0&simulate=1'))
		// The header names the universe with the shared switcher, which links back to the universe browser.
		const universeSwitcher = rendered.container.querySelector('.header-toolbar-controls .toolbar-field-value .universe-switcher')
		expect(universeSwitcher?.querySelector('.universe-switcher-label')?.textContent).toBe('Genesis')
		expect(universeSwitcher?.querySelector('summary')?.getAttribute('aria-label')).toBe('Universe: Genesis. Switch universe')
		expect(universeSwitcher?.querySelector('.universe-switcher-browse')?.getAttribute('href')).toContain('#/universe')
	})

	test('follows an addressed market into its universe and rewrites a disagreeing parameter', async () => {
		const pool = `0x${'ab'.repeat(20)}`
		window.history.replaceState(undefined, '', `/#/market/${pool}?universe=0`)
		const configuration: DeploymentConfiguration = { chainId: 31_337, chainName: 'Local', rpcUrl: 'http://127.0.0.1:1', securityPoolFactory: `0x${'11'.repeat(20)}`, factory: `0x${'22'.repeat(20)}`, router: `0x${'33'.repeat(20)}`, feeBps: 30 }
		const market: LiveMarket = {
			pool,
			pair: `0x${'cd'.repeat(20)}`,
			shareToken: `0x${'ef'.repeat(20)}`,
			universeId: 5n,
			questionId: 2n,
			title: 'Universe five market',
			description: 'Addressed route fixture',
			endTime: 2n ** 255n,
			statoblastSecurityMultiplierBps: 20_000n,
			initialReportPriorityFeeAttoEthPerGas: 1n,
			systemState: 0,
			awaitingForkContinuation: false,
			universeForkTime: 0n,
			vaultCount: 1n,
			shareTokenSupplyAttoShares: 10n * 10n ** 36n,
			settlementCollateralAttoEth: 10n * 10n ** 18n,
			currentRetentionRate: 10n ** 18n,
			totalCapacityOwnershipAttoRep: 1n,
			feeEligibleCapacityOwnershipAttoRep: 1n,
			mintingCapacityCeilingAttoEth: 2n,
			availableMintingCapacityAttoEth: 1n,
			feeBps: 30n,
			tradingStatus: 0,
			questionOutcome: 3,
			yesReserve: 50n * 10n ** 36n,
			noReserve: 50n * 10n ** 36n,
			lpTotalSupply: 50n * 10n ** 36n,
		}
		const services = {
			...liveTradingControllerServices,
			createTradingPublicClient: () => ({}),
			validateLiveDeployment: async () => undefined,
			discoverAddressedMarket: async () => ({ start: 0n, count: 1n, total: 1n, previousStart: undefined, nextStart: undefined, markets: [market], universeIds: [5n], selectedUniverseId: 5n }),
		}
		const rendered = await renderIntoDocument(<App initializeEnvironment={async () => undefined} loadLiveDeployment={async () => configuration} liveTradingServices={services} />)
		cleanupRendered = rendered.cleanup
		await waitFor(() => expect(window.location.hash).toBe(`#/market/${pool}?universe=5`))
		await waitFor(() => expect(rendered.container.querySelector('.header-toolbar-controls .universe-switcher-label')?.textContent).toBe('Universe 0x5'))
	})

	test('a request superseded while in flight settles nothing; only the answer to the current universe request does', async () => {
		window.history.replaceState(undefined, '', '/#/universe?universe=5')
		const configuration: DeploymentConfiguration = { chainId: 31_337, chainName: 'Local', rpcUrl: 'http://127.0.0.1:1', securityPoolFactory: `0x${'11'.repeat(20)}`, factory: `0x${'22'.repeat(20)}`, router: `0x${'33'.repeat(20)}`, feeBps: 30 }
		const answers: Array<ReturnType<typeof createDeferred<{ start: bigint; count: bigint; total: bigint; previousStart: undefined; nextStart: undefined; markets: never[]; universeIds: bigint[]; selectedUniverseId: bigint }>>> = []
		const services = {
			...liveTradingControllerServices,
			createTradingPublicClient: () => ({}),
			validateLiveDeployment: async () => undefined,
			discoverUniverses: async () => {
				const answer = createDeferred<{ start: bigint; count: bigint; total: bigint; previousStart: undefined; nextStart: undefined; markets: never[]; universeIds: bigint[]; selectedUniverseId: bigint }>()
				answers.push(answer)
				return await answer.promise
			},
		}
		const rendered = await renderIntoDocument(<App initializeEnvironment={async () => undefined} loadLiveDeployment={async () => configuration} liveTradingServices={services} />)
		cleanupRendered = rendered.cleanup
		await waitFor(() => expect(answers).toHaveLength(1))
		// The user moves to universe 7 while the universe-5 discovery is still in flight.
		await act(async () => {
			window.history.replaceState(undefined, '', '/#/universe?universe=7')
			window.dispatchEvent(new Event('popstate'))
		})
		await act(async () => {
			answers[0]?.resolve({ start: 0n, count: 0n, total: 0n, previousStart: undefined, nextStart: undefined, markets: [], universeIds: [0n, 5n], selectedUniverseId: 5n })
			await Bun.sleep(20)
		})
		// The superseded universe-5 answer neither confirms nor rewrites the universe-7 request.
		expect(window.location.hash).toBe('#/universe?universe=7')
		expect(rendered.container.querySelector('.header-toolbar-controls .toolbar-field-value')?.textContent).toContain('Loading')
		// Only the answer to the universe-7 request settles it (7 is unknown, so it falls back to genesis and rewrites).
		await waitFor(() => expect(answers).toHaveLength(2))
		await act(async () => {
			answers[1]?.resolve({ start: 0n, count: 0n, total: 0n, previousStart: undefined, nextStart: undefined, markets: [], universeIds: [0n, 5n], selectedUniverseId: 0n })
			await Bun.sleep(20)
		})
		await waitFor(() => expect(window.location.hash).toBe('#/universe?universe=0'))
		await waitFor(() => expect(rendered.container.querySelector('.header-toolbar-controls .universe-switcher-label')?.textContent).toBe('Genesis'))
	})

	test('settles on the discovered universe without re-discovering in a loop', async () => {
		window.history.replaceState(undefined, '', '/#/market')
		const configuration: DeploymentConfiguration = { chainId: 31_337, chainName: 'Local', rpcUrl: 'http://127.0.0.1:1', securityPoolFactory: `0x${'11'.repeat(20)}`, factory: `0x${'22'.repeat(20)}`, router: `0x${'33'.repeat(20)}`, feeBps: 30 }
		let discoveries = 0
		const services = {
			...liveTradingControllerServices,
			createTradingPublicClient: () => ({}),
			validateLiveDeployment: async () => undefined,
			discoverTradingMarketPage: async () => {
				discoveries += 1
				return { start: 0n, count: 0n, total: 0n, previousStart: undefined, nextStart: undefined, markets: [], universeIds: [0n], selectedUniverseId: 0n }
			},
		}
		const rendered = await renderIntoDocument(<App initializeEnvironment={async () => undefined} loadLiveDeployment={async () => configuration} liveTradingServices={services} />)
		cleanupRendered = rendered.cleanup
		await waitFor(() => expect(rendered.container.querySelector('.header-toolbar-controls .universe-switcher-label')?.textContent).toBe('Genesis'))
		// The confirmed universe is re-requested once; a confirmed answer must not read as foreign and restart discovery.
		await act(async () => await Bun.sleep(300))
		expect(discoveries).toBeLessThanOrEqual(2)
		expect(rendered.container.querySelector('.header-toolbar-controls .universe-switcher-label')?.textContent).toBe('Genesis')
		expect(window.location.hash).toBe('#/market')
	})

	test('says the universe is unavailable when universe discovery fails', async () => {
		window.history.replaceState(undefined, '', '/#/universe')
		const configuration: DeploymentConfiguration = { chainId: 31_337, chainName: 'Local', rpcUrl: 'http://127.0.0.1:1', securityPoolFactory: `0x${'11'.repeat(20)}`, factory: `0x${'22'.repeat(20)}`, router: `0x${'33'.repeat(20)}`, feeBps: 30 }
		const services = {
			...liveTradingControllerServices,
			createTradingPublicClient: () => ({}),
			validateLiveDeployment: async () => undefined,
			discoverUniverses: async () => {
				throw new Error('registry RPC unavailable')
			},
		}
		const rendered = await renderIntoDocument(<App initializeEnvironment={async () => undefined} loadLiveDeployment={async () => configuration} liveTradingServices={services} />)
		cleanupRendered = rendered.cleanup
		await waitFor(() => expect(rendered.container.textContent).toContain('Universe discovery failed: registry RPC unavailable'))
		// The header learns about the failure through the route's state effect, one commit after the route itself.
		await waitFor(() => expect(rendered.container.querySelector('.header-toolbar-controls .toolbar-field-value')?.textContent).toBe('Unavailable'))
	})

	test('shows wallet connection failures on the universe route', async () => {
		window.history.replaceState(undefined, '', '/#/universe')
		const configuration: DeploymentConfiguration = { chainId: 31_337, chainName: 'Local', rpcUrl: 'http://127.0.0.1:1', securityPoolFactory: `0x${'11'.repeat(20)}`, factory: `0x${'22'.repeat(20)}`, router: `0x${'33'.repeat(20)}`, feeBps: 30 }
		const services = {
			...liveTradingControllerServices,
			createTradingPublicClient: () => ({}),
			validateLiveDeployment: async () => undefined,
			discoverUniverses: async () => ({ start: 0n, count: 0n, total: 0n, previousStart: undefined, nextStart: undefined, markets: [], universeIds: [0n], selectedUniverseId: 0n }),
		}
		const rendered = await renderIntoDocument(<App initializeEnvironment={async () => undefined} loadLiveDeployment={async () => configuration} liveTradingServices={services} />)
		cleanupRendered = rendered.cleanup
		await waitFor(() => expect(rendered.container.querySelector('.header-toolbar-controls .universe-switcher-label')?.textContent).toBe('Genesis'))
		const walletButton = rendered.container.querySelector<HTMLButtonElement>('.trading-wallet-actions .wallet-button')
		expect(walletButton?.textContent).toBe('Connect wallet')
		await act(async () => {
			walletButton?.click()
			await Bun.sleep(10)
		})
		await waitFor(() => expect(rendered.container.querySelector('#app-content [role="alert"]')?.textContent).toContain('No injected wallet was found'))
	})

	test('renders an explicit not-found route and updates the document title', async () => {
		window.history.replaceState(undefined, '', '/#/missing')
		expect(tradingRouting.resolve(window.location.hash)).toBe('not-found')
		const rendered = await renderIntoDocument(<App />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector('main')?.textContent).toContain('Page Not Found')
		expect(rendered.container.querySelector('h1.visually-hidden')?.textContent).toBe('Not found')
		const skipButton = Array.from(rendered.container.querySelectorAll('button')).find(button => button.textContent === 'Skip to main content')
		if (skipButton === undefined) throw new Error('Shared application skip control is unavailable')
		await act(() => skipButton.click())
		expect(document.activeElement).toBe(rendered.container.querySelector('#app-content'))
		// The shared frame focuses the route content only, so skipping lands past the header and tab navigation.
		expect(document.activeElement?.querySelector('.tab-nav')).toBeNull()
		expect(document.activeElement?.textContent).toContain('Page Not Found')
		expect(document.title).toBe(appCopy.documentTitle(appCopy.notFound))
		expect(document.title).toBe('Not found · Statoblast trading')
	})

	test('accepts only addressed security-pool routes', () => {
		window.history.replaceState(undefined, '', '/#/security-pool')
		expect(tradingRouting.resolve(window.location.hash)).toBe('not-found')
		const address = `0x${'44'.repeat(20)}`
		window.history.replaceState(undefined, '', `/#/security-pool/${address}`)
		expect(tradingRouting.resolve(window.location.hash)).toBe(`security-pool/${address}`)
		window.history.replaceState(undefined, '', `/#security-pool/${address}`)
		expect(tradingRouting.resolve(window.location.hash)).toBe(`security-pool/${address}`)
	})

	test('preserves slashless top-level route bookmarks', () => {
		window.history.replaceState(undefined, '', '/#market')
		expect(tradingRouting.resolve(window.location.hash)).toBe('market')
	})

	test('uses Statoblast branding without the removed footer disclaimers', async () => {
		const rendered = await renderIntoDocument(<App />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector('.application-brand')?.textContent).toContain('Statoblast trading')
		expect(rendered.container.querySelector('footer')).toBeNull()
		expect(rendered.container.textContent).not.toContain('unaudited MVP')
		expect(rendered.container.textContent).not.toContain('Spot prices are not manipulation-resistant oracles.')
	})

	test('connects wallets from the persistent top-right header action', async () => {
		window.history.replaceState(undefined, '', '/#/market')
		const configuration: DeploymentConfiguration = {
			chainId: 31_337,
			chainName: 'Local',
			rpcUrl: 'http://127.0.0.1:1',
			securityPoolFactory: `0x${'11'.repeat(20)}`,
			factory: `0x${'22'.repeat(20)}`,
			router: `0x${'33'.repeat(20)}`,
			feeBps: 30,
		}
		const rendered = await renderIntoDocument(<App loadLiveDeployment={async () => configuration} />)
		cleanupRendered = rendered.cleanup
		await act(async () => {
			await Bun.sleep(10)
		})
		const walletButton = rendered.container.querySelector<HTMLButtonElement>('.trading-wallet-actions .wallet-button')
		expect(walletButton?.textContent).toBe('Connect wallet')
		expect(walletButton?.disabled).toBeFalse()
		expect(rendered.container.querySelector('main .route-header .wallet-button')).toBeNull()
		await act(async () => {
			walletButton?.click()
			await Bun.sleep(10)
		})
		expect(rendered.container.querySelector('main')?.textContent).toContain('No injected wallet was found')
	})

	test('reserves the toolbar wallet slot while the deployment is checked', async () => {
		window.history.replaceState(undefined, '', '/#/market')
		let resolveDeployment: ((configuration: DeploymentConfiguration) => void) | undefined
		const deployment = new Promise<DeploymentConfiguration>(resolve => {
			resolveDeployment = resolve
		})
		const rendered = await renderIntoDocument(<App loadLiveDeployment={() => deployment} />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector('.trading-wallet-actions .wallet-chip.is-placeholder')?.textContent).toContain('Loading')
		expect(rendered.container.querySelector('.trading-wallet-actions .wallet-button')).toBeNull()
		// The universe field is a plain value chosen on the universe route; it never becomes a control.
		expect(rendered.container.querySelector('.header-toolbar-controls .toolbar-field-value')?.textContent).toContain('Loading')
		expect(rendered.container.querySelector('.header-toolbar-controls select')).toBeNull()
		if (resolveDeployment === undefined) throw new Error('Deployment resolver is unavailable')
		resolveDeployment({ chainId: 31_337, chainName: 'Local', rpcUrl: 'http://127.0.0.1:1', securityPoolFactory: `0x${'11'.repeat(20)}`, factory: `0x${'22'.repeat(20)}`, router: `0x${'33'.repeat(20)}`, feeBps: 30 })
		await act(async () => {
			await Bun.sleep(10)
		})
		expect(rendered.container.querySelector('.trading-wallet-actions .wallet-chip.is-placeholder')).toBeNull()
		expect(rendered.container.querySelector('.trading-wallet-actions .wallet-button')?.textContent).toBe('Connect wallet')
	})

	test('renders the live account chip with its change action outside simulation', async () => {
		const account = '0x8ba1f109551bD432803012645Ac136ddd64DBA72'
		const deploymentWalletState = { account: undefined, connecting: false, networkName: undefined, ready: true }
		let connectRequests = 0
		const baseProps = { deploymentSetupActive: false, deploymentWalletState, liveDeploymentStatus: 'verified' as const, onDeploymentWalletRequest: () => undefined, onWalletConnectRequest: () => connectRequests++, routeOwnsLiveWallet: true, workflowLocked: false }
		const live = await renderIntoDocument(<TradingWalletControls {...baseProps} account={account} simulation={false} />)
		cleanupRendered = live.cleanup
		expect(live.container.querySelector('.wallet-chip .address-value-abbreviated')?.textContent).toBe('0x8ba1f1…4DBA72')
		expect(live.container.querySelector('.wallet-chip button.address-value')?.getAttribute('title')).toBe(account)
		const changeButton = live.container.querySelector<HTMLButtonElement>('.wallet-button')
		expect(changeButton?.textContent).toBe('Change wallet')
		await act(() => changeButton?.click())
		expect(connectRequests).toBe(1)
		await live.cleanup()

		const simulated = await renderIntoDocument(<TradingWalletControls {...baseProps} account={account} simulation />)
		cleanupRendered = simulated.cleanup
		expect(simulated.container.querySelector('.wallet-chip .address-value-abbreviated')?.textContent).toBe('0x8ba1f1…4DBA72')
		expect(simulated.container.querySelector('.wallet-button')).toBeNull()
		await simulated.cleanup()

		let switchRequests = 0
		const wrongChain = await renderIntoDocument(<TradingWalletControls {...baseProps} account={undefined} simulation requiredNetworkName='Local' walletChainId={1} onSwitchNetwork={() => switchRequests++} />)
		cleanupRendered = wrongChain.cleanup
		expect(wrongChain.container.querySelector('.badge')?.textContent).toBe('Wrong Network (Ethereum)')
		const switchButton = wrongChain.container.querySelector<HTMLButtonElement>('.wallet-button')
		expect(switchButton?.textContent).toBe('Switch to Local')
		await act(() => switchButton?.click())
		expect(switchRequests).toBe(1)
		await wrongChain.cleanup()

		expect(hasTradingWalletControls({ deploymentSetupActive: false, liveDeploymentStatus: 'unavailable', routeOwnsLiveWallet: true })).toBe(false)
		expect(hasTradingWalletControls({ deploymentSetupActive: false, liveDeploymentStatus: 'verified', routeOwnsLiveWallet: false })).toBe(false)
		expect(hasTradingWalletControls({ deploymentSetupActive: true, liveDeploymentStatus: 'unavailable', routeOwnsLiveWallet: false })).toBe(true)
	})

	test('omits the toolbar controls slot on routes without wallet or universe context', async () => {
		window.history.replaceState(undefined, '', '/#/help')
		const rendered = await renderIntoDocument(
			<App
				loadLiveDeployment={async () => {
					throw new Error('deployment unavailable')
				}}
			/>,
		)
		cleanupRendered = rendered.cleanup
		await act(async () => {
			await Bun.sleep(10)
		})
		expect(rendered.container.querySelector('.header-toolbar-controls')).toBeNull()
		expect(rendered.container.querySelector('.header-toolbar-settings')).not.toBeNull()
	})

	test('uses shared overview and navigation with linked route tabs and no duplicate route selector', async () => {
		const rendered = await renderIntoDocument(<App />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector('.top-shell-content .header-toolbar .application-brand')?.textContent).toBe('Statoblast trading')
		expect(rendered.container.querySelector('.app-nav-stack .tab-nav')).not.toBeNull()
		expect(rendered.container.querySelector('.app-nav-stack select')).toBeNull()
		const helpLink = Array.from(rendered.container.querySelectorAll<HTMLAnchorElement>('.tab-nav a')).find(anchor => anchor.textContent === 'Help')
		if (helpLink === undefined) throw new Error('Shared route navigation is missing')
		await act(() => {
			helpLink.click()
		})
		expect(tradingRouting.resolve(window.location.hash)).toBe('help')
	})

	test('shows wallet connection failures on live security-pool routes', async () => {
		window.history.replaceState(undefined, '', `/#/security-pool/0x${'44'.repeat(20)}`)
		const configuration: DeploymentConfiguration = {
			chainId: 31_337,
			chainName: 'Local',
			rpcUrl: 'http://127.0.0.1:1',
			securityPoolFactory: `0x${'11'.repeat(20)}`,
			factory: `0x${'22'.repeat(20)}`,
			router: `0x${'33'.repeat(20)}`,
			feeBps: 30,
		}
		const rendered = await renderIntoDocument(<App loadLiveDeployment={async () => configuration} />)
		cleanupRendered = rendered.cleanup
		await act(async () => {
			await Bun.sleep(10)
		})
		const walletButton = rendered.container.querySelector<HTMLButtonElement>('.trading-wallet-actions .wallet-button')
		expect(walletButton?.textContent).toBe('Connect wallet')
		await act(async () => {
			walletButton?.click()
			await Bun.sleep(10)
		})
		expect(rendered.container.querySelector('main [role="alert"]')?.textContent).toContain('No injected wallet was found')
		await act(async () => {
			window.history.replaceState(undefined, '', '/#/market')
			window.dispatchEvent(new Event('hashchange'))
			await Bun.sleep(10)
		})
		expect(rendered.container.querySelector('main')?.textContent).not.toContain('No injected wallet was found')
	})

	test('keeps only markets minted in the selected universe', () => {
		const first = { universeId: 1n } as LiveMarket
		const second = { universeId: 2n } as LiveMarket
		expect(filterMarketsByUniverse([first, second], '2')).toEqual([second])
		expect(filterMarketsByUniverse([first, second], undefined)).toEqual([])
	})

	test('keeps the balance slots in place while the wallet is disconnected or loading', async () => {
		const disconnected = await renderIntoDocument(<TradingOverviewPanel simulation={false} walletSummary={{ account: undefined, ethAttoEth: undefined, repAttoRep: undefined, status: 'disconnected', error: undefined, errorLabel: undefined, universeId: '1' }} />)
		cleanupRendered = disconnected.cleanup
		const disconnectedCells = [...disconnected.container.querySelectorAll('.overview-inline-metrics .overview-metric-group-items > div')].map(cell => cell.className)
		expect(disconnectedCells).toEqual(['overview-simulation-secondary', 'overview-simulation-secondary'])
		const group = disconnected.container.querySelector('.overview-inline-metrics > .overview-metric-group')
		if (!(group instanceof HTMLElement)) throw new Error('Expected the balances group')
		expect(group.getAttribute('aria-label')).toBe('Balances')
		expect(group.style.getPropertyValue('--overview-metric-columns')).toBe('2')
		expect(disconnected.container.querySelector('[data-wallet-asset="ETH"]')?.textContent).toContain('—')
		expect(disconnected.container.querySelector('[data-wallet-asset="REP"]')?.textContent).toContain('—')
		await disconnected.cleanup()

		const loading = await renderIntoDocument(<TradingOverviewPanel simulation={false} walletSummary={{ account: '0x8ba1f109551bD432803012645Ac136ddd64DBA72', ethAttoEth: undefined, repAttoRep: undefined, status: 'loading', error: undefined, errorLabel: undefined, universeId: '1' }} />)
		cleanupRendered = loading.cleanup
		const loadingCells = [...loading.container.querySelectorAll('.overview-inline-metrics .overview-metric-group-items > div')].map(cell => cell.className)
		expect(loadingCells).toEqual(disconnectedCells)
		expect(loading.container.querySelector('[data-wallet-asset="ETH"]')?.textContent).toContain('Loading')
		expect(loading.container.querySelector('[data-wallet-asset="REP"]')?.textContent).toContain('Loading')
	})

	test('keeps wallet balance failures visible with a retry', async () => {
		const account = '0x8ba1f109551bD432803012645Ac136ddd64DBA72'
		let retries = 0
		const rendered = await renderIntoDocument(<TradingOverviewPanel simulation={false} walletSummary={{ account, ethAttoEth: undefined, repAttoRep: undefined, status: 'error', error: 'REP balance RPC failed', errorLabel: 'Wallet balance read failed', universeId: '1' }} onRetryWalletSummary={() => retries++} />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector('[data-wallet-asset="ETH"]')?.textContent).toContain('—')
		expect(rendered.container.querySelector('[data-wallet-asset="REP"]')?.textContent).toContain('—')
		expect(rendered.container.querySelector('[role="alert"]')?.textContent).toBe('Wallet balance read failed')
		expect(rendered.container.querySelector('[role="alert"]')?.getAttribute('aria-label')).toContain('REP balance RPC failed')
		await act(() => rendered.container.querySelector<HTMLButtonElement>('.trading-wallet-error button')?.click())
		expect(retries).toBe(1)
	})

	test('ends wallet balance loading when selected-universe discovery fails', async () => {
		expect(walletSummaryAvailability(true, undefined, 'loading', undefined, true, 'Security pool discovery failed')?.status).toBe('loading')
		// The universe route names its own discovery and a redacted detail is not prefixed twice.
		expect(walletSummaryAvailability(true, undefined, 'error', 'RPC request failed', true, 'Universe discovery failed')).toEqual({ status: 'error', error: 'Universe discovery failed: RPC request failed', errorLabel: 'Universe discovery failed' })
		expect(walletSummaryAvailability(true, undefined, 'error', 'Universe discovery failed', true, 'Universe discovery failed')?.error).toBe('Universe discovery failed')
		const availability = walletSummaryAvailability(true, undefined, 'error', 'RPC request failed', true, 'Security pool discovery failed')
		if (availability === undefined) throw new Error('A discovery failure must make wallet balances unavailable')
		const rendered = await renderIntoDocument(<TradingOverviewPanel simulation={false} walletSummary={{ account: '0x8ba1f109551bD432803012645Ac136ddd64DBA72', ethAttoEth: undefined, repAttoRep: undefined, status: availability.status, error: availability.error, errorLabel: availability.errorLabel, universeId: '1' }} />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector('[role="status"]')).toBeNull()
		expect(rendered.container.querySelector('[role="alert"]')?.getAttribute('aria-label')).toContain('Security pool discovery failed: RPC request failed')
	})

	test('discloses simulation balances through the shared overview control', async () => {
		const rendered = await renderIntoDocument(<TradingOverviewPanel simulation walletSummary={{ account: '0x00000000000000000000000000000000000000A1', ethAttoEth: 1n, repAttoRep: 2n, status: 'ready', error: undefined, errorLabel: undefined, universeId: '0' }} />)
		cleanupRendered = rendered.cleanup
		const toggle = rendered.container.querySelector<HTMLButtonElement>('.overview-details-toggle')
		expect(toggle?.getAttribute('aria-expanded')).toBe('false')
		expect(rendered.container.querySelector('.mobile-expanded')).toBeNull()
		await act(() => toggle?.click())
		expect(toggle?.getAttribute('aria-expanded')).toBe('true')
		expect(rendered.container.querySelector('.overview-inline-metrics.mobile-expanded')).not.toBeNull()
		await act(() => toggle?.click())
		expect(toggle?.getAttribute('aria-expanded')).toBe('false')
	})

	test('preserves all 18 decimals in authoritative wallet balances', async () => {
		const rendered = await renderIntoDocument(<TradingOverviewPanel simulation={false} walletSummary={{ account: '0x8ba1f109551bD432803012645Ac136ddd64DBA72', ethAttoEth: 1n, repAttoRep: 2n ** 256n - 1n, status: 'ready', error: undefined, errorLabel: undefined, universeId: '1' }} />)
		cleanupRendered = rendered.cleanup
		expect(rendered.container.querySelector('[data-wallet-asset="ETH"] button')?.getAttribute('title')).toBe('0.000000000000000001')
		expect(rendered.container.querySelector('[data-wallet-asset="REP"] button')?.getAttribute('title')).toEndWith('.584007913129639935')
	})

	test('hides retained balances synchronously when the selected universe changes', () => {
		const previous = { account: '0x8ba1f109551bD432803012645Ac136ddd64DBA72' as const, ethAttoEth: 64n * 10n ** 18n, repAttoRep: 12_500n * 10n ** 18n, status: 'ready' as const, error: undefined, errorLabel: undefined, universeId: '1' }
		const invalidated = walletSummaryForUniverse(previous, '2')
		expect(invalidated).toEqual({ account: previous.account, ethAttoEth: undefined, repAttoRep: undefined, status: 'loading', error: undefined, errorLabel: undefined, universeId: '2' })
		expect(walletSummaryForUniverse(previous, '1')).toBe(previous)
	})

	test('drops wallet identity whenever live route ownership unmounts or remounts', () => {
		const previous = { account: '0x8ba1f109551bD432803012645Ac136ddd64DBA72' as const, ethAttoEth: 64n * 10n ** 18n, repAttoRep: 12_500n * 10n ** 18n, status: 'ready' as const, error: undefined, errorLabel: undefined, universeId: '1' }
		const detached = walletSummaryAfterRouteChange(previous, 'market', 'help', '1')
		expect(detached.account).toBeUndefined()
		expect(walletSummaryAfterRouteChange(previous, 'market', 'not-found', '1').account).toBeUndefined()
		expect(routeOwnsLiveWallet('not-found')).toBeFalse()
		expect(walletSummaryAfterRouteChange(detached, 'help', 'market', '1')).toEqual(detached)
		expect(walletSummaryAfterRouteChange(previous, 'market', 'portfolio', '1')).toBe(previous)
	})

	test('clears header quantities for a known transaction receipt before reloading', () => {
		expect(walletSummaryRefreshState('0x8ba1f109551bD432803012645Ac136ddd64DBA72', '2')).toEqual({ account: '0x8ba1f109551bD432803012645Ac136ddd64DBA72', ethAttoEth: undefined, repAttoRep: undefined, status: 'loading', error: undefined, errorLabel: undefined, universeId: '2' })
	})

	test('preserves the current market page when retry must rerun discovery', () => {
		expect(walletSummaryDiscoveryRetryStart('error', true, undefined, 50n)).toBe(50n)
		expect(walletSummaryDiscoveryRetryStart('ready', true, 'pool read failed', 75n)).toBe(75n)
		expect(walletSummaryDiscoveryRetryStart('ready', true, undefined, 50n)).toBeUndefined()
	})

	test('falls back to canonical setup without exposing stored configuration errors', async () => {
		window.history.replaceState(undefined, '', '/#/market')
		let attempts = 0
		const rendered = await renderIntoDocument(
			<App
				deploymentSetupServices={{
					createPublicClient: () => {
						throw new Error('No deployment client expected')
					},
					loadCoreDeployments: async () => [],
				}}
				loadLiveDeployment={async () => {
					attempts++
					throw new Error('stored deployment unavailable')
				}}
			/>,
		)
		cleanupRendered = rendered.cleanup
		await act(async () => {
			await Bun.sleep(0)
		})
		expect(rendered.container.textContent).not.toContain('stored deployment unavailable')
		expect(rendered.container.textContent).not.toContain('Retry configuration')
		expect(rendered.container.querySelector('h1')?.textContent).toBe('Deploy')
		expect(rendered.container.querySelector('.trading-wallet-actions .wallet-button')).not.toBeNull()
		expect(rendered.container.querySelector('main .route-header .wallet-button')).toBeNull()
		expect(attempts).toBe(1)
	})
})
