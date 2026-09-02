import { join } from 'node:path'
import { publicConnectivityError } from '@zoltar/bot-shared/dashboard/connectivity-error'
import { boundedDashboardJson, dashboardAuthenticationChallenge, dashboardAuthorities, dashboardRequestAuthorityIsAccepted, dashboardRequestIsAuthenticated, dashboardRequestIsSameOrigin, validateDashboardAuthentication } from '@zoltar/bot-shared/dashboard/security'

export type DashboardController = {
	getConfiguration: () => unknown | Promise<unknown>
	getState: () => unknown | Promise<unknown>
	hostname: '0.0.0.0' | '127.0.0.1'
	isNetworkConfigured: () => boolean | Promise<boolean>
	loopbackPublished?: boolean
	password?: string | undefined
	publicAuthority?: string | undefined
	setApprovedUniverses: (value: unknown) => unknown | Promise<unknown>
	setMarketConfiguration?: (value: unknown) => unknown | Promise<unknown>
	setNetworkConnectivity?: (value: unknown) => unknown | Promise<unknown>
	setPaused: (value: unknown) => unknown | Promise<unknown>
	reconcileTransaction?: (value: unknown) => unknown | Promise<unknown>
	testMarketSources?: (value: unknown) => unknown | Promise<unknown>
	setSelectedPools: (value: unknown) => unknown | Promise<unknown>
	setSigner: (value: unknown) => unknown | Promise<unknown>
	setStrategy: (value: unknown) => unknown | Promise<unknown>
	switchNetworkProfile?: (value: unknown) => unknown | Promise<unknown>
}

const CHAIN_CONFIGURATION_REQUIRED = 'Select and save the chain and RPC endpoints before changing chain-specific settings'

function headers(contentType: string) {
	return {
		'cache-control': 'no-store',
		'content-security-policy': "default-src 'self'; connect-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
		'content-type': contentType,
		'referrer-policy': 'no-referrer',
		'x-content-type-options': 'nosniff',
	}
}

function json(value: unknown, status = 200) {
	return Response.json(value, {
		headers: headers('application/json; charset=utf-8'),
		status,
	})
}

function closingJson(value: unknown) {
	return Response.json(value, { headers: { ...headers('application/json; charset=utf-8'), connection: 'close' } })
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}

function publicConnectivityUpdateError(error: unknown) {
	return publicConnectivityError(error, {
		fallback: 'RPC connectivity checks failed. Review the submitted endpoints and retry.',
		validationMessages: new Set([
			'Live execution with RPC quorum 2 requires at least two independent quorum RPCs (three read endpoints total)',
			'Network and RPC settings must be an object',
			'Network must be mainnet or sepolia',
			'RPC connectivity settings must be an object',
			'RPC quorum must be 1 or 2',
			'Select the chain profile before saving its RPC settings',
		]),
	})
}

function publicOperatorFailure(error: string, fallback = 'The operation returned an unexpected error. Automatic retry remains active; check protected bot logs for details.') {
	const logRange = /Log scan failed for blocks (\d+) (?:through|to) (\d+)/i.exec(error)
	if (logRange !== null) return `Log scan failed: fromBlock ${logRange[1]} · toBlock ${logRange[2]}. Automatic retry remains active.`
	const normalized = error.toLowerCase()
	if (normalized.includes('rpc') || normalized.includes('chain') || normalized.includes('block')) return 'RPC connectivity or canonical chain reads failed. Automatic retry remains active.'
	if (normalized.includes('market') || normalized.includes('price') || normalized.includes('quote')) return 'Market evidence or price validation failed. Automatic retry remains active.'
	if (normalized.includes('transaction') || normalized.includes('receipt') || normalized.includes('relay')) return 'Transaction confirmation or delivery tracking failed. Review transaction activity while automatic retry remains active.'
	if (normalized.includes('persist') || normalized.includes('state') || normalized.includes('history')) return 'Durable operator state could not be verified. Review recovery state before resuming execution.'
	if (normalized.includes('risk') || normalized.includes('limit') || normalized.includes('policy')) return 'A risk or execution policy prevented this operation. Review the active policy and protected bot logs.'
	return fallback
}

function containsSensitiveOperatorDetail(value: string) {
	return /https?:\/\/[^\s/:]+:[^@\s]+@/i.test(value) || /(?:api[_-]?key|authorization|bearer|password|secret|token)\s*[=:]\s*\S+/i.test(value) || /(?:calldata|data|serializedTransaction|transactionData)\s*[=:]\s*0x[0-9a-f]{16,}/i.test(value) || /(?:[a-z]:\\|\/(?:etc|home|root|tmp|var|workspace)\/)/i.test(value)
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : undefined
}

function publicFields(value: unknown, fields: readonly string[]) {
	const source = record(value)
	const result: Record<string, unknown> = {}
	if (source === undefined) return result
	for (const field of fields) {
		if (!Object.hasOwn(source, field)) continue
		const candidate = source[field]
		if (candidate !== undefined) result[field] = candidate
	}
	return result
}

function publicList(value: unknown, transform: (entry: unknown) => Record<string, unknown>) {
	return Array.isArray(value) ? value.flatMap(entry => (record(entry) === undefined ? [] : [transform(entry)])) : []
}

function publicActivityDetails(kind: unknown, status: unknown, details: string) {
	if (kind === 'error' || status === 'failed') return publicOperatorFailure(details)
	if (containsSensitiveOperatorDetail(details)) return undefined
	if (kind === 'scan' && /^block=\d+$/.test(details)) return details
	if (kind !== 'configuration') return undefined
	if (details === 'Set the chain and RPC endpoints in the dashboard') return details
	if (/^\d+(?:, \d+)*$/.test(details)) return details
	if (/^\d+ source\(s\) responded$/.test(details)) return details
	if (/^\d+ CEX source\(s\) across \d+ REP asset\(s\)$/.test(details)) return details
	if (/^chain=\d+ (?:factory=0x[0-9a-f]{40}|readRpc=[a-z0-9.:[\]-]+)$/i.test(details)) return details
	return undefined
}

function publicActivity(value: unknown) {
	const source = record(value)
	if (source === undefined) return {}
	const activity = publicFields(source, ['at', 'message', 'status'])
	const details = source['details']
	const kind = source['kind']
	const message = source['message']
	const status = source['status']
	if (typeof details === 'string') {
		const safeDetails = publicActivityDetails(kind, status, details)
		if (safeDetails !== undefined) activity['details'] = safeDetails
	}
	if (typeof message === 'string' && containsSensitiveOperatorDetail(message)) activity['message'] = 'An operator activity requires attention. Check protected bot logs for details.'
	return activity
}

function publicAlert(value: unknown) {
	const source = record(value)
	if (source === undefined) return {}
	const alert = publicFields(source, ['message', 'severity'])
	const message = source['message']
	if (typeof message === 'string' && containsSensitiveOperatorDetail(message)) alert['message'] = publicOperatorFailure(message, 'An operator alert requires attention. Check protected bot logs for details.')
	return alert
}

function publicCentralizedMarket(value: unknown) {
	const market = publicFields(value, ['askDepthEth', 'bidDepthEth', 'priceRepPerEth', 'reasons', 'reliable'])
	const source = record(value)
	if (source !== undefined && Array.isArray(source['observations'])) {
		market['observations'] = publicList(source['observations'], observation => publicFields(observation, ['askDepthEth', 'bidDepthEth', 'exchangeId', 'observedAt', 'priceRepPerEth', 'repMarket']))
	}
	return market
}

function publicMarketConsensus(value: unknown) {
	const consensus = publicFields(value, ['priceRepPerEth', 'reasons', 'reliable'])
	const source = record(value)
	if (source === undefined) return consensus
	for (const group of ['cex', 'dex'] as const) {
		if (record(source[group]) !== undefined) consensus[group] = publicFields(source[group], ['askDepthEth', 'bidDepthEth', 'priceRepPerEth', 'reliable', 'sourceCount'])
	}
	return consensus
}

function publicPool(value: unknown) {
	const pool = publicFields(value, ['address', 'approvedUniverse', 'centralizedPriceAllowed', 'centralizedPriceDeviationBps', 'isPriceValid', 'knownVaultCount', 'lastPrice', 'multiplierBps', 'questionId', 'selected', 'systemState', 'totalCapacityOwnershipRep', 'totalPoolHeldRep'])
	const source = record(value)
	if (source === undefined) return pool
	if (record(source['botVault']) !== undefined) pool['botVault'] = publicFields(source['botVault'], ['capacityOwnershipRep', 'claimableFeesEth', 'healthBps', 'openInterestDisplay', 'vaultRepBacking'])
	const candidates = source['candidates']
	pool['candidateCount'] = Array.isArray(candidates) ? candidates.length : 0
	const bestCandidate = Array.isArray(candidates) ? record(candidates[0]) : undefined
	if (typeof bestCandidate?.['bonusValueEth'] === 'string') pool['bestCandidateBonusValueEth'] = bestCandidate['bonusValueEth']
	return pool
}

function publicEndpointTarget(value: unknown) {
	if (typeof value !== 'string') return 'Protected endpoint'
	try {
		const parsed = new URL(value)
		return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : 'Protected endpoint'
	} catch (error) {
		void error
		return 'Protected endpoint'
	}
}

function publicRpcEndpointHealth(value: unknown) {
	const health = publicFields(value, ['consecutiveFailures', 'lastFailureAt', 'lastSuccessAt', 'latencyMilliseconds', 'nextRetryAt', 'status'])
	const source = record(value)
	health['target'] = publicEndpointTarget(source?.['target'])
	if (typeof source?.['error'] === 'string') health['error'] = publicOperatorFailure(source['error'])
	return health
}

function publicOperatorSnapshot(value: unknown) {
	const source = record(value)
	if (source === undefined) return {}
	const snapshot = publicFields(value, ['execute', 'lastScanAt', 'lastScannedBlock', 'lastScannedTimestamp', 'network', 'operatorCapable', 'paused', 'scanning', 'status', 'wallet'])
	const error = source['error']
	if (typeof error === 'string') snapshot['error'] = publicOperatorFailure(error)
	if (Array.isArray(source['activities'])) snapshot['activities'] = publicList(source['activities'], publicActivity)
	if (Array.isArray(source['alerts'])) snapshot['alerts'] = publicList(source['alerts'], publicAlert)
	if (record(source['centralizedMarket']) !== undefined) snapshot['centralizedMarket'] = publicCentralizedMarket(source['centralizedMarket'])
	if (record(source['marketConsensus']) !== undefined) snapshot['marketConsensus'] = publicMarketConsensus(source['marketConsensus'])
	if (record(source['metrics']) !== undefined) {
		snapshot['metrics'] = publicFields(source['metrics'], ['approvedUniverseCount', 'assumedOpenInterestEth', 'candidateCount', 'deployedRep', 'eligiblePoolCount', 'poolCount', 'selectedPoolCount', 'walletEth', 'walletRep'])
	}
	if (Array.isArray(source['pendingStagedOperations']))
		snapshot['pendingStagedOperations'] = publicList(source['pendingStagedOperations'], operation => publicFields(operation, ['candidateBlock', 'coordinator', 'historicalRecoveryComplete', 'latestRecoveryBlock', 'nextHistoricalBlock', 'operationId', 'queuedBlock', 'target']))
	if (Array.isArray(source['pendingTransactions'])) snapshot['pendingTransactions'] = publicList(source['pendingTransactions'], intent => publicFields(intent, ['hash', 'label', 'mode', 'nonce', 'submissionBlock']))
	if (Array.isArray(source['rpcEndpointHealth'])) snapshot['rpcEndpointHealth'] = publicList(source['rpcEndpointHealth'], publicRpcEndpointHealth)
	if (Array.isArray(source['pools'])) snapshot['pools'] = publicList(source['pools'], publicPool)
	if (Array.isArray(source['marketSources'])) snapshot['marketSources'] = publicList(source['marketSources'], marketSource => publicFields(marketSource, ['assetId', 'id', 'kind', 'market', 'reason', 'status']))
	if (Array.isArray(source['universes'])) {
		snapshot['universes'] = publicList(source['universes'], universe => publicFields(universe, ['forkedPoolCount', 'forkQuestionId', 'id', 'migratableVaultCount', 'operationalPoolCount', 'outcomeIndex', 'parentId', 'poolCount', 'selectedPoolCount']))
	}
	return snapshot
}

function publicError(error: unknown, status: number, operation: string, fallback: string) {
	console.error(`dashboardOperation=${operation} failed=${errorMessage(error)}`)
	return json({ error: fallback }, status)
}

export function startDashboardServer(port: number, controller: DashboardController) {
	validateDashboardAuthentication(controller.hostname, controller.password, controller.loopbackPublished, controller.publicAuthority)
	const directory = import.meta.dir
	const browserSource = Bun.file(join(directory, 'dashboard.ts'))
	const dashboardPages = new Set(['overview', 'pools', 'markets', 'operations', 'settings'])
	const dashboardPage = async (pathname: string) => {
		const page = pathname === '/' ? 'overview' : pathname.slice(1)
		if (!dashboardPages.has(page)) return undefined
		const source = await Bun.file(join(directory, 'index.html')).text()
		return source.replace('<body>', `<body data-page="${page}">`)
	}
	const transpiler = new Bun.Transpiler({ loader: 'ts', target: 'browser' })
	let acceptedAuthorities: ReadonlySet<string> = new Set()
	const server = Bun.serve({
		hostname: controller.hostname,
		port,
		async fetch(request) {
			if (!dashboardRequestAuthorityIsAccepted(request, acceptedAuthorities)) {
				return json({ error: 'Request authority is not accepted' }, 403)
			}
			if (request.method === 'GET' && new URL(request.url).pathname === '/healthz') return new Response('ok', { headers: headers('text/plain; charset=utf-8') })
			if (!dashboardRequestIsAuthenticated(request, controller.password)) {
				return Response.json({ error: 'Dashboard authentication is required' }, { headers: { ...headers('application/json; charset=utf-8'), ...dashboardAuthenticationChallenge() }, status: 401 })
			}
			const url = new URL(request.url)
			if (request.method === 'GET') {
				const page = await dashboardPage(url.pathname)
				if (page !== undefined) return new Response(page, { headers: headers('text/html; charset=utf-8') })
			}
			if (request.method === 'GET' && url.pathname === '/dashboard.css') {
				return new Response(Bun.file(join(directory, 'styles.css')), {
					headers: headers('text/css; charset=utf-8'),
				})
			}
			if (request.method === 'GET' && url.pathname === '/operator-console.css') {
				return new Response(Bun.file(join(directory, '..', '..', '..', 'shared', 'src', 'dashboard', 'operator-console.css')), {
					headers: headers('text/css; charset=utf-8'),
				})
			}
			if (request.method === 'GET' && url.pathname === '/dashboard.js') {
				return new Response(transpiler.transformSync(await browserSource.text()), {
					headers: headers('text/javascript; charset=utf-8'),
				})
			}
			if (request.method === 'GET' && url.pathname === '/api/state') {
				try {
					return json(publicOperatorSnapshot(await controller.getState()))
				} catch (error) {
					return publicError(error, 503, 'state-read', publicOperatorFailure(errorMessage(error), 'Dashboard state is unavailable. Automatic retry remains active; check protected bot logs for details.'))
				}
			}
			if (request.method === 'GET' && url.pathname === '/api/configuration') {
				try {
					return json(await controller.getConfiguration())
				} catch (error) {
					return publicError(error, 503, 'configuration-read', 'Configuration is unavailable. Retry or check protected bot logs for details.')
				}
			}
			if (request.method === 'PUT' && !dashboardRequestIsSameOrigin(request, acceptedAuthorities)) {
				return json({ error: 'Cross-origin requests are not accepted' }, 403)
			}
			const handlers = new Map<string, (value: unknown) => unknown | Promise<unknown>>([
				['/api/approved-universes', controller.setApprovedUniverses],
				['/api/paused', controller.setPaused],
				['/api/selected-pools', controller.setSelectedPools],
				['/api/signer', controller.setSigner],
				['/api/strategy', controller.setStrategy],
			])
			if (controller.setMarketConfiguration !== undefined) handlers.set('/api/market-configuration', controller.setMarketConfiguration)
			if (controller.setNetworkConnectivity !== undefined) handlers.set('/api/network-connectivity', controller.setNetworkConnectivity)
			if (controller.switchNetworkProfile !== undefined) handlers.set('/api/network-profile', controller.switchNetworkProfile)
			if (controller.reconcileTransaction !== undefined) handlers.set('/api/reconcile-transaction', controller.reconcileTransaction)
			if (controller.testMarketSources !== undefined) handlers.set('/api/test-market-sources', controller.testMarketSources)
			const handler = handlers.get(url.pathname)
			if (request.method === 'PUT' && handler !== undefined) {
				try {
					const value = await boundedDashboardJson(request)
					const emergencyPause = url.pathname === '/api/paused' && typeof value === 'object' && value !== null && !Array.isArray(value) && Reflect.get(value, 'paused') === true
					if (url.pathname !== '/api/network-connectivity' && url.pathname !== '/api/network-profile' && !emergencyPause && !(await controller.isNetworkConfigured())) throw new Error(CHAIN_CONFIGURATION_REQUIRED)
					const result = await handler(value)
					return url.pathname === '/api/network-profile' ? closingJson(result) : json(result)
				} catch (error) {
					const fallback = url.pathname === '/api/network-connectivity' ? publicConnectivityUpdateError(error) : 'The dashboard change could not be saved. Review the submitted values and protected bot logs.'
					return publicError(error, 400, `mutation:${url.pathname}`, fallback)
				}
			}
			if (request.method === 'GET' && url.pathname === '/favicon.svg') {
				return new Response(Bun.file(join(import.meta.dir, '..', '..', '..', '..', 'ui', 'coreShared', 'favicon.svg')), { headers: headers('image/svg+xml') })
			}
			if (request.method === 'GET' && url.pathname === '/favicon.ico') {
				return new Response(undefined, { headers: headers('image/x-icon'), status: 204 })
			}
			return json({ error: 'Not found' }, 404)
		},
	})
	if (server.port === undefined) throw new Error('Dashboard server did not expose its listening port')
	acceptedAuthorities = dashboardAuthorities(server.port, controller.publicAuthority)
	return server
}
