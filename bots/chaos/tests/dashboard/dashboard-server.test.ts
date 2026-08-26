import { afterEach, describe, expect, test } from 'bun:test'
import { publicChaosConfiguration, publicChaosState, startDashboardServer } from '../../src/dashboard/dashboard-server.ts'
import { CONFIGURATION_COMMIT_INDETERMINATE, CONFIGURATION_COMMITTED_SAFELY_PAUSED } from '../../src/runtime/dashboard-controller.ts'

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
		for (const path of ['/', '/overview', '/catalog', '/ecosystem', '/activity', '/settings', '/api/state', '/api/configuration']) {
			const rejected = await fetch(new URL(path, server.url))
			expect(rejected.status, path).toBe(401)
			expect(rejected.headers.get('www-authenticate'), path).toContain('Basic')
		}
		for (const path of ['/api/reconciliation/candidate', '/api/reconciliation/cancellation', '/api/reconciliation/obligation', '/api/paused', '/api/reconciliation/replacement', '/api/reconciliation/workflow', '/api/settings', '/api/signer']) {
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
		const server = startDashboardServer(
			0,
			controller({
				setSettings: () => {
					throw committed
				},
				setSigner: () => {
					throw indeterminate
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
	})

	test('whitelists runtime state and removes calldata, signed transactions, RPCs, and sensitive error details', () => {
		const privateKey = `0x${'11'.repeat(32)}`
		const calldata = `0x${'ab'.repeat(256)}`
		const signedTransaction = `0x${'cd'.repeat(512)}`
		const rpc = 'https://operator:password@rpc.example/?api_key=secret'
		const state = publicChaosState({
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
			rpcEndpointHealth: [{ target: rpc }],
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
		})
		const body = JSON.stringify(state)

		expect(body).not.toContain(privateKey)
		expect(body).not.toContain(calldata)
		expect(body).not.toContain(signedTransaction)
		expect(body).not.toContain('rpc.example')
		expect(body).not.toContain('Bearer')
		expect(Reflect.get(state, 'lastScannedBlock')).toBe('42')
		expect(Reflect.get(state, 'pendingTransactions')).toEqual([{ hash: `0x${'02'.repeat(32)}`, label: 'Wrap WETH', nonce: '9', status: 'submitted' }])
		expect(Reflect.get(state, 'operationEvaluations')).toEqual([{ blockers: [], candidateCount: 1, description: 'Wrap bounded ETH', ecosystem: 'open-oracle', eligible: true, id: 'wrap', label: 'Wrap WETH', prerequisites: [], risk: 'low' }])
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
					workflowValidForBlocks: 24,
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
			workflowValidForBlocks: 24,
		})
		expect(body).not.toContain('rpc.example')
		expect(body).not.toContain('private/path')
		expect(body).not.toContain('444444')
	})
})
