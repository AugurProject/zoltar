import { canonicalExecutorIdentity } from '#execution/executor-identity'
import { afterEach, expect, test } from 'bun:test'
import { Browser, type BrowserWindow, type Element } from 'happy-dom'
import { join } from 'node:path'
import { getAddress, type Address } from '@zoltar/bot-shared/ethereum'
import { startDashboardServer } from '#dashboard/dashboard-server'
import { operatorSnapshot, type MutableStrategy, type OperatorState } from '#state/operator-state'
import example from '../../config/operator.example.json'
import { parseOperatorSettings, serializeOperatorSettings } from '#config/settings-store'
import { validateDeploymentSettings } from '#config/deployment-settings'
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
	let networkConfigured = true
	let deploymentUnavailable = false
	let currentStrategy = strategy(111n)
	let stateGate: Promise<void> | undefined
	let configurationGate: Promise<void> | undefined
	let releaseState: (() => void) | undefined
	let releaseConfiguration: (() => void) | undefined
	let hangProfileResponse = true
	let capable = false
	let stateFailure = true
	const submission = validateSubmissionSettings({ mode: 'public', relayUrls: [] })
	const connectivity = { publicRpcUrls: ['https://rpc.example/'], readRpcUrl: 'https://rpc.example/' }
	const deployment = {
		coordinatorAddresses: [],
		deploymentManifest: undefined,
		executor: undefined,
		openOracle: address,
		quorumRpcUrls: [],
		rep: address,
		uniswapV2Enabled: false,
		uniswapV3Enabled: true,
		uniswapV4Enabled: false,
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
		networkConfigured,
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
		approvedUniverses: [],
		tokenAddresses: [],
	})
	const snapshot = () => {
		const state = operatorState()
		if (deploymentUnavailable) state.marketAvailability = { kind: 'missing-deployment', chainId: 11_155_111, contracts: [{ name: 'Uniswap V3 factory', address }] }
		if (capable) {
			state.paused = false
			state.status = 'running'
			state.lastPollAt = new Date().toISOString()
		}
		state.endpointChecks = [{ chainId: 1, checkedAt: new Date().toISOString(), error: undefined, kind: 'read-rpc', status: 'healthy', target: 'https://mainnet-rpc.example' }]
		state.rpcEndpointHealth = [{ consecutiveFailures: 0, error: undefined, lastFailureAt: undefined, lastSuccessAt: new Date().toISOString(), latencyMilliseconds: 1, nextRetryAt: undefined, status: 'healthy', target: 'https://mainnet-live.example' }]
		return operatorSnapshot(state, currentStrategy, submission, connectivity, {
			deployment,
			execute: false,
			executor: undefined,
			expectedChainId: network === 'mainnet' ? 1 : 11_155_111,
			explorerUrl: network === 'mainnet' ? 'https://etherscan.io' : 'https://sepolia.etherscan.io',
			network,
			networkConfigured,
			openOracle: address,
			queuedWallet: undefined,
			savedWallet: undefined,
			wallet: undefined,
		})
	}
	const server = startDashboardServer(0, {
		getConfiguration: async () => {
			const captured = { configuration: configuration(), revision: `${network}-revision` }
			const gate = configurationGate
			if (gate !== undefined) await gate
			return captured
		},
		getSnapshot: async () => {
			if (stateFailure) throw new Error('State unavailable')
			const captured = snapshot()
			const gate = stateGate
			if (gate !== undefined) await gate
			return captured
		},
		hostname: '127.0.0.1',
		isNetworkConfigured: () => true,
		setPaused: () => undefined,
		switchNetworkProfile: async value => {
			if (typeof value !== 'object' || value === null) throw new Error('Unexpected profile request')
			const requestedNetwork = Reflect.get(value, 'network')
			if (requestedNetwork !== 'mainnet' && requestedNetwork !== 'sepolia') throw new Error('Unexpected profile request')
			if (requestedNetwork === 'sepolia' && hangProfileResponse) {
				hangProfileResponse = false
				network = 'sepolia'
				currentStrategy = strategy(222n)
				return await new Promise<never>(() => {})
			}
			return { network: requestedNetwork }
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
	page.content = (await (await fetch(server.url)).text()).replace('<script type="module" src="/dashboard.js"></script>', '').replace('<script type="module" src="/header-notices.js"></script>', '')
	const window = page.mainFrame.window
	for (const [name, value] of Object.entries({ AbortController, Array, Boolean, Date, Error, Intl, JSON, Map, Math, Number, Object, Promise, Reflect, Set, String, SyntaxError, decodeURIComponent })) Reflect.set(window, name, value)
	const intervalCallbacks: (() => unknown)[] = []
	window.setInterval = handler => {
		if (typeof handler === 'function') intervalCallbacks.push(handler as () => unknown)
		const timeout = window.setTimeout(() => undefined, 1)
		window.clearTimeout(timeout)
		return timeout
	}
	const triggerRefresh = () => {
		const refresh = intervalCallbacks[0]
		if (refresh === undefined) throw new Error('Dashboard did not register its refresh interval')
		refresh()
	}
	const nativeSetTimeout = window.setTimeout.bind(window)
	window.setTimeout = (handler, timeout, ...arguments_) => nativeSetTimeout(handler, timeout === 500 ? 0 : timeout, ...arguments_)
	window.fetch = async (input, init) => {
		const inputUrl = typeof input === 'string' || input instanceof window.URL ? input.toString() : Reflect.get(input, 'url')
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
	expect(element(window, 'launch-notice', window.HTMLElement).hidden).toBe(true)
	expect(element(window, 'capability-badge', window.HTMLElement).textContent).toBe('Capability unavailable')
	expect(element(window, 'attention-badge', window.HTMLElement).dataset['tone']).toBe('warning')
	stateFailure = false
	triggerRefresh()
	await page.waitUntilComplete()
	expect(element(window, 'capability-badge', window.HTMLElement).textContent).toBe('Operator blocked')
	expect(element(window, 'attention-badge', window.HTMLElement).textContent).toBe('1 action')

	capable = true
	triggerRefresh()
	await page.waitUntilComplete()
	expect(element(window, 'capability-badge', window.HTMLElement).hidden).toBe(true)
	expect(element(window, 'attention-badge', window.HTMLElement).dataset['tone']).toBe('ok')
	stateFailure = true
	triggerRefresh()
	await page.waitUntilComplete()
	expect(element(window, 'launch-notice', window.HTMLElement).hidden).toBe(true)
	expect(element(window, 'capability-badge', window.HTMLElement).textContent).toBe('Capability unavailable')
	expect(element(window, 'attention-badge', window.HTMLElement).dataset['tone']).toBe('warning')
	stateFailure = false
	triggerRefresh()
	await page.waitUntilComplete()
	expect(element(window, 'capability-badge', window.HTMLElement).hidden).toBe(true)
	expect(element(window, 'attention-badge', window.HTMLElement).dataset['tone']).toBe('ok')

	capable = false
	triggerRefresh()
	await page.waitUntilComplete()

	stateGate = new Promise(resolve => (releaseState = resolve))
	configurationGate = new Promise(resolve => (releaseConfiguration = resolve))
	triggerRefresh()
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
	for (let attempt = 0; attempt < 200 && !element(window, 'settings-chain-scope', window.HTMLElement).textContent.includes('Sepolia'); attempt++) await Bun.sleep(20)
	expect(element(window, 'settings-chain-scope', window.HTMLElement).textContent).toContain('Sepolia')
	expect(element(window, 'network-name', window.HTMLSelectElement).value).toBe('sepolia')
	expect(element(window, 'network-target-status', window.HTMLElement).hidden).toBe(true)
	expect(element(window, 'strategy-fieldset', window.HTMLFieldSetElement).disabled).toBe(false)
	expect(element(window, 'configuration-fieldset', window.HTMLFieldSetElement).disabled).toBe(false)
	expect(element(window, 'pause-button', window.HTMLButtonElement).disabled).toBe(false)
	expect(element(window, 'endpoint-checks', window.HTMLElement).textContent).not.toContain('Chain 1')
	expect(element(window, 'endpoint-checks', window.HTMLElement).textContent).not.toContain('mainnet')
	const loadedProfitInput = window.document.querySelector('[name="minimumProfitBps"]')
	if (!(loadedProfitInput instanceof window.HTMLInputElement)) throw new Error('Missing minimum profit input')
	expect(loadedProfitInput.value).toBe('222')

	const mainnetSelect = element(window, 'network-name', window.HTMLSelectElement)
	mainnetSelect.value = 'mainnet'
	mainnetSelect.dispatchEvent(new window.Event('change'))
	for (let attempt = 0; attempt < 100 && !element(window, 'connectivity-status', window.HTMLElement).textContent.includes('did not reconnect in time'); attempt++) await Bun.sleep(20)
	expect(element(window, 'connectivity-status', window.HTMLElement).textContent).toBe('The profile was saved, but the dashboard did not reconnect in time. Retry the profile load when the dashboard is available.')
	const profileRetry = element(window, 'profile-switch-retry-button', window.HTMLButtonElement)
	expect(profileRetry.hidden).toBe(false)
	expect(profileRetry.disabled).toBe(false)
	expect(element(window, 'strategy-fieldset', window.HTMLFieldSetElement).disabled).toBe(true)
	network = 'mainnet'
	currentStrategy = strategy(333n)
	profileRetry.click()
	await Bun.sleep(50)
	expect(element(window, 'settings-chain-scope', window.HTMLElement).textContent).toContain('Ethereum mainnet')
	expect(element(window, 'network-name', window.HTMLSelectElement).value).toBe('mainnet')
	expect(element(window, 'network-target-status', window.HTMLElement).hidden).toBe(true)
	expect(element(window, 'strategy-fieldset', window.HTMLFieldSetElement).disabled).toBe(false)
	expect(element(window, 'configuration-fieldset', window.HTMLFieldSetElement).disabled).toBe(false)
	expect(element(window, 'pause-button', window.HTMLButtonElement).disabled).toBe(false)
	const profitInput = window.document.querySelector('[name="minimumProfitBps"]')
	if (!(profitInput instanceof window.HTMLInputElement)) throw new Error('Missing minimum profit input')
	expect(profitInput.value).toBe('333')

	page.evaluate(await (await fetch(new URL('/header-notices.js', server.url))).text())
	networkConfigured = false
	window.history.replaceState({}, '', '/settings')
	window.dispatchEvent(new window.PopStateEvent('popstate'))
	triggerRefresh()
	await page.waitUntilComplete()
	const launchNotice = element(window, 'launch-notice', window.HTMLElement)
	expect(launchNotice.hidden).toBe(false)
	expect(launchNotice.closest('header')).not.toBeNull()
	expect(launchNotice.textContent).toContain('Network setup required')
	expect(launchNotice.textContent).toContain('in Settings')
	networkConfigured = true
	triggerRefresh()
	await page.waitUntilComplete()
	expect(launchNotice.hidden).toBe(true)
	capable = true
	deploymentUnavailable = true
	triggerRefresh()
	await page.waitUntilComplete()
	expect(element(window, 'header-notices-count', window.HTMLElement).textContent).toBe('1')
	expect(element(window, 'header-notices', window.HTMLDetailsElement).open).toBe(false)
	expect(element(window, 'notice-title', window.HTMLElement).textContent).toBe('Deployment unavailable')
	deploymentUnavailable = false
	triggerRefresh()
	await page.waitUntilComplete()
	expect(element(window, 'header-notices-count', window.HTMLElement).textContent).toBe('0')
})

function element<T extends Element>(window: BrowserWindow, id: string, constructor: { new (): T }): T {
	const found = window.document.getElementById(id)
	if (!(found instanceof constructor)) throw new Error(`Missing dashboard element ${id}`)
	return found
}

async function mountDashboard(server: ReturnType<typeof startDashboardServer>, path: string) {
	const browser = new Browser({ settings: { enableJavaScriptEvaluation: true, suppressInsecureJavaScriptEnvironmentWarning: true } })
	browsers.push(browser)
	const page = browser.newPage()
	page.url = new URL(path, server.url).href
	page.content = (await (await fetch(server.url)).text()).replace('<script type="module" src="/dashboard.js"></script>', '').replace('<script type="module" src="/header-notices.js"></script>', '')
	const window = page.mainFrame.window
	for (const [name, value] of Object.entries({ AbortController, Array, Boolean, Date, Error, Intl, JSON, Map, Math, Number, Object, Promise, Reflect, Set, String, SyntaxError, decodeURIComponent })) Reflect.set(window, name, value)
	window.setInterval = () => {
		const timeout = window.setTimeout(() => undefined, 1)
		window.clearTimeout(timeout)
		return timeout
	}
	window.fetch = async (input, init) => {
		const inputUrl = typeof input === 'string' || input instanceof window.URL ? input.toString() : Reflect.get(input, 'url')
		if (typeof inputUrl !== 'string') throw new Error('Unexpected request URL')
		const url = new URL(inputUrl, server.url)
		const response = init?.method === undefined || init.method === 'GET' ? await fetch(url) : await fetch(url, { body: String(init.body), headers: { 'content-type': 'application/json', origin: server.url.origin }, method: init.method })
		return new window.Response(await response.text(), { headers: { 'content-type': response.headers.get('content-type') ?? 'application/json' }, status: response.status })
	}
	const build = await Bun.build({ entrypoints: [join(import.meta.dir, '..', '..', 'src', 'dashboard', 'dashboard.ts')], target: 'browser' })
	const output = build.outputs[0]
	if (!build.success || output === undefined) throw new Error('Could not build dashboard fixture')
	page.evaluate(await output.text())
	await page.waitUntilComplete()
	return { page, window }
}

test('lists skipped reports beside priced ones with their scan reason and token', async () => {
	const settings = parseOperatorSettings({ ...example, network: 'sepolia', networkConfigured: true, connectivity: { publicRpcUrls: ['https://rpc.example/'], readRpcUrl: 'https://rpc.example/' } })
	const state = operatorState()
	state.opportunities = [
		{ decision: 'skipped', reason: '2 pools exceed the 100 tick spot/TWAP limit', reportId: '11', token: address, tokenSymbol: 'REP', timeRemaining: '241', windowUnit: 'seconds' },
		{
			centralizedPriceDeviationBps: undefined,
			decision: 'unprofitable',
			direction: 'sell-rep',
			estimatedNetProfitEth: '-0.0031',
			estimatedNetProfitWeth: '-0.0031',
			executablePriceRepPerEth: '10.284',
			hasRequiredInventory: undefined,
			pool: address,
			poolFee: 3_000,
			reportId: '12',
			requiredToken: '38',
			requiredWeth: '0.151',
			token: address,
			tokenSymbol: 'REP',
			timeRemaining: '27',
			venue: 'uniswap-v3',
			windowUnit: 'blocks',
		},
	]
	const snapshot = () =>
		operatorSnapshot(state, settings.strategy, settings.submission, settings.connectivity, {
			deployment: settings.deployment,
			execute: false,
			executor: undefined,
			expectedChainId: 11_155_111,
			explorerUrl: 'https://sepolia.etherscan.io',
			network: 'sepolia',
			networkConfigured: true,
			openOracle: settings.deployment.openOracle,
			queuedWallet: undefined,
			savedWallet: undefined,
			wallet: undefined,
		})
	const server = startDashboardServer(0, {
		getConfiguration: () => ({ configuration: serializeOperatorSettings(settings), revision: 'fixture' }),
		getSnapshot: snapshot,
		hostname: '127.0.0.1',
		isNetworkConfigured: () => true,
		setPaused: () => undefined,
		updateConnectivity: value => value,
		updateSigner: () => ({ wallet: undefined }),
		updateStrategy: () => snapshot().settings,
		updateSubmission: value => validateSubmissionSettings(value),
	})
	servers.push(server)
	const { window } = await mountDashboard(server, '/operations')
	const body = element(window, 'opportunities-body', window.HTMLTableSectionElement)
	for (let attempt = 0; attempt < 100 && body.children.length < 2; attempt++) await Bun.sleep(10)
	const cells = (rowIndex: number) => Array.from(body.children[rowIndex]?.querySelectorAll('td') ?? [], cell => cell.textContent)
	expect(cells(0)).toEqual(['11', 'skipped', '—', '—', '2 pools exceed the 100 tick spot/TWAP limit', 'WETH/REP', '—', '—', '—', '241 seconds', '—', '—'])
	expect(cells(1).slice(0, 6)).toEqual(['12', 'unprofitable', 'Unavailable', '10.284 REP / ETH', 'Modeled profit is below configured thresholds', 'sell REP'])
	expect(body.children[0]?.querySelector('.decision')?.getAttribute('data-decision')).toBe('skipped')
	expect(element(window, 'opportunity-count', window.HTMLElement).textContent).toBe('1 evaluated · 1 skipped')
	expect(element(window, 'opportunities-empty', window.HTMLElement).hidden).toBe(true)
})

test('deployment form saves venue switches without configurable Uniswap addresses', async () => {
	let settings = parseOperatorSettings({ ...example, network: 'sepolia', networkConfigured: true, connectivity: { publicRpcUrls: ['https://rpc.example/'], readRpcUrl: 'https://rpc.example/' } })
	const snapshot = () =>
		operatorSnapshot(operatorState(), settings.strategy, settings.submission, settings.connectivity, {
			deployment: settings.deployment,
			execute: false,
			executor: undefined,
			expectedChainId: 11_155_111,
			explorerUrl: 'https://sepolia.etherscan.io',
			network: 'sepolia',
			networkConfigured: true,
			openOracle: settings.deployment.openOracle,
			queuedWallet: undefined,
			savedWallet: undefined,
			wallet: undefined,
		})
	const server = startDashboardServer(0, {
		getConfiguration: () => ({ configuration: serializeOperatorSettings(settings), revision: 'fixture' }),
		getSnapshot: snapshot,
		hostname: '127.0.0.1',
		isNetworkConfigured: () => true,
		setPaused: () => undefined,
		updateConnectivity: value => value,
		updateDeployment: value => {
			settings = { ...settings, deployment: validateDeploymentSettings(value, 'sepolia') }
			return settings.deployment
		},
		updateSigner: () => ({ wallet: undefined }),
		updateStrategy: () => snapshot().settings,
		updateSubmission: value => validateSubmissionSettings(value),
	})
	servers.push(server)
	const { page, window } = await mountDashboard(server, '/settings')
	for (let attempt = 0; attempt < 100 && !element(window, 'deployment-v2-enabled', window.HTMLInputElement).checked; attempt++) await Bun.sleep(10)
	const form = element(window, 'deployment-form', window.HTMLFormElement)
	const save = async () => {
		form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
		await page.waitUntilComplete()
		for (let attempt = 0; attempt < 100 && element(window, 'deployment-status', window.HTMLElement).textContent === 'Validating deployment configuration…'; attempt++) await Bun.sleep(10)
		expect(element(window, 'deployment-status', window.HTMLElement).textContent).toContain('Deployment configuration saved')
	}
	expect(form.checkValidity()).toBe(true)
	for (const id of ['deployment-v3-factory', 'deployment-v3-quoter', 'deployment-v3-router', 'deployment-v2-router', 'deployment-v4-pool-manager', 'deployment-v4-quoter']) expect(window.document.getElementById(id)).toBeNull()
	expect(window.document.getElementById('deployment-executor')?.tagName).toBe('P')
	expect(window.document.getElementById('deployment-coordinators')?.tagName).toBe('P')
	expect(window.document.getElementById('create2-salt')).toBeNull()
	await save()
	const restored = () => parseOperatorSettings({ ...JSON.parse(JSON.stringify(serializeOperatorSettings(settings))), network: 'mainnet' }).deployment
	expect(settings.deployment.executor).toBe(canonicalExecutorIdentity().address)
	expect(settings.deployment.uniswapV2Router).toBeUndefined()
	expect(restored().uniswapV2Router).toBe(getAddress('0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'))
	element(window, 'deployment-v2-enabled', window.HTMLInputElement).checked = false
	element(window, 'deployment-v3-enabled', window.HTMLInputElement).checked = false
	element(window, 'deployment-v4-enabled', window.HTMLInputElement).checked = true
	await save()
	expect(settings.deployment.uniswapV4PoolManager).toBeDefined()
	expect(settings.deployment.uniswapV4Quoter).toBeDefined()
	expect(restored().uniswapV2Router).toBeUndefined()
	expect(restored().uniswapRouter).toBeUndefined()
	expect(serializeOperatorSettings(settings).deployment).toEqual({ deploymentManifest: undefined, quorumRpcUrls: [], uniswapV2Enabled: false, uniswapV3Enabled: false, uniswapV4Enabled: true })
	element(window, 'deployment-v2-enabled', window.HTMLInputElement).checked = true
	await save()
	expect(settings.deployment.uniswapV2Router).toBeUndefined()
	expect(restored().uniswapV2Router).toBeDefined()
})
