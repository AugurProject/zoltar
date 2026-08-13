import { afterEach, expect, test } from 'bun:test'
import type { Address } from '#ethereum'
import { startDashboardServer } from '#dashboard/dashboard-server'
import { operatorSnapshot, updateStrategyFromRequest, type MutableStrategy, type OperatorState } from '#state/operator-state'
import { validateSubmissionSettings } from '#execution/transaction-submission'

const servers: ReturnType<typeof startDashboardServer>[] = []
const address = '0x0000000000000000000000000000000000000001' as Address

afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true)
})

test('serves dashboard state and protects mutable controls with same-origin JSON requests', async () => {
	const strategy: MutableStrategy = {
		maxSpotTwapTicks: 100n,
		minimumProfitBps: 100n,
		minimumProfitAttoWeth: 10n ** 16n,
		minimumRemainingBlocks: 3n,
		minimumRemainingSeconds: 36n,
		pollMilliseconds: 12_000,
		twapSeconds: 1_800,
	}
	const state: OperatorState = {
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
		paused: false,
		positions: [],
		status: 'running',
		tokenAddresses: [],
		tokenMarkets: [],
		priceHistory: [],
		reportPaths: [],
		transactionActivity: [],
	}
	let submission = validateSubmissionSettings({ mode: 'public', relayUrls: ['https://relay.flashbots.net'] })
	let connectivity = { publicRpcUrls: ['https://rpc.example/'], readRpcUrl: 'https://rpc.example/' }
	let queuedWallet: Address | null | undefined
	let savedWallet: Address | undefined
	let deployment = operatorSnapshot(state, strategy, submission, connectivity, { execute: false, executor: undefined, expectedChainId: 1, explorerUrl: 'https://etherscan.io', network: 'mainnet', openOracle: address, queuedWallet, savedWallet, wallet: undefined }).deployment
	const server = startDashboardServer(0, {
		getSnapshot: () => operatorSnapshot(state, strategy, submission, connectivity, { deployment, execute: false, executor: undefined, expectedChainId: 1, explorerUrl: 'https://etherscan.io', network: 'mainnet', openOracle: address, queuedWallet, savedWallet, wallet: undefined }),
		setPaused: paused => {
			state.paused = paused
		},
		updateConnectivity: value => {
			if (
				typeof value !== 'object' ||
				value === null ||
				!('connectivity' in value) ||
				typeof value.connectivity !== 'object' ||
				value.connectivity === null ||
				!('readRpcUrl' in value.connectivity) ||
				!('publicRpcUrls' in value.connectivity) ||
				typeof value.connectivity.readRpcUrl !== 'string' ||
				!Array.isArray(value.connectivity.publicRpcUrls) ||
				!('network' in value) ||
				value.network !== 'mainnet'
			)
				throw new Error('Invalid test connectivity')
			connectivity = { publicRpcUrls: value.connectivity.publicRpcUrls.map(String), readRpcUrl: value.connectivity.readRpcUrl }
			return { connectivity, network: value.network, restartRequired: false }
		},
		updateDeployment: value => {
			if (typeof value !== 'object' || value === null || !('executor' in value)) throw new Error('Invalid test deployment')
			deployment = { ...deployment, executor: value.executor === null ? undefined : address }
			return deployment
		},
		deployExecutor: value => {
			if (typeof value !== 'object' || value === null || !('salt' in value)) throw new Error('Invalid test salt')
			return { address, alreadyDeployed: false, transactionHash: `0x${'11'.repeat(32)}` }
		},
		predictExecutor: () => ({ address, salt: `0x${'00'.repeat(32)}` }),
		updateSigner: value => {
			if (typeof value === 'object' && value !== null && 'forgetSavedSigner' in value) {
				savedWallet = undefined
				return { wallet: address }
			}
			const clear = typeof value === 'object' && value !== null && 'privateKey' in value && value['privateKey'] === null
			queuedWallet = clear ? null : address
			savedWallet = clear ? undefined : address
			return { wallet: clear ? undefined : address }
		},
		updateSubmission: value => {
			submission = validateSubmissionSettings(value)
			return submission
		},
		updateStrategy: value => updateStrategyFromRequest(strategy, value),
		updateTokens: value => {
			if (!Array.isArray(value)) throw new Error('Invalid token list')
			return value.map(String)
		},
	})
	servers.push(server)
	const origin = `http://${server.hostname}:${server.port}`
	const health = await fetch(`${origin}/healthz`)
	expect(health.status).toBe(200)
	expect(await health.text()).toBe('ok')
	const page = await fetch(origin)
	expect(page.status).toBe(200)
	expect(page.headers.get('content-security-policy')).toContain("default-src 'self'")
	const pageSource = await page.text()
	expect(pageSource).toContain('OpenOracle Arbitrager')
	expect(pageSource).toContain('<a href="/documentation">Operator guide</a>')
	expect(pageSource).not.toContain('>Starting<')
	expect(pageSource).toContain('id="mode-badge" class="badge">Mode —</span>')
	expect(pageSource).toContain('id="status-value">—</strong>')
	expect(pageSource).toContain('id="pause-button" class="button" type="button" disabled')
	expect(pageSource).toContain('id="hedged-profit-value"')
	expect(pageSource).toContain('id="game-capital-value"')
	expect(pageSource).toContain('id="strategy-fieldset" disabled')
	expect(pageSource).toContain('id="submission-fieldset" disabled')
	expect(pageSource).toContain('Both delivery modes submit one parent-bound atomic entry transaction')
	expect(pageSource).toContain('require sufficient pre-existing ERC-20 and OpenOracle internal allowances')
	expect(pageSource).not.toContain('bundle prerequisite approvals')
	expect(pageSource).toContain('Active risk envelope')
	expect(pageSource).toContain('<div class="metric"><span>Lifecycle reserve floor</span><strong id="risk-lifecycle-reserve">—</strong></div>')
	expect(pageSource).toContain('Strategy use')
	expect(pageSource).toContain('id="connectivity-fieldset" disabled')
	expect(pageSource).toContain('id="signer-fieldset" disabled')
	expect(pageSource).toContain('id="deployment-fieldset" disabled')
	expect(pageSource).toContain('id="create2-fieldset" disabled')
	expect(pageSource).toContain('Deploy predictable executor')
	expect(pageSource).toContain('id="signer-status" class="muted" role="status" aria-live="polite"')
	expect(pageSource).toContain('id="centralized-market-status" class="muted" role="status" aria-live="polite"')
	expect(pageSource).toContain('id="centralized-market-summary" class="metric-grid"')
	expect(pageSource).not.toContain('id="centralized-market-summary" class="metric-grid" aria-live')
	expect(pageSource).toContain('id="centralized-market-price"')
	expect(pageSource).toContain('id="dex-market-price"')
	expect(pageSource).toContain('id="guarded-market-price"')
	expect(pageSource).not.toContain('public CCXT sources')
	expect(pageSource).toContain('<th>Executable REP / ETH</th>')
	expect(pageSource).toContain('<th>Reference deviation</th>')
	expect(pageSource).toContain('aria-describedby="signer-status"')
	expect(pageSource).toContain('id="remember-signer" type="checkbox"')
	expect(pageSource).toContain('id="forget-signer-button"')
	expect(pageSource).toContain('Save this new key in plaintext')
	expect(pageSource).toContain('Clear signer &amp; saved key')
	expect(pageSource).toContain('Observed dispute paths')
	expect(pageSource).toContain('Spot (WETH/token)')
	expect(pageSource).not.toContain('id="launch-gate-link"')
	expect(pageSource).toContain('id="launch-notice"')
	const documentation = await fetch(`${origin}/documentation`)
	expect(documentation.status).toBe(200)
	expect(documentation.headers.get('content-security-policy')).toContain("default-src 'self'")
	const documentationSource = await documentation.text()
	expect(documentationSource).toContain('OpenOracle Arbitrager Operator Guide')
	expect(documentationSource).toContain('fig-open-oracle-arbitrager-lifecycle')
	expect(documentationSource).toContain('fig-open-oracle-arbitrager-profit')
	expect(documentationSource).toContain('<math')
	expect(documentationSource).toContain('Uniswap V3')
	expect(documentationSource).toContain('SushiSwap V2')
	expect(documentationSource).toContain('href="/market-fixture.html"')
	expect(documentationSource).toContain('href="/documentation/reference#uniswap-venue-execution"')
	expect(documentationSource).toContain('href="/documentation/reference#recovery-required-runbook"')
	const reference = await fetch(`${origin}/documentation/reference`)
	expect(reference.status).toBe(200)
	expect(reference.headers.get('content-type')).toContain('text/html')
	const referenceSource = await reference.text()
	expect(referenceSource.match(/<h1/g)?.length).toBe(1)
	expect(referenceSource).toContain('id="uniswap-venue-execution"')
	expect(referenceSource).toContain('id="recovery-required-runbook"')
	expect(referenceSource).toContain('id="profit-and-history-semantics"')
	expect(referenceSource).toContain('<pre tabindex="0" aria-label="Scrollable code or command example">')
	expect(referenceSource).toContain('href="/documentation#math"')
	expect(referenceSource).toContain('href="/market-fixture.html#open-oracle-market-fixture"')
	const fixture = await fetch(`${origin}/market-fixture.html`)
	expect(fixture.status).toBe(200)
	const fixtureSource = await fixture.text()
	expect(fixtureSource).toContain('id="open-oracle-market-fixture"')
	expect(fixtureSource).toContain('href="/scripts/check-market-fixture.mts"')
	expect(fixtureSource).toContain('href="/src/core/strategy.ts"')
	for (const asset of ['/README.md', '/operator-guide.css', '/shared.css', '/chart-runtime.js', '/assets/dashboard-overview.png', '/assets/dashboard-markets.png', '/scripts/check-market-fixture.mts', '/src/core/strategy.ts']) {
		const response = await fetch(`${origin}${asset}`)
		expect(response.status).toBe(200)
	}
	const favicon = await fetch(`${origin}/favicon.ico`)
	expect(favicon.status).toBe(204)
	expect(favicon.headers.get('content-type')).toBe('image/x-icon')
	const browserScript = await fetch(`${origin}/dashboard.js`)
	expect(browserScript.headers.get('content-type')).toContain('text/javascript')
	const browserSource = await browserScript.text()
	expect(browserSource).toContain('setInterval')
	expect(browserSource).toContain('aria-labelledby')
	expect(browserSource).toContain('Recent exact price samples')
	expect(browserSource).toContain('Mainnet execution network')
	expect(browserSource).toContain('Sepolia rehearsal network')
	expect(browserSource).toContain('details.dataset["reportId"]')
	expect(browserSource).toContain('focus({ preventScroll: true })')
	expect(browserSource).toContain('stroke-dasharray')
	const browserFormatScript = await fetch(`${origin}/dashboard-format.js`)
	expect(browserFormatScript.headers.get('content-type')).toContain('text/javascript')
	expect(await browserFormatScript.text()).toContain('sumSignedDecimals')
	const crossOrigin = await fetch(`${origin}/api/paused`, {
		body: JSON.stringify({ paused: true }),
		headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
		method: 'PUT',
	})
	expect(crossOrigin.status).toBe(403)
	const rebound = await fetch(`${origin}/api/paused`, {
		body: JSON.stringify({ paused: false }),
		headers: {
			'content-type': 'application/json',
			host: 'attacker.example',
			origin: 'http://attacker.example',
		},
		method: 'PUT',
	})
	expect(rebound.status).toBe(403)
	const pause = await fetch(`${origin}/api/paused`, {
		body: JSON.stringify({ paused: true }),
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
	expect(pause.status).toBe(200)
	expect(state.paused).toBe(true)
	const update = await fetch(`${origin}/api/settings`, {
		body: JSON.stringify({
			maxSpotTwapTicks: '75',
			minimumProfitBps: '200',
			minimumProfitWeth: '0.025',
			minimumRemainingBlocks: '4',
			minimumRemainingSeconds: '48',
			pollMilliseconds: 15_000,
			twapSeconds: 2_400,
		}),
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
	expect(update.status).toBe(200)
	expect(strategy.minimumProfitAttoWeth).toBe(25n * 10n ** 15n)
	const submissionUpdate = await fetch(`${origin}/api/submission`, {
		body: JSON.stringify({ mode: 'private', relayUrls: ['https://relay.flashbots.net', 'https://relay.example'] }),
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
	expect(submissionUpdate.status).toBe(200)
	expect(submission.mode).toBe('private')
	expect(submission.relayUrls).toHaveLength(2)
	const connectivityUpdate = await fetch(`${origin}/api/connectivity`, {
		body: JSON.stringify({ connectivity: { publicRpcUrls: ['https://submit.example'], readRpcUrl: 'https://read.example' }, network: 'mainnet' }),
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
	expect(connectivityUpdate.status).toBe(200)
	expect(await connectivityUpdate.json()).toEqual({ connectivity: { publicRpcUrls: ['https://submit.example'], readRpcUrl: 'https://read.example' }, network: 'mainnet', restartRequired: false })
	expect(connectivity.readRpcUrl).toBe('https://read.example')
	const tokenUpdate = await fetch(`${origin}/api/tokens`, {
		body: JSON.stringify([address]),
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
	expect(tokenUpdate.status).toBe(200)
	expect(await tokenUpdate.json()).toEqual({ tokenAddresses: [address] })
	const deploymentUpdate = await fetch(`${origin}/api/deployment`, {
		body: JSON.stringify({ executor: address }),
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
	expect(deploymentUpdate.status).toBe(200)
	const executorDeployment = await fetch(`${origin}/api/executor-deployment`, {
		body: JSON.stringify({ salt: `0x${'00'.repeat(32)}` }),
		headers: { 'content-type': 'application/json', origin },
		method: 'POST',
	})
	expect(executorDeployment.status).toBe(200)
	expect(await executorDeployment.json()).toMatchObject({ address, alreadyDeployed: false })
	const executorPrediction = await fetch(`${origin}/api/executor-prediction`, {
		body: JSON.stringify({ salt: `0x${'00'.repeat(32)}` }),
		headers: { 'content-type': 'application/json', origin },
		method: 'POST',
	})
	expect(executorPrediction.status).toBe(200)
	expect(await executorPrediction.json()).toMatchObject({ address })
	const signerUpdate = await fetch(`${origin}/api/signer`, {
		body: JSON.stringify({ privateKey: 'not returned by test controller', rememberSigner: true }),
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
	expect(signerUpdate.status).toBe(200)
	expect(await signerUpdate.json()).toEqual({ wallet: address })
	const reloadedState = await fetch(`${origin}/api/state`).then(response => response.json())
	expect(reloadedState).toMatchObject({ queuedWallet: address })
	expect(reloadedState).toMatchObject({ savedWallet: address })
	const forgetSigner = await fetch(`${origin}/api/signer`, {
		body: JSON.stringify({ forgetSavedSigner: true }),
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
	expect(forgetSigner.status).toBe(200)
	const forgottenState = (await fetch(`${origin}/api/state`).then(response => response.json())) as Record<string, unknown>
	expect(forgottenState).toMatchObject({ queuedWallet: address })
	expect(forgottenState['savedWallet']).toBeUndefined()
	const signerClear = await fetch(`${origin}/api/signer`, {
		body: JSON.stringify({ privateKey: null, rememberSigner: false }),
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
	expect(signerClear.status).toBe(200)
	const clearReloadedState = await fetch(`${origin}/api/state`).then(response => response.json())
	expect(clearReloadedState).toMatchObject({ queuedWallet: null })
})

test('returns a structured unavailable response when the initial state read fails', async () => {
	const server = startDashboardServer(0, {
		getSnapshot: () => {
			throw new Error('RPC unavailable')
		},
		setPaused: () => undefined,
		updateConnectivity: () => {
			throw new Error('Connectivity unavailable')
		},
		updateSigner: () => {
			throw new Error('Signer unavailable')
		},
		updateSubmission: () => {
			throw new Error('Submission unavailable')
		},
		updateStrategy: () => {
			throw new Error('Settings unavailable')
		},
	})
	servers.push(server)
	const response = await fetch(`http://${server.hostname}:${server.port}/api/state`)
	expect(response.status).toBe(503)
	expect(await response.json()).toEqual({ error: 'RPC unavailable' })
})

test('supports a container bind while retaining loopback request authority', async () => {
	const password = 'correct horse battery staple'
	expect(() =>
		startDashboardServer(0, {
			getSnapshot: () => {
				throw new Error('Not needed')
			},
			hostname: '0.0.0.0',
			setPaused: () => undefined,
			updateConnectivity: () => {
				throw new Error('Not needed')
			},
			updateSigner: () => {
				throw new Error('Not needed')
			},
			updateSubmission: () => {
				throw new Error('Not needed')
			},
			updateStrategy: () => {
				throw new Error('Not needed')
			},
		}),
	).toThrow('ZOLTAR_BOT_DASHBOARD_PASSWORD')
	const server = startDashboardServer(0, {
		getSnapshot: () => {
			throw new Error('Not needed')
		},
		hostname: '0.0.0.0',
		password,
		setPaused: () => undefined,
		updateConnectivity: () => {
			throw new Error('Not needed')
		},
		updateSigner: () => {
			throw new Error('Not needed')
		},
		updateSubmission: () => {
			throw new Error('Not needed')
		},
		updateStrategy: () => {
			throw new Error('Not needed')
		},
	})
	servers.push(server)
	expect(server.hostname).toBe('0.0.0.0')
	const origin = `http://127.0.0.1:${server.port}`
	expect((await fetch(origin)).status).toBe(401)
	const authorization = `Basic ${Buffer.from(`operator:${password}`).toString('base64')}`
	const response = await fetch(origin, { headers: { authorization } })
	expect(response.status).toBe(200)
})
