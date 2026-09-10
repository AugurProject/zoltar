import { beforeEach, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { registerTradingSimulationScenario, TRADING_SIMULATION_SCENARIO } from '../../simulation/index.js'
import { getRegisteredSimulationScenarios } from '@zoltar/ui-core-shared/simulation/scenarios.js'
import { tradingActiveEnvironmentDependencies } from '../../app/activeEnvironment.js'
import * as appCopy from '../../copy/app.js'
import { Status } from '../../components/Status.js'
import { TradingAddressValue } from '../../components/TradingAddress.js'
import { ReadOnlyAddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { fireEvent, waitFor, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { App, currentRoute, tradingNetworkLabel } from '../../app/App.js'
import type { DeploymentConfiguration } from '../../protocol/config.js'
import { getCurrentRouteHash, getRouteHashSearch, resetRoutingForTesting } from '@zoltar/ui-core-shared/navigation/routing.js'
import { getTradingRouteHref, installTradingRouting } from '../../lib/routing.js'
import { getActiveNetworkProfile, installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createFakeBackend, createFakeSimulationProfile } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { createPublicClient, custom } from '@zoltar/core-shared/evm/ethereum'
import { createTradingPublicClient } from '../../protocol/live.js'

beforeEach(() => installTradingRouting())

test('Trading registers its shared TEVM scenario and selects its own worker', () => {
	registerTradingSimulationScenario()
	expect(tradingActiveEnvironmentDependencies.appId).toBe('trading')
	expect(getRegisteredSimulationScenarios()).toContain(TRADING_SIMULATION_SCENARIO)
})

test('Trading installs shared routing for simulation scenario navigation', () => {
	const dom = installDomEnvironment('http://localhost/#/liquidity?simulate=1&simScenario=trading')
	try {
		installTradingRouting()
		expect(getCurrentRouteHash()).toBe('#/liquidity')
		expect(getRouteHashSearch()).toBe('?simulate=1&simScenario=trading')
		expect(currentRoute()).toBe('liquidity')
		expect(getTradingRouteHref('#/markets')).toBe('#/markets?simulate=1&simScenario=trading')
	} finally {
		resetRoutingForTesting()
		dom.cleanup()
	}
})

test('Trading production links preserve the active simulation route query', async () => {
	const productionSources = ['app/App.tsx', 'components/TradingAddress.tsx', 'features/LiveTrading.tsx']
	for (const source of productionSources) {
		const contents = await readFile(join(import.meta.dir, '../..', source), 'utf8')
		expect(contents).not.toMatch(/href=['"]#\//)
	}
})

test('Trading refreshes the active environment when history changes the simulation scenario', async () => {
	const dom = installDomEnvironment('http://localhost/#/markets?simulate=1&simScenario=trading')
	installTradingRouting()
	let environmentInitializations = 0
	const configuration: DeploymentConfiguration = {
		chainId: 31_337,
		chainName: 'Browser Simulation',
		factory: `0x${'22'.repeat(20)}`,
		feeBps: 30,
		router: `0x${'33'.repeat(20)}`,
		rpcUrl: 'http://127.0.0.1/',
		securityPoolFactory: `0x${'11'.repeat(20)}`,
	}
	const rendered = await renderIntoDocument(
		<App
			initializeEnvironment={async () => {
				environmentInitializations += 1
			}}
			loadLiveDeployment={async () => configuration}
		/>,
	)
	try {
		window.history.pushState({}, '', '#/markets?simulate=1&simScenario=baseline')
		window.dispatchEvent(new Event('popstate'))
		await new Promise(resolve => setTimeout(resolve, 10))
		expect(environmentInitializations).toBe(1)
		window.dispatchEvent(new Event('popstate'))
		await new Promise(resolve => setTimeout(resolve, 10))
		expect(environmentInitializations).toBe(1)
	} finally {
		await rendered.cleanup()
		resetRoutingForTesting()
		dom.cleanup()
	}
})

test('Trading force-refreshes the active environment after saving the active network RPC', async () => {
	resetActiveEnvironmentForTesting()
	const dom = installDomEnvironment('http://localhost/#/markets')
	const originalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
	Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: window.localStorage })
	let environmentInitializations = 0
	const configuredClient = createPublicClient({ transport: custom({ request: async () => '0x1' }) })
	let restoreConfiguredEnvironment: (() => void) | undefined
	const rendered = await renderIntoDocument(
		<App
			initializeEnvironment={async () => {
				environmentInitializations += 1
				restoreConfiguredEnvironment?.()
				restoreConfiguredEnvironment = installActiveEnvironmentForTesting({ ...createFakeBackend(), createReadClient: () => configuredClient })
			}}
			loadLiveDeployment={async () => ({
				chainId: 1,
				chainName: 'Ethereum Mainnet',
				factory: `0x${'22'.repeat(20)}`,
				feeBps: 30,
				router: `0x${'33'.repeat(20)}`,
				rpcUrl: 'https://old-rpc.example',
				securityPoolFactory: `0x${'11'.repeat(20)}`,
			})}
		/>,
	)
	try {
		await waitFor(() => expect(rendered.container.textContent).toContain('Ethereum Mainnet'))
		const queries = within(rendered.container)
		await act(async () => fireEvent.click(queries.getByRole('button', { name: 'Settings' })))
		const networkSelect = queries.getByRole('combobox', { name: 'RPC network' }) as HTMLSelectElement
		expect(networkSelect.value).toBe('mainnet')
		expect(getActiveNetworkProfile().id).toBe('mainnet')
		const rpcInput = queries.getByRole('textbox', { name: 'Fallback RPC URL' }) as HTMLInputElement
		rpcInput.value = 'https://new-rpc.example'
		await act(async () => fireEvent.input(rpcInput))
		const saveButton = queries.getByRole('button', { name: 'Save RPC' }) as HTMLButtonElement
		expect(saveButton.disabled).toBe(false)
		await act(async () => saveButton.click())
		expect(globalThis.localStorage.getItem('zoltar.rpcUrls')).toContain('new-rpc.example')
		await waitFor(() => expect(environmentInitializations).toBe(1))
		expect(createTradingPublicClient({ chainId: 1, chainName: 'Ethereum Mainnet', factory: `0x${'22'.repeat(20)}`, feeBps: 30, router: `0x${'33'.repeat(20)}`, rpcUrl: 'https://old-rpc.example', securityPoolFactory: `0x${'11'.repeat(20)}` })).toBe(configuredClient)
	} finally {
		await rendered.cleanup()
		restoreConfiguredEnvironment?.()
		if (originalStorageDescriptor === undefined) Reflect.deleteProperty(globalThis, 'localStorage')
		else Object.defineProperty(globalThis, 'localStorage', originalStorageDescriptor)
		resetActiveEnvironmentForTesting()
		dom.cleanup()
	}
})

test('Trading renders its shell while the environment is still bootstrapping', async () => {
	const dom = installDomEnvironment('http://localhost/#/markets')
	installTradingRouting()
	// A pending waitUntilReady stands in for an unfinished simulation bootstrap. The shell must render
	// anyway; only the deployment lookup waits for it.
	const restoreEnvironment = installActiveEnvironmentForTesting({ ...createFakeBackend(), waitUntilReady: async () => await new Promise<void>(() => undefined) })
	const rendered = await renderIntoDocument(<App initializeEnvironment={async () => undefined} />)
	try {
		await waitFor(() => expect(rendered.container.textContent).toContain('Loading trading contracts'))
		expect(within(rendered.container).queryByRole('alert')).toBe(null)
		expect(within(rendered.container).getByRole('combobox', { name: 'Select universe' }).textContent).toBe('Loading…')
	} finally {
		await rendered.cleanup()
		restoreEnvironment()
		resetActiveEnvironmentForTesting()
		resetRoutingForTesting()
		dom.cleanup()
	}
})

test('Trading issues no chain reads while the environment is bootstrapping', async () => {
	const dom = installDomEnvironment('http://localhost/#/deploy')
	installTradingRouting()
	let readClientRequests = 0
	const restoreEnvironment = installActiveEnvironmentForTesting({
		...createFakeBackend({ profile: createFakeSimulationProfile() }),
		createReadClient: () => {
			readClientRequests += 1
			return createPublicClient({
				transport: custom({
					request: async () => {
						throw new Error('The simulated chain is still bootstrapping')
					},
				}),
			})
		},
		waitUntilReady: async () => await new Promise<void>(() => undefined),
	})
	const rendered = await renderIntoDocument(<App initializeEnvironment={async () => undefined} />)
	try {
		await waitFor(() => expect(rendered.container.textContent).toContain('Deploy trading contracts'))
		// Flush the inspection effect's pending continuations; without the readiness gate it reaches the
		// chain here and reports a missing SecurityPoolFactory against a half-bootstrapped simulation.
		for (let flush = 0; flush < 5; flush += 1) await act(async () => undefined)
		expect(readClientRequests).toBe(0)
		expect(rendered.container.textContent).not.toContain(appCopy.securityPoolFactoryNotDeployed)
	} finally {
		await rendered.cleanup()
		restoreEnvironment()
		resetActiveEnvironmentForTesting()
		resetRoutingForTesting()
		dom.cleanup()
	}
})

test('Trading reports a failed environment on the deployment route', async () => {
	const dom = installDomEnvironment('http://localhost/#/markets')
	installTradingRouting()
	const restoreEnvironment = installActiveEnvironmentForTesting({
		...createFakeBackend({ profile: createFakeSimulationProfile() }),
		waitUntilReady: async () => {
			throw new Error('Simulation scenario bootstrap failed')
		},
	})
	const rendered = await renderIntoDocument(<App initializeEnvironment={async () => undefined} />)
	try {
		await waitFor(() => expect(rendered.container.textContent).toContain('Simulation scenario bootstrap failed'))
		expect(within(rendered.container).getByRole('alert').textContent).toContain('Simulation scenario bootstrap failed')
	} finally {
		await rendered.cleanup()
		restoreEnvironment()
		resetActiveEnvironmentForTesting()
		resetRoutingForTesting()
		dom.cleanup()
	}
})

test('Trading status and address presentation use coreShared primitives', async () => {
	const dom = installDomEnvironment()
	const address = '0x00000000000000000000000000000000000000a1'
	const rendered = await renderIntoDocument(<Status tone='good'>Trading open</Status>)
	expect(rendered.container.querySelector('.badge.status')?.textContent).toContain('Trading open')
	expect(TradingAddressValue({ value: address }).type).toBe(ReadOnlyAddressValue)
	await rendered.cleanup()
	dom.cleanup()
})

test('Trading preserves its route headers and does not restyle shared disclosures', async () => {
	const css = await readFile(join(import.meta.dir, '..', '..', '..', 'css', 'app.css'), 'utf8')
	expect(css).toContain('.route-header {')
	expect(css).toContain('padding: 0;')
	expect(css).toContain('background: transparent;')
	expect(css).toContain('details:not(.simulation-banner-details) > summary::after')
})

test('Trading keeps the initial loading fallback visible until the environment settles', async () => {
	const source = await Bun.file(new URL('../../index.ts', import.meta.url)).text()
	expect(source.indexOf('await initializeTradingActiveEnvironment()')).toBeLessThan(source.indexOf("document.querySelector('body > main')?.remove()"))
	expect(source.indexOf('} finally {')).toBeLessThan(source.indexOf("document.querySelector('body > main')?.remove()"))
	expect(source).toContain('initialize: initializeTradingForMount')
})

test('verified deployment status stays accurate in live and simulated environments', () => {
	const address = '0x00000000000000000000000000000000000000a1'
	const configuration = { chainId: 1, chainName: 'Ethereum', factory: address, feeBps: 30, router: address, rpcUrl: 'https://rpc.example', securityPoolFactory: address, zoltar: address }
	expect(tradingNetworkLabel('verified', configuration, { account: undefined, connecting: false, networkName: undefined, ready: true })).toBe('Ethereum')
	expect(tradingNetworkLabel('verified', configuration, { account: undefined, connecting: false, networkName: 'Sepolia', ready: true })).toBe('Sepolia')
})

test('the removed demo query cannot select a parallel simulated-data application', async () => {
	const dom = installDomEnvironment('http://localhost/?demo=1&scenario=baseline#/markets')
	const configuration: DeploymentConfiguration = {
		chainId: 31_337,
		chainName: 'Browser Simulation',
		factory: `0x${'22'.repeat(20)}`,
		feeBps: 30,
		router: `0x${'33'.repeat(20)}`,
		rpcUrl: 'http://127.0.0.1/',
		securityPoolFactory: `0x${'11'.repeat(20)}`,
	}
	const rendered = await renderIntoDocument(<App loadLiveDeployment={async () => configuration} />)
	await new Promise(resolve => setTimeout(resolve, 10))
	expect(rendered.container.querySelector('.demo-banner')).toBeNull()
	expect(rendered.container.textContent).not.toContain('SIMULATED DATA')
	expect(rendered.container.textContent).not.toContain('Demo mode')
	expect(rendered.container.textContent).toContain('Markets')
	await rendered.cleanup()
	dom.cleanup()
})

test('shared header navigation preserves hash settings once and keeps addressed liquidity context', async () => {
	const pool = '0x1111111111111111111111111111111111111111'
	const search = 'universe=1&network=sepolia&simulate=1&simScenario=trading-funded'
	const dom = installDomEnvironment(`http://localhost/#/market/${pool}?${search}`)
	const rendered = await renderIntoDocument(
		<App
			initializeEnvironment={async () => undefined}
			loadLiveDeployment={async () => {
				throw new Error('Deployment unavailable in navigation fixture')
			}}
		/>,
	)
	try {
		const link = Array.from(rendered.container.querySelectorAll<HTMLAnchorElement>('.tab-nav a')).find(anchor => anchor.textContent === 'Liquidity')
		if (link === undefined) throw new Error('Liquidity link is unavailable')
		const href = link.getAttribute('href')
		expect(href).toBe(`#/liquidity/${pool}?${search}`)
		if (href === null) throw new Error('Liquidity link has no destination')
		await act(() => {
			link.click()
			window.location.hash = href
			window.dispatchEvent(new Event('hashchange'))
		})
		expect(currentRoute()).toBe(`liquidity/${pool}`)
		const select = rendered.container.querySelector<HTMLSelectElement>('.mobile-route-select select')
		if (select === null) throw new Error('Mobile route selector is unavailable')
		await act(() => {
			select.value = 'liquidity'
			select.dispatchEvent(new Event('change', { bubbles: true }))
		})
		expect(window.location.hash).toBe(`#/liquidity/${pool}?${search}`)
		const parameters = new URLSearchParams(window.location.hash.split('?')[1])
		for (const [key, value] of new URLSearchParams(search)) expect(parameters.getAll(key)).toEqual([value])
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})
