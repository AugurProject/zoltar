import { afterEach, describe, expect, test } from 'bun:test'
import { publicChaosConfiguration, publicChaosReadiness, publicChaosState, startDashboardServer } from '../../src/dashboard/dashboard-server.ts'
import { CONFIGURATION_COMMIT_INDETERMINATE, CONFIGURATION_COMMITTED_SAFELY_PAUSED } from '../../src/runtime/dashboard-controller.ts'
import { EndpointCheckFailure } from '@zoltar/bot-shared/monitoring/connectivity'

const servers: ReturnType<typeof startDashboardServer>[] = []
const dashboardPassword = 'correct horse battery staple'

function dashboardAuthorization(password = dashboardPassword) {
	return `Basic ${Buffer.from(`operator:${password}`).toString('base64')}`
}

function authenticatedFetch(input: string | URL | Request, init: RequestInit = {}, password = dashboardPassword) {
	const headers = new Headers(init.headers)
	headers.set('authorization', dashboardAuthorization(password))
	return fetch(input, { ...init, headers })
}

afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true)
})

function controller(overrides: Partial<Parameters<typeof startDashboardServer>[1]> = {}) {
	return {
		getConfiguration: () => ({ paused: true }),
		getState: () => ({ paused: true }),
		hostname: '127.0.0.1' as const,
		password: dashboardPassword,
		setCancellation: (value: unknown) => value,
		setCandidate: (value: unknown) => value,
		setConnectivity: (value: unknown) => value,
		setObligation: (value: unknown) => value,
		setPaused: (value: unknown) => value,
		setReplacement: (value: unknown) => value,
		setSettings: (value: unknown) => value,
		setSigner: (value: unknown) => value,
		setWorkflow: (value: unknown) => value,
		...overrides,
	}
}

describe('chaos dashboard server', () => {
	test('serves five protected routes with hardened no-store responses', async () => {
		const server = startDashboardServer(0, controller())
		servers.push(server)
		const health = await fetch(new URL('/healthz', server.url))
		expect(health.status).toBe(200)
		expect(await health.text()).toBe('ok')
		expect(health.headers.get('cache-control')).toBe('no-store')
		const readiness = await authenticatedFetch(new URL('/readyz', server.url))
		expect(readiness.status).toBe(503)
		expect(await readiness.json()).toMatchObject({ ready: false })
		const metrics = await authenticatedFetch(new URL('/metrics', server.url))
		expect(metrics.status).toBe(200)
		expect(await metrics.text()).toContain('zoltar_chaos_ready 0')

		for (const route of ['overview', 'catalog', 'ecosystem', 'activity', 'settings']) {
			const response = await authenticatedFetch(new URL(`/${route}`, server.url))
			expect(response.status).toBe(200)
			expect(response.headers.get('cache-control')).toBe('no-store')
			expect(response.headers.get('content-security-policy')).toContain("default-src 'self'")
			expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
			expect(response.headers.get('permissions-policy')).toContain('camera=()')
			expect(await response.text()).toContain(`<body data-page="${route}">`)
		}

		const overview = await (await authenticatedFetch(server.url)).text()
		expect(overview).toContain('<body data-page="overview">')
		expect(overview).toContain('Operation catalog')
		expect(overview).toContain('Ecosystem state')
		expect(overview).toContain('Activity &amp; recovery')
		expect(overview).toContain('id="private-key"')
		expect(overview).toContain('id="connectivity-form"')
		expect(overview).toContain('http://reth:8545')
		expect(overview).toContain('type="password"')
		expect(overview).toContain('id="countdown"')
		expect(overview).toContain('id="replacement-hash"')
		expect(overview).toContain('id="cancellation-confirmation"')
		expect(overview).toContain('id="candidate-confirmation"')
		expect(overview).toContain('id="workflow-confirmation"')
		expect(overview).toContain('id="obligation-confirmation"')
		expect(overview).toContain('data-ecosystem-toggle="open-oracle"')
		expect(overview).not.toContain('fixture-private-key')

		const sharedStyles = await authenticatedFetch(new URL('/operator-console.css', server.url))
		expect(sharedStyles.status).toBe(200)
		expect(await sharedStyles.text()).toContain('.operator-shell')
		expect((await authenticatedFetch(new URL('/unknown', server.url))).status).toBe(404)
	})

	test('requires basic authentication on loopback for every route and mutation API', async () => {
		const password = 'another correct horse battery staple'
		expect(() => startDashboardServer(0, controller({ password: undefined }))).toThrow('for every chaos dashboard binding')
		expect(() => startDashboardServer(0, controller({ password: 'too-short' }))).toThrow('at least 16 characters')
		const authenticatedController = controller({ password })
		const server = startDashboardServer(0, authenticatedController)
		servers.push(server)
		authenticatedController.password = undefined

		expect((await fetch(new URL('/healthz', server.url))).status).toBe(200)
		for (const path of ['/', '/overview', '/catalog', '/ecosystem', '/activity', '/settings', '/api/state', '/api/configuration', '/readyz', '/metrics']) {
			const rejected = await fetch(new URL(path, server.url))
			expect(rejected.status, path).toBe(401)
			expect(rejected.headers.get('www-authenticate'), path).toContain('Basic')
		}
		for (const path of ['/api/connectivity', '/api/reconciliation/candidate', '/api/reconciliation/cancellation', '/api/reconciliation/obligation', '/api/paused', '/api/reconciliation/replacement', '/api/reconciliation/workflow', '/api/settings', '/api/signer']) {
			const rejected = await fetch(new URL(path, server.url), { method: 'PUT' })
			expect(rejected.status, path).toBe(401)
			expect(rejected.headers.get('www-authenticate'), path).toContain('Basic')
		}
		const authorization = dashboardAuthorization(password)
		const accepted = await fetch(server.url, { headers: { authorization } })
		expect(accepted.status).toBe(200)

		const wrongAuthority = await fetch(server.url, { headers: { authorization, host: 'attacker.example' } })
		expect(wrongAuthority.status).toBe(403)
	})

	test('routes RPC connectivity updates to the server controller', async () => {
		let received: unknown
		const server = startDashboardServer(
			0,
			controller({
				setConnectivity: value => {
					received = value
				},
			}),
		)
		servers.push(server)
		const body = {
			connectivity: { publicRpcUrls: ['http://reth:8545'], quorumRpcUrls: [], readRpcUrl: 'http://reth:8545', rpcQuorum: 1 },
			revision: 'revision',
		}
		const response = await authenticatedFetch(new URL('/api/connectivity', server.url), {
			body: JSON.stringify(body),
			headers: { 'content-type': 'application/json', origin: server.url.origin },
			method: 'PUT',
		})
		expect(response.status).toBe(200)
		expect(received).toEqual(body)
	})

	test('returns a specific connectivity failure for unreachable local RPC hostnames', async () => {
		const server = startDashboardServer(
			0,
			controller({
				setConnectivity: () => {
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
			}),
		)
		servers.push(server)
		const response = await authenticatedFetch(new URL('/api/connectivity', server.url), {
			body: JSON.stringify({
				connectivity: { publicRpcUrls: ['http://reth:8545'], quorumRpcUrls: [], readRpcUrl: 'http://reth:8545', rpcQuorum: 1 },
				revision: 'revision',
			}),
			headers: { 'content-type': 'application/json', origin: server.url.origin },
			method: 'PUT',
		})

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({
			error: 'RPC http://reth:8545 failed while calling eth_chainId: Unable to connect. Is the computer able to access the url? The hostname reth must resolve from the bot process; Docker service names like reth only work when the bot shares that container network.',
		})
	})

	test('returns the container-network hint for anvil using Bun transport failure text', async () => {
		const server = startDashboardServer(
			0,
			controller({
				setConnectivity: () => {
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
			}),
		)
		servers.push(server)
		const response = await authenticatedFetch(new URL('/api/connectivity', server.url), {
			body: JSON.stringify({
				connectivity: { publicRpcUrls: ['http://anvil:8545'], quorumRpcUrls: [], readRpcUrl: 'http://anvil:8545', rpcQuorum: 1 },
				revision: 'revision',
			}),
			headers: { 'content-type': 'application/json', origin: server.url.origin },
			method: 'PUT',
		})

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({
			error: 'RPC http://anvil:8545 failed while calling eth_chainId: Unable to connect. Is the computer able to access the url? The hostname anvil must resolve from the bot process; Docker service names like anvil only work when the bot shares that container network.',
		})
	})

	test.each(['RPC URLs must not exceed 2048 characters', 'At most 8 read quorum RPC URLs are supported'])('returns safe connectivity validation failures verbatim: %s', async message => {
		const server = startDashboardServer(
			0,
			controller({
				setConnectivity: () => {
					throw new Error(message)
				},
			}),
		)
		servers.push(server)
		const response = await authenticatedFetch(new URL('/api/connectivity', server.url), {
			body: JSON.stringify({
				connectivity: { publicRpcUrls: ['https://submit.example'], quorumRpcUrls: [], readRpcUrl: 'https://read.example', rpcQuorum: 1 },
				revision: 'revision',
			}),
			headers: { 'content-type': 'application/json', origin: server.url.origin },
			method: 'PUT',
		})

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({ error: message })
	})

	test('reports public submission capability failures without mislabeling them as eth_chainId failures', async () => {
		const server = startDashboardServer(
			0,
			controller({
				setConnectivity: () => {
					throw new EndpointCheckFailure('RPC https://submit.example failed while calling eth_sendRawTransaction: Endpoint did not prove eth_sendRawTransaction support: HTTP 200 RPC -32601: method not found', [
						{
							chainId: 11_155_111,
							checkedAt: '2026-09-01T00:00:00.000Z',
							error: 'RPC https://submit.example failed while calling eth_sendRawTransaction: Endpoint did not prove eth_sendRawTransaction support: HTTP 200 RPC -32601: method not found',
							failureDisposition: 'safety-paused',
							kind: 'public-rpc',
							status: 'failed',
							target: 'https://submit.example',
						},
					])
				},
			}),
		)
		servers.push(server)
		const response = await authenticatedFetch(new URL('/api/connectivity', server.url), {
			body: JSON.stringify({
				connectivity: { publicRpcUrls: ['https://submit.example'], quorumRpcUrls: [], readRpcUrl: 'https://read.example', rpcQuorum: 1 },
				revision: 'revision',
			}),
			headers: { 'content-type': 'application/json', origin: server.url.origin },
			method: 'PUT',
		})

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({
			error: "RPC https://submit.example failed while calling eth_sendRawTransaction. Review the endpoint's public transaction submission support and protected bot logs.",
		})
	})

	test('keeps unrecognized public RPC preflight failures on the chain-id phase when no chain evidence exists', async () => {
		const server = startDashboardServer(
			0,
			controller({
				setConnectivity: () => {
					throw new EndpointCheckFailure('RPC https://submit.example failed while calling eth_chainId: RPC -32000: unexpected upstream failure', [
						{
							chainId: undefined,
							checkedAt: '2026-09-01T00:00:00.000Z',
							error: 'RPC https://submit.example failed while calling eth_chainId: RPC -32000: unexpected upstream failure',
							failureDisposition: 'safety-paused',
							kind: 'public-rpc',
							status: 'failed',
							target: 'https://submit.example',
						},
					])
				},
			}),
		)
		servers.push(server)
		const response = await authenticatedFetch(new URL('/api/connectivity', server.url), {
			body: JSON.stringify({
				connectivity: { publicRpcUrls: ['https://submit.example'], quorumRpcUrls: [], readRpcUrl: 'https://read.example', rpcQuorum: 1 },
				revision: 'revision',
			}),
			headers: { 'content-type': 'application/json', origin: server.url.origin },
			method: 'PUT',
		})

		expect(response.status).toBe(400)
		expect(await response.json()).toEqual({
			error: 'RPC https://submit.example failed while calling eth_chainId. Review the endpoint and protected bot logs.',
		})
	})

	test('redacts credential-bearing connectivity failures before returning them to the dashboard', async () => {
		const secret = 'chaos-connectivity-secret'
		const server = startDashboardServer(
			0,
			controller({
				setConnectivity: () => {
					throw new EndpointCheckFailure(`RPC https://rpc.example failed while calling eth_chainId: connection refused; project id ${secret}`, [
						{ chainId: undefined, checkedAt: '2026-09-01T00:00:00.000Z', error: `RPC https://rpc.example failed while calling eth_chainId: connection refused; project id ${secret}`, kind: 'read-rpc', status: 'failed', target: 'https://rpc.example' },
					])
				},
			}),
		)
		servers.push(server)
		const response = await authenticatedFetch(new URL('/api/connectivity', server.url), {
			body: JSON.stringify({
				connectivity: { publicRpcUrls: ['https://rpc.example'], quorumRpcUrls: [], readRpcUrl: 'https://rpc.example', rpcQuorum: 1 },
				revision: 'revision',
			}),
			headers: { 'content-type': 'application/json', origin: server.url.origin },
			method: 'PUT',
		})
		const body = await response.text()

		expect(response.status).toBe(400)
		expect(body).not.toContain(secret)
		expect(JSON.parse(body)).toEqual({ error: 'RPC https://rpc.example failed while calling eth_chainId. Review the endpoint and protected bot logs.' })
	})

	test('separates liveness from machine readiness and reports recovery blockers', async () => {
		const now = Date.parse('2026-08-31T12:00:00.000Z')
		const configuration = {
			hasSigner: true,
			settings: {
				connectivity: { publicRpcUrls: ['https://submit.example'], quorumRpcUrls: [], readRpcUrl: 'https://one.example', rpcQuorum: 1 },
				network: { chainId: 11_155_111, maximumBlockIntervalSeconds: 60 },
				networkConfigured: true,
				paused: false,
				privateKey: '__redacted__',
				runtime: { execute: true, lifecyclePollMilliseconds: 12_000 },
				scheduler: { maximumDelaySeconds: 3_600 },
				strategy: { maximumEthPerOperation: '0.03', maximumGasCostEth: '0.02', maximumRepPerOperation: '5', minimumEthReserve: '0.05', minimumRepReserve: '10' },
				submission: { minimumBundleRelaySuccesses: 1, mode: 'public', relayUrls: [] },
			},
		}
		const state = {
			inventory: { eth: '100000000000000000', rep: [{ balance: '15000000000000000000' }] },
			lastScanAt: '2026-08-31T11:59:00.000Z',
			obligations: [],
			paused: false,
			pendingTransactions: [],
			rpcEndpointHealth: [
				{ chainId: 11_155_111, checkedAt: '2026-08-31T11:59:30.000Z', kind: 'read-rpc', status: 'healthy', target: 'https://one.example' },
				{ chainId: 11_155_111, checkedAt: '2026-08-31T11:59:30.000Z', kind: 'public-rpc', status: 'healthy', target: 'https://submit.example' },
			],
			safetyPaused: false,
			status: 'running',
			topology: { complete: true },
			workflows: [],
		}
		const ready = publicChaosReadiness(state, configuration, now)
		expect(ready).toMatchObject({ blockers: [], maximumScanAgeSeconds: 156, mode: 'live', ready: true, scanAgeSeconds: 60 })
		const currentTimestamp = new Date().toISOString()
		const currentState = { ...state, lastScanAt: currentTimestamp, rpcEndpointHealth: state.rpcEndpointHealth.map(check => ({ ...check, checkedAt: currentTimestamp })) }
		const server = startDashboardServer(0, controller({ getConfiguration: () => configuration, getState: () => currentState }))
		servers.push(server)
		const readyResponse = await authenticatedFetch(new URL('/readyz', server.url))
		expect(readyResponse.status).toBe(200)
		expect(await readyResponse.json()).toMatchObject({ blockers: [], ready: true })
		const metrics = await (await authenticatedFetch(new URL('/metrics', server.url))).text()
		expect(metrics).toContain('zoltar_chaos_ready 1')
		expect(metrics).toContain('zoltar_chaos_readiness_check{check="rpc"} 1')
		expect(metrics).toContain('zoltar_chaos_readiness_check{check="submission"} 1')
		expect(metrics).toContain('zoltar_chaos_active_workflows 0')
		expect(metrics).toContain('zoltar_chaos_automatic_retry_obligations 0')
		const missingSubmissionState = { ...currentState, rpcEndpointHealth: currentState.rpcEndpointHealth.filter(check => check.kind === 'read-rpc') }
		const missingSubmissionServer = startDashboardServer(0, controller({ getConfiguration: () => configuration, getState: () => missingSubmissionState }))
		servers.push(missingSubmissionServer)
		expect((await authenticatedFetch(new URL('/readyz', missingSubmissionServer.url))).status).toBe(503)
		expect(await (await authenticatedFetch(new URL('/metrics', missingSubmissionServer.url))).text()).toContain('zoltar_chaos_readiness_check{check="submission"} 0')

		const blocked = publicChaosReadiness(
			{
				...state,
				obligations: [{ status: 'failed' }],
				paused: true,
				pendingTransactions: [{ status: 'submitted' }],
				safetyPaused: true,
			},
			configuration,
			now,
		)
		expect(blocked).toMatchObject({ blockers: expect.arrayContaining(['paused', 'recovery']), failedObligationCount: 1, pendingTransactionCount: 1, ready: false, safetyPaused: true })
	})

	test('requires full live-operation principal and reserve funding at exact boundaries', () => {
		const now = Date.parse('2026-08-31T12:00:00.000Z')
		const configuration = {
			hasSigner: true,
			settings: {
				connectivity: { publicRpcUrls: ['https://submit.example'], quorumRpcUrls: [], readRpcUrl: 'https://one.example', rpcQuorum: 1 },
				network: { chainId: 11_155_111, maximumBlockIntervalSeconds: 60 },
				networkConfigured: true,
				paused: false,
				privateKey: '__redacted__',
				runtime: { execute: true, lifecyclePollMilliseconds: 12_000 },
				strategy: { maximumEthPerOperation: '0.03', maximumGasCostEth: '0.02', maximumRepPerOperation: '5', minimumEthReserve: '0.05', minimumRepReserve: '10' },
				submission: { minimumBundleRelaySuccesses: 1, mode: 'public', relayUrls: [] },
			},
		}
		const exactEth = '100000000000000000'
		const exactRep = '15000000000000000000'
		const state = {
			inventory: { eth: exactEth, rep: [{ balance: exactRep }] },
			lastScanAt: '2026-08-31T11:59:00.000Z',
			obligations: [],
			paused: false,
			pendingTransactions: [],
			rpcEndpointHealth: [
				{ chainId: 11_155_111, checkedAt: '2026-08-31T11:59:30.000Z', kind: 'read-rpc', status: 'healthy', target: 'https://one.example' },
				{ chainId: 11_155_111, checkedAt: '2026-08-31T11:59:30.000Z', kind: 'public-rpc', status: 'healthy', target: 'https://submit.example' },
			],
			safetyPaused: false,
			status: 'running',
			topology: { complete: true },
			workflows: [],
		}

		expect(publicChaosReadiness(state, configuration, now)).toMatchObject({ blockers: [], checks: { inventory: { ready: true } }, ready: true })
		const underfundedDetail = 'Live inventory does not cover the ETH reserve, maximum ETH principal, maximum gas budget, REP reserve, and maximum REP principal'
		expect(publicChaosReadiness({ ...state, inventory: { ...state.inventory, eth: (BigInt(exactEth) - 1n).toString() } }, configuration, now)).toMatchObject({
			blockers: expect.arrayContaining(['inventory']),
			checks: { inventory: { detail: underfundedDetail, ready: false } },
			ready: false,
		})
		expect(publicChaosReadiness({ ...state, inventory: { ...state.inventory, rep: [{ balance: (BigInt(exactRep) - 1n).toString() }] } }, configuration, now)).toMatchObject({
			blockers: expect.arrayContaining(['inventory']),
			checks: { inventory: { detail: underfundedDetail, ready: false } },
			ready: false,
		})
	})

	test('requires current submission-path threshold evidence for live readiness', () => {
		const now = Date.parse('2026-08-31T12:00:00.000Z')
		const wallet = '0x0000000000000000000000000000000000000001'
		const publicConfiguration = {
			hasSigner: true,
			settings: {
				connectivity: { publicRpcUrls: ['https://submit.example/path'], quorumRpcUrls: [], readRpcUrl: 'https://one.example', rpcQuorum: 1 },
				network: { chainId: 11_155_111, maximumBlockIntervalSeconds: 60 },
				networkConfigured: true,
				paused: false,
				runtime: { execute: true, lifecyclePollMilliseconds: 12_000 },
				strategy: { maximumEthPerOperation: '0.03', maximumGasCostEth: '0.02', maximumRepPerOperation: '5', minimumEthReserve: '0.05', minimumRepReserve: '10' },
				submission: { minimumBundleRelaySuccesses: 1, mode: 'public', relayUrls: [] },
			},
			wallet,
		}
		const readCheck = { chainId: 11_155_111, checkedAt: '2026-08-31T11:59:30.000Z', kind: 'read-rpc', status: 'healthy', target: 'https://one.example' }
		const state = {
			inventory: { eth: '100000000000000000', rep: [{ balance: '15000000000000000000' }] },
			lastScanAt: '2026-08-31T11:59:30.000Z',
			obligations: [],
			paused: false,
			pendingTransactions: [],
			rpcEndpointHealth: [readCheck],
			safetyPaused: false,
			status: 'running',
			topology: { complete: true },
			workflows: [],
		}
		const submissionDetail = 'Live submission endpoint evidence is missing, stale, failed, or below its required healthy-origin threshold'

		expect(publicChaosReadiness(state, publicConfiguration, now)).toMatchObject({ blockers: expect.arrayContaining(['submission']), checks: { submission: { detail: submissionDetail, ready: false } }, ready: false })
		const stalePublicCheck = { chainId: 11_155_111, checkedAt: new Date(now - 157_000).toISOString(), kind: 'public-rpc', status: 'healthy', target: 'https://submit.example' }
		expect(publicChaosReadiness({ ...state, rpcEndpointHealth: [readCheck, stalePublicCheck] }, publicConfiguration, now)).toMatchObject({ blockers: expect.arrayContaining(['submission']), checks: { submission: { ready: false } } })
		const failedPublicCheck = { chainId: undefined, checkedAt: new Date(now).toISOString(), failureDisposition: 'connectivity-degraded', kind: 'public-rpc', status: 'failed', target: 'https://submit.example' }
		expect(publicChaosReadiness({ ...state, rpcEndpointHealth: [readCheck, failedPublicCheck] }, publicConfiguration, now)).toMatchObject({ blockers: expect.arrayContaining(['submission']), checks: { submission: { ready: false } } })
		const healthyPublicCheck = { chainId: 11_155_111, checkedAt: new Date(now).toISOString(), kind: 'public-rpc', status: 'healthy', target: 'https://submit.example' }
		expect(publicChaosReadiness({ ...state, rpcEndpointHealth: [readCheck, healthyPublicCheck] }, publicConfiguration, now)).toMatchObject({ blockers: [], checks: { submission: { ready: true } }, ready: true })
		for (const invalidPublicCheck of [
			{ ...healthyPublicCheck, chainId: 1 },
			{ ...healthyPublicCheck, checkedAt: 'not-a-timestamp' },
			{ ...healthyPublicCheck, checkedAt: new Date(now + 1).toISOString() },
			{ ...healthyPublicCheck, kind: 'read-rpc' },
			{ ...healthyPublicCheck, target: 'https://unexpected.example' },
		]) {
			expect(publicChaosReadiness({ ...state, rpcEndpointHealth: [readCheck, invalidPublicCheck] }, publicConfiguration, now)).toMatchObject({ blockers: expect.arrayContaining(['submission']), checks: { submission: { ready: false } } })
		}

		const privateConfiguration = {
			...publicConfiguration,
			settings: {
				...publicConfiguration.settings,
				submission: { minimumBundleRelaySuccesses: 2, mode: 'private', relayUrls: ['https://relay-one.example/path', 'https://relay-two.example/path', 'https://relay-three.example/path'] },
			},
		}
		const privateChecks = [
			{ authenticatedAddress: wallet, chainId: 11_155_111, checkedAt: new Date(now).toISOString(), kind: 'private-relay', status: 'healthy', target: 'https://relay-one.example' },
			{ authenticatedAddress: wallet, chainId: undefined, checkedAt: new Date(now).toISOString(), failureDisposition: 'connectivity-degraded', kind: 'private-relay', status: 'failed', target: 'https://relay-two.example' },
		]
		const firstPrivateCheck = privateChecks[0]
		if (firstPrivateCheck === undefined) throw new Error('Submission-readiness fixture requires one healthy private relay')
		expect(publicChaosReadiness({ ...state, rpcEndpointHealth: [readCheck, ...privateChecks] }, privateConfiguration, now)).toMatchObject({ blockers: expect.arrayContaining(['submission']), checks: { submission: { ready: false } } })
		const duplicateRelayOriginChecks = [firstPrivateCheck, { ...firstPrivateCheck, target: 'https://relay-one.example' }]
		expect(publicChaosReadiness({ ...state, rpcEndpointHealth: [readCheck, ...duplicateRelayOriginChecks] }, privateConfiguration, now)).toMatchObject({ blockers: expect.arrayContaining(['submission']), checks: { submission: { ready: false } } })
		const enoughDistinctRelayOrigins = [...privateChecks, { authenticatedAddress: wallet, chainId: 11_155_111, checkedAt: new Date(now).toISOString(), kind: 'private-relay', status: 'healthy', target: 'https://relay-three.example' }]
		expect(publicChaosReadiness({ ...state, rpcEndpointHealth: [readCheck, ...enoughDistinctRelayOrigins] }, privateConfiguration, now)).toMatchObject({ blockers: [], checks: { submission: { ready: true } }, ready: true })
		const oldSignerRelayBatch = enoughDistinctRelayOrigins.map(check => ({ ...check, authenticatedAddress: '0x0000000000000000000000000000000000000002' }))
		expect(publicChaosReadiness({ ...state, rpcEndpointHealth: [readCheck, ...oldSignerRelayBatch] }, privateConfiguration, now)).toMatchObject({ blockers: expect.arrayContaining(['submission']), checks: { submission: { ready: false } } })
		const partiallyStaleRelayBatch = enoughDistinctRelayOrigins.map(check => (check.target === 'https://relay-two.example' ? { ...check, checkedAt: new Date(now - 157_000).toISOString() } : check))
		expect(publicChaosReadiness({ ...state, rpcEndpointHealth: [readCheck, ...partiallyStaleRelayBatch] }, privateConfiguration, now)).toMatchObject({ blockers: expect.arrayContaining(['submission']), checks: { submission: { ready: false } } })
		const safetyFailedRelayThreshold = enoughDistinctRelayOrigins.map(check => (check.target === 'https://relay-two.example' ? { ...check, failureDisposition: 'safety-paused' } : check))
		const safetyBlocked = publicChaosReadiness({ ...state, rpcEndpointHealth: [readCheck, ...safetyFailedRelayThreshold.map(check => ({ ...check, error: 'https://relay-two.example/private?api_key=secret' }))] }, privateConfiguration, now)
		expect(safetyBlocked).toMatchObject({ blockers: expect.arrayContaining(['submission']), checks: { submission: { ready: false } } })
		expect(JSON.stringify(safetyBlocked)).not.toContain('secret')
	})

	test('fails readiness on the same lifecycle states that prevent scheduled novelty', () => {
		const now = Date.parse('2026-08-31T12:00:00.000Z')
		const configuration = {
			hasSigner: false,
			settings: {
				connectivity: { publicRpcUrls: [], quorumRpcUrls: [], readRpcUrl: 'https://one.example', rpcQuorum: 1 },
				network: { chainId: 11_155_111, maximumBlockIntervalSeconds: 60 },
				networkConfigured: true,
				paused: false,
				runtime: { execute: false, lifecyclePollMilliseconds: 12_000 },
			},
		}
		const baseState = {
			lastScanAt: '2026-08-31T11:59:00.000Z',
			obligations: [],
			paused: false,
			pendingTransactions: [],
			rpcEndpointHealth: [{ chainId: 11_155_111, checkedAt: '2026-08-31T11:59:30.000Z', kind: 'read-rpc', status: 'healthy', target: 'https://one.example' }],
			safetyPaused: false,
			status: 'running',
			topology: { complete: true },
			workflows: [],
		}

		const pending = publicChaosReadiness({ ...baseState, obligations: [{ status: 'pending' }] }, configuration, now)
		expect(pending).toMatchObject({ blockers: expect.arrayContaining(['recovery']), pendingObligationCount: 1, ready: false })
		const retry = publicChaosReadiness({ ...baseState, obligations: [{ notBefore: '2026-08-31T12:01:00.000Z', status: 'deferred' }] }, configuration, now)
		expect(retry).toMatchObject({ automaticRetryObligationCount: 1, blockers: expect.arrayContaining(['recovery']), ready: false })
		const presence = publicChaosReadiness({ ...baseState, lifecyclePresenceBlocker: { count: 1 } }, configuration, now)
		expect(presence).toMatchObject({ blockers: expect.arrayContaining(['recovery']), lifecyclePresenceBlocked: true, ready: false })
		const ordinaryDeferred = publicChaosReadiness({ ...baseState, obligations: [{ status: 'deferred' }] }, configuration, now)
		expect(ordinaryDeferred).toMatchObject({ blockers: [], ready: true })
		const runtimeError = publicChaosReadiness({ ...baseState, error: 'Protocol-index RPC https://secret.example reorganized' }, configuration, now)
		expect(runtimeError).toMatchObject({ blockers: expect.arrayContaining(['runtime']), checks: { runtime: { ready: false } }, ready: false })
	})

	test('bounds scan freshness by lifecycle polling rather than the random scheduler delay', () => {
		const now = Date.parse('2026-08-31T12:00:00.000Z')
		const configuration = {
			settings: {
				connectivity: { publicRpcUrls: [], quorumRpcUrls: [], readRpcUrl: 'https://one.example', rpcQuorum: 1 },
				network: { chainId: 11_155_111, maximumBlockIntervalSeconds: 60 },
				networkConfigured: true,
				paused: false,
				runtime: { execute: false, lifecyclePollMilliseconds: 12_000 },
				scheduler: { maximumDelaySeconds: 3_600 },
			},
		}
		const state = {
			lastScanAt: new Date(now - 157_000).toISOString(),
			obligations: [],
			paused: false,
			pendingTransactions: [],
			rpcEndpointHealth: [{ chainId: 11_155_111, checkedAt: new Date(now).toISOString(), kind: 'read-rpc', status: 'healthy', target: 'https://one.example' }],
			topology: { complete: true },
			workflows: [],
		}
		expect(publicChaosReadiness(state, configuration, now)).toMatchObject({ blockers: expect.arrayContaining(['scan']), maximumScanAgeSeconds: 156, ready: false, scanAgeSeconds: 157 })
	})

	test('rejects direct non-loopback exposure and requires authentication for container publication', () => {
		expect(() =>
			startDashboardServer(
				0,
				controller({
					hostname: '0.0.0.0',
					password: 'correct horse battery staple',
				}),
			),
		).toThrow('Non-loopback chaos dashboard exposure is disabled')
		expect(() => startDashboardServer(0, controller({ hostname: '0.0.0.0', loopbackPublished: true, password: undefined }))).toThrow('for every chaos dashboard binding')
		const server = startDashboardServer(
			0,
			controller({
				hostname: '0.0.0.0',
				loopbackPublished: true,
				password: 'correct horse battery staple',
			}),
		)
		servers.push(server)
	})

	test('protects mutations by same origin, content type, body bound, and generic acknowledgements', async () => {
		const privateKey = `0x${'11'.repeat(32)}`
		const values: unknown[] = []
		const server = startDashboardServer(
			0,
			controller({
				setPaused: value => values.push(value),
				setReplacement: value => values.push(value),
				setSettings: value => values.push(value),
				setSigner: value => {
					values.push(value)
					return { privateKey, rawTransaction: `0x${'ab'.repeat(256)}` }
				},
			}),
		)
		servers.push(server)

		const crossOrigin = await authenticatedFetch(new URL('/api/paused', server.url), {
			body: JSON.stringify({ paused: true }),
			headers: { 'content-type': 'application/json', origin: 'https://attacker.example' },
			method: 'PUT',
		})
		expect(crossOrigin.status).toBe(403)

		const wrongType = await authenticatedFetch(new URL('/api/paused', server.url), {
			body: JSON.stringify({ paused: true }),
			headers: { 'content-type': 'text/plain', origin: server.url.origin },
			method: 'PUT',
		})
		expect(wrongType.status).toBe(400)

		const tooLarge = await authenticatedFetch(new URL('/api/settings', server.url), {
			body: JSON.stringify({ padding: 'x'.repeat(1024 * 1024) }),
			headers: { 'content-type': 'application/json', origin: server.url.origin },
			method: 'PUT',
		})
		expect(tooLarge.status).toBe(400)

		const signer = await authenticatedFetch(new URL('/api/signer', server.url), {
			body: JSON.stringify({ privateKey, remember: false }),
			headers: { 'content-type': 'application/json', origin: server.url.origin },
			method: 'PUT',
		})
		expect(signer.status).toBe(200)
		expect(await signer.json()).toEqual({ saved: true })
		expect(values).toContainEqual({ privateKey, remember: false })

		const replacement = {
			intentHash: `0x${'22'.repeat(32)}`,
			replacementHash: `0x${'33'.repeat(32)}`,
		}
		const queued = await authenticatedFetch(new URL('/api/reconciliation/replacement', server.url), {
			body: JSON.stringify(replacement),
			headers: {
				'content-type': 'application/json',
				origin: server.url.origin,
			},
			method: 'PUT',
		})
		expect(queued.status).toBe(200)
		expect(values).toContainEqual(replacement)
	})

	test('surfaces configuration revision conflicts without exposing internal errors', async () => {
		const conflict = new Error('sensitive path and revision detail')
		conflict.name = 'ConfigurationRevisionConflict'
		const server = startDashboardServer(
			0,
			controller({
				setSettings: () => {
					throw conflict
				},
			}),
		)
		servers.push(server)

		const response = await authenticatedFetch(new URL('/api/settings', server.url), {
			body: JSON.stringify({ patch: {}, revision: 'stale' }),
			headers: {
				'content-type': 'application/json',
				origin: server.url.origin,
			},
			method: 'PUT',
		})

		expect(response.status).toBe(409)
		expect(await response.json()).toEqual({
			code: 'configuration_revision_conflict',
			error: 'Configuration changed after these values were loaded. Reload and review the current policy before saving again.',
		})
	})

	test('reports post-commit safety outcomes explicitly without exposing internal errors', async () => {
		const committed = new Error('sensitive signer-lock path')
		committed.name = CONFIGURATION_COMMITTED_SAFELY_PAUSED
		const indeterminate = new Error('sensitive owner-file path')
		indeterminate.name = CONFIGURATION_COMMIT_INDETERMINATE
		let postIndeterminateMutationCalls = 0
		const server = startDashboardServer(
			0,
			controller({
				setSettings: () => {
					throw committed
				},
				setSigner: () => {
					throw indeterminate
				},
				setPaused: () => {
					postIndeterminateMutationCalls += 1
				},
			}),
		)
		servers.push(server)

		const committedResponse = await authenticatedFetch(new URL('/api/settings', server.url), {
			body: JSON.stringify({ patch: {}, revision: 'current' }),
			headers: {
				'content-type': 'application/json',
				origin: server.url.origin,
			},
			method: 'PUT',
		})
		expect(committedResponse.status).toBe(503)
		const committedBody = await committedResponse.json()
		expect(committedBody).toEqual({
			code: 'configuration_committed_safely_paused',
			committed: true,
			error: 'The configuration was committed, but activation did not complete. The bot remains durably safety-paused. Reload the committed configuration and explicitly resume after recovery.',
			safetyPaused: true,
		})
		expect(JSON.stringify(committedBody)).not.toContain('sensitive')

		const indeterminateResponse = await authenticatedFetch(new URL('/api/signer', server.url), {
			body: JSON.stringify({
				privateKey: `0x${'11'.repeat(32)}`,
				remember: true,
				revision: 'current',
			}),
			headers: {
				'content-type': 'application/json',
				origin: server.url.origin,
			},
			method: 'PUT',
		})
		expect(indeterminateResponse.status).toBe(503)
		const indeterminateBody = await indeterminateResponse.json()
		expect(indeterminateBody).toEqual({
			code: 'configuration_commit_indeterminate',
			commitStatus: 'indeterminate',
			error: 'The configuration may have committed. Treat it as committed and stop the bot before inspecting and reloading the owner configuration and runtime-state files.',
			safetyPausedInProcess: true,
			treatAsCommitted: true,
		})
		expect(JSON.stringify(indeterminateBody)).not.toContain('sensitive')

		const latchedConfiguration = await authenticatedFetch(new URL('/api/configuration', server.url))
		expect(latchedConfiguration.status).toBe(200)
		expect(await latchedConfiguration.json()).toMatchObject({ configurationCommitIndeterminate: true })

		const blockedMutation = await authenticatedFetch(new URL('/api/paused', server.url), {
			body: JSON.stringify({ paused: true, revision: 'current' }),
			headers: {
				'content-type': 'application/json',
				origin: server.url.origin,
			},
			method: 'PUT',
		})
		expect(blockedMutation.status).toBe(503)
		expect(await blockedMutation.json()).toEqual(indeterminateBody)
		expect(postIndeterminateMutationCalls).toBe(0)
	})

	test('waits for an in-flight mutation before serving reconciliation snapshots', async () => {
		let releaseMutation: () => void = () => undefined
		const mutationGate = new Promise<void>(resolve => {
			releaseMutation = resolve
		})
		let markMutationStarted: () => void = () => undefined
		const mutationStarted = new Promise<void>(resolve => {
			markMutationStarted = resolve
		})
		let paused = true
		let revision = 'before-mutation'
		let configurationReadCount = 0
		let stateReadCount = 0
		const server = startDashboardServer(
			0,
			controller({
				getConfiguration: () => {
					configurationReadCount += 1
					return { paused, revision }
				},
				getState: () => {
					stateReadCount += 1
					return { paused }
				},
				setSettings: async () => {
					markMutationStarted()
					await mutationGate
					paused = false
					revision = 'after-mutation'
				},
			}),
		)
		servers.push(server)

		const mutation = authenticatedFetch(new URL('/api/settings', server.url), {
			body: JSON.stringify({ patch: {}, revision: 'before-mutation' }),
			headers: { 'content-type': 'application/json', origin: server.url.origin },
			method: 'PUT',
		})
		await mutationStarted
		const configurationRead = authenticatedFetch(new URL('/api/configuration', server.url))
		const stateRead = authenticatedFetch(new URL('/api/state', server.url))
		await Bun.sleep(20)
		expect(configurationReadCount).toBe(0)
		expect(stateReadCount).toBe(0)

		releaseMutation()
		expect((await mutation).status).toBe(200)
		const [configurationResponse, stateResponse] = await Promise.all([configurationRead, stateRead])
		expect(await configurationResponse.json()).toMatchObject({ paused: false, revision: 'after-mutation' })
		expect(await stateResponse.json()).toMatchObject({ paused: false })
		expect(configurationReadCount).toBe(2)
		expect(stateReadCount).toBe(1)
	})

	test('does not execute a queued mutation after an indeterminate configuration boundary', async () => {
		const indeterminate = new Error('sensitive post-commit failure')
		indeterminate.name = CONFIGURATION_COMMIT_INDETERMINATE
		let releaseSigner: () => void = () => undefined
		const signerGate = new Promise<void>(resolve => {
			releaseSigner = resolve
		})
		let markSignerStarted: () => void = () => undefined
		const signerStarted = new Promise<void>(resolve => {
			markSignerStarted = resolve
		})
		let pausedMutationCalls = 0
		const server = startDashboardServer(
			0,
			controller({
				setPaused: () => {
					pausedMutationCalls += 1
				},
				setSigner: async () => {
					markSignerStarted()
					await signerGate
					throw indeterminate
				},
			}),
		)
		servers.push(server)

		const signerMutation = authenticatedFetch(new URL('/api/signer', server.url), {
			body: JSON.stringify({ privateKey: `0x${'11'.repeat(32)}`, remember: true, revision: 'current' }),
			headers: { 'content-type': 'application/json', origin: server.url.origin },
			method: 'PUT',
		})
		await signerStarted
		const queuedPause = authenticatedFetch(new URL('/api/paused', server.url), {
			body: JSON.stringify({ paused: true, revision: 'current' }),
			headers: { 'content-type': 'application/json', origin: server.url.origin },
			method: 'PUT',
		})
		await Bun.sleep(20)
		expect(pausedMutationCalls).toBe(0)

		releaseSigner()
		const [signerResponse, pauseResponse] = await Promise.all([signerMutation, queuedPause])
		expect(signerResponse.status).toBe(503)
		expect(pauseResponse.status).toBe(503)
		expect(await pauseResponse.json()).toMatchObject({ code: 'configuration_commit_indeterminate' })
		expect(pausedMutationCalls).toBe(0)
	})

	test('whitelists runtime state and removes calldata, signed transactions, RPCs, and sensitive error details', () => {
		const privateKey = `0x${'11'.repeat(32)}`
		const calldata = `0x${'ab'.repeat(256)}`
		const signedTransaction = `0x${'cd'.repeat(512)}`
		const rpc = 'https://operator:password@rpc.example/?api_key=secret'
		const state = publicChaosState(
			{
				activities: [
					{ at: '2026-08-24T00:00:00.000Z', details: `authorization=Bearer ${privateKey}`, hash: `0x${'01'.repeat(32)}`, message: 'Transaction submitted', status: 'pending' },
					{ at: '2026-08-24T00:01:00.000Z', message: rpc, status: 'failed' },
				],
				evaluations: [
					{
						definition: { description: 'Wrap bounded ETH', ecosystem: 'open-oracle', id: 'wrap', label: 'Wrap WETH', risk: 'low' },
						eligibility: { blockers: [], eligible: true },
						plan: { steps: [{ data: calldata }] },
					},
				],
				inventory: { eth: '1', rep: [{ allowances: { spender: privateKey }, balance: '2', symbol: 'REP', token: '0x2222222222222222222222222222222222222222' }], weth: '3' },
				lastScannedBlock: 42n,
				obligations: [{ blockers: [`rpc_url=${rpc}`], dueAt: '2026-08-24T01:00:00.000Z', id: 'settle', label: 'Settle report', status: 'pending' }],
				pendingTransactions: [{ data: calldata, hash: `0x${'02'.repeat(32)}`, label: 'Wrap WETH', nonce: 9n, serializedTransaction: signedTransaction, status: 'submitted' }],
				rpcEndpointHealth: [
					{ chainId: 11_155_111, checkedAt: '2026-08-24T00:00:00.000Z', error: undefined, kind: 'read-rpc', status: 'healthy', target: rpc },
					{ chainId: 11_155_111, checkedAt: '2026-08-24T00:01:00.000Z', error: undefined, kind: 'read-rpc', status: 'healthy', target: 'https://second.example/?token=private' },
					{ chainId: undefined, checkedAt: '2026-08-24T00:02:00.000Z', error: `token=${privateKey}`, kind: 'read-rpc', status: 'failed', target: 'https://third.example/private' },
					{ error: `RPC ${rpc} failed with secret`, lastFailureAt: '2026-08-24T00:04:00.000Z', status: 'degraded', target: 'https://second.example/?token=private' },
				],
				scheduler: { lastDelaySeconds: 61, nextRunAt: '2026-08-24T02:00:00.000Z', status: 'scheduled' },
				wallet: '0x3333333333333333333333333333333333333333',
				workflows: [
					{
						createdAt: '2026-08-24T00:00:00.000Z',
						id: 'workflow',
						label: 'Wrap WETH',
						status: 'waiting-transaction',
						steps: [{ data: calldata, label: 'Wrap', status: 'submitted', transactionHash: `0x${'02'.repeat(32)}` }],
					},
				],
			},
			{
				settings: {
					connectivity: {
						publicRpcUrls: ['https://submit.example/?token=private'],
						quorumRpcUrls: ['https://second.example/?token=private', 'https://third.example/private'],
						readRpcUrl: rpc,
						rpcQuorum: 2,
					},
					network: { chainId: 11_155_111, name: 'sepolia' },
				},
			},
		)
		const body = JSON.stringify(state)

		expect(body).not.toContain(privateKey)
		expect(body).not.toContain(calldata)
		expect(body).not.toContain(signedTransaction)
		expect(body).not.toContain('rpc.example')
		expect(body).not.toContain('second.example')
		expect(body).not.toContain('third.example')
		expect(body).not.toContain('Bearer')
		expect(Reflect.get(state, 'lastScannedBlock')).toBe('42')
		expect(Reflect.get(state, 'pendingTransactions')).toEqual([{ hash: `0x${'02'.repeat(32)}`, label: 'Wrap WETH', nonce: '9', status: 'submitted' }])
		expect(Reflect.get(state, 'operationEvaluations')).toEqual([{ blockers: [], candidateCount: 1, description: 'Wrap bounded ETH', ecosystem: 'open-oracle', eligible: true, id: 'wrap', label: 'Wrap WETH', prerequisites: [], risk: 'low' }])
		expect(Reflect.get(state, 'rpcHealth')).toEqual({
			chainReady: false,
			configuredReadEndpointCount: 3,
			healthyReadEndpointCount: 1,
			lastCheckedAt: '2026-08-24T00:04:00.000Z',
			requiredReadQuorum: 2,
			status: 'degraded',
		})
	})

	test('projects inventory availability, the safety latch, and selectable recovery workflow identity', () => {
		const state = publicChaosState({
			inventory: { eth: '1', rep: [], weth: '2' },
			inventoryAvailable: false,
			safetyPaused: true,
			workflows: [
				{
					classification: 'selectable',
					id: 'workflow:partial',
					label: 'Partial random workflow',
					status: 'waiting-continuation',
					steps: [],
				},
			],
		})

		expect(state).toMatchObject({
			currentWorkflow: {
				classification: 'selectable',
				id: 'workflow:partial',
				status: 'waiting-continuation',
			},
			inventoryAvailable: false,
			safetyPaused: true,
		})
	})

	test('keeps deferred lifecycle obligations in the public recovery projection', () => {
		const state = publicChaosState({
			obligations: [
				{
					attemptCount: 1,
					automaticRetryCount: 1,
					automaticRetryLimit: 3,
					blockers: ['Tracked canonical lifecycle identity is not currently actionable'],
					ecosystem: 'statoblast',
					id: 'deferred',
					label: 'Future auction settlement',
					notBefore: '2026-08-24T00:03:00.000Z',
					status: 'deferred',
					updatedAt: '2026-08-24T00:00:00.000Z',
				},
				{ id: 'completed', label: 'Completed settlement', status: 'completed' },
			],
		})

		expect(Reflect.get(state, 'obligations')).toEqual([
			{
				attemptCount: 1,
				automaticRetryCount: 1,
				automaticRetryLimit: 3,
				blockers: ['Tracked canonical lifecycle identity is not currently actionable'],
				ecosystem: 'statoblast',
				id: 'deferred',
				label: 'Future auction settlement',
				notBefore: '2026-08-24T00:03:00.000Z',
				status: 'deferred',
				updatedAt: '2026-08-24T00:00:00.000Z',
			},
		])
	})

	test('groups lifecycle candidates and preserves every operation classification', () => {
		const definition = { classification: 'lifecycle-obligation', description: 'Settle a mature report', ecosystem: 'open-oracle', id: 'open-oracle.settle', label: 'Settle report', risk: 'low' }
		const state = publicChaosState({
			evaluations: [
				{ blockers: ['first candidate changed'], candidateCount: 0, definition, eligibility: { blockers: ['first candidate changed'], eligible: false }, enabled: true },
				{ definition, eligibility: { blockers: [], eligible: true }, enabled: true, plan: { id: 'candidate-1' } },
				{ definition, eligibility: { blockers: [], eligible: true }, enabled: true, plan: { id: 'candidate-2' } },
				{
					definition: { classification: 'role-restricted', ecosystem: 'statoblast', id: 'surface.pool.initialize', label: 'Pool.initialize', risk: 'high' },
					eligibility: { blockers: ['Only the factory may initialize a pool'], eligible: false },
				},
			],
		})

		expect(Reflect.get(state, 'operationEvaluations')).toEqual([
			{
				blockers: ['first candidate changed'],
				candidateCount: 2,
				classification: 'lifecycle-obligation',
				description: 'Settle a mature report',
				ecosystem: 'open-oracle',
				eligible: true,
				enabled: true,
				id: 'open-oracle.settle',
				label: 'Settle report',
				prerequisites: [],
				risk: 'low',
			},
			{
				blockers: ['Only the factory may initialize a pool'],
				candidateCount: 0,
				classification: 'role-restricted',
				ecosystem: 'statoblast',
				eligible: false,
				id: 'surface.pool.initialize',
				label: 'Pool.initialize',
				prerequisites: [],
				risk: 'high',
			},
		])
	})

	test('projects a bounded sanitized topology without runtime-only fields', () => {
		const secret = 'topology-secret'
		const topology = Reflect.get(
			publicChaosState({
				topology: {
					anchor: { blockHash: `0x${'ab'.repeat(32)}`, blockNumber: '42', timestamp: '1000' },
					auctions: [{ address: '0x1111111111111111111111111111111111111111', bids: [{ rawTransaction: secret }], finalized: false, pool: '0x2222222222222222222222222222222222222222' }],
					complete: true,
					pairs: [{ address: '0x3333333333333333333333333333333333333333', pool: '0x2222222222222222222222222222222222222222', reserve: secret, status: 1, universeId: '0' }],
					pools: [{ address: '0x2222222222222222222222222222222222222222', coordinator: '0x4444444444444444444444444444444444444444', universeId: '0', vaults: [{ privateKey: secret }] }],
					reports: [{ calldata: secret, currentReporter: '0x5555555555555555555555555555555555555555', reportId: '7', token1: '0x6666666666666666666666666666666666666666', token2: '0x7777777777777777777777777777777777777777' }],
					universes: [{ id: '0', knownChildOutcomes: ['1', '2'], privateRpcUrl: `https://${secret}.example`, repToken: '0x8888888888888888888888888888888888888888' }],
				},
			}),
			'topology',
		)

		expect(topology).toEqual({
			anchorBlock: '42',
			anchorTimestamp: '1000',
			auctions: [{ address: '0x1111111111111111111111111111111111111111', bidCount: 1, finalized: false, pool: '0x2222222222222222222222222222222222222222' }],
			complete: true,
			pairs: [{ address: '0x3333333333333333333333333333333333333333', pool: '0x2222222222222222222222222222222222222222', status: 1, universeId: '0' }],
			pools: [{ address: '0x2222222222222222222222222222222222222222', coordinator: '0x4444444444444444444444444444444444444444', universeId: '0', vaultCount: 1 }],
			reports: [{ currentReporter: '0x5555555555555555555555555555555555555555', reportId: '7', token1: '0x6666666666666666666666666666666666666666', token2: '0x7777777777777777777777777777777777777777' }],
			totalCounts: { auctions: 1, pairs: 1, pools: 1, reports: 1, universes: 1 },
			truncated: false,
			universes: [{ id: '0', knownChildOutcomeCount: 2, repToken: '0x8888888888888888888888888888888888888888' }],
		})
		expect(JSON.stringify(topology)).not.toContain(secret)
	})

	test('reports bounded topology projection truncation without overstating visible totals', () => {
		const topology = Reflect.get(
			publicChaosState({
				topology: {
					anchor: { blockNumber: '42', timestamp: '1000' },
					complete: true,
					pools: Array.from({ length: 501 }, (_, index) => ({ address: `pool-${index.toString()}` })),
				},
			}),
			'topology',
		)

		expect(Reflect.get(topology, 'complete')).toBe(true)
		expect(Reflect.get(topology, 'truncated')).toBe(true)
		expect(Reflect.get(Reflect.get(topology, 'totalCounts'), 'pools')).toBe(501)
		expect(Reflect.get(topology, 'pools')).toHaveLength(500)
	})

	test('serves only aggregate RPC quorum health from the authenticated state API', async () => {
		const secret = 'rpc-dashboard-secret'
		const submissionCheckedAt = new Date().toISOString()
		const signerAddress = '0x0000000000000000000000000000000000000001'
		const server = startDashboardServer(
			0,
			controller({
				getConfiguration: () => ({
					signerAddress,
					settings: {
						connectivity: {
							publicRpcUrls: [`https://submit.example/?api_key=${secret}`],
							quorumRpcUrls: ['https://read-two.example/private'],
							readRpcUrl: `https://operator:${secret}@read-one.example/private`,
							rpcQuorum: 2,
						},
						network: { chainId: 11_155_111, name: 'sepolia' },
						submission: {
							minimumBundleRelaySuccesses: 2,
							mode: 'private',
							relayUrls: [`https://relay-one.example/private?api_key=${secret}`, `https://relay-two.example/private?api_key=${secret}`],
						},
					},
				}),
				getState: () => ({
					rpcEndpointHealth: [
						{ chainId: 11_155_111, checkedAt: '2026-08-24T00:00:04.000Z', kind: 'read-rpc', status: 'healthy', target: `https://stale-${secret}.example/private` },
						{ chainId: 11_155_111, checkedAt: '2026-08-24T00:00:00.000Z', kind: 'read-rpc', status: 'healthy', target: `https://operator:${secret}@read-one.example/private` },
						{ chainId: 11_155_111, checkedAt: '2026-08-24T00:00:01.000Z', kind: 'read-rpc', status: 'healthy', target: 'https://read-two.example/private' },
						{ lastSuccessAt: '2026-08-24T00:00:02.000Z', status: 'healthy', target: `https://operator:${secret}@read-one.example/private` },
						{ error: `token=${secret}`, lastSuccessAt: '2026-08-24T00:00:03.000Z', status: 'healthy', target: 'https://read-two.example/private' },
						{ authenticatedAddress: signerAddress, chainId: 11_155_111, checkedAt: submissionCheckedAt, kind: 'private-relay', status: 'healthy', target: `https://relay-one.example/private?api_key=${secret}` },
						{ authenticatedAddress: signerAddress, chainId: 11_155_111, checkedAt: submissionCheckedAt, kind: 'private-relay', status: 'healthy', target: `https://relay-two.example/private?api_key=${secret}` },
					],
				}),
			}),
		)
		servers.push(server)

		const response = await authenticatedFetch(new URL('/api/state', server.url))
		expect(response.status).toBe(200)
		const body = await response.json()
		expect(Reflect.get(body, 'rpcHealth')).toEqual({
			chainReady: true,
			configuredReadEndpointCount: 2,
			healthyReadEndpointCount: 2,
			lastCheckedAt: '2026-08-24T00:00:03.000Z',
			requiredReadQuorum: 2,
			status: 'ready',
		})
		expect(Reflect.get(body, 'submissionHealth')).toEqual({
			checkedOriginCount: 2,
			configuredOriginCount: 2,
			freshOriginCount: 2,
			healthyOriginCount: 2,
			lastCheckedAt: submissionCheckedAt,
			mode: 'private',
			proofMatchesSigner: true,
			ready: true,
			requiredHealthyOriginCount: 2,
			status: 'ready',
		})
		const serialized = JSON.stringify(body)
		expect(serialized).not.toContain(secret)
		expect(serialized).not.toContain('read-one.example')
		expect(serialized).not.toContain('read-two.example')
		expect(serialized).not.toContain('stale-')
		expect(serialized).not.toContain('submit.example')
		expect(serialized).not.toContain('relay-one.example')
		expect(serialized).not.toContain('relay-two.example')
		expect(serialized).not.toContain('target')
		expect(serialized).not.toContain('error')
	})

	test('projects sanitized transaction-path readiness states without endpoint or signer identity', () => {
		const now = Date.parse('2026-08-31T12:00:00.000Z')
		const secret = 'submission-readiness-secret'
		const signerAddress = '0x0000000000000000000000000000000000000001'
		const configuration = {
			signerAddress,
			settings: {
				connectivity: { publicRpcUrls: [`https://public.example/private?token=${secret}`] },
				network: { chainId: 11_155_111, maximumBlockIntervalSeconds: 60 },
				runtime: { lifecyclePollMilliseconds: 12_000 },
				submission: { minimumBundleRelaySuccesses: 2, mode: 'private', relayUrls: [`https://relay-one.example/private?token=${secret}`, `https://relay-two.example/private?token=${secret}`] },
			},
		}
		const healthyChecks = [
			{ authenticatedAddress: signerAddress, chainId: 11_155_111, checkedAt: new Date(now - 1_000).toISOString(), error: `token=${secret}`, kind: 'private-relay', status: 'healthy', target: `https://relay-one.example/private?token=${secret}` },
			{ authenticatedAddress: signerAddress, chainId: 11_155_111, checkedAt: new Date(now - 2_000).toISOString(), kind: 'private-relay', status: 'healthy', target: `https://relay-two.example/private?token=${secret}` },
		]
		const projected = (rpcEndpointHealth: readonly unknown[], candidateConfiguration: unknown = configuration) => Reflect.get(publicChaosState({ rpcEndpointHealth }, candidateConfiguration, now), 'submissionHealth')

		expect(projected(healthyChecks)).toEqual({
			checkedOriginCount: 2,
			configuredOriginCount: 2,
			freshOriginCount: 2,
			healthyOriginCount: 2,
			lastCheckedAt: new Date(now - 1_000).toISOString(),
			mode: 'private',
			proofMatchesSigner: true,
			ready: true,
			requiredHealthyOriginCount: 2,
			status: 'ready',
		})
		const degraded = projected([healthyChecks[0], { ...healthyChecks[1], authenticatedAddress: '0x0000000000000000000000000000000000000002', status: 'failed' }])
		expect(degraded).toMatchObject({ healthyOriginCount: 1, mode: 'private', proofMatchesSigner: false, ready: false, status: 'degraded' })
		const stale = projected(healthyChecks.map(check => ({ ...check, checkedAt: new Date(now - 157_000).toISOString() })))
		expect(stale).toMatchObject({ freshOriginCount: 0, healthyOriginCount: 0, mode: 'private', ready: false, status: 'stale' })
		const publicConfiguration = {
			settings: {
				connectivity: { publicRpcUrls: [`https://public.example/private?token=${secret}`] },
				network: { chainId: 11_155_111, maximumBlockIntervalSeconds: 60 },
				runtime: { lifecyclePollMilliseconds: 12_000 },
				submission: { minimumBundleRelaySuccesses: 1, mode: 'public', relayUrls: [] },
			},
		}
		expect(projected([{ chainId: 11_155_111, checkedAt: new Date(now).toISOString(), kind: 'public-rpc', status: 'healthy', target: `https://public.example/private?token=${secret}` }], publicConfiguration)).toMatchObject({
			configuredOriginCount: 1,
			healthyOriginCount: 1,
			mode: 'public',
			ready: true,
			requiredHealthyOriginCount: 1,
			status: 'ready',
		})
		expect(projected([], { settings: { connectivity: {}, network: { chainId: 11_155_111 } } })).toEqual({ ready: false, status: 'not-configured' })
		const serialized = JSON.stringify({ degraded, ready: projected(healthyChecks), stale })
		expect(serialized).not.toContain(secret)
		expect(serialized).not.toContain(signerAddress)
		expect(serialized).not.toContain('relay-one.example')
		expect(serialized).not.toContain('relay-two.example')
		expect(serialized).not.toContain('target')
		expect(serialized).not.toContain('error')
	})

	test('projects only current configured read-quorum evidence in timestamp order', () => {
		const configuration = {
			settings: {
				connectivity: {
					quorumRpcUrls: ['https://read-two.example/private'],
					readRpcUrl: 'https://read-one.example/private',
					rpcQuorum: 2,
				},
				network: { chainId: 1 },
			},
		}
		const checks = [
			{ chainId: 1, checkedAt: '2026-08-24T00:01:00.000Z', kind: 'read-rpc', status: 'healthy', target: 'https://read-one.example/private' },
			{ chainId: 1, checkedAt: '2026-08-24T00:01:00.000Z', kind: 'read-rpc', status: 'healthy', target: 'https://read-two.example/private' },
		]
		const projectedHealth = (rpcEndpointHealth: readonly unknown[]) => Reflect.get(publicChaosState({ rpcEndpointHealth }, configuration), 'rpcHealth')

		expect(projectedHealth([])).toEqual({ configuredReadEndpointCount: 2, healthyReadEndpointCount: 0, requiredReadQuorum: 2, status: 'not-checked' })

		expect(projectedHealth([...checks, { lastFailureAt: '2026-08-24T00:02:00.000Z', status: 'degraded', target: 'https://read-one.example/private' }, { lastSuccessAt: '2026-08-24T00:03:00.000Z', status: 'healthy', target: 'https://read-one.example/private' }])).toEqual({
			chainReady: true,
			configuredReadEndpointCount: 2,
			healthyReadEndpointCount: 2,
			lastCheckedAt: '2026-08-24T00:03:00.000Z',
			requiredReadQuorum: 2,
			status: 'ready',
		})

		expect(projectedHealth([...checks, { lastSuccessAt: '2026-08-24T00:02:00.000Z', status: 'healthy', target: 'https://read-one.example/private' }, { lastFailureAt: '2026-08-24T00:03:00.000Z', status: 'degraded', target: 'https://read-one.example/private' }])).toEqual({
			chainReady: false,
			configuredReadEndpointCount: 2,
			healthyReadEndpointCount: 1,
			lastCheckedAt: '2026-08-24T00:03:00.000Z',
			requiredReadQuorum: 2,
			status: 'degraded',
		})

		expect(projectedHealth([...checks, { lastFailureAt: '2026-08-24T00:00:00.000Z', status: 'degraded', target: 'https://read-one.example/private' }])).toEqual({
			chainReady: true,
			configuredReadEndpointCount: 2,
			healthyReadEndpointCount: 2,
			lastCheckedAt: '2026-08-24T00:01:00.000Z',
			requiredReadQuorum: 2,
			status: 'ready',
		})

		expect(projectedHealth([...checks, { chainId: undefined, checkedAt: '2026-08-24T00:04:00.000Z', kind: 'read-rpc', status: 'failed', target: 'https://read-one.example/private' }])).toEqual({
			chainReady: false,
			configuredReadEndpointCount: 2,
			healthyReadEndpointCount: 1,
			lastCheckedAt: '2026-08-24T00:04:00.000Z',
			requiredReadQuorum: 2,
			status: 'degraded',
		})
	})

	test('treats an invalid duplicate-origin read configuration as unavailable without deriving observed counts', () => {
		const secret = 'duplicate-origin-secret'
		const state = publicChaosState(
			{
				rpcEndpointHealth: [
					{ chainId: 1, checkedAt: '2026-08-24T00:01:00.000Z', kind: 'read-rpc', status: 'healthy', target: `https://duplicate.example/one?token=${secret}` },
					{ chainId: 1, checkedAt: '2026-08-24T00:02:00.000Z', kind: 'read-rpc', status: 'healthy', target: `https://duplicate.example/two?token=${secret}` },
				],
			},
			{
				settings: {
					connectivity: {
						quorumRpcUrls: [`https://duplicate.example/two?token=${secret}`],
						readRpcUrl: `https://duplicate.example/one?token=${secret}`,
						rpcQuorum: 2,
					},
					network: { chainId: 1 },
				},
			},
		)

		expect(Reflect.get(state, 'rpcHealth')).toEqual({ status: 'not-configured' })
		const serialized = JSON.stringify(state)
		expect(serialized).not.toContain(secret)
		expect(serialized).not.toContain('duplicate.example')
		expect(serialized).not.toContain('target')

		const unspecifiedChain = publicChaosState({ rpcEndpointHealth: [{ chainId: 1, checkedAt: '2026-08-24T00:01:00.000Z', kind: 'read-rpc', status: 'healthy', target: 'https://read-one.example' }] }, { settings: { connectivity: { quorumRpcUrls: [], readRpcUrl: 'https://read-one.example', rpcQuorum: 1 }, network: {} } })
		expect(Reflect.get(unspecifiedChain, 'rpcHealth')).toEqual({ status: 'not-configured' })
	})

	test('projects serialized settings without returning private keys or connectivity credentials', () => {
		const configuration = publicChaosConfiguration({
			revision: 'sha256:revision',
			settings: {
				connectivity: { readRpcUrl: 'https://user:password@rpc.example' },
				network: { chainId: 11_155_111, explorerUrl: 'https://sepolia.etherscan.io', name: 'sepolia' },
				networkConfigured: true,
				paused: true,
				privateKey: `0x${'44'.repeat(32)}`,
				runtime: { execute: false, stateFile: '/private/path' },
				scheduler: { maximumDelaySeconds: 3_600, minimumDelaySeconds: 60 },
				strategy: {
					allowHighRiskOperations: true,
					allowIrreversibleOperations: false,
					enabledEcosystems: ['zoltar', 'statoblast', 'open-oracle', 'trading'],
					maximumEthPerOperation: '0.05',
					maximumGasCostEth: '0.02',
					maximumRepPerOperation: '10',
					minimumEthReserve: '0.05',
					minimumRepReserve: '10',
					selectableOperationAllowlist: ['open-oracle.weth.wrap'],
					workflowValidForBlocks: 288,
				},
			},
		})
		const body = JSON.stringify(configuration)

		expect(configuration).toEqual({
			allowHighRiskOperations: true,
			allowIrreversibleOperations: false,
			chainId: 11_155_111,
			enabledEcosystems: ['zoltar', 'statoblast', 'open-oracle', 'trading'],
			execute: false,
			hasSigner: true,
			maximumDelaySeconds: 3_600,
			maximumEthPerOperation: '0.05',
			maximumGasCostEth: '0.02',
			maximumRepPerOperation: '10',
			minimumDelaySeconds: 60,
			minimumEthReserve: '0.05',
			minimumRepReserve: '10',
			network: 'sepolia',
			networkConfigured: true,
			operationControls: {},
			paused: true,
			revision: 'sha256:revision',
			selectableOperationAllowlist: ['open-oracle.weth.wrap'],
			workflowValidForBlocks: 288,
		})
		expect(body).not.toContain('rpc.example')
		expect(body).not.toContain('private/path')
		expect(body).not.toContain('444444')
	})

	test('projects the internal all-selection sentinel as an explicit public null', () => {
		expect(Reflect.get(publicChaosConfiguration({ settings: { strategy: { selectableOperationAllowlist: undefined } } }), 'selectableOperationAllowlist')).toBeNull()
	})
})
