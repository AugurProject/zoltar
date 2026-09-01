import { afterEach, describe, expect, test } from 'bun:test'
import { startDashboardServer } from '../../src/dashboard/dashboard-server.ts'
import { EndpointCheckFailure } from '@zoltar/bot-shared/monitoring/connectivity'

const servers: ReturnType<typeof startDashboardServer>[] = []

afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true)
})

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
						internalPath: protectedPath,
						kind: 'liquidation',
						message: 'Transaction submitted',
						status: 'pending',
					},
				],
				alerts: [{ internalPath: protectedPath, message: 'Execution is paused', severity: 'warning' }],
				execute: true,
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
							capacityOwnershipRep: '6',
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
						totalCapacityOwnershipRep: '12',
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
		expect(body).not.toContain(calldataMarker)
		expect(body).not.toContain(protectedPath)
		expect(body).not.toContain(rpcSecret)
		expect(Reflect.get(snapshot, 'status')).toBe('connectivity-degraded')
		expect(Reflect.get(snapshot, 'lastScannedBlock')).toBe('12345678')
		expect(Reflect.get(snapshot, 'lastScannedTimestamp')).toBe('1786924800')
		expect(Reflect.get(snapshot, 'rpcEndpointHealth')).toEqual([{ consecutiveFailures: 2, error: 'RPC connectivity or canonical chain reads failed. Automatic retry remains active.', lastFailureAt: '2026-08-13T00:00:00.000Z', nextRetryAt: '2026-08-13T00:01:00.000Z', status: 'offline', target: 'https://rpc.example' }])
		expect(body).not.toContain('manager-marker')
		expect(body).not.toContain('nested-vault-marker')
		expect(body).not.toContain('candidate-target-marker')
		expect(body).not.toContain('vault-address-marker')
		expect(Reflect.get(snapshot, 'activities')).toEqual([{ at: '2026-08-13T00:00:00.000Z', message: 'Transaction submitted', status: 'pending' }])
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
				botVault: { capacityOwnershipRep: '6', claimableFeesEth: '0.1', healthBps: '12500', openInterestDisplay: '2', vaultRepBacking: '7' },
				candidateCount: 1,
				centralizedPriceAllowed: true,
				isPriceValid: true,
				knownVaultCount: '9',
				lastPrice: '10',
				multiplierBps: '20000',
				questionId: '11',
				selected: true,
				systemState: '0',
				totalCapacityOwnershipRep: '12',
				totalPoolHeldRep: '13',
			},
		])
	})

	test('keeps snapshot and controller failures out of public dashboard responses', async () => {
		const credential = 'https://operator:operator-secret@rpc.example/private'
		const server = startDashboardServer(0, {
			getConfiguration: () => {
				throw new Error(`configuration read failed at ${credential}`)
			},
			getState: () => ({
				activities: [{ at: '2026-08-13T00:00:00.000Z', details: `provider rejected ${credential}`, kind: 'error', message: 'Scan cycle failed', status: 'failed' }],
				alerts: [{ message: `RPC alert from ${credential}`, severity: 'error' }],
				error: `RPC ${credential} returned authorization=Bearer-secret`,
			}),
			hostname: '127.0.0.1',
			isNetworkConfigured: () => true,
			setApprovedUniverses: value => value,
			setPaused: () => {
				throw new Error(`pause write failed at ${credential}`)
			},
			setSelectedPools: value => value,
			setSigner: value => value,
			setStrategy: value => value,
		})
		servers.push(server)

		const snapshotResponse = await fetch(new URL('/api/state', server.url))
		const snapshotBody = await snapshotResponse.text()
		expect(snapshotResponse.status).toBe(200)
		expect(snapshotBody).not.toContain('operator-secret')
		expect(snapshotBody).not.toContain('rpc.example')
		expect(snapshotBody).not.toContain('Bearer-secret')
		expect(snapshotBody).toContain('RPC connectivity')

		const configurationResponse = await fetch(new URL('/api/configuration', server.url))
		const configurationBody = await configurationResponse.text()
		expect(configurationResponse.status).toBe(503)
		expect(configurationBody).not.toContain('operator-secret')
		expect(configurationBody).not.toContain('rpc.example')

		const mutationResponse = await fetch(new URL('/api/paused', server.url), {
			body: JSON.stringify({ paused: true }),
			headers: { 'content-type': 'application/json', origin: server.url.origin },
			method: 'PUT',
		})
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
		const server = startDashboardServer(0, {
			getConfiguration: () => ({ selectedPools: [], strategy: {} }),
			getState: () => ({ paused }),
			hostname: '127.0.0.1',
			isNetworkConfigured: () => true,
			reconcileTransaction: value => {
				reconciliation = value
				return value
			},
			setApprovedUniverses: value => value,
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
			setSelectedPools: value => value,
			setSigner: value => value,
			setStrategy: value => value,
			testMarketSources: () => ({ assets: [], blockNumber: '1' }),
		})
		servers.push(server)
		const health = await fetch(new URL('/healthz', server.url))
		expect(health.status).toBe(200)
		expect(await health.text()).toBe('ok')
		const page = await fetch(server.url)
		expect(page.status).toBe(200)
		const pageSource = await page.text()
		expect(pageSource).toContain('Statoblast liquidator')
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
		expect(pageSource).toContain('id="market-configuration-json"')
		expect(pageSource).toContain('id="network-name"')
		expect(pageSource).toContain('id="settings-chain-scope"')
		expect(pageSource).toContain('id="network-scope-summary"')
		expect(pageSource).toContain('Select a chain profile first')
		expect(pageSource).toContain('id="network-badge"')
		expect(pageSource).toContain('id="refresh-button"')
		expect(pageSource).toContain('id="test-market-sources"')
		expect(pageSource).toContain('id="recovery-list"')
		expect(pageSource).toContain('id="resume-dialog"')
		expect(pageSource).toContain('class="section-nav"')
		expect(pageSource).toContain('Universe truth policy')
		expect(pageSource).not.toContain('public CCXT sources')
		expect(pageSource).toContain('id="metrics" class="metric-grid"')
		expect(pageSource).not.toContain('id="metrics" class="metric-grid" aria-live')
		const sharedStyles = await fetch(new URL('/operator-console.css', server.url))
		expect(sharedStyles.status).toBe(200)
		expect(await sharedStyles.text()).toContain('.operator-shell')
		const rejected = await fetch(new URL('/api/paused', server.url), {
			body: JSON.stringify({ paused: true }),
			headers: {
				'content-type': 'application/json',
				origin: 'https://attacker.example',
			},
			method: 'PUT',
		})
		expect(rejected.status).toBe(403)
		const accepted = await fetch(new URL('/api/paused', server.url), {
			body: JSON.stringify({ paused: true }),
			headers: {
				'content-type': 'application/json',
				origin: server.url.origin,
			},
			method: 'PUT',
		})
		expect(accepted.status).toBe(200)
		expect(paused).toBe(true)
		const marketMutation = await fetch(new URL('/api/market-configuration', server.url), {
			body: JSON.stringify({ sources: [] }),
			headers: { 'content-type': 'application/json', origin: server.url.origin },
			method: 'PUT',
		})
		expect(marketMutation.status).toBe(200)
		expect(marketConfiguration).toEqual({ sources: [] })
		const networkMutation = await fetch(new URL('/api/network-connectivity', server.url), {
			body: JSON.stringify({ connectivity: { publicRpcUrls: ['https://rpc.example'], quorumRpcUrls: [], readRpcUrl: 'https://rpc.example' }, network: 'sepolia' }),
			headers: { 'content-type': 'application/json', origin: server.url.origin },
			method: 'PUT',
		})
		expect(networkMutation.status).toBe(200)
		expect(networkConnectivity).toEqual({ connectivity: { publicRpcUrls: ['https://rpc.example'], quorumRpcUrls: [], readRpcUrl: 'https://rpc.example' }, network: 'sepolia' })
		const sourceTest = await fetch(new URL('/api/test-market-sources', server.url), {
			body: '{}',
			headers: { 'content-type': 'application/json', origin: server.url.origin },
			method: 'PUT',
		})
		expect(sourceTest.status).toBe(200)
		const recoveryRequest = { intentHash: `0x${'1'.repeat(64)}`, replacementHash: `0x${'2'.repeat(64)}` }
		const recovery = await fetch(new URL('/api/reconcile-transaction', server.url), {
			body: JSON.stringify(recoveryRequest),
			headers: { 'content-type': 'application/json', origin: server.url.origin },
			method: 'PUT',
		})
		expect(recovery.status).toBe(200)
		expect(reconciliation).toEqual(recoveryRequest)
	})

	test('returns a specific connectivity failure for unreachable local RPC hostnames', async () => {
		const server = startDashboardServer(0, {
			getConfiguration: () => ({ selectedPools: [], strategy: {} }),
			getState: () => ({ paused: false }),
			hostname: '127.0.0.1',
			isNetworkConfigured: () => true,
			setApprovedUniverses: value => value,
			setNetworkConnectivity: () => {
				throw new EndpointCheckFailure('RPC http://reth:8545 failed while calling eth_chainId: Unable to connect. Is the computer able to access the url?; RPC http://reth:8545 failed while calling eth_chainId: Unable to connect. Is the computer able to access the url?', [
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
			},
			setPaused: value => value,
			setSelectedPools: value => value,
			setSigner: value => value,
			setStrategy: value => value,
		})
		servers.push(server)

		const response = await fetch(new URL('/api/network-connectivity', server.url), {
			body: JSON.stringify({ connectivity: { publicRpcUrls: ['http://reth:8545'], quorumRpcUrls: [], readRpcUrl: 'http://reth:8545' }, network: 'sepolia' }),
			headers: { 'content-type': 'application/json', origin: server.url.origin },
			method: 'PUT',
		})

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({
			error: 'RPC http://reth:8545 failed while calling eth_chainId: Unable to connect. Is the computer able to access the url? The hostname reth must resolve from the bot process; Docker service names like reth only work when the bot shares that container network.',
		})
	})

	test('returns the container-network hint for anvil using Bun transport failure text', async () => {
		const server = startDashboardServer(0, {
			getConfiguration: () => ({ selectedPools: [], strategy: {} }),
			getState: () => ({ paused: false }),
			hostname: '127.0.0.1',
			isNetworkConfigured: () => true,
			setApprovedUniverses: value => value,
			setNetworkConnectivity: () => {
				throw new EndpointCheckFailure('RPC http://anvil:8545 failed while calling eth_chainId: Unable to connect. Is the computer able to access the url?', [
					{
						chainId: undefined,
						checkedAt: '2026-09-01T00:00:00.000Z',
						error: 'RPC http://anvil:8545 failed while calling eth_chainId: Unable to connect. Is the computer able to access the url?',
						kind: 'read-rpc',
						status: 'failed',
						target: 'http://anvil:8545',
					},
				])
			},
			setPaused: value => value,
			setSelectedPools: value => value,
			setSigner: value => value,
			setStrategy: value => value,
		})
		servers.push(server)

		const response = await fetch(new URL('/api/network-connectivity', server.url), {
			body: JSON.stringify({ connectivity: { publicRpcUrls: ['http://anvil:8545'], quorumRpcUrls: [], readRpcUrl: 'http://anvil:8545' }, network: 'sepolia' }),
			headers: { 'content-type': 'application/json', origin: server.url.origin },
			method: 'PUT',
		})

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({
			error: 'RPC http://anvil:8545 failed while calling eth_chainId: Unable to connect. Is the computer able to access the url? The hostname anvil must resolve from the bot process; Docker service names like anvil only work when the bot shares that container network.',
		})
	})

	test.each(['RPC URLs must not exceed 2048 characters', 'At most 8 read quorum RPC URLs are supported'])('returns safe connectivity validation failures verbatim: %s', async message => {
		const server = startDashboardServer(0, {
			getConfiguration: () => ({ selectedPools: [], strategy: {} }),
			getState: () => ({ paused: false }),
			hostname: '127.0.0.1',
			isNetworkConfigured: () => true,
			setApprovedUniverses: value => value,
			setNetworkConnectivity: () => {
				throw new Error(message)
			},
			setPaused: value => value,
			setSelectedPools: value => value,
			setSigner: value => value,
			setStrategy: value => value,
		})
		servers.push(server)

		const response = await fetch(new URL('/api/network-connectivity', server.url), {
			body: JSON.stringify({ connectivity: { publicRpcUrls: ['https://rpc.example'], quorumRpcUrls: [], readRpcUrl: 'https://rpc.example' }, network: 'sepolia' }),
			headers: { 'content-type': 'application/json', origin: server.url.origin },
			method: 'PUT',
		})

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({ error: message })
	})

	test('redacts credential-bearing connectivity failures before returning them to the dashboard', async () => {
		const secret = 'liquidator-connectivity-secret'
		const server = startDashboardServer(0, {
			getConfiguration: () => ({ selectedPools: [], strategy: {} }),
			getState: () => ({ paused: false }),
			hostname: '127.0.0.1',
			isNetworkConfigured: () => true,
			setApprovedUniverses: value => value,
			setNetworkConnectivity: () => {
				throw new EndpointCheckFailure(`RPC https://rpc.example failed while calling eth_chainId: connection refused; project id ${secret}`, [
					{ chainId: undefined, checkedAt: '2026-09-01T00:00:00.000Z', error: `RPC https://rpc.example failed while calling eth_chainId: connection refused; project id ${secret}`, kind: 'read-rpc', status: 'failed', target: 'https://rpc.example' },
				])
			},
			setPaused: value => value,
			setSelectedPools: value => value,
			setSigner: value => value,
			setStrategy: value => value,
		})
		servers.push(server)

		const response = await fetch(new URL('/api/network-connectivity', server.url), {
			body: JSON.stringify({ connectivity: { publicRpcUrls: ['https://rpc.example'], quorumRpcUrls: [], readRpcUrl: 'https://rpc.example' }, network: 'sepolia' }),
			headers: { 'content-type': 'application/json', origin: server.url.origin },
			method: 'PUT',
		})
		const body = await response.text()

		expect(response.status).toBe(400)
		expect(body).not.toContain(secret)
		expect(JSON.parse(body)).toEqual({ error: 'RPC https://rpc.example failed while calling eth_chainId. Review the endpoint and protected bot logs.' })
	})

	test('accepts configured network authority when bound to all interfaces', async () => {
		let paused = false
		const password = 'correct horse battery staple'
		const publicAuthority = 'dashboard.example'
		expect(() =>
			startDashboardServer(0, {
				getConfiguration: () => ({}),
				getState: () => ({}),
				hostname: '0.0.0.0',
				isNetworkConfigured: () => true,
				setApprovedUniverses: value => value,
				setPaused: value => value,
				setSelectedPools: value => value,
				setSigner: value => value,
				setStrategy: value => value,
			}),
		).toThrow('ZOLTAR_BOT_DASHBOARD_PASSWORD')
		const server = startDashboardServer(0, {
			getConfiguration: () => ({}),
			getState: () => ({ paused }),
			hostname: '0.0.0.0',
			isNetworkConfigured: () => true,
			password,
			publicAuthority,
			setApprovedUniverses: value => value,
			setPaused: value => {
				paused = Reflect.get(value as object, 'paused') === true
				return { paused }
			},
			setSelectedPools: value => value,
			setSigner: value => value,
			setStrategy: value => value,
		})
		servers.push(server)
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
			setSigner: mutate,
			setStrategy: mutate,
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
			['/api/market-configuration', {}],
			['/api/paused', { paused: false }],
			['/api/reconcile-transaction', {}],
			['/api/selected-pools', []],
			['/api/signer', {}],
			['/api/strategy', {}],
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

	test('allows passwordless access through an explicitly loopback-published container port', async () => {
		const server = startDashboardServer(0, {
			getConfiguration: () => ({}),
			getState: () => ({}),
			hostname: '0.0.0.0',
			isNetworkConfigured: () => true,
			loopbackPublished: true,
			setApprovedUniverses: value => value,
			setPaused: value => value,
			setSelectedPools: value => value,
			setSigner: value => value,
			setStrategy: value => value,
		})
		servers.push(server)
		expect((await fetch(`http://127.0.0.1:${server.port}`)).status).toBe(200)
	})
})
