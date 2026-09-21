import { emptySettlementSnapshot, parseSettlementSettings, settlementSettings, settlementSnapshot } from '#state/settlement-store'
import { canonicalExecutorIdentity } from '#execution/executor-identity'
import { afterEach, expect, test } from 'bun:test'
import { Browser, type BrowserWindow, type Element } from 'happy-dom'
import { join } from 'node:path'
import { getAddress, type Address } from '@zoltar/bot-shared/ethereum'
import { startDashboardServer } from '#dashboard/dashboard-server'
import { operatorSnapshot, type MutableStrategy, type OperatorState, type QueuedSettingsSection } from '#state/operator-state'
import example from '../../config/operator.example.json'
import { parseOperatorSettings, parseRuntimeLimitsRequest, parseStoredCentralizedMarkets, serializeOperatorSettings, serializeRuntimeLimits, serializeStoredCentralizedMarkets } from '#config/settings-store'
import { mergeStoredDeploymentUpdate } from '#config/deployment-settings'
import { requiredDeploymentRoles } from '#config/deployment-roles'
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
		settlements: emptySettlementSnapshot(),
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
		runtime: example.runtime,
		settlement: example.settlement,
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
	const triggerRefresh = stubIntervals(window)
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

/** Replaces the dashboard's polling intervals with a manual trigger so each test decides when a refresh happens. */
function stubIntervals(window: BrowserWindow) {
	const intervalCallbacks: (() => unknown)[] = []
	window.setInterval = handler => {
		if (typeof handler === 'function') intervalCallbacks.push(() => void handler())
		const timeout = window.setTimeout(() => undefined, 1)
		window.clearTimeout(timeout)
		return timeout
	}
	return () => {
		const refresh = intervalCallbacks[0]
		if (refresh === undefined) throw new Error('Dashboard did not register its refresh interval')
		refresh()
	}
}

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
	const triggerRefresh = stubIntervals(window)
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
	return { page, triggerRefresh, window }
}

test('pending executor deployment recovery owns the overview notice, the executor form, and the resume refusal until it is reconciled', async () => {
	const settings = parseOperatorSettings({
		...example,
		connectivity: { publicRpcUrls: ['https://rpc.example/'], readRpcUrl: 'https://rpc.example/' },
		network: 'sepolia',
		networkConfigured: true,
	})
	const transactionHash = `0x${'ab'.repeat(32)}` as const
	let recovery: { transactionHash: typeof transactionHash } | undefined = { transactionHash }
	// The bot refuses from its on-disk journal, which it can see before the dashboard's next poll reports the recovery.
	let refusal: string | undefined = 'Recover the pending executor deployment before resuming execution'
	let paused = true
	const pauseRequests: boolean[] = []
	const snapshot = () =>
		operatorSnapshot({ ...operatorState(), paused, status: paused ? 'paused' : 'running' }, settings.strategy, settings.submission, settings.connectivity, {
			deployment: settings.deployment,
			execute: false,
			executor: address,
			executorDeploymentRecovery: recovery,
			expectedChainId: 11_155_111,
			explorerUrl: 'https://sepolia.etherscan.io',
			network: 'sepolia',
			networkConfigured: true,
			openOracle: settings.deployment.openOracle,
			queuedWallet: undefined,
			savedWallet: undefined,
			wallet: address,
		})
	const server = startDashboardServer(0, {
		getConfiguration: () => ({ configuration: serializeOperatorSettings(settings), revision: 'fixture' }),
		getSnapshot: snapshot,
		hostname: '127.0.0.1',
		isNetworkConfigured: () => true,
		setPaused: paused => {
			pauseRequests.push(paused)
			if (!paused && refusal !== undefined) throw new Error(refusal)
		},
		deployExecutor: () => {
			recovery = undefined
			refusal = undefined
			return { address, alreadyDeployed: true, transactionHash }
		},
		predictExecutor: () => ({ address, salt: `0x${'00'.repeat(32)}` }),
		updateConnectivity: value => value,
		updateSigner: () => ({ wallet: address }),
		updateStrategy: () => snapshot().settings,
		updateSubmission: value => validateSubmissionSettings(value),
	})
	servers.push(server)
	const { page, triggerRefresh, window } = await mountDashboard(server, '/overview')
	const noticeTitle = element(window, 'notice-title', window.HTMLElement)
	const noticeCopy = element(window, 'notice-copy', window.HTMLElement)
	const executorRecovery = element(window, 'create2-recovery', window.HTMLElement)
	for (let attempt = 0; attempt < 100 && noticeTitle.textContent !== 'Executor deployment recovery required'; attempt++) await Bun.sleep(10)
	expect(noticeTitle.textContent).toBe('Executor deployment recovery required')
	expect(noticeCopy.textContent).toContain(`Executor deployment ${transactionHash.slice(0, 10)}…${transactionHash.slice(-8)}`)
	expect(noticeCopy.textContent).toContain('Run Deploy predictable executor under Settings › Venues and executor with the same signer')
	expect(element(window, 'notice', window.HTMLElement).dataset['tone']).toBe('danger')
	expect(executorRecovery.hidden).toBe(false)
	expect(element(window, 'create2-recovery-copy', window.HTMLElement).textContent).toBe(
		`The executor deployment was signed but its receipt was never confirmed. Deploying again with the same signer confirms or rebroadcasts it; Resume stays blocked until then. Transaction ${transactionHash.slice(0, 8)}…${transactionHash.slice(-6)}`,
	)
	const recoveryTransaction = element(window, 'create2-recovery-copy', window.HTMLElement).querySelector('a')
	expect(recoveryTransaction?.getAttribute('href')).toBe(`https://sepolia.etherscan.io/tx/${transactionHash}`)
	expect(recoveryTransaction?.getAttribute('title')).toBe(transactionHash)
	const executorReadiness = () => Array.from(element(window, 'execution-checklist', window.HTMLUListElement).children).find(item => item.querySelector('.readiness-label')?.textContent === 'Executor')
	for (let attempt = 0; attempt < 100 && executorReadiness() === undefined; attempt++) await Bun.sleep(10)
	expect(executorReadiness()?.getAttribute('data-ready')).toBe('false')
	expect(executorReadiness()?.querySelector('strong')?.textContent).toBe('Recover the pending deployment under Venues and executor')

	// The refused resume names the recovery step and stays on the notice across later polls instead of reverting to "Bot paused".
	const pauseButton = element(window, 'pause-button', window.HTMLButtonElement)
	expect(pauseButton.disabled).toBe(false)
	pauseButton.click()
	for (let attempt = 0; attempt < 100 && noticeTitle.textContent !== 'Unable to change bot state'; attempt++) await Bun.sleep(10)
	expect(pauseRequests).toEqual([false])
	const refusalCopy = 'Recover the pending executor deployment before resuming execution. Run Deploy predictable executor under Settings › Venues and executor with the same signer to confirm or rebroadcast it.'
	expect(noticeTitle.textContent).toBe('Unable to change bot state')
	expect(noticeCopy.textContent).toBe(refusalCopy)
	triggerRefresh()
	await page.waitUntilComplete()
	await Bun.sleep(20)
	expect(noticeTitle.textContent).toBe('Unable to change bot state')
	expect(noticeCopy.textContent).toBe(refusalCopy)

	// Reconciling the deployment from another dashboard client retires the refusal on the next poll; the snapshot notice takes over and every recovery surface clears.
	recovery = undefined
	refusal = undefined
	triggerRefresh()
	await page.waitUntilComplete()
	for (let attempt = 0; attempt < 100 && noticeTitle.textContent === 'Unable to change bot state'; attempt++) await Bun.sleep(10)
	expect(noticeTitle.textContent).toBe('Bot paused')
	expect(executorRecovery.hidden).toBe(true)
	expect(executorReadiness()?.querySelector('strong')?.textContent).toBe('Waiting for the first scan')

	// A refusal that lands before the poll reports the journal is kept until a poll has shown the recovery and a later one shows it cleared.
	refusal = 'Recover the pending executor deployment before resuming execution'
	pauseButton.click()
	for (let attempt = 0; attempt < 100 && noticeTitle.textContent !== 'Unable to change bot state'; attempt++) await Bun.sleep(10)
	expect(pauseRequests).toEqual([false, false])
	expect(noticeCopy.textContent).toBe(refusalCopy)
	triggerRefresh()
	await page.waitUntilComplete()
	await Bun.sleep(20)
	expect(noticeTitle.textContent).toBe('Unable to change bot state')

	// Deploying from this page clears that refusal even though no poll ever showed the journal, so a later poll cannot revive it.
	Reflect.set(window, 'confirm', () => true)
	element(window, 'create2-form', window.HTMLFormElement).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
	await page.waitUntilComplete()
	for (let attempt = 0; attempt < 100 && noticeTitle.textContent === 'Unable to change bot state'; attempt++) await Bun.sleep(10)
	expect(element(window, 'create2-status', window.HTMLElement).textContent).toBe(`Verified existing executor at ${address}.`)
	expect(noticeTitle.textContent).toBe('Bot paused')
	expect(executorRecovery.hidden).toBe(true)
	triggerRefresh()
	await page.waitUntilComplete()
	await Bun.sleep(20)
	expect(noticeTitle.textContent).toBe('Bot paused')

	pauseButton.click()
	for (let attempt = 0; attempt < 100 && pauseRequests.length < 3; attempt++) await Bun.sleep(10)
	await page.waitUntilComplete()
	expect(pauseRequests).toEqual([false, false, false])
	expect(noticeTitle.textContent).toBe('Bot paused')

	// Any refusal retires once a poll shows the requested run state applied after all, for example by another client.
	refusal = 'Configure the chain and RPC endpoints before resuming'
	pauseButton.click()
	for (let attempt = 0; attempt < 100 && noticeTitle.textContent !== 'Unable to change bot state'; attempt++) await Bun.sleep(10)
	expect(noticeCopy.textContent).toBe('Configure the chain and RPC endpoints before resuming')
	triggerRefresh()
	await page.waitUntilComplete()
	await Bun.sleep(20)
	expect(noticeTitle.textContent).toBe('Unable to change bot state')
	paused = false
	triggerRefresh()
	await page.waitUntilComplete()
	for (let attempt = 0; attempt < 100 && noticeTitle.textContent === 'Unable to change bot state'; attempt++) await Bun.sleep(10)
	// The fixture has no completed poll yet, so the snapshot's own readiness notice takes over instead of the refusal.
	expect(noticeTitle.textContent).toBe('Operator not ready')
})

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
	const coordinator = `0x${'c'.repeat(40)}` as Address
	const settlementHash = `0x${'5'.repeat(64)}` as const
	state.settlements = settlementSnapshot({
		now: new Date('2026-09-19T10:05:00.000Z'),
		queue: [
			{ callbackGasLimit: '4000000', coordinator, decision: 'dry-run-settlement', elapsed: '95', projectedGasCostEth: '0.008746984', projectedNetEth: '0.008296326270400101', reportId: '11', rewardEth: '0.017043310270400101', token: address, tokenSymbol: 'REP', windowUnit: 'seconds' },
			{ callbackGasLimit: '4000000', coordinator, decision: 'settled', elapsed: '3', projectedGasCostEth: '0.008', projectedNetEth: '0.009', reportId: '10', rewardEth: '0.017', token: address, tokenSymbol: 'REP', windowUnit: 'seconds' },
		],
		records: [
			{
				account: address,
				actualGasCostEth: '0.004',
				coordinator,
				finalized: true,
				kind: 'settlement',
				lastValidBlockNumber: '115',
				minedAt: '2026-09-19T10:01:00.000Z',
				nonce: '7',
				projectedGasCostEth: '0.0087',
				receiptBlock: { hash: settlementHash, number: '91' },
				replacedBy: undefined,
				reportId: '9',
				rewardEth: '0.017',
				status: 'confirmed',
				submissionBlockNumber: '90',
				submissionMode: 'public',
				submittedAt: '2026-09-19T10:00:00.000Z',
				transactionHash: settlementHash,
				transactionIntent: { data: '0x', to: address, value: '0' },
				updatedAt: '2026-09-19T10:01:00.000Z',
			},
		],
		settings: { ...parseSettlementSettings(undefined), enabled: true },
		unclaimedRewardAttoEth: 17n * 10n ** 15n,
		withdrawalDecision: 'dry-run',
	})
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
	const settlementQueue = element(window, 'settlement-queue-body', window.HTMLTableSectionElement)
	for (let attempt = 0; attempt < 100 && settlementQueue.children.length < 2; attempt++) await Bun.sleep(10)
	const settlementCells = (bodyId: string) => Array.from(element(window, bodyId, window.HTMLTableSectionElement).children[0]?.querySelectorAll('td') ?? [], cell => cell.textContent)
	expect(settlementCells('settlement-queue-body')).toEqual(['11', 'dry run settlement', 'Reward covers gas and the minimum net; execution mode is disabled', '0.017043310270400101 ETH', '0.008746984 ETH', '0.008296326270400101 ETH', '95 seconds', 'WETH/REP', `${coordinator.slice(0, 8)}…${coordinator.slice(-6)}`])
	expect(settlementCells('settlement-history-body').slice(1, 7)).toEqual(['settle', '9', 'confirmed', '0.017 ETH', '0.0087 ETH', '0.004 ETH'])
	expect(element(window, 'settlement-count', window.HTMLElement).textContent).toBe('1 awaiting settlement')
	expect(element(window, 'settlement-history-count', window.HTMLElement).textContent).toBe('1 transaction')
	expect(element(window, 'settlement-summary', window.HTMLElement).textContent).toContain('0.017 ETH · withdrawal waits for execution mode')
	expect(element(window, 'settlement-summary', window.HTMLElement).textContent).not.toContain('withdrawal due')
	expect(element(window, 'settlement-summary', window.HTMLElement).textContent).toContain('0.013 ETH')
	expect(element(window, 'settlement-summary', window.HTMLElement).textContent).toContain('0.013 ETH')
	expect(element(window, 'settlement-queue-empty', window.HTMLElement).hidden).toBe(true)
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
			settings = { ...settings, deployment: mergeStoredDeploymentUpdate(settings.deployment, value, 'sepolia') }
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
		for (let attempt = 0; attempt < 100 && element(window, 'deployment-status', window.HTMLElement).textContent === 'Validating venues…'; attempt++) await Bun.sleep(10)
		expect(element(window, 'deployment-status', window.HTMLElement).textContent).toContain('Venues saved')
	}
	expect(form.checkValidity()).toBe(true)
	for (const id of ['deployment-v3-factory', 'deployment-v3-quoter', 'deployment-v3-router', 'deployment-v2-router', 'deployment-v4-pool-manager', 'deployment-v4-quoter']) expect(window.document.getElementById(id)).toBeNull()
	expect(window.document.getElementById('deployment-executor')?.tagName).toBe('P')
	expect(window.document.getElementById('deployment-coordinators')?.tagName).toBe('P')
	expect(window.document.getElementById('create2-salt')).toBeNull()
	expect(window.document.getElementById('deployment-quorum-rpcs')).toBeNull()
	expect(element(window, 'quorum-rpc-urls', window.HTMLTextAreaElement).closest('form')?.id).toBe('connectivity-form')
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
	expect(serializeOperatorSettings(settings).deployment).toEqual({ quorumRpcUrls: [], uniswapV2Enabled: false, uniswapV3Enabled: false, uniswapV4Enabled: true })
	element(window, 'deployment-v2-enabled', window.HTMLInputElement).checked = true
	await save()
	expect(settings.deployment.uniswapV2Router).toBeUndefined()
	expect(restored().uniswapV2Router).toBeDefined()
})

test('focused risk, settlement, execution, and market forms load the saved configuration and save through their endpoints', async () => {
	let settings = parseOperatorSettings({ ...example, network: 'sepolia', networkConfigured: true, connectivity: { publicRpcUrls: ['https://rpc.example/'], readRpcUrl: 'https://rpc.example/' } })
	const executionRequests: unknown[] = []
	const queued: QueuedSettingsSection[] = []
	let holdRuntimeSave: Promise<void> | undefined
	const snapshot = () =>
		operatorSnapshot(
			operatorState(),
			settings.strategy,
			settings.submission,
			settings.connectivity,
			{
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
			},
			settings.runtime.riskLimits,
			queued,
		)
	const server = startDashboardServer(0, {
		getConfiguration: () => ({ configuration: serializeOperatorSettings(settings), revision: 'fixture' }),
		getSnapshot: snapshot,
		hostname: '127.0.0.1',
		isNetworkConfigured: () => true,
		setPaused: () => undefined,
		updateCentralizedMarkets: value => {
			settings = { ...settings, centralizedMarkets: parseStoredCentralizedMarkets(value, settings.deployment.rep, settings.network) }
			return serializeStoredCentralizedMarkets(settings.centralizedMarkets)
		},
		updateConnectivity: value => value,
		updateExecution: value => {
			executionRequests.push(value)
			throw new Error('Execution requires an active signer')
		},
		updateRuntimeLimits: async value => {
			settings = { ...settings, runtime: { ...settings.runtime, ...parseRuntimeLimitsRequest(value) } }
			queued.push('risk')
			if (holdRuntimeSave !== undefined) await holdRuntimeSave
			return serializeRuntimeLimits(settings.runtime)
		},
		updateSettlement: value => {
			settings = { ...settings, settlement: parseSettlementSettings(value) }
			queued.push('settlement')
			return settlementSettings(settings.settlement)
		},
		updateSigner: () => ({ wallet: undefined }),
		updateStrategy: () => snapshot().settings,
		updateSubmission: value => validateSubmissionSettings(value),
	})
	servers.push(server)
	const { page, window } = await mountDashboard(server, '/settings')
	const runtimeInput = (name: string) => {
		const found = element(window, 'runtime-form', window.HTMLFormElement).querySelector(`[name="${name}"]`)
		if (!(found instanceof window.HTMLInputElement)) throw new Error(`Missing runtime input ${name}`)
		return found
	}
	const settlementInput = (name: string) => {
		const found = element(window, 'settlement-form', window.HTMLFormElement).querySelector(`[name="${name}"]`)
		if (!(found instanceof window.HTMLInputElement)) throw new Error(`Missing settlement input ${name}`)
		return found
	}
	for (let attempt = 0; attempt < 100 && runtimeInput('maxTotalLockedWeth').value === ''; attempt++) await Bun.sleep(10)
	for (const id of ['runtime-fieldset', 'settlement-fieldset', 'execution-fieldset', 'market-fieldset']) expect(element(window, id, window.HTMLFieldSetElement).disabled).toBe(false)
	expect(runtimeInput('maxPositionNotionalWeth').value).toBe('5')
	expect(runtimeInput('maxTotalLockedWeth').value).toBe('10')
	expect(runtimeInput('maxConcurrentPositions').value).toBe('1')
	expect(runtimeInput('maxDailyGasSpendWeth').value).toBe('0.05')
	expect(runtimeInput('lifecycleGasReserveWeth').value).toBe('0.01')
	expect(runtimeInput('maxHedgeSlippageBps').value).toBe('50')
	expect(runtimeInput('lookbackBlocks').value).toBe('256')
	expect(element(window, 'settlement-enabled', window.HTMLInputElement).checked).toBe(false)
	expect(settlementInput('settlementMinimumProfitWeth').value).toBe('0.001')
	expect(settlementInput('settlementMaxGasPriceNanoEth').value).toBe('50')
	expect(settlementInput('settlementRewardWithdrawThresholdEth').value).toBe('0.01')
	expect(element(window, 'execution-enabled', window.HTMLInputElement).checked).toBe(false)
	// Usage beside the caps, the settlement queue in the panel summary, and the go-live checklist all read the snapshot.
	expect(element(window, 'usage-locked', window.HTMLElement).textContent).toBe('0 WETH / 10 WETH')
	expect(element(window, 'usage-positions', window.HTMLElement).textContent).toBe('0 / 1')
	expect(element(window, 'settlement-panel-summary', window.HTMLElement).textContent).toBe('Disabled · 0 reports awaiting settlement')
	const checklist = () => Array.from(element(window, 'execution-checklist', window.HTMLUListElement).children, item => `${item.getAttribute('data-ready') ?? ''}:${item.querySelector('.readiness-label')?.textContent ?? ''}`)
	// No scan has inspected the chain yet, so the on-chain rows wait; pool coordinators are advisory and never block arming.
	expect(checklist()).toEqual(['false:Execution signer', 'true:Independent quorum RPCs', 'true:Trading venue', 'false:Executor', 'false:Canonical contracts', 'true:Delivery', 'false:Pool coordinators'])
	expect(Array.from(element(window, 'execution-checklist', window.HTMLUListElement).children, item => item.getAttribute('data-advisory'))).toEqual([null, null, null, null, null, null, 'true'])
	expect(window.document.getElementById('manifest-configuration')).toBeNull()
	expect(window.document.getElementById('manifest-form')).toBeNull()
	expect(element(window, 'execution-mode-summary', window.HTMLElement).textContent).toBe('Dry run · prerequisites missing')
	expect(element(window, 'execution-enabled', window.HTMLInputElement).disabled).toBe(true)
	const marketRows = () => Array.from(element(window, 'market-source-rows', window.HTMLTableSectionElement).querySelectorAll('tr'))
	expect(marketRows()).toHaveLength(0)
	expect(element(window, 'market-sources-empty', window.HTMLElement).hidden).toBe(false)
	const marketInput = (name: string) => {
		const found = element(window, 'market-form', window.HTMLFormElement).querySelector(`[name="${name}"]`)
		if (!(found instanceof window.HTMLInputElement)) throw new Error(`Missing market input ${name}`)
		return found
	}
	expect(marketInput('minimumSourceCount').value).toBe('2')
	// Browser-side bounds mirror the parser so a rejected value never needs a round trip to explain itself.
	expect([marketInput('minimumSourceCount').min, marketInput('minimumSourceCount').max]).toEqual(['1', '100'])
	expect([marketInput('maximumObservationAgeMilliseconds').min, marketInput('maximumObservationAgeMilliseconds').max]).toEqual(['1000', '3600000'])
	expect([marketInput('requestTimeoutMilliseconds').min, marketInput('requestTimeoutMilliseconds').max]).toEqual(['250', '60000'])
	expect(window.document.querySelector('#settings-nav a[aria-current="true"]')?.getAttribute('data-settings-target')).toBe('settings-connect')
	expect(marketInput('minimumBidDepthEth').value).toBe('2')
	expect(element(window, 'market-required', window.HTMLInputElement).checked).toBe(false)
	expect(JSON.parse(element(window, 'market-venue-consensus-json', window.HTMLTextAreaElement).value)).toEqual(serializeStoredCentralizedMarkets(settings.centralizedMarkets).venueConsensus)

	// Save buttons stay disabled until an edit differs from the loaded values; the panel summary shows the unsaved state.
	const saveButton = (formId: string) => {
		const found = element(window, formId, window.HTMLFormElement).querySelector('button[type="submit"]')
		if (!(found instanceof window.HTMLButtonElement)) throw new Error(`Missing save button for ${formId}`)
		return found
	}
	const badges = (formId: string) => Array.from(window.document.querySelectorAll(`.settings-badges[data-form="${formId}"] .settings-badge`), badge => badge.textContent)
	expect(saveButton('runtime-form').disabled).toBe(true)
	expect(badges('runtime-form')).toEqual([])
	runtimeInput('maxTotalLockedWeth').value = '12.5'
	runtimeInput('maxTotalLockedWeth').dispatchEvent(new window.Event('input', { bubbles: true }))
	expect(saveButton('runtime-form').disabled).toBe(false)
	expect(badges('runtime-form')).toEqual(['Unsaved changes'])

	const submit = async (formId: string, statusId: string, pendingMessage: string) => {
		element(window, formId, window.HTMLFormElement).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
		await page.waitUntilComplete()
		for (let attempt = 0; attempt < 100 && element(window, statusId, window.HTMLElement).textContent === pendingMessage; attempt++) await Bun.sleep(10)
		return element(window, statusId, window.HTMLElement).textContent
	}

	runtimeInput('maxConcurrentPositions').value = '2'
	runtimeInput('lookbackBlocks').value = '64'
	// While the save is in flight the form is still dirty, yet a re-evaluation (as every snapshot refresh performs) must not re-enable Save.
	let releaseRuntimeSave: (() => void) | undefined
	holdRuntimeSave = new Promise(resolve => {
		releaseRuntimeSave = resolve
	})
	element(window, 'runtime-form', window.HTMLFormElement).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
	await Bun.sleep(30)
	expect(element(window, 'runtime-status', window.HTMLElement).textContent).toBe('Saving risk limits…')
	// The whole fieldset locks during the request, so a later edit cannot be replaced silently by the response.
	expect(element(window, 'runtime-fieldset', window.HTMLFieldSetElement).disabled).toBe(true)
	runtimeInput('maxTotalLockedWeth').dispatchEvent(new window.Event('input', { bubbles: true }))
	expect(saveButton('runtime-form').disabled).toBe(true)
	releaseRuntimeSave?.()
	holdRuntimeSave = undefined
	for (let attempt = 0; attempt < 100 && element(window, 'runtime-status', window.HTMLElement).textContent === 'Saving risk limits…'; attempt++) await Bun.sleep(10)
	expect(element(window, 'runtime-status', window.HTMLElement).textContent).toBe('Risk limits saved.')
	expect(element(window, 'runtime-fieldset', window.HTMLFieldSetElement).disabled).toBe(false)
	expect(settings.runtime.riskLimits.maxTotalLockedAttoWeth).toBe(125n * 10n ** 17n)
	expect(settings.runtime.riskLimits.maxConcurrentPositions).toBe(2)
	expect(settings.runtime.lookbackBlocks).toBe(64n)
	expect(settings.runtime.execute).toBe(false)
	expect(saveButton('runtime-form').disabled).toBe(true)
	expect(badges('runtime-form')).toEqual(['Queued · next scan'])
	runtimeInput('maxPositionNotionalWeth').value = '20'
	expect(await submit('runtime-form', 'runtime-status', 'Saving risk limits…')).toBe('Runtime maxPositionNotionalAttoWeth cannot exceed maxTotalLockedAttoWeth')
	expect(settings.runtime.riskLimits.maxPositionNotionalAttoWeth).toBe(5n * 10n ** 18n)
	expect(saveButton('runtime-form').disabled).toBe(false)

	element(window, 'settlement-enabled', window.HTMLInputElement).checked = true
	settlementInput('settlementMaxGasPriceNanoEth').value = '30'
	expect(await submit('settlement-form', 'settlement-status', 'Saving settlement…')).toBe('Settlement enabled.')
	expect(settings.settlement).toEqual({ enabled: true, maxGasPriceAttoEthPerGas: 30n * 10n ** 9n, minimumProfitAttoWeth: 10n ** 15n, rewardWithdrawThresholdAttoEth: 10n ** 16n })
	expect(element(window, 'settlement-enabled', window.HTMLInputElement).checked).toBe(true)
	// The running bot still reports the old value until the boundary, so the summary names the saved switch instead.
	for (let attempt = 0; attempt < 100 && !element(window, 'settlement-panel-summary', window.HTMLElement).textContent.startsWith('Enabling'); attempt++) await Bun.sleep(10)
	expect(element(window, 'settlement-panel-summary', window.HTMLElement).textContent).toBe('Enabling at the next scan · 0 reports awaiting settlement')
	settlementInput('settlementRewardWithdrawThresholdEth').value = '0'
	expect(await submit('settlement-form', 'settlement-status', 'Saving settlement…')).toBe('Settlement rewardWithdrawThresholdEth must be from 0.000000000000000001 to 100')
	expect(settings.settlement.rewardWithdrawThresholdAttoEth).toBe(10n ** 16n)

	// The switch is locked while prerequisites are missing; a direct submit is still rejected by the bot and reset.
	element(window, 'execution-enabled', window.HTMLInputElement).checked = true
	expect(await submit('execution-form', 'execution-status', 'Saving execution mode…')).toBe('Execution requires an active signer')
	expect(executionRequests).toEqual([{ execute: true }])
	expect(element(window, 'execution-mode-summary', window.HTMLElement).textContent).toBe('Dry run · prerequisites missing')
	expect(element(window, 'execution-enabled', window.HTMLInputElement).checked).toBe(false)

	// The source table and thresholds rebuild the stored document; the bot binds the asset identity to the chain.
	element(window, 'market-source-add', window.HTMLButtonElement).click()
	expect(marketRows()).toHaveLength(1)
	expect(element(window, 'market-sources-empty', window.HTMLElement).hidden).toBe(true)
	expect(saveButton('market-form').disabled).toBe(false)
	const rowInput = (name: string) => {
		const found = marketRows()[0]?.querySelector(`[name="${name}"]`)
		if (!(found instanceof window.HTMLInputElement)) throw new Error(`Missing source input ${name}`)
		return found
	}
	rowInput('sourceExchangeId').value = 'kraken'
	rowInput('sourceExchangeId').dispatchEvent(new window.Event('input', { bubbles: true }))
	expect(marketRows()[0]?.querySelector('button')?.getAttribute('aria-label')).toBe('Remove kraken')
	rowInput('sourceRepMarket').value = 'REP/USDT'
	rowInput('sourceEthMarket').value = 'ETH/USDT'
	marketInput('minimumSourceCount').value = '1'
	expect(await submit('market-form', 'market-status', 'Validating market sources…')).toBe('Market sources saved.')
	expect(settings.centralizedMarkets.sources).toEqual([{ ethMarket: 'ETH/USDT', exchangeId: 'kraken', repMarket: 'REP/USDT' }])
	expect(settings.centralizedMarkets.minimumSourceCount).toBe(1)
	expect(settings.centralizedMarkets.assetAddress).toBe(settings.deployment.rep)
	expect(marketRows()).toHaveLength(1)
	expect(saveButton('market-form').disabled).toBe(true)
	rowInput('sourceEthMarket').value = ''
	expect(await submit('market-form', 'market-status', 'Validating market sources…')).toBe('centralizedMarkets.sources[0].ethMarket must be ETH/USDT')
	expect(settings.centralizedMarkets.sources[0]?.ethMarket).toBe('ETH/USDT')
	element(window, 'market-venue-consensus-json', window.HTMLTextAreaElement).value = '{"dexSources": []'
	expect(await submit('market-form', 'market-status', 'Validating market sources…')).toContain('JSON')
	const removeButton = marketRows()[0]?.querySelector('button')
	if (!(removeButton instanceof window.HTMLButtonElement)) throw new Error('Missing remove button')
	removeButton.click()
	expect(marketRows()).toHaveLength(0)
	expect(element(window, 'market-sources-empty', window.HTMLElement).hidden).toBe(false)
})

test('go-live checklist unlocks the switch once every prerequisite holds, reports the armed state, and the RPC form carries quorum URLs', async () => {
	let settings = parseOperatorSettings({
		...example,
		connectivity: { publicRpcUrls: ['https://rpc.example/'], readRpcUrl: 'https://rpc.example/' },
		deployment: { ...example.deployment, quorumRpcUrls: ['https://quorum-one.example/', 'https://quorum-two.example/'] },
		network: 'sepolia',
		networkConfigured: true,
		rpcQuorum: 2,
	})
	const queued: QueuedSettingsSection[] = []
	let execute = false
	const connectivityRequests: unknown[] = []
	const deploymentRequests: unknown[] = []
	let holdConnectivity: Promise<void> | undefined
	const executor = canonicalExecutorIdentity().address
	// The running V3-only profile has been inspected once; the V3 router is the only contract still missing.
	const inspectedContracts = (routerDeployed: boolean) => requiredDeploymentRoles({ v2: false, v3: true, v4: false }).map(role => ({ address, deployed: routerDeployed || role !== 'uniswap-router', role }))
	let canonicalDeployments: OperatorState['canonicalDeployments'] = { contracts: inspectedContracts(false), executorDeployed: false }
	const snapshot = () =>
		operatorSnapshot(
			{ ...operatorState(), canonicalDeployments },
			settings.strategy,
			settings.submission,
			settings.connectivity,
			{
				deployment: settings.deployment,
				execute,
				executor,
				expectedChainId: 11_155_111,
				explorerUrl: 'https://sepolia.etherscan.io',
				network: 'sepolia',
				networkConfigured: true,
				openOracle: settings.deployment.openOracle,
				queuedWallet: undefined,
				savedWallet: undefined,
				wallet: address,
			},
			settings.runtime.riskLimits,
			queued,
		)
	const server = startDashboardServer(0, {
		getConfiguration: () => ({ configuration: serializeOperatorSettings(settings), revision: 'fixture' }),
		getSnapshot: snapshot,
		hostname: '127.0.0.1',
		isNetworkConfigured: () => true,
		setPaused: () => undefined,
		deployExecutor: () => {
			canonicalDeployments = { contracts: inspectedContracts(true), executorDeployed: true }
			return { address: executor, alreadyDeployed: false, transactionHash: undefined }
		},
		predictExecutor: () => ({ address: executor, salt: '0x0' }),
		// Mirrors the bot's serialized settings queue: the connectivity write lands first and a later save reads it.
		updateConnectivity: async value => {
			connectivityRequests.push(value)
			if (typeof value !== 'object' || value === null || !('quorumRpcUrls' in value) || !Array.isArray(value.quorumRpcUrls)) throw new Error('Expected quorum RPC URLs')
			const quorumRpcUrls = value.quorumRpcUrls.map(String)
			settings = { ...settings, deployment: { ...settings.deployment, quorumRpcUrls } }
			queued.push('connectivity', 'deployment', 'universes')
			if (holdConnectivity !== undefined) await holdConnectivity
			return { connectivity: settings.connectivity, network: 'sepolia', quorumRpcUrls, rpcQuorum: 2 }
		},
		updateDeployment: async value => {
			deploymentRequests.push(value)
			if (holdConnectivity !== undefined) await holdConnectivity
			settings = { ...settings, deployment: mergeStoredDeploymentUpdate(settings.deployment, value, 'sepolia') }
			return settings.deployment
		},
		updateExecution: value => {
			if (typeof value !== 'object' || value === null || !('execute' in value) || typeof value.execute !== 'boolean') throw new Error('Expected execute')
			settings = { ...settings, paused: true, runtime: { ...settings.runtime, execute: value.execute } }
			// The bot keeps reporting live until the boundary, so only an enable flips the snapshot immediately.
			if (value.execute) execute = true
			queued.push('execution')
			return { execute: value.execute }
		},
		updateSigner: () => ({ wallet: address }),
		updateStrategy: () => snapshot().settings,
		updateSubmission: value => validateSubmissionSettings(value),
	})
	servers.push(server)
	const { page, window } = await mountDashboard(server, '/settings')
	const checklistReady = () => Array.from(element(window, 'execution-checklist', window.HTMLUListElement).children, item => item.getAttribute('data-ready'))
	const checklistDetail = (label: string) =>
		Array.from(element(window, 'execution-checklist', window.HTMLUListElement).children)
			.find(item => item.querySelector('.readiness-label')?.textContent === label)
			?.querySelector('strong')?.textContent
	for (let attempt = 0; attempt < 100 && checklistReady().length === 0; attempt++) await Bun.sleep(10)
	// The saved settings are complete, but the scan found no executor bytecode, so the switch stays locked until it is deployed.
	expect(checklistReady()).toEqual(['true', 'true', 'true', 'false', 'false', 'true', 'false'])
	expect(checklistDetail('Executor')).toBe('Deploy it under Venues and executor')
	expect(checklistDetail('Canonical contracts')).toBe('Missing Uniswap V3 router')
	expect(checklistDetail('Pool coordinators')).toBe('None discovered · optional')
	// The advisory row is announced as optional, not as a missing prerequisite.
	expect(Array.from(element(window, 'execution-checklist', window.HTMLUListElement).children, item => item.querySelector('.visually-hidden')?.textContent)).toEqual([' ready', ' ready', ' ready', ' missing', ' missing', ' ready', ' optional'])
	expect(element(window, 'execution-mode-summary', window.HTMLElement).textContent).toBe('Dry run · prerequisites missing')
	expect(element(window, 'execution-enabled', window.HTMLInputElement).disabled).toBe(true)
	Reflect.set(window, 'confirm', () => true)
	element(window, 'create2-form', window.HTMLFormElement).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
	await page.waitUntilComplete()
	for (let attempt = 0; attempt < 100 && !element(window, 'create2-status', window.HTMLElement).textContent.startsWith('Deployed'); attempt++) await Bun.sleep(10)
	expect(element(window, 'create2-status', window.HTMLElement).textContent).toBe(`Deployed ${executor} in transaction unknown.`)
	for (let attempt = 0; attempt < 100 && checklistDetail('Executor') !== `${executor.slice(0, 8)}…${executor.slice(-6)}`; attempt++) await Bun.sleep(10)
	expect(checklistReady()).toEqual(['true', 'true', 'true', 'true', 'true', 'true', 'false'])
	expect(element(window, 'execution-mode-summary', window.HTMLElement).textContent).toBe('Dry run · ready to go live')
	expect(element(window, 'execution-enabled', window.HTMLInputElement).disabled).toBe(false)
	expect(element(window, 'quorum-rpc-urls', window.HTMLTextAreaElement).value).toBe('https://quorum-one.example/\nhttps://quorum-two.example/')

	const submit = async (formId: string, statusId: string, pendingPrefix: string) => {
		element(window, formId, window.HTMLFormElement).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
		await page.waitUntilComplete()
		for (let attempt = 0; attempt < 100 && element(window, statusId, window.HTMLElement).textContent.startsWith(pendingPrefix); attempt++) await Bun.sleep(10)
		return element(window, statusId, window.HTMLElement).textContent
	}
	element(window, 'execution-enabled', window.HTMLInputElement).checked = true
	expect(await submit('execution-form', 'execution-status', 'Saving execution mode…')).toBe('Live execution saved.')
	expect(settings.runtime.execute).toBe(true)
	for (let attempt = 0; attempt < 100 && !element(window, 'execution-mode-summary', window.HTMLElement).textContent.startsWith('Armed'); attempt++) await Bun.sleep(10)
	expect(element(window, 'execution-mode-summary', window.HTMLElement).textContent).toBe('Armed · bot paused')
	expect(Array.from(window.document.querySelectorAll('.settings-badges[data-form="execution-form"] .settings-badge'), badge => badge.textContent)).toEqual(['Queued · next scan'])
	// Queuing a switch back to dry run on a live operator is not an armed state.
	element(window, 'execution-enabled', window.HTMLInputElement).checked = false
	expect(await submit('execution-form', 'execution-status', 'Saving execution mode…')).toBe('Dry-run mode saved.')
	for (let attempt = 0; attempt < 100 && !element(window, 'execution-mode-summary', window.HTMLElement).textContent.startsWith('Live'); attempt++) await Bun.sleep(10)
	expect(element(window, 'execution-mode-summary', window.HTMLElement).textContent).toBe('Live · dry run at the next scan')

	element(window, 'quorum-rpc-urls', window.HTMLTextAreaElement).value = 'https://quorum-one.example/\nhttps://quorum-three.example/'
	expect(await submit('connectivity-form', 'connectivity-status', 'Checking every endpoint')).toBe('Chain and RPCs passed validation and were saved.')
	expect(connectivityRequests).toEqual([{ connectivity: { publicRpcUrls: ['https://rpc.example/'], readRpcUrl: 'https://rpc.example/' }, network: 'sepolia', quorumRpcUrls: ['https://quorum-one.example/', 'https://quorum-three.example/'], rpcQuorum: 2 }])
	expect(settings.deployment.quorumRpcUrls).toEqual(['https://quorum-one.example/', 'https://quorum-three.example/'])
	expect(element(window, 'quorum-rpc-urls', window.HTMLTextAreaElement).value).toBe('https://quorum-one.example/\nhttps://quorum-three.example/')
	for (let attempt = 0; attempt < 100 && window.document.querySelectorAll('.settings-badges[data-form="deployment-form"] .settings-badge').length === 0; attempt++) await Bun.sleep(10)

	// A venue save that overlaps a slow RPC save must not resurrect the previous quorum URLs:
	// each form sends only its own fields and the bot merges them into the latest saved section.
	let releaseConnectivity: (() => void) | undefined
	holdConnectivity = new Promise(resolve => {
		releaseConnectivity = resolve
	})
	element(window, 'quorum-rpc-urls', window.HTMLTextAreaElement).value = 'https://quorum-four.example/\nhttps://quorum-five.example/'
	element(window, 'connectivity-form', window.HTMLFormElement).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
	await Bun.sleep(30)
	element(window, 'deployment-v4-enabled', window.HTMLInputElement).checked = true
	element(window, 'deployment-form', window.HTMLFormElement).dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
	await Bun.sleep(30)
	expect(deploymentRequests.at(-1)).toEqual({ uniswapV2Enabled: true, uniswapV3Enabled: true, uniswapV4Enabled: true })
	releaseConnectivity?.()
	holdConnectivity = undefined
	for (let attempt = 0; attempt < 100 && !element(window, 'connectivity-status', window.HTMLElement).textContent.startsWith('Chain and RPCs passed'); attempt++) await Bun.sleep(10)
	for (let attempt = 0; attempt < 100 && element(window, 'deployment-status', window.HTMLElement).textContent !== 'Venues saved.'; attempt++) await Bun.sleep(10)
	expect(element(window, 'deployment-status', window.HTMLElement).textContent).toBe('Venues saved.')
	expect(settings.deployment.quorumRpcUrls).toEqual(['https://quorum-four.example/', 'https://quorum-five.example/'])
	expect(settings.deployment.uniswapV4Enabled).toBe(true)
	expect(element(window, 'quorum-rpc-urls', window.HTMLTextAreaElement).value).toBe('https://quorum-four.example/\nhttps://quorum-five.example/')
	expect(element(window, 'deployment-v4-enabled', window.HTMLInputElement).checked).toBe(true)
	expect(Array.from(window.document.querySelectorAll('.settings-badges[data-form="deployment-form"] .settings-badge'), badge => badge.textContent)).toEqual(['Queued · next scan'])
	// The saved V4 venue needs contracts the last scan never inspected, so the verified V3-only inspection no longer unlocks arming.
	expect(checklistDetail('Canonical contracts')).toBe('Waiting for the next scan')
	expect(checklistReady()).toEqual(['true', 'true', 'true', 'true', 'false', 'true', 'false'])
	expect(element(window, 'execution-mode-summary', window.HTMLElement).textContent).toBe('Live · dry run at the next scan')
	expect(element(window, 'execution-enabled', window.HTMLInputElement).disabled).toBe(true)
	// The universe form has no controls of its own, yet it joins the same clean/queued model as every other panel.
	expect(Array.from(window.document.querySelectorAll('.settings-badges[data-form="tokens-form"] .settings-badge'), badge => badge.textContent)).toEqual(['Queued · next scan'])
	const universeSave = element(window, 'tokens-form', window.HTMLFormElement).querySelector('button[type="submit"]')
	if (!(universeSave instanceof window.HTMLButtonElement)) throw new Error('Missing universe save button')
	expect(universeSave.disabled).toBe(true)
})
