import { afterEach, expect, test } from 'bun:test'
import { Browser, type BrowserWindow, type Element } from 'happy-dom'
import { join } from 'node:path'
import type { Address } from '#ethereum'
import { startDashboardServer } from '#dashboard/dashboard-server'
import { operatorSnapshot, type MutableStrategy, type OperatorState } from '#state/operator-state'
import { validateSubmissionSettings } from '#execution/transaction-submission'

const servers: ReturnType<typeof startDashboardServer>[] = []
const browsers: Browser[] = []
const address = '0x0000000000000000000000000000000000000001' as Address

afterEach(async () => {
	for (const server of servers.splice(0)) server.stop(true)
	for (const browser of browsers.splice(0)) await browser.close()
})

function operatorState(): OperatorState {
	return {
		activeReportCount: 0,
		balances: undefined,
		blockNumber: '100',
		blockTimestamp: '1000',
		executionHistory: [],
		endpointChecks: [],
		gameCapital: { eth: '0', totalEthWeth: '0', weth: '0' },
		lastError: undefined,
		lastPollAt: undefined,
		opportunities: [],
		operationLog: [],
		paused: true,
		positions: [],
		priceHistory: [],
		reportPaths: [],
		status: 'paused',
		tokenAddresses: [],
		tokenMarkets: [],
		transactionActivity: [],
	}
}

function strategy(minimumProfitBps: bigint): MutableStrategy {
	return {
		maxSpotTwapTicks: 100n,
		minimumProfitAttoWeth: 10n ** 16n,
		minimumProfitBps,
		minimumRemainingBlocks: 3n,
		minimumRemainingSeconds: 36n,
		pollMilliseconds: 12_000,
		twapSeconds: 1_800,
	}
}

test('keeps all mutations locked and ignores deferred old-chain responses until matching state and configuration arrive', async () => {
	let network: 'mainnet' | 'sepolia' = 'mainnet'
	let currentStrategy = strategy(111n)
	let stateGate: Promise<void> | undefined
	let configurationGate: Promise<void> | undefined
	let releaseState: (() => void) | undefined
	let releaseConfiguration: (() => void) | undefined
	const submission = validateSubmissionSettings({ mode: 'public', relayUrls: [] })
	const connectivity = { publicRpcUrls: ['https://rpc.example/'], readRpcUrl: 'https://rpc.example/' }
	const deployment = {
		coordinatorAddresses: [],
		deploymentManifest: undefined,
		executor: undefined,
		openOracle: address,
		quorumRpcUrls: [],
		rep: address,
		uniswapFactory: address,
		uniswapQuoter: address,
		uniswapRouter: undefined,
		uniswapV2Router: undefined,
		uniswapV4PoolManager: undefined,
		uniswapV4Quoter: undefined,
		weth: address,
	}
	const configuration = () => ({
		centralizedMarkets: {},
		connectivity,
		deployment,
		network,
		networkConfigured: true,
		rpcQuorum: 1,
		strategy: {
			maxSpotTwapTicks: currentStrategy.maxSpotTwapTicks.toString(),
			minimumProfitBps: currentStrategy.minimumProfitBps.toString(),
			minimumProfitWeth: '0.01',
			minimumRemainingBlocks: currentStrategy.minimumRemainingBlocks.toString(),
			minimumRemainingSeconds: currentStrategy.minimumRemainingSeconds.toString(),
			pollMilliseconds: currentStrategy.pollMilliseconds,
			twapSeconds: currentStrategy.twapSeconds,
		},
		submission,
		tokenAddresses: [],
	})
	const snapshot = () =>
		operatorSnapshot(operatorState(), currentStrategy, submission, connectivity, {
			deployment,
			execute: false,
			executor: undefined,
			expectedChainId: network === 'mainnet' ? 1 : 11_155_111,
			explorerUrl: network === 'mainnet' ? 'https://etherscan.io' : 'https://sepolia.etherscan.io',
			network,
			openOracle: address,
			queuedWallet: undefined,
			savedWallet: undefined,
			wallet: undefined,
		})
	const server = startDashboardServer(0, {
		getConfiguration: async () => {
			const captured = { configuration: configuration(), revision: `${network}-revision` }
			const gate = configurationGate
			if (gate !== undefined) await gate
			return captured
		},
		getSnapshot: async () => {
			const captured = snapshot()
			const gate = stateGate
			if (gate !== undefined) await gate
			return captured
		},
		hostname: '127.0.0.1',
		isNetworkConfigured: () => true,
		setPaused: () => undefined,
		switchNetworkProfile: value => {
			if (typeof value !== 'object' || value === null || Reflect.get(value, 'network') !== 'sepolia') throw new Error('Unexpected profile request')
			return { network: 'sepolia' }
		},
		updateConnectivity: value => value,
		updateSigner: () => ({ wallet: undefined }),
		updateStrategy: () => snapshot().settings,
		updateSubmission: value => validateSubmissionSettings(value),
	})
	servers.push(server)
	const browser = new Browser({ settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } })
	browsers.push(browser)
	const page = browser.newPage()
	page.url = server.url.href
	page.content = (await (await fetch(server.url)).text()).replace('<script type="module" src="/dashboard.js"></script>', '')
	const window = page.mainFrame.window
	for (const [name, value] of Object.entries({ AbortController, Array, Boolean, Date, Error, Intl, JSON, Map, Math, Number, Object, Promise, Reflect, Set, String, decodeURIComponent })) Reflect.set(window, name, value)
	window.setInterval = () => {
		const timeout = window.setTimeout(() => undefined, 1)
		window.clearTimeout(timeout)
		return timeout
	}
	const nativeSetTimeout = window.setTimeout.bind(window)
	window.setTimeout = (handler, timeout, ...arguments_) => nativeSetTimeout(handler, timeout === 500 ? 0 : timeout, ...arguments_)
	window.fetch = async (input, init) => {
		const inputUrl = typeof input === 'string' ? input : input instanceof window.URL ? input.href : Reflect.get(input, 'url')
		if (typeof inputUrl !== 'string') throw new Error('Unexpected request URL')
		const url = new URL(inputUrl, server.url)
		const response = init?.method === undefined || init.method === 'GET' ? await fetch(url) : await fetch(url, { body: String(init.body), headers: { 'content-type': 'application/json', origin: server.url.origin }, method: init.method })
		return new window.Response(await response.text(), { headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' }, status: response.status })
	}
	const dashboardBuild = await Bun.build({ entrypoints: [join(import.meta.dir, '..', '..', 'src', 'dashboard', 'dashboard.ts')], target: 'browser' })
	if (!dashboardBuild.success) throw new Error('Could not build the dashboard fixture')
	const dashboardOutput = dashboardBuild.outputs[0]
	if (dashboardOutput === undefined) throw new Error('Dashboard fixture build returned no output')
	page.evaluate(await dashboardOutput.text())
	await page.waitUntilComplete()
	await Bun.sleep(100)
	const initialConfigurationStatus = element(window, 'configuration-status', window.HTMLElement).textContent
	if (!element(window, 'settings-chain-scope', window.HTMLElement).textContent.includes('Ethereum mainnet')) throw new Error(`Initial configuration did not load: ${initialConfigurationStatus}`)
	expect(element(window, 'settings-chain-scope', window.HTMLElement).textContent).toContain('Ethereum mainnet')

	stateGate = new Promise(resolve => (releaseState = resolve))
	configurationGate = new Promise(resolve => (releaseConfiguration = resolve))
	element(window, 'refresh-button', window.HTMLButtonElement).click()
	element(window, 'reload-configuration-button', window.HTMLButtonElement).click()
	await Bun.sleep(10)
	const networkSelect = element(window, 'network-name', window.HTMLSelectElement)
	networkSelect.value = 'sepolia'
	networkSelect.dispatchEvent(new window.Event('change'))
	await Bun.sleep(20)

	expect(networkSelect.value).toBe('mainnet')
	expect(element(window, 'network-target-status', window.HTMLElement).hidden).toBe(false)
	expect(element(window, 'network-target-status', window.HTMLElement).textContent).toBe('Switching from mainnet to sepolia. Existing chain settings remain visible until the new profile loads.')
	expect(element(window, 'strategy-fieldset', window.HTMLFieldSetElement).disabled).toBe(true)
	expect(element(window, 'pause-button', window.HTMLButtonElement).disabled).toBe(true)
	releaseState?.()
	releaseConfiguration?.()
	stateGate = new Promise(resolve => (releaseState = resolve))
	configurationGate = new Promise(resolve => (releaseConfiguration = resolve))
	await Bun.sleep(20)
	expect(networkSelect.value).toBe('mainnet')
	expect(element(window, 'settings-chain-scope', window.HTMLElement).textContent).toContain('Ethereum mainnet')
	expect(element(window, 'strategy-fieldset', window.HTMLFieldSetElement).disabled).toBe(true)

	releaseState?.()
	releaseConfiguration?.()
	stateGate = undefined
	configurationGate = undefined
	for (let attempt = 0; attempt < 100 && !element(window, 'connectivity-status', window.HTMLElement).textContent.includes('did not reconnect in time'); attempt++) await Bun.sleep(20)
	expect(element(window, 'connectivity-status', window.HTMLElement).textContent).toBe('The profile was saved, but the dashboard did not reconnect in time. Retry the profile load when the dashboard is available.')
	const profileRetry = element(window, 'profile-switch-retry-button', window.HTMLButtonElement)
	expect(profileRetry.hidden).toBe(false)
	expect(profileRetry.disabled).toBe(false)
	expect(element(window, 'strategy-fieldset', window.HTMLFieldSetElement).disabled).toBe(true)
	network = 'sepolia'
	currentStrategy = strategy(222n)
	profileRetry.click()
	await Bun.sleep(50)
	expect(element(window, 'settings-chain-scope', window.HTMLElement).textContent).toContain('Sepolia')
	expect(element(window, 'network-name', window.HTMLSelectElement).value).toBe('sepolia')
	expect(element(window, 'network-target-status', window.HTMLElement).hidden).toBe(true)
	expect(element(window, 'strategy-fieldset', window.HTMLFieldSetElement).disabled).toBe(false)
	expect(element(window, 'configuration-fieldset', window.HTMLFieldSetElement).disabled).toBe(false)
	expect(element(window, 'pause-button', window.HTMLButtonElement).disabled).toBe(false)
	const profitInput = window.document.querySelector('[name="minimumProfitBps"]')
	if (!(profitInput instanceof window.HTMLInputElement)) throw new Error('Missing minimum profit input')
	expect(profitInput.value).toBe('222')
})

function element<T extends Element>(window: BrowserWindow, id: string, constructor: { new (): T }): T {
	const found = window.document.getElementById(id)
	if (!(found instanceof constructor)) throw new Error(`Missing dashboard element ${id}`)
	return found
}
