import { decodeSnapshot } from '../../src/dashboard/api-validation.ts'
import { afterEach, describe, expect, test } from 'bun:test'
import { startDashboardServer } from '../../src/dashboard/dashboard-server.ts'
import { EndpointCheckFailure } from '@zoltar/bot-shared/monitoring/connectivity'

const servers: ReturnType<typeof startDashboardServer>[] = []

afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true)
})

type DashboardControls = Parameters<typeof startDashboardServer>[1]

/** Loopback controls for a configured network whose required mutations echo their request. */
function startServer(overrides: Partial<DashboardControls> = {}) {
	const server = startDashboardServer(0, {
		getConfiguration: () => ({ selectedPools: [], strategy: {} }),
		getState: () => ({ paused: false }),
		hostname: '127.0.0.1',
		isNetworkConfigured: () => true,
		setApprovedUniverses: value => value,
		setPaused: value => value,
		setSelectedPools: value => value,
		setSigner: value => value,
		setStrategy: value => value,
		...overrides,
	})
	servers.push(server)
	return server
}

/** Sends a same-origin JSON mutation to the dashboard. */
function putJson(server: ReturnType<typeof startDashboardServer>, pathname: string, body: unknown) {
	const encoded = JSON.stringify(body)
	if (encoded === undefined) throw new Error('Test request body must be JSON serializable')
	return fetch(new URL(pathname, server.url), { body: encoded, headers: { 'content-type': 'application/json', origin: server.url.origin }, method: 'PUT' })
}

describe('liquidator dashboard server', () => {
	test('returns only the fields consumed by the public dashboard', async () => {
		const calldataMarker = `0x${'de'.repeat(64)}`
		const protectedPath = '/protected/operator-state.json'
		const rpcSecret = 'liquidator-rpc-secret'
		const server = startDashboardServer(0, {
			getConfiguration: () => ({}),
			getState: () => ({
				activities: [
					{
						at: '2026-08-13T00:00:00.000Z',
						details: `to=0x1111111111111111111111111111111111111111 data=${calldataMarker} value=0`,
						hash: `0x${'12'.repeat(32)}`,
						internalPath: protectedPath,
						kind: 'liquidation',
						message: 'Transaction submitted',
						status: 'pending',
					},
				],
				alerts: [{ internalPath: protectedPath, message: 'Execution is paused', severity: 'warning' }],
				execute: true,
				network: 'mainnet',
				operatorCapable: false,
				deploymentMissingName: 'Zoltar',
				deploymentCheckedBlock: '12345679',
				deploymentCheckedTimestamp: '1786924812',
				lastScannedBlock: '12345678',
				lastScannedTimestamp: '1786924800',
				metrics: {
					approvedUniverseCount: 1,
					assumedOpenInterestEth: '2',
					candidateCount: 1,
					deployedRep: '3',
					eligiblePoolCount: 1,
					internalPath: protectedPath,
					poolCount: 1,
					selectedPoolCount: 1,
					walletEth: '4',
					walletRep: '5',
				},
				operatorPath: protectedPath,
				paused: false,
				pendingStagedOperations: [
					{
						candidateBlock: '119',
						coordinator: '0x1111111111111111111111111111111111111111',
						historicalRecoveryComplete: false,
						internalPath: protectedPath,
						latestRecoveryBlock: '120',
						operationId: '7',
						queuedBlock: '100',
						target: '0x2222222222222222222222222222222222222222',
					},
				],
				rpcEndpointHealth: [
					{
						consecutiveFailures: 2,
						error: `RPC https://user:${rpcSecret}@rpc.example/private failed`,
						lastFailureAt: '2026-08-13T00:00:00.000Z',
						lastSuccessAt: undefined,
						latencyMilliseconds: undefined,
						nextRetryAt: '2026-08-13T00:01:00.000Z',
						status: 'offline',
						target: `https://user:${rpcSecret}@rpc.example/private?token=${rpcSecret}`,
					},
				],
				pendingTransactions: [
					{
						hash: `0x${'12'.repeat(32)}`,
						kind: 'liquidation',
						label: 'Liquidate vault',
						maxBlockNumber: '120',
						mode: 'public',
						nonce: '7',
						receiptExpectation: { path: protectedPath },
						requiresMarketEvidence: true,
						serializedTransaction: calldataMarker,
						submissionBlock: '100',
					},
				],
				pools: [
					{
						address: '0x2222222222222222222222222222222222222222',
						approvedUniverse: true,
						botVault: {
							address: 'vault-address-marker',
							capacityOwnershipEth: '6',
							claimableFeesEth: '0.1',
							healthBps: '12500',
							openInterestDisplay: '2',
							protectedPath,
							vaultRepBacking: '7',
						},
						candidates: [{ bonusValueEth: '0.25', calldata: calldataMarker, requestedDebtEth: '8', target: 'candidate-target-marker' }],
						centralizedPriceAllowed: true,
						isPriceValid: true,
						knownVaultCount: '9',
						lastPrice: '10',
						manager: 'manager-marker',
						multiplierBps: '20000',
						questionId: '11',
						selected: true,
						systemState: '0',
						totalCapacityOwnershipEth: '12',
						totalPoolHeldRep: '13',
						universeId: '14',
						vaults: [{ address: 'nested-vault-marker', path: protectedPath }],
					},
				],
				scanning: false,
				status: 'connectivity-degraded',
				marketSources: [],
				universes: [],
				wallet: '0x3333333333333333333333333333333333333333',
				walletRep: { protected: calldataMarker },
			}),
			hostname: '127.0.0.1',
			isNetworkConfigured: () => true,
			setApprovedUniverses: value => value,
			setPaused: value => value,
			setSelectedPools: value => value,
			setSigner: value => value,
			setStrategy: value => value,
		})
		servers.push(server)

		const response = await fetch(new URL('/api/state', server.url))
		const body = await response.text()
		const snapshot: unknown = JSON.parse(body)
		if (typeof snapshot !== 'object' || snapshot === null || Array.isArray(snapshot)) throw new Error('Expected public dashboard snapshot')
		expect(response.status).toBe(200)
		expect(() => decodeSnapshot(snapshot)).not.toThrow()
		expect(body).not.toContain(calldataMarker)
		expect(body).not.toContain(protectedPath)
		expect(body).not.toContain(rpcSecret)
		expect(Reflect.get(snapshot, 'status')).toBe('connectivity-degraded')
		expect(Reflect.get(snapshot, 'deploymentMissingName')).toBe('Zoltar')
		expect(Reflect.get(snapshot, 'deploymentCheckedBlock')).toBe('12345679')
		expect(Reflect.get(snapshot, 'deploymentCheckedTimestamp')).toBe('1786924812')
		expect(Reflect.get(snapshot, 'lastScannedBlock')).toBe('12345678')
		expect(Reflect.get(snapshot, 'lastScannedTimestamp')).toBe('1786924800')
		expect(Reflect.get(snapshot, 'rpcEndpointHealth')).toEqual([
			{ consecutiveFailures: 2, error: 'The bot tried to read blockchain data through an RPC endpoint, but it failed: RPC https://rpc.example failed. Automatic retry remains active.', lastFailureAt: '2026-08-13T00:00:00.000Z', nextRetryAt: '2026-08-13T00:01:00.000Z', status: 'offline', target: 'https://rpc.example' },
		])
		expect(body).not.toContain('manager-marker')
		expect(body).not.toContain('nested-vault-marker')
		expect(body).not.toContain('candidate-target-marker')
		expect(body).not.toContain('vault-address-marker')
		expect(Reflect.get(snapshot, 'activities')).toEqual([{ at: '2026-08-13T00:00:00.000Z', hash: `0x${'12'.repeat(32)}`, message: 'Transaction submitted', status: 'pending' }])
		expect(Reflect.get(snapshot, 'pendingStagedOperations')).toEqual([
			{
				candidateBlock: '119',
				coordinator: '0x1111111111111111111111111111111111111111',
				historicalRecoveryComplete: false,
				latestRecoveryBlock: '120',
				operationId: '7',
				queuedBlock: '100',
				target: '0x2222222222222222222222222222222222222222',
			},
		])
		expect(Reflect.get(snapshot, 'pools')).toEqual([
			{
				address: '0x2222222222222222222222222222222222222222',
				approvedUniverse: true,
				bestCandidateBonusValueEth: '0.25',
				botVault: { capacityOwnershipEth: '6', claimableFeesEth: '0.1', healthBps: '12500', openInterestDisplay: '2', vaultRepBacking: '7' },
				candidateCount: 1,
				centralizedPriceAllowed: true,
				isPriceValid: true,
				knownVaultCount: '9',
				lastPrice: '10',
				multiplierBps: '20000',
				questionId: '11',
				selected: true,
				systemState: '0',
				totalCapacityOwnershipEth: '12',
				totalPoolHeldRep: '13',
				universeId: '14',
			},
		])
	})

	test('keeps snapshot and controller failures out of public dashboard responses', async () => {
		const credential = 'https://operator:operator-secret@rpc.example/private'
		const server = startServer({
			getConfiguration: () => {
				throw new Error(`configuration read failed at ${credential}`)
			},
			getState: () => ({
				activities: [{ at: '2026-08-13T00:00:00.000Z', details: `provider rejected ${credential}`, kind: 'error', message: 'Scan cycle failed', status: 'failed' }],
				alerts: [{ message: `RPC alert from ${credential}`, severity: 'error' }],
				error: `RPC ${credential} returned authorization=Bearer-secret`,
			}),
			setPaused: () => {
				throw new Error(`pause write failed at ${credential}`)
			},
		})

		const snapshotResponse = await fetch(new URL('/api/state', server.url))
		const snapshotBody = await snapshotResponse.text()
		expect(snapshotResponse.status).toBe(200)
		expect(snapshotBody).not.toContain('operator-secret')
		expect(snapshotBody).not.toContain('/private')
		expect(snapshotBody).not.toContain('Bearer-secret')
		expect(snapshotBody).toContain('read blockchain data through an RPC endpoint')

		const configurationResponse = await fetch(new URL('/api/configuration', server.url))
		const configurationBody = await configurationResponse.text()
		expect(configurationResponse.status).toBe(503)
		expect(configurationBody).not.toContain('operator-secret')
		expect(configurationBody).not.toContain('rpc.example')

		const mutationResponse = await putJson(server, '/api/paused', { paused: true })
		const mutationBody = await mutationResponse.text()
		expect(mutationResponse.status).toBe(400)
		expect(mutationBody).not.toContain('operator-secret')
		expect(mutationBody).not.toContain('rpc.example')
	})

	test('serves the dashboard and protects configuration mutations by origin', async () => {
		let paused = false
		let marketConfiguration: unknown
		let networkConnectivity: unknown
		let reconciliation: unknown
		const server = startServer({
			getState: () => ({ paused }),
			reconcileTransaction: value => {
				reconciliation = value
				return value
			},
			setMarketConfiguration: value => {
				marketConfiguration = value
				return value
			},
			setNetworkConnectivity: value => {
				networkConnectivity = value
				return value
			},
			setPaused: value => {
				paused = Reflect.get(value as object, 'paused') === true
				return { paused }
			},
			testMarketSources: () => ({ assets: [], blockNumber: '1' }),
		})
		const health = await fetch(new URL('/healthz', server.url))
		expect(health.status).toBe(200)
		expect(await health.text()).toBe('ok')
		const page = await fetch(server.url)
		expect(page.status).toBe(200)
		expect(page.headers.get('content-security-policy')).toContain("object-src 'none'")
		expect(page.headers.get('cross-origin-resource-policy')).toBe('same-origin')
		expect(page.headers.get('permissions-policy')).toContain('camera=()')
		expect(page.headers.get('x-frame-options')).toBe('DENY')
		const pageSource = await page.text()
		expect(pageSource).toContain('Statoblast liquidator')
		const favicon = await fetch(new URL('/favicon.svg', server.url))
		expect(favicon.status).toBe(200)
		expect(favicon.headers.get('content-type')).toBe('image/svg+xml')
		expect(await favicon.text()).toBe(await Bun.file(new URL('../../src/dashboard/favicon.svg', import.meta.url)).text())
		for (const route of ['overview', 'pools', 'markets', 'operations', 'settings']) {
			const routedPage = await fetch(new URL(`/${route}`, server.url))
			expect(routedPage.status).toBe(200)
			expect(await routedPage.text()).toContain(`<body data-page="${route}">`)
		}
		expect(pageSource).toContain('id="centralized-market-status" class="muted" role="status" aria-live="polite"')
		expect(pageSource).toContain('id="centralized-market-summary" class="metric-grid"')
		expect(pageSource).not.toContain('id="centralized-market-summary" class="metric-grid" aria-live')
		expect(pageSource).toContain('id="centralized-market-price"')
		expect(pageSource).toContain('id="dex-market-price"')
		expect(pageSource).toContain('id="guarded-market-price"')
		expect(pageSource).toContain('id="market-configuration-editor"')
		expect(pageSource).toContain('id="network-name"')
		expect(pageSource).toContain('id="settings-chain-scope"')
		expect(pageSource).toContain('id="network-scope-summary"')
		expect(pageSource).toContain('Select a chain profile first')
		expect(pageSource).toContain('id="network-badge"')
		expect(pageSource).not.toContain('id="refresh-button"')
		expect(pageSource).toContain('id="test-market-sources"')
		expect(pageSource).toContain('id="recovery-list"')
		expect(pageSource).toContain('id="resume-dialog"')
		expect(pageSource).toContain('class="section-nav"')
		expect(pageSource).toContain('Approved universes')
		expect(pageSource).not.toContain('public CCXT sources')
		expect(pageSource).toContain('id="metrics" class="metric-grid operator-metrics"')
		expect(pageSource).not.toContain('id="metrics" class="metric-grid" aria-live')
		const sharedStyles = await fetch(new URL('/operator-console.css', server.url))
		expect(sharedStyles.status).toBe(200)
		expect(await sharedStyles.text()).toContain('.operator-shell')
		const headerScript = await fetch(new URL('/header-notices.js', server.url))
		expect(headerScript.status).toBe(200)
		expect(headerScript.headers.get('content-type')).toContain('text/javascript')
		expect(await headerScript.text()).toContain('MutationObserver')
		const rejected = await fetch(new URL('/api/paused', server.url), {
			body: JSON.stringify({ paused: true }),
			headers: {
				'content-type': 'application/json',
				origin: 'https://attacker.example',
			},
			method: 'PUT',
		})
		expect(rejected.status).toBe(403)
		const accepted = await putJson(server, '/api/paused', { paused: true })
		expect(accepted.status).toBe(200)
		expect(paused).toBe(true)
		const marketMutation = await putJson(server, '/api/market-configuration', { sources: [] })
		expect(marketMutation.status).toBe(200)
		expect(marketConfiguration).toEqual({ sources: [] })
		const networkMutation = await putJson(server, '/api/network-connectivity', { connectivity: { publicRpcUrls: ['https://rpc.example'], quorumRpcUrls: [], readRpcUrl: 'https://rpc.example' }, network: 'sepolia' })
		expect(networkMutation.status).toBe(200)
		expect(networkConnectivity).toEqual({ connectivity: { publicRpcUrls: ['https://rpc.example'], quorumRpcUrls: [], readRpcUrl: 'https://rpc.example' }, network: 'sepolia' })
		const sourceTest = await putJson(server, '/api/test-market-sources', {})
		expect(sourceTest.status).toBe(200)
		const recoveryRequest = { intentHash: `0x${'1'.repeat(64)}`, replacementHash: `0x${'2'.repeat(64)}` }
		const recovery = await putJson(server, '/api/reconcile-transaction', recoveryRequest)
		expect(recovery.status).toBe(200)
		expect(reconciliation).toEqual(recoveryRequest)
	})

	const unreachableReth = 'RPC http://reth:8545 failed while calling eth_chainId: Unable to connect. Is the computer able to access the url?'
	const connectivitySecret = 'liquidator-connectivity-secret'
	const credentialFailure = `RPC https://rpc.example failed while calling eth_chainId: connection refused; project id ${connectivitySecret}`
	test.each([
		{
			name: 'a specific failure for unreachable local RPC hostnames',
			failure: new EndpointCheckFailure(`${unreachableReth}; ${unreachableReth}`, [
				{ chainId: undefined, checkedAt: '2026-09-01T00:00:00.000Z', error: unreachableReth, kind: 'read-rpc', status: 'failed', target: 'http://reth:8545' },
				{ chainId: undefined, checkedAt: '2026-09-01T00:00:00.000Z', error: unreachableReth, kind: 'public-rpc', status: 'failed', target: 'http://reth:8545' },
			]),
			rpcUrl: 'http://reth:8545',
			error: `${unreachableReth} The hostname reth must resolve from the bot process; Docker service names like reth only work when the bot shares that container network.`,
		},
		{ name: 'safe URL-length validation failures verbatim', failure: new Error('RPC URLs must not exceed 2048 characters'), rpcUrl: 'https://rpc.example', error: 'RPC URLs must not exceed 2048 characters' },
		{ name: 'safe read-quorum validation failures verbatim', failure: new Error('At most 8 read quorum RPC URLs are supported'), rpcUrl: 'https://rpc.example', error: 'At most 8 read quorum RPC URLs are supported' },
		{
			name: 'credential-bearing failures redacted',
			failure: new EndpointCheckFailure(credentialFailure, [{ chainId: undefined, checkedAt: '2026-09-01T00:00:00.000Z', error: credentialFailure, kind: 'read-rpc', status: 'failed', target: 'https://rpc.example' }]),
			rpcUrl: 'https://rpc.example',
			error: 'RPC https://rpc.example failed while calling eth_chainId. Review the endpoint and protected bot logs.',
		},
	])('returns $name for a connectivity update', async ({ failure, rpcUrl, error }) => {
		const server = startServer({
			setNetworkConnectivity: () => {
				throw failure
			},
		})

		const response = await putJson(server, '/api/network-connectivity', { connectivity: { publicRpcUrls: [rpcUrl], quorumRpcUrls: [], readRpcUrl: rpcUrl }, network: 'sepolia' })
		const body = await response.text()

		expect(response.status).toBe(400)
		expect(body).not.toContain(connectivitySecret)
		expect(JSON.parse(body)).toEqual({ error })
	})

	test('accepts configured network authority when bound to all interfaces', async () => {
		let paused = false
		const password = 'correct horse battery staple'
		const publicAuthority = 'dashboard.example'
		expect(() => startServer({ hostname: '0.0.0.0' })).toThrow('ZOLTAR_BOT_DASHBOARD_PASSWORD')
		const server = startServer({
			getConfiguration: () => ({}),
			getState: () => ({ paused }),
			hostname: '0.0.0.0',
			password,
			publicAuthority,
			setPaused: value => {
				paused = Reflect.get(value as object, 'paused') === true
				return { paused }
			},
		})
		const origin = `http://127.0.0.1:${server.port}`
		const unauthorized = await fetch(origin)
		expect(unauthorized.status).toBe(401)
		expect(unauthorized.headers.get('www-authenticate')).toContain('Basic')
		const authorization = `Basic ${Buffer.from(`operator:${password}`).toString('base64')}`
		const page = await fetch(origin, { headers: { authorization } })
		expect(page.status).toBe(200)
		const publicOrigin = `http://${publicAuthority}`
		const publicPage = await fetch(origin, { headers: { authorization, host: publicAuthority } })
		expect(publicPage.status).toBe(200)
		const mutation = await fetch(`${origin}/api/paused`, {
			body: JSON.stringify({ paused: true }),
			headers: {
				authorization,
				'content-type': 'application/json',
				host: publicAuthority,
				origin: publicOrigin,
			},
			method: 'PUT',
		})
		expect(mutation.status).toBe(200)
		const mixedAuthorityMutation = await fetch(`${origin}/api/paused`, {
			body: JSON.stringify({ paused: false }),
			headers: { authorization, 'content-type': 'application/json', origin: publicOrigin },
			method: 'PUT',
		})
		expect(mixedAuthorityMutation.status).toBe(403)
		expect(paused).toBe(true)
	})

	test('rejects every chain-specific mutation until network connectivity is configured', async () => {
		let configured = false
		let chainSpecificMutations = 0
		let pauseMutations = 0
		const mutate = (value: unknown) => {
			chainSpecificMutations += 1
			return value
		}
		const server = startDashboardServer(0, {
			getConfiguration: () => ({}),
			getState: () => ({}),
			hostname: '127.0.0.1',
			isNetworkConfigured: () => configured,
			reconcileTransaction: mutate,
			setApprovedUniverses: mutate,
			setMarketConfiguration: mutate,
			setNetworkConnectivity: value => {
				configured = true
				return value
			},
			setPaused: value => {
				pauseMutations += 1
				return value
			},
			setSelectedPools: mutate,
			setExecution: mutate,
			setSigner: mutate,
			setStrategy: mutate,
			setSubmission: mutate,
			testMarketSources: mutate,
		})
		servers.push(server)
		const request = async (pathname: string, body: unknown = {}) => {
			const encoded = JSON.stringify(body)
			if (encoded === undefined) throw new Error('Test request body must be JSON serializable')
			return await fetch(new URL(pathname, server.url), {
				body: encoded,
				headers: { 'content-type': 'application/json', origin: server.url.origin },
				method: 'PUT',
			})
		}
		for (const [pathname, body] of [
			['/api/approved-universes', []],
			['/api/execution', { execute: true }],
			['/api/market-configuration', {}],
			['/api/paused', { paused: false }],
			['/api/reconcile-transaction', {}],
			['/api/selected-pools', []],
			['/api/signer', {}],
			['/api/strategy', {}],
			['/api/submission', {}],
			['/api/test-market-sources', {}],
		] as const) {
			expect((await request(pathname, body)).status).toBe(400)
		}
		expect(chainSpecificMutations).toBe(0)
		expect(pauseMutations).toBe(0)
		expect((await request('/api/paused', { paused: true })).status).toBe(200)
		expect(pauseMutations).toBe(1)
		expect((await request('/api/network-connectivity')).status).toBe(200)
		expect(configured).toBe(true)
		expect((await request('/api/strategy')).status).toBe(200)
		expect(chainSpecificMutations).toBe(1)
	})

	test('names the execution prerequisite or the competing signer owner without leaking the lock path', async () => {
		let failure = 'Live execution requires an active signer'
		const server = startServer({
			getConfiguration: () => ({}),
			getState: () => ({}),
			setExecution: () => {
				throw new Error(failure)
			},
			setPaused: () => {
				throw new Error(failure)
			},
			setSigner: () => {
				throw new Error(failure)
			},
		})
		const request = async (endpoint = '/api/execution') => {
			const response = await fetch(new URL(endpoint, server.url), { body: JSON.stringify({ execute: true }), headers: { 'content-type': 'application/json', origin: server.url.origin }, method: 'PUT' })
			expect(response.status).toBe(400)
			return Reflect.get(Object(await response.json()), 'error')
		}
		expect(await request()).toBe('Live execution requires an active signer')
		failure = 'The saved key differs from the active signer; return to dry run and save or remove the conflicting saved key before rearming live execution'
		expect(await request()).toBe(failure)
		for (const endpoint of ['/api/signer', '/api/paused']) expect(await request(endpoint)).toBe(failure)
		failure = 'Resolve pending transaction and staged-operation recovery before changing the signer'
		expect(await request('/api/signer')).toBe(failure)
		failure = 'Execution signer 0x1111111111111111111111111111111111111111 on chain 1 is already locked (pid 4242 on host-a). Stop the other process before removing /workspace/.state/locks/signer.lock.'
		expect(await request()).toBe('The signer is reserved by another liquidator process. Stop it or choose another signer before going live.')
		failure = 'ENOENT: /workspace/.state/operator.json'
		for (const endpoint of ['/api/signer', '/api/paused']) expect(await request(endpoint)).not.toContain(failure)
		expect(await request()).toBe('Execution mode could not be changed. Review the signer, quorum RPCs, and protected bot logs.')
	})
})

test('bounds factory browsing, gates network setup, sanitizes failures, and protects support mutations', async () => {
	let configured = false
	let fail = false
	const pages: number[] = []
	const searches: (string | undefined)[] = []
	const scopes: (string | undefined)[] = []
	const selections: unknown[] = []
	const server = startDashboardServer(0, {
		getConfiguration: () => ({}),
		getState: () => ({}),
		hostname: '127.0.0.1',
		isNetworkConfigured: () => configured,
		getPoolCatalog: async (page, address, scope) => {
			pages.push(page)
			searches.push(address)
			scopes.push(scope)
			if (fail) throw new Error('RPC secret at /protected/path')
			return { chainId: 1, snapshotTimestamp: '1789560060', page, pageCount: '0', total: '0', pools: [] }
		},
		setSupportedPool: value => {
			selections.push(value)
			return {}
		},
		setApprovedUniverses: () => ({}),
		setPaused: () => ({}),
		setSelectedPools: () => ({}),
		setSigner: () => ({}),
		setStrategy: () => ({}),
	})
	servers.push(server)
	const catalog = new URL('/api/pool-catalog', server.url)
	expect((await fetch(catalog)).status).toBe(400)
	expect(pages).toEqual([])
	configured = true
	expect((await fetch(new URL('/api/pool-catalog?page=-1', server.url))).status).toBe(400)
	expect((await fetch(new URL('/api/pool-catalog?page=9007199254740992', server.url))).status).toBe(400)
	expect(await (await fetch(catalog)).json()).toMatchObject({ total: '0', pools: [] })
	expect((await fetch(new URL('/api/pool-catalog?address=invalid', server.url))).status).toBe(400)
	expect((await fetch(new URL('/api/pool-catalog?address=0x1111111111111111111111111111111111111111', server.url))).status).toBe(200)
	expect(searches).toEqual([undefined, '0x1111111111111111111111111111111111111111'])
	expect((await fetch(new URL('/api/pool-catalog?scope=unknown', server.url))).status).toBe(400)
	expect((await fetch(new URL('/api/pool-catalog?scope=monitored', server.url))).status).toBe(200)
	expect(scopes).toEqual(['all', 'all', 'monitored'])
	// Another site cannot start discovery through a subresource load; the dashboard's own requests and direct navigation can.
	for (const site of ['cross-site', 'same-site']) expect((await fetch(catalog, { headers: { 'sec-fetch-site': site } })).status).toBe(403)
	for (const site of ['same-origin', 'none']) expect((await fetch(catalog, { headers: { 'sec-fetch-site': site } })).status).toBe(200)
	expect(scopes).toEqual(['all', 'all', 'monitored', 'all', 'all'])
	fail = true
	const failed = await fetch(catalog)
	expect(failed.status).toBe(503)
	expect(await failed.text()).not.toContain('secret')
	const request = { address: '0x1111111111111111111111111111111111111111', chainId: 1, supported: true }
	const mutation = new URL('/api/supported-pool', server.url)
	expect((await fetch(mutation, { method: 'PUT', body: JSON.stringify(request), headers: { origin: 'https://foreign.example', 'content-type': 'application/json' } })).status).toBe(403)
	expect(selections).toEqual([])
	expect((await fetch(mutation, { method: 'PUT', body: JSON.stringify(request), headers: { origin: server.url.origin, 'content-type': 'application/json' } })).status).toBe(200)
	expect(selections).toEqual([request])
})
