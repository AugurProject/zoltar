import { afterEach, expect, test } from 'bun:test'
import type { Address, Hex } from '#ethereum'
import { startDashboardServer } from '#dashboard/dashboard-server'
import { operatorSnapshot, updateStrategyFromRequest, type MutableStrategy, type OperatorState } from '#state/operator-state'
import { validateSubmissionSettings } from '#execution/transaction-submission'
import type { PositionRecord } from '#state/position-store'
import { EndpointCheckFailure } from '#monitoring/connectivity'

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
	let connectivityFailure: Error | undefined
	let submissionFailure: Error | undefined
	let queuedWallet: Address | null | undefined
	let savedWallet: Address | undefined
	let deployment = operatorSnapshot(state, strategy, submission, connectivity, { execute: false, executor: undefined, expectedChainId: 1, explorerUrl: 'https://etherscan.io', network: 'mainnet', openOracle: address, queuedWallet, savedWallet, wallet: undefined }).deployment
	const server = startDashboardServer(0, {
		getSnapshot: () => operatorSnapshot(state, strategy, submission, connectivity, { deployment, execute: false, executor: undefined, expectedChainId: 1, explorerUrl: 'https://etherscan.io', network: 'mainnet', openOracle: address, queuedWallet, savedWallet, wallet: undefined }),
		isNetworkConfigured: () => true,
		setPaused: paused => {
			state.paused = paused
		},
		updateConnectivity: value => {
			if (connectivityFailure !== undefined) throw connectivityFailure
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
			return { connectivity, network: value.network }
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
			if (submissionFailure !== undefined) throw submissionFailure
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
	for (const route of ['overview', 'operations', 'games', 'markets', 'settings']) {
		const routedPage = await fetch(`${origin}/${route}`)
		expect(routedPage.status).toBe(200)
		expect(await routedPage.text()).toContain(`<body data-page="${route}">`)
	}
	expect(pageSource).toContain('<a href="/documentation">Operator guide</a>')
	expect(pageSource).not.toContain('>Starting<')
	expect(pageSource).toContain('id="mode-badge" class="badge">Mode —</span>')
	expect(pageSource).toContain('id="run-status-badge" class="badge">Run —</span>')
	expect(pageSource).toContain('id="retry-status-badge" class="badge badge-warning" hidden>Retry —</span>')
	expect(pageSource).toContain('id="status-value">—</strong>')
	expect(pageSource).toContain('id="pause-button" class="button" type="button" disabled')
	expect(pageSource).toContain('id="resume-dialog"')
	expect(pageSource).toContain('class="section-nav"')
	expect(pageSource).toContain('class="mobile-record-table"')
	expect(pageSource).toContain('id="hedged-profit-value"')
	expect(pageSource).toContain('id="game-capital-value"')
	expect(pageSource).toContain('id="strategy-fieldset" disabled')
	expect(pageSource).toContain('id="settings-chain-scope"')
	expect(pageSource).toContain('Select a chain profile first')
	expect(pageSource.indexOf('id="network-connectivity"')).toBeLessThan(pageSource.indexOf('id="strategy-form"'))
	expect(pageSource).toContain('id="submission-fieldset" disabled')
	expect(pageSource).toContain('id="settings-load-status" role="status" aria-live="polite">Loading operator configuration…</span>')
	expect(pageSource).toContain('id="retry-settings-button"')
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
	expect(pageSource).toContain('Save this key in the local operator file')
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
	expect(referenceSource).toContain('href="https://docs.flashbots.net/flashbots-auction/advanced/rpc-endpoint" target="_blank" rel="noreferrer"')
	const fixture = await fetch(`${origin}/market-fixture.html`)
	expect(fixture.status).toBe(200)
	const fixtureSource = await fixture.text()
	expect(fixtureSource).toContain('id="open-oracle-market-fixture"')
	expect(fixtureSource).toContain('href="/scripts/check-market-fixture.mts"')
	expect(fixtureSource).toContain('href="/src/core/strategy.ts"')
	for (const asset of ['/README.md', '/operator-guide.css', '/shared.css', '/operator-console.css', '/chart-runtime.js', '/assets/dashboard-overview.png', '/assets/dashboard-markets.png', '/scripts/check-market-fixture.mts', '/src/core/strategy.ts']) {
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
	expect(browserSource).toContain('Refreshing…')
	expect(browserSource).toContain('Configuration request timed out.')
	expect(browserSource).toContain('aria-labelledby')
	expect(browserSource).toContain('Recent exact price samples')
	expect(browserSource).toContain('Mainnet execution network')
	expect(browserSource).toContain('Sepolia network')
	expect(browserSource).not.toContain('production approval')
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
	const relaySecret = 'private-relay-secret'
	submissionFailure = new EndpointCheckFailure('private relay unavailable', [
		{
			chainId: undefined,
			checkedAt: '2026-09-01T00:00:00.000Z',
			error: `RPC https://operator:${relaySecret}@relay.example/private?key=${relaySecret} failed while calling eth_sendPrivateTransaction: getaddrinfo ENOTFOUND relay.example`,
			kind: 'private-relay',
			status: 'failed',
			target: `https://operator:${relaySecret}@relay.example/private?key=${relaySecret}`,
		},
	])
	const failedSubmissionUpdate = await fetch(`${origin}/api/submission`, {
		body: JSON.stringify({ mode: 'private', relayUrls: ['https://relay.example'] }),
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
	const failedSubmissionBody = await failedSubmissionUpdate.text()
	expect(failedSubmissionUpdate.status).toBe(400)
	expect(failedSubmissionBody).not.toContain(relaySecret)
	expect(JSON.parse(failedSubmissionBody)).toEqual({ error: 'RPC https://relay.example failed while calling eth_sendPrivateTransaction: getaddrinfo ENOTFOUND relay.example' })
	submissionFailure = undefined
	const connectivityUpdate = await fetch(`${origin}/api/connectivity`, {
		body: JSON.stringify({ connectivity: { publicRpcUrls: ['https://submit.example'], readRpcUrl: 'https://read.example' }, network: 'mainnet' }),
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
	expect(connectivityUpdate.status).toBe(200)
	expect(await connectivityUpdate.json()).toEqual({ connectivity: { publicRpcUrls: ['https://submit.example'], readRpcUrl: 'https://read.example' }, network: 'mainnet' })
	expect(connectivity.readRpcUrl).toBe('https://read.example')
	const mutationCredentialMarker = 'mutation-operator-secret'
	connectivityFailure = new EndpointCheckFailure(`RPC https://rpc.example failed while calling eth_chainId: connection refused; project id ${mutationCredentialMarker}`, [
		{ chainId: undefined, checkedAt: '2026-09-01T00:00:00.000Z', error: `RPC https://rpc.example failed while calling eth_chainId: connection refused; project id ${mutationCredentialMarker}`, kind: 'read-rpc', status: 'failed', target: 'https://rpc.example' },
	])
	const failedConnectivityUpdate = await fetch(`${origin}/api/connectivity`, {
		body: JSON.stringify({ connectivity: { publicRpcUrls: ['https://submit.example'], readRpcUrl: 'https://read.example' }, network: 'mainnet' }),
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
	expect(failedConnectivityUpdate.status).toBe(400)
	const failedConnectivityBody = await failedConnectivityUpdate.json()
	expect(JSON.stringify(failedConnectivityBody)).not.toContain(mutationCredentialMarker)
	expect(failedConnectivityBody).toEqual({ error: 'RPC https://rpc.example failed while calling eth_chainId. Review the endpoint and protected bot logs.' })
	connectivityFailure = new EndpointCheckFailure('RPC http://reth:8545 failed while calling eth_chainId: getaddrinfo ENOTFOUND reth; RPC http://reth:8545 failed while calling eth_chainId: getaddrinfo ENOTFOUND reth', [
		{
			chainId: undefined,
			checkedAt: '2026-09-01T00:00:00.000Z',
			error: 'RPC http://reth:8545 failed while calling eth_chainId: Unable to connect. Is the computer able to access the url?',
			kind: 'read-rpc',
			status: 'failed',
			target: 'http://reth:8545',
		},
		{
			chainId: undefined,
			checkedAt: '2026-09-01T00:00:00.000Z',
			error: 'RPC http://reth:8545 failed while calling eth_chainId: Unable to connect. Is the computer able to access the url?',
			kind: 'public-rpc',
			status: 'failed',
			target: 'http://reth:8545',
		},
	])
	const unresolvedHostnameUpdate = await fetch(`${origin}/api/connectivity`, {
		body: JSON.stringify({ connectivity: { publicRpcUrls: ['https://submit.example'], readRpcUrl: 'https://read.example' }, network: 'mainnet' }),
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
	expect(unresolvedHostnameUpdate.status).toBe(400)
	const unresolvedHostnameBody = await unresolvedHostnameUpdate.json()
	expect(JSON.stringify(unresolvedHostnameBody)).not.toContain(mutationCredentialMarker)
	expect(unresolvedHostnameBody).toEqual({
		error: 'RPC http://reth:8545 failed while calling eth_chainId: Unable to connect. Is the computer able to access the url? The hostname reth must resolve from the bot process; Docker service names like reth only work when the bot shares that container network.',
	})
	connectivityFailure = new Error('RPC URLs must not exceed 2048 characters')
	const oversizedUrlUpdate = await fetch(`${origin}/api/connectivity`, {
		body: JSON.stringify({ connectivity: { publicRpcUrls: ['https://submit.example'], readRpcUrl: 'https://read.example' }, network: 'mainnet' }),
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
	expect(oversizedUrlUpdate.status).toBe(400)
	expect(await oversizedUrlUpdate.json()).toEqual({ error: 'RPC URLs must not exceed 2048 characters' })
	connectivityFailure = new Error('At most 8 read quorum RPC URLs are supported')
	const readQuorumLimitUpdate = await fetch(`${origin}/api/connectivity`, {
		body: JSON.stringify({ connectivity: { publicRpcUrls: ['https://submit.example'], readRpcUrl: 'https://read.example' }, network: 'mainnet' }),
		headers: { 'content-type': 'application/json', origin },
		method: 'PUT',
	})
	expect(readQuorumLimitUpdate.status).toBe(400)
	expect(await readQuorumLimitUpdate.json()).toEqual({ error: 'At most 8 read quorum RPC URLs are supported' })
	connectivityFailure = undefined
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
	const credentialMarker = 'operator-secret'
	const endpointCredentialMarker = 'provider-secret'
	const endpointPathMarker = 'tenant-private-path'
	const entryCalldataMarker = '0xdeadbeef'
	const lifecycleCalldataMarker = '0xcafebabe'
	const credentialEndpoint = `https://operator:${endpointCredentialMarker}@rpc.example/${endpointPathMarker}?token=${endpointCredentialMarker}`
	const rawRpcFailure = `Read RPC https://operator:${credentialMarker}@rpc.example failed at block 100`
	const rawRelayFailure = `Private relay https://operator:${credentialMarker}@relay.example rejected the transaction`
	const protectedSettingsFile = '/var/lib/zoltar/operator/mainnet/operator.json'
	const transactionHash: Hex = `0x${'12'.repeat(32)}`
	state.positions = [
		{
			account: address,
			actualEntryGasCostEth: '0.001',
			capitalAtRiskWeth: '1',
			closedAt: undefined,
			direction: 'buy-rep',
			entryTransactionHash: transactionHash,
			entryTransactionHashes: [transactionHash],
			entryTransactionIntent: { data: entryCalldataMarker, to: address, value: '0' },
			gasExpenditures: [],
			historyOutbox: undefined,
			hedgeAmountToken: '1',
			hedgeWeth: '1',
			hedgedProfitBeforeGasEth: '0.02',
			lifecycleGasCostEth: '0.0005',
			lifecycleReceiptRecovered: true,
			lifecycleSettlerRewardEth: '0.0001',
			lifecycleTargetBlockNumber: '110',
			lifecycleTokenDecimals: '18',
			lifecycleTransactionHashes: [transactionHash],
			lifecycleTransactionIntent: { data: lifecycleCalldataMarker, to: address, value: '0' },
			lifecycleUpdatedAt: new Date(0).toISOString(),
			lifecycleWalletTokenBefore: '1',
			lifecycleWalletWethBefore: '1',
			lockedToken: '1',
			lockedWeth: '1',
			manualReconciliation: undefined,
			openedAt: new Date(0).toISOString(),
			realizedNetProfitEth: undefined,
			reportId: '1',
			status: 'open',
			token: address,
			tokenSymbol: 'REP',
			withdrawnToken: '0',
			withdrawnWeth: '0',
		} satisfies PositionRecord,
	]
	connectivity = { publicRpcUrls: [credentialEndpoint], readRpcUrl: credentialEndpoint }
	submission = { minimumBundleRelaySuccesses: 1, mode: 'private', relayUrls: [credentialEndpoint] }
	deployment = { ...deployment, quorumRpcUrls: [credentialEndpoint] }
	state.lastError = rawRpcFailure
	state.lastPollFailureAt = new Date(1_000).toISOString()
	state.lastRetryAt = new Date(2_000).toISOString()
	state.nextRetryAt = new Date(3_000).toISOString()
	state.retryInProgress = false
	state.endpointChecks = [{ chainId: undefined, checkedAt: new Date(0).toISOString(), error: rawRpcFailure, kind: 'read-rpc', status: 'failed', target: credentialEndpoint }]
	state.rpcEndpointHealth = [{ consecutiveFailures: 2, error: rawRpcFailure, lastFailureAt: new Date(0).toISOString(), lastSuccessAt: undefined, latencyMilliseconds: undefined, nextRetryAt: new Date(1_000).toISOString(), status: 'offline', target: credentialEndpoint }]
	state.operationLog = [
		{ category: 'configuration', details: protectedSettingsFile, level: 'info', message: 'Complete operator configuration saved', reason: 'Live settings apply automatically at scan boundaries', reportId: undefined, timestamp: new Date(0).toISOString() },
		{ category: 'decision', details: 'net 0.0158 ETH · 992 bps', level: 'info', message: 'Selected profitable sell-REP dispute', reason: 'quote, TWAP, inventory, and risk checks passed', reportId: '1', timestamp: new Date(0).toISOString() },
		{ category: 'transaction', details: rawRelayFailure, level: 'error', message: 'Transaction submission failed', reason: rawRpcFailure, reportId: '1', timestamp: new Date(0).toISOString() },
	]
	state.transactionActivity = [
		{
			acceptedTargets: [credentialEndpoint],
			actualGasCostEth: undefined,
			estimatedNetProfitEth: undefined,
			failedTargets: [{ error: rawRelayFailure, target: credentialEndpoint }],
			hash: transactionHash,
			kind: 'dispute',
			mode: 'private',
			originalHash: transactionHash,
			reportId: '1',
			status: 'submission-failed',
			submittedAt: new Date(0).toISOString(),
			token: undefined,
			tokenSymbol: undefined,
			trackedNetProfitEth: undefined,
			updatedAt: new Date(0).toISOString(),
		},
	]
	const reloadedState = await fetch(`${origin}/api/state`).then(response => response.json())
	expect(reloadedState).toMatchObject({ queuedWallet: address })
	expect(reloadedState).toMatchObject({ savedWallet: address })
	const serializedState = JSON.stringify(reloadedState)
	for (const protectedMarker of [credentialMarker, endpointCredentialMarker, endpointPathMarker, entryCalldataMarker, lifecycleCalldataMarker, protectedSettingsFile]) expect(serializedState).not.toContain(protectedMarker)
	expect(reloadedState).toMatchObject({ rpcEndpointHealth: [{ consecutiveFailures: 2, status: 'offline', target: 'https://rpc.example' }] })
	expect(reloadedState).toMatchObject({ lastPollFailureAt: new Date(1_000).toISOString(), lastRetryAt: new Date(2_000).toISOString(), nextRetryAt: new Date(3_000).toISOString(), retryInProgress: false })
	if (typeof reloadedState !== 'object' || reloadedState === null || Array.isArray(reloadedState)) throw new Error('Expected public dashboard state')
	for (const configurationField of ['connectivity', 'deployment', 'settings']) expect(configurationField in reloadedState).toBe(false)
	expect(reloadedState).toMatchObject({
		positions: [
			{
				actualEntryGasCostEth: '0.001',
				direction: 'buy-rep',
				entryTransactionHash: transactionHash,
				hedgedProfitBeforeGasEth: '0.02',
				lifecycleGasCostEth: '0.0005',
				lifecycleReceiptRecovered: true,
				lifecycleSettlerRewardEth: '0.0001',
				hasLifecycleTransactions: true,
				manuallyReconciled: false,
				openedAt: new Date(0).toISOString(),
				reportId: '1',
				status: 'open',
				tokenSymbol: 'REP',
				withdrawnToken: '0',
				withdrawnWeth: '0',
			},
		],
		submission: { minimumBundleRelaySuccesses: 1, mode: 'private' },
	})
	const publicOperations = Reflect.get(reloadedState, 'operationLog')
	expect(Array.isArray(publicOperations)).toBe(true)
	if (!Array.isArray(publicOperations)) throw new Error('Expected public operation log')
	expect(publicOperations[0]).toMatchObject({ message: 'Complete operator configuration saved' })
	expect(typeof publicOperations[0] === 'object' && publicOperations[0] !== null && Reflect.has(publicOperations[0], 'details')).toBe(false)
	expect(publicOperations[1]).toMatchObject({ details: 'net 0.0158 ETH · 992 bps', reason: 'quote, TWAP, inventory, and risk checks passed' })
	expect(publicOperations[2]).toMatchObject({
		details: 'The bot tried to submit or confirm a transaction, but it failed: Private relay https://relay.example rejected the transaction. Review transaction activity while automatic retry remains active.',
		reason: 'The bot tried to read blockchain data through an RPC endpoint, but it failed: Read RPC https://rpc.example failed at block 100. Automatic retry remains active.',
	})
	expect(reloadedState).toMatchObject({
		endpointChecks: [{ error: 'The bot tried to read blockchain data through an RPC endpoint, but it failed: Read RPC https://rpc.example failed at block 100. Automatic retry remains active.' }],
		lastError: 'The bot tried to read blockchain data through an RPC endpoint, but it failed: Read RPC https://rpc.example failed at block 100. Automatic retry remains active.',
		transactionActivity: [{ failedTargets: [{ error: 'The bot tried to submit or confirm a transaction, but it failed: Private relay https://relay.example rejected the transaction. Review transaction activity while automatic retry remains active.' }] }],
	})
	state.lastError = `RPC Authorization: Basic ${credentialMarker} failed while opening '${protectedSettingsFile}'`
	const protectedFailureState = await fetch(`${origin}/api/state`).then(response => response.json())
	expect(protectedFailureState).toMatchObject({ lastError: "The bot tried to read blockchain data through an RPC endpoint, but it failed: RPC Authorization: [redacted] failed while opening '[protected path]'. Automatic retry remains active." })
	expect(JSON.stringify(protectedFailureState)).not.toContain(credentialMarker)
	expect(JSON.stringify(protectedFailureState)).not.toContain(protectedSettingsFile)
	state.lastError = `RPC credentials=${credentialMarker} failed while opening path='${protectedSettingsFile} state.json'`
	const alternateProtectedFailureState = await fetch(`${origin}/api/state`).then(response => response.json())
	expect(alternateProtectedFailureState).toMatchObject({ lastError: "The bot tried to read blockchain data through an RPC endpoint, but it failed: RPC credentials=[redacted] failed while opening path='[protected path]'. Automatic retry remains active." })
	expect(JSON.stringify(alternateProtectedFailureState)).not.toContain(credentialMarker)
	expect(JSON.stringify(alternateProtectedFailureState)).not.toContain(protectedSettingsFile)
	const relativePathMarker = 'operator-relative-secret'
	state.lastError = `RPC request failed while opening '.state/${relativePathMarker} secrets.json'`
	const relativeProtectedFailureState = await fetch(`${origin}/api/state`).then(response => response.json())
	expect(relativeProtectedFailureState).toMatchObject({ lastError: "The bot tried to read blockchain data through an RPC endpoint, but it failed: RPC request failed while opening '[protected path]'. Automatic retry remains active." })
	expect(JSON.stringify(relativeProtectedFailureState)).not.toContain(relativePathMarker)
	state.lastError = `RPC request failed while reading state/${relativePathMarker}.json`
	const unquotedRelativeProtectedFailureState = await fetch(`${origin}/api/state`).then(response => response.json())
	expect(unquotedRelativeProtectedFailureState).toMatchObject({ lastError: 'The bot tried to read blockchain data through an RPC endpoint, but it failed: RPC request failed while reading [protected path]. Automatic retry remains active.' })
	expect(JSON.stringify(unquotedRelativeProtectedFailureState)).not.toContain(relativePathMarker)
	state.lastError = `RPC request failed while reading state/${relativePathMarker}.sqlite`
	const alternateRelativeProtectedFailureState = await fetch(`${origin}/api/state`).then(response => response.json())
	expect(alternateRelativeProtectedFailureState).toMatchObject({ lastError: 'The bot tried to read blockchain data through an RPC endpoint, but it failed: RPC request failed while reading [protected path]. Automatic retry remains active.' })
	expect(JSON.stringify(alternateRelativeProtectedFailureState)).not.toContain(relativePathMarker)
	state.lastError = `RPC wss://operator:${credentialMarker}@rpc.example/private failed while reading (detail)state/${relativePathMarker}`
	const schemeAndDelimiterProtectedState = await fetch(`${origin}/api/state`).then(response => response.json())
	expect(schemeAndDelimiterProtectedState).toMatchObject({ lastError: 'The bot tried to read blockchain data through an RPC endpoint, but it failed: RPC [redacted URL] failed while reading [protected path]. Automatic retry remains active.' })
	expect(JSON.stringify(schemeAndDelimiterProtectedState)).not.toContain(credentialMarker)
	expect(JSON.stringify(schemeAndDelimiterProtectedState)).not.toContain(relativePathMarker)
	state.lastError = `RPC ws:operator:${credentialMarker}@rpc.example failed`
	const compactSchemeProtectedState = await fetch(`${origin}/api/state`).then(response => response.json())
	expect(JSON.stringify(compactSchemeProtectedState)).not.toContain(credentialMarker)
	state.lastError = `RPC api key=${credentialMarker} failed with auth='Basic ${endpointCredentialMarker} value'`
	const labeledCredentialFailureState = await fetch(`${origin}/api/state`).then(response => response.json())
	expect(labeledCredentialFailureState).toMatchObject({ lastError: 'The bot tried to read blockchain data through an RPC endpoint, but it failed: RPC api key=[redacted] failed with auth=[redacted]. Automatic retry remains active.' })
	expect(JSON.stringify(labeledCredentialFailureState)).not.toContain(credentialMarker)
	expect(JSON.stringify(labeledCredentialFailureState)).not.toContain(endpointCredentialMarker)
	state.lastError = `RPC provider returned {"password":"${credentialMarker}'tail value","secret":"${endpointCredentialMarker}\\"tail value"}`
	const quotedCredentialFailureState = await fetch(`${origin}/api/state`).then(response => response.json())
	expect(quotedCredentialFailureState).toMatchObject({ lastError: 'The bot tried to read blockchain data through an RPC endpoint, but it failed: RPC provider returned {"password":"[redacted]","secret":"[redacted]"}. Automatic retry remains active.' })
	expect(JSON.stringify(quotedCredentialFailureState)).not.toContain(credentialMarker)
	expect(JSON.stringify(quotedCredentialFailureState)).not.toContain(endpointCredentialMarker)
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
		isNetworkConfigured: () => true,
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
	expect(await response.json()).toEqual({ error: 'The bot tried to load the latest operator state for the dashboard, but it failed: RPC unavailable. Automatic retry remains active.' })
})

test('rejects every chain-specific mutation until network connectivity is configured', async () => {
	let configured = false
	let chainSpecificMutations = 0
	let pauseMutations = 0
	const strategy: MutableStrategy = {
		maxSpotTwapTicks: 100n,
		minimumProfitBps: 100n,
		minimumProfitAttoWeth: 10n ** 16n,
		minimumRemainingBlocks: 3n,
		minimumRemainingSeconds: 36n,
		pollMilliseconds: 12_000,
		twapSeconds: 1_800,
	}
	const server = startDashboardServer(0, {
		getSnapshot: () => {
			throw new Error('Not needed')
		},
		isNetworkConfigured: () => configured,
		setPaused: () => {
			pauseMutations += 1
		},
		updateConfiguration: () => {
			chainSpecificMutations += 1
			return {}
		},
		updateConnectivity: () => {
			configured = true
			return {}
		},
		updateDeployment: () => {
			chainSpecificMutations += 1
			throw new Error('Unexpected deployment update')
		},
		deployExecutor: () => {
			chainSpecificMutations += 1
			throw new Error('Unexpected executor deployment')
		},
		predictExecutor: () => {
			chainSpecificMutations += 1
			throw new Error('Unexpected executor prediction')
		},
		updateSigner: () => {
			chainSpecificMutations += 1
			return { wallet: undefined }
		},
		updateSubmission: () => {
			chainSpecificMutations += 1
			return validateSubmissionSettings({ mode: 'public', relayUrls: [] })
		},
		updateStrategy: () => {
			chainSpecificMutations += 1
			return {
				maxSpotTwapTicks: strategy.maxSpotTwapTicks.toString(),
				minimumProfitBps: strategy.minimumProfitBps.toString(),
				minimumProfitWeth: '0.01',
				minimumRemainingBlocks: strategy.minimumRemainingBlocks.toString(),
				minimumRemainingSeconds: strategy.minimumRemainingSeconds.toString(),
				pollMilliseconds: strategy.pollMilliseconds,
				twapSeconds: strategy.twapSeconds,
			}
		},
		updateTokens: () => {
			chainSpecificMutations += 1
			return []
		},
	})
	servers.push(server)
	const origin = `http://${server.hostname}:${server.port}`
	const request = async (pathname: string, method: 'POST' | 'PUT' = 'PUT', body: unknown = {}) => {
		const encoded = JSON.stringify(body)
		if (encoded === undefined) throw new Error('Test request body must be JSON serializable')
		return await fetch(`${origin}${pathname}`, {
			body: encoded,
			headers: { 'content-type': 'application/json', origin },
			method,
		})
	}
	for (const [pathname, method, body] of [
		['/api/configuration', 'PUT', {}],
		['/api/settings', 'PUT', {}],
		['/api/submission', 'PUT', {}],
		['/api/deployment', 'PUT', {}],
		['/api/executor-deployment', 'POST', {}],
		['/api/executor-prediction', 'POST', {}],
		['/api/tokens', 'PUT', []],
		['/api/signer', 'PUT', {}],
		['/api/paused', 'PUT', { paused: false }],
	] as const) {
		expect((await request(pathname, method, body)).status).toBe(400)
	}
	expect(chainSpecificMutations).toBe(0)
	expect(pauseMutations).toBe(0)
	expect((await request('/api/paused', 'PUT', { paused: true })).status).toBe(200)
	expect(pauseMutations).toBe(1)
	expect((await request('/api/connectivity')).status).toBe(200)
	expect(configured).toBe(true)
	expect((await request('/api/tokens', 'PUT', [])).status).toBe(200)
	expect(chainSpecificMutations).toBe(1)
})

test('supports loopback and configured network authorities for a container bind', async () => {
	const password = 'correct horse battery staple'
	const publicAuthority = 'dashboard.example'
	expect(() =>
		startDashboardServer(0, {
			getSnapshot: () => {
				throw new Error('Not needed')
			},
			hostname: '0.0.0.0',
			isNetworkConfigured: () => true,
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
		isNetworkConfigured: () => true,
		password,
		publicAuthority,
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
	const publicOrigin = `http://${publicAuthority}`
	const publicResponse = await fetch(origin, { headers: { authorization, host: publicAuthority } })
	expect(publicResponse.status).toBe(200)
	const publicMutation = await fetch(`${origin}/api/paused`, {
		body: JSON.stringify({ paused: true }),
		headers: { authorization, 'content-type': 'application/json', host: publicAuthority, origin: publicOrigin },
		method: 'PUT',
	})
	expect(publicMutation.status).toBe(200)
	const mixedAuthorityMutation = await fetch(`${origin}/api/paused`, {
		body: JSON.stringify({ paused: false }),
		headers: { authorization, 'content-type': 'application/json', origin: publicOrigin },
		method: 'PUT',
	})
	expect(mixedAuthorityMutation.status).toBe(403)
})

test('allows passwordless access through an explicitly loopback-published container port', async () => {
	const server = startDashboardServer(0, {
		getSnapshot: () => {
			throw new Error('Not needed')
		},
		hostname: '0.0.0.0',
		isNetworkConfigured: () => true,
		loopbackPublished: true,
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
	expect((await fetch(`http://127.0.0.1:${server.port}`)).status).toBe(200)
})
