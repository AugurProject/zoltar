import { join } from 'node:path'
import { boundedDashboardJson, dashboardAuthenticationChallenge, dashboardRequestIsAuthenticated, validateDashboardAuthentication } from '@zoltar/bot-shared/dashboard/security'
import { CONFIGURATION_REVISION_CONFLICT } from '../config/settings.ts'
import { CONFIGURATION_COMMIT_INDETERMINATE, CONFIGURATION_COMMITTED_SAFELY_PAUSED } from '../runtime/dashboard-controller.ts'
import { requiredLiveInventory } from '../runtime/live-readiness.ts'

export type ChaosDashboardController = {
	getConfiguration: () => unknown | Promise<unknown>
	getState: () => unknown | Promise<unknown>
	hostname: '0.0.0.0' | '127.0.0.1'
	loopbackPublished?: boolean
	password?: string | undefined
	setCancellation: (value: unknown) => unknown | Promise<unknown>
	setCandidate: (value: unknown) => unknown | Promise<unknown>
	setObligation: (value: unknown) => unknown | Promise<unknown>
	setReplacement: (value: unknown) => unknown | Promise<unknown>
	setPaused: (value: unknown) => unknown | Promise<unknown>
	setSettings: (value: unknown) => unknown | Promise<unknown>
	setSigner: (value: unknown) => unknown | Promise<unknown>
	setWorkflow: (value: unknown) => unknown | Promise<unknown>
}

const dashboardPages = new Set(['overview', 'catalog', 'ecosystem', 'activity', 'settings'])

function securityHeaders(contentType: string) {
	return {
		'cache-control': 'no-store',
		'content-security-policy': "default-src 'self'; connect-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'",
		'content-type': contentType,
		'cross-origin-resource-policy': 'same-origin',
		'permissions-policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
		'referrer-policy': 'no-referrer',
		'x-content-type-options': 'nosniff',
		'x-frame-options': 'DENY',
	}
}

function json(value: unknown, status = 200) {
	return Response.json(value, { headers: securityHeaders('application/json; charset=utf-8'), status })
}

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : undefined
}

function safeString(value: unknown) {
	if (typeof value !== 'string') return undefined
	const sensitive =
		/(?:authorization|bearer|password|private[_-]?key|secret|token|api[_-]?key|rpc[_-]?(?:url|endpoint)|calldata|raw[_-]?(?:transaction|tx)|signed[_-]?(?:transaction|tx))\s*[=:]/i.test(value) ||
		/https?:\/\//i.test(value) ||
		/(?:[a-z]:\\|\/(?:etc|home|root|tmp|var|workspace)\/)/i.test(value) ||
		/0x[0-9a-f]{130,}/i.test(value)
	return sensitive ? undefined : value.slice(0, 1_000)
}

function stringField(source: Record<string, unknown>, key: string) {
	return safeString(source[key])
}

function booleanField(source: Record<string, unknown>, key: string) {
	return typeof source[key] === 'boolean' ? source[key] : undefined
}

function numberField(source: Record<string, unknown>, key: string) {
	return typeof source[key] === 'number' && Number.isFinite(source[key]) ? source[key] : undefined
}

function scalar(source: Record<string, unknown>, key: string) {
	const value = source[key]
	return stringField(source, key) ?? numberField(source, key) ?? booleanField(source, key) ?? (typeof value === 'bigint' ? value.toString() : undefined)
}

function safeIntegerField(source: Record<string, unknown>, key: string) {
	const value = source[key]
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function isoTimestampField(source: Record<string, unknown>, key: string) {
	const value = source[key]
	if (typeof value !== 'string') return undefined
	const milliseconds = Date.parse(value)
	return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : undefined
}

function compact<T extends Record<string, unknown>>(value: T) {
	return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined))
}

function publicStrings(value: unknown) {
	return Array.isArray(value)
		? value.flatMap(entry => {
				const safe = safeString(entry)
				return safe === undefined ? [] : [safe]
			})
		: []
}

function nullablePublicStrings(value: unknown) {
	if (value === null || value === undefined) return null
	return Array.isArray(value) ? publicStrings(value) : undefined
}

const operationClassifications = new Set(['excluded-dangerous', 'lifecycle-obligation', 'prerequisite', 'role-restricted', 'selectable'])

function operationClassificationField(source: Record<string, unknown>, key: string) {
	const value = stringField(source, key)
	return value !== undefined && operationClassifications.has(value) ? value : undefined
}

function publicCandidateCount(value: unknown) {
	if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : undefined
	if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) return undefined
	const count = BigInt(value)
	return count <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(count) : count.toString()
}

function publicTopologyItem(value: unknown, kind: 'auction' | 'pair' | 'pool' | 'report' | 'universe') {
	const source = record(value)
	if (source === undefined) return undefined
	if (kind === 'universe') {
		const id = stringField(source, 'id')
		if (id === undefined) return undefined
		return compact({
			forkQuestionId: stringField(source, 'forkQuestionId'),
			forkTime: scalar(source, 'forkTime'),
			id,
			knownChildOutcomeCount: Array.isArray(source['knownChildOutcomes']) ? source['knownChildOutcomes'].length : safeIntegerField(source, 'knownChildOutcomeCount'),
			parentUniverseId: stringField(source, 'parentUniverseId'),
			repToken: stringField(source, 'repToken'),
		})
	}
	if (kind === 'pool') {
		const address = stringField(source, 'address')
		if (address === undefined) return undefined
		return compact({
			address,
			awaitingForkContinuation: booleanField(source, 'awaitingForkContinuation'),
			coordinator: stringField(source, 'coordinator'),
			questionId: stringField(source, 'questionId'),
			systemState: scalar(source, 'systemState'),
			universeId: stringField(source, 'universeId'),
			vaultCount: Array.isArray(source['vaults']) ? source['vaults'].length : safeIntegerField(source, 'vaultCount'),
		})
	}
	if (kind === 'report') {
		const reportId = stringField(source, 'reportId') ?? stringField(source, 'id')
		if (reportId === undefined) return undefined
		return compact({
			currentReporter: stringField(source, 'currentReporter'),
			flags: scalar(source, 'flags'),
			reportId,
			settlementTime: scalar(source, 'settlementTime'),
			token1: stringField(source, 'token1'),
			token2: stringField(source, 'token2'),
		})
	}
	if (kind === 'auction') {
		const address = stringField(source, 'address')
		if (address === undefined) return undefined
		return compact({
			address,
			bidCount: Array.isArray(source['bids']) ? source['bids'].length : safeIntegerField(source, 'bidCount'),
			endTime: scalar(source, 'endTime'),
			finalized: booleanField(source, 'finalized'),
			pool: stringField(source, 'pool'),
			startTime: scalar(source, 'startTime'),
		})
	}
	const address = stringField(source, 'address')
	if (address === undefined) return undefined
	return compact({
		address,
		feeBps: scalar(source, 'feeBps'),
		pool: stringField(source, 'pool'),
		status: scalar(source, 'status'),
		universeId: stringField(source, 'universeId'),
	})
}

const MAXIMUM_PUBLIC_TOPOLOGY_ITEMS_PER_KIND = 500

function publicTopologyItems(value: unknown, kind: 'auction' | 'pair' | 'pool' | 'report' | 'universe') {
	if (!Array.isArray(value)) return []
	return value.slice(0, MAXIMUM_PUBLIC_TOPOLOGY_ITEMS_PER_KIND).flatMap(entry => {
		const projected = publicTopologyItem(entry, kind)
		return projected === undefined ? [] : [projected]
	})
}

function topologyItemCount(value: unknown) {
	return Array.isArray(value) ? value.length : 0
}

/** Sanitized, bounded view of the protocol graph observed at one canonical anchor. */
export function publicChaosTopology(value: unknown) {
	const source = record(value)
	const anchor = record(source?.['anchor'])
	const totalCounts = {
		auctions: topologyItemCount(source?.['auctions']),
		pairs: topologyItemCount(source?.['pairs']),
		pools: topologyItemCount(source?.['pools']),
		reports: topologyItemCount(source?.['reports']),
		universes: topologyItemCount(source?.['universes']),
	}
	return {
		anchorBlock: scalar(anchor ?? {}, 'blockNumber') ?? scalar(source ?? {}, 'anchorBlock'),
		anchorTimestamp: scalar(anchor ?? {}, 'timestamp') ?? scalar(source ?? {}, 'anchorTimestamp'),
		auctions: publicTopologyItems(source?.['auctions'], 'auction'),
		complete: booleanField(source ?? {}, 'complete'),
		pairs: publicTopologyItems(source?.['pairs'], 'pair'),
		pools: publicTopologyItems(source?.['pools'], 'pool'),
		reports: publicTopologyItems(source?.['reports'], 'report'),
		totalCounts,
		truncated: [totalCounts.auctions, totalCounts.pairs, totalCounts.pools, totalCounts.reports, totalCounts.universes].some(count => count > MAXIMUM_PUBLIC_TOPOLOGY_ITEMS_PER_KIND),
		universes: publicTopologyItems(source?.['universes'], 'universe'),
	}
}

function publicRepBalance(value: unknown) {
	const source = record(value)
	if (source === undefined) return undefined
	return compact({
		balance: scalar(source, 'balance'),
		symbol: stringField(source, 'symbol'),
		token: stringField(source, 'token') ?? stringField(source, 'address'),
		universeId: stringField(source, 'universeId'),
	})
}

function publicInventory(value: unknown) {
	const source = record(value)
	if (source === undefined) return {}
	const repValue = source['rep'] ?? source['reps']
	return compact({
		eth: scalar(source, 'eth'),
		rep: Array.isArray(repValue)
			? repValue.flatMap(entry => {
					const balance = publicRepBalance(entry)
					return balance === undefined ? [] : [balance]
				})
			: [],
		weth: scalar(source, 'weth'),
	})
}

function publicScheduler(value: unknown) {
	const source = record(value)
	if (source === undefined) return {}
	return compact({
		due: booleanField(source, 'due'),
		lastDelaySeconds: scalar(source, 'lastDelaySeconds'),
		lastRunAt: stringField(source, 'lastRunAt'),
		nextRunAt: stringField(source, 'nextRunAt'),
		selectedOperationId: stringField(source, 'selectedOperationId'),
		status: stringField(source, 'status'),
	})
}

type RpcHealthPolicy = {
	configuredReadEndpointCount: number | undefined
	configuredReadTargets: ReadonlySet<string> | undefined
	expectedChainId: number | undefined
	requiredReadQuorum: number | undefined
}

function endpointOrigin(value: unknown) {
	if (typeof value !== 'string') return undefined
	try {
		return new URL(value).origin
	} catch (error) {
		if (error instanceof TypeError) return undefined
		throw error
	}
}

function publicRpcHealthPolicy(value: unknown): RpcHealthPolicy {
	const source = record(value)
	const settings = record(source?.['settings']) ?? source
	const connectivity = record(settings?.['connectivity'])
	const network = record(settings?.['network'])
	if (connectivity === undefined) {
		return { configuredReadEndpointCount: undefined, configuredReadTargets: undefined, expectedChainId: safeIntegerField(network ?? {}, 'chainId'), requiredReadQuorum: undefined }
	}
	const readRpcUrl = connectivity['readRpcUrl']
	const quorumRpcUrls = connectivity['quorumRpcUrls']
	const configuredRpcUrls = typeof readRpcUrl === 'string' && Array.isArray(quorumRpcUrls) && quorumRpcUrls.every(entry => typeof entry === 'string') && quorumRpcUrls.length <= 8 ? [readRpcUrl, ...quorumRpcUrls] : undefined
	const configuredOrigins = configuredRpcUrls?.flatMap(entry => {
		const origin = endpointOrigin(entry)
		return origin === undefined ? [] : [origin]
	})
	const configuredReadTargets = configuredOrigins !== undefined && configuredRpcUrls !== undefined && configuredOrigins.length === configuredRpcUrls.length && new Set(configuredOrigins).size === configuredOrigins.length ? new Set(configuredOrigins) : undefined
	const configuredReadEndpointCount = configuredReadTargets?.size
	const configuredQuorum = safeIntegerField(connectivity, 'rpcQuorum')
	const requiredReadQuorum = configuredQuorum !== undefined && configuredQuorum >= 1 && configuredReadEndpointCount !== undefined && configuredQuorum <= configuredReadEndpointCount ? configuredQuorum : undefined
	return {
		configuredReadEndpointCount,
		configuredReadTargets,
		expectedChainId: safeIntegerField(network ?? {}, 'chainId'),
		requiredReadQuorum,
	}
}

function publicRpcHealth(value: unknown, configurationValue: unknown) {
	const policy = publicRpcHealthPolicy(configurationValue)
	if (policy.configuredReadEndpointCount === undefined || policy.configuredReadTargets === undefined || policy.expectedChainId === undefined || policy.requiredReadQuorum === undefined) {
		return { status: 'not-configured' }
	}
	const entries = Array.isArray(value)
		? value.flatMap(entry => {
				const source = record(entry)
				return source === undefined ? [] : [source]
			})
		: []
	const readChecksByTarget = new Map<string, Record<string, unknown>>()
	for (const entry of entries) {
		if (entry['kind'] !== 'read-rpc') continue
		const target = endpointOrigin(entry['target'])
		if (target === undefined || !policy.configuredReadTargets.has(target)) continue
		const current = readChecksByTarget.get(target)
		const currentCheckedAt = current === undefined ? undefined : isoTimestampField(current, 'checkedAt')
		const candidateCheckedAt = isoTimestampField(entry, 'checkedAt')
		if (current === undefined || (candidateCheckedAt !== undefined && (currentCheckedAt === undefined || candidateCheckedAt > currentCheckedAt))) readChecksByTarget.set(target, entry)
	}
	type PoolEvent = { at: string; milliseconds: number; healthy: boolean }
	const poolEventsByTarget = new Map<string, PoolEvent>()
	const recordPoolEvent = (target: string, at: string | undefined, healthy: boolean) => {
		if (at === undefined) return
		const milliseconds = Date.parse(at)
		const current = poolEventsByTarget.get(target)
		if (current === undefined || milliseconds > current.milliseconds || (milliseconds === current.milliseconds && !healthy && current.healthy)) {
			poolEventsByTarget.set(target, { at, healthy, milliseconds })
		}
	}
	for (const entry of entries) {
		if (entry['kind'] !== undefined) continue
		const target = endpointOrigin(entry['target'])
		if (target === undefined || !policy.configuredReadTargets.has(target)) continue
		recordPoolEvent(target, isoTimestampField(entry, 'lastSuccessAt'), true)
		recordPoolEvent(target, isoTimestampField(entry, 'lastFailureAt'), false)
	}
	const readChecks = [...readChecksByTarget.values()]
	let healthyReadEndpointCount = 0
	const timestamps: string[] = []
	for (const check of readChecks) {
		const checkedAt = isoTimestampField(check, 'checkedAt')
		if (checkedAt !== undefined) timestamps.push(checkedAt)
		const target = endpointOrigin(check['target'])
		const poolEvent = target === undefined ? undefined : poolEventsByTarget.get(target)
		if (poolEvent !== undefined) timestamps.push(poolEvent.at)
		const chainId = safeIntegerField(check, 'chainId')
		const expectedChainMatches = chainId === policy.expectedChainId
		const currentlyHealthy = checkedAt !== undefined && (poolEvent === undefined || poolEvent.milliseconds <= Date.parse(checkedAt) || poolEvent.healthy)
		if (check['status'] === 'healthy' && expectedChainMatches && currentlyHealthy) healthyReadEndpointCount += 1
	}
	const requiredReadQuorum = policy.requiredReadQuorum
	const chainReady = readChecks.length === 0 ? undefined : readChecks.length >= requiredReadQuorum && healthyReadEndpointCount >= requiredReadQuorum
	const lastCheckedAt = timestamps.sort((left, right) => Date.parse(right) - Date.parse(left))[0]
	let status: 'degraded' | 'not-checked' | 'ready' = 'degraded'
	if (readChecks.length === 0) status = 'not-checked'
	else if (chainReady) status = 'ready'
	return compact({
		chainReady,
		configuredReadEndpointCount: policy.configuredReadEndpointCount,
		healthyReadEndpointCount,
		lastCheckedAt,
		requiredReadQuorum,
		status,
	})
}

function publicSubmissionHealth(value: unknown, configurationValue: unknown, nowMilliseconds: number, maximumAgeSeconds: number) {
	const configuration = record(configurationValue)
	const settings = record(configuration?.['settings']) ?? configuration
	const connectivity = record(settings?.['connectivity'])
	const network = record(settings?.['network'])
	const submission = record(settings?.['submission'])
	const expectedChainId = safeIntegerField(network ?? {}, 'chainId')
	if (connectivity === undefined || submission === undefined || expectedChainId === undefined || !Number.isSafeInteger(maximumAgeSeconds) || maximumAgeSeconds < 1) return { ready: false, status: 'not-configured' as const }
	const mode = submission['mode']
	let expectedKind: 'private-relay' | 'public-rpc'
	let expectedAuthenticationAddress: string | undefined
	let requiredHealthyOriginCount: number
	let urls: unknown
	if (mode === 'public') {
		expectedKind = 'public-rpc'
		requiredHealthyOriginCount = 1
		urls = connectivity['publicRpcUrls']
	} else if (mode === 'private') {
		expectedKind = 'private-relay'
		const wallet = stringField(configuration ?? {}, 'wallet')
		if (wallet === undefined || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return { ready: false, status: 'not-configured' as const }
		expectedAuthenticationAddress = wallet.toLowerCase()
		const required = safeIntegerField(submission, 'minimumBundleRelaySuccesses')
		if (required === undefined || required < 1) return { ready: false, status: 'not-configured' as const }
		requiredHealthyOriginCount = required
		urls = submission['relayUrls']
	} else {
		return { ready: false, status: 'not-configured' as const }
	}
	if (!Array.isArray(urls) || urls.length === 0 || urls.some(url => typeof url !== 'string')) return { ready: false, status: 'not-configured' as const }
	const configuredOrigins = urls.flatMap(url => {
		const origin = endpointOrigin(url)
		return origin === undefined ? [] : [origin]
	})
	const configuredTargets = new Set(configuredOrigins)
	if (configuredOrigins.length !== urls.length || configuredTargets.size < requiredHealthyOriginCount) return { ready: false, status: 'not-configured' as const }
	const matchingChecks = Array.isArray(value)
		? value.flatMap(candidate => {
				const check = record(candidate)
				if (check?.['kind'] !== expectedKind) return []
				if (expectedAuthenticationAddress !== undefined && stringField(check, 'authenticatedAddress')?.toLowerCase() !== expectedAuthenticationAddress) return []
				const target = endpointOrigin(check['target'])
				return target !== undefined && configuredTargets.has(target) ? [{ check, target }] : []
			})
		: []
	if (matchingChecks.length === 0) return { ready: false, status: 'not-checked' as const }
	const expectedTargets = [...configuredOrigins].sort()
	const observedTargets = matchingChecks.map(({ target }) => target).sort()
	if (observedTargets.length !== expectedTargets.length || observedTargets.some((target, index) => target !== expectedTargets[index])) return { ready: false, status: 'not-checked' as const }
	const freshChecks = matchingChecks.filter(({ check }) => {
		const checkedAt = isoTimestampField(check, 'checkedAt')
		if (checkedAt === undefined) return false
		const ageMilliseconds = nowMilliseconds - Date.parse(checkedAt)
		return ageMilliseconds >= 0 && ageMilliseconds <= maximumAgeSeconds * 1_000
	})
	if (freshChecks.length !== matchingChecks.length) return { ready: false, status: 'stale' as const }
	const safetyFailure = freshChecks.some(({ check }) => check['status'] === 'failed' && check['failureDisposition'] !== 'connectivity-degraded')
	const healthyOrigins = new Set(freshChecks.flatMap(({ check, target }) => (check['status'] === 'healthy' && safeIntegerField(check, 'chainId') === expectedChainId ? [target] : [])))
	const ready = !safetyFailure && healthyOrigins.size >= requiredHealthyOriginCount
	return { ready, status: ready ? ('ready' as const) : ('degraded' as const) }
}

function publicEvaluation(value: unknown) {
	const source = record(value)
	if (source === undefined) return undefined
	const definition = record(source['definition']) ?? source
	const eligibility = record(source['eligibility']) ?? source
	const plan = record(source['plan'])
	return compact({
		blockers: publicStrings(eligibility['blockers']),
		candidateCount: publicCandidateCount(source['candidateCount']) ?? (plan === undefined ? 0 : 1),
		classification: operationClassificationField(definition, 'classification') ?? operationClassificationField(source, 'classification'),
		description: stringField(definition, 'description'),
		ecosystem: stringField(definition, 'ecosystem'),
		eligible: booleanField(eligibility, 'eligible'),
		enabled: booleanField(source, 'enabled'),
		id: stringField(definition, 'id'),
		independentlyExecutable: booleanField(definition, 'independentlyExecutable') ?? booleanField(source, 'independentlyExecutable'),
		label: stringField(definition, 'label'),
		prerequisites: publicStrings(source['prerequisites']),
		risk: stringField(definition, 'risk'),
	})
}

function groupedPublicEvaluations(value: unknown) {
	if (!Array.isArray(value)) return []
	const grouped = new Map<string, Record<string, unknown>>()
	for (const entry of value) {
		const projected = publicEvaluation(entry)
		if (projected === undefined) continue
		const source = record(projected)
		if (source === undefined) continue
		const key = [stringField(source, 'id') ?? '', stringField(source, 'ecosystem') ?? '', stringField(source, 'label') ?? '', stringField(source, 'classification') ?? ''].join('\u0000')
		const previous = grouped.get(key)
		if (previous === undefined) {
			grouped.set(key, source)
			continue
		}
		const previousCount = publicCandidateCount(previous['candidateCount']) ?? 0
		const currentCount = publicCandidateCount(source['candidateCount']) ?? 0
		const totalCount = BigInt(previousCount) + BigInt(currentCount)
		previous['candidateCount'] = totalCount <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(totalCount) : totalCount.toString()
		previous['blockers'] = [...new Set([...publicStrings(previous['blockers']), ...publicStrings(source['blockers'])])]
		previous['prerequisites'] = [...new Set([...publicStrings(previous['prerequisites']), ...publicStrings(source['prerequisites'])])]
		previous['eligible'] = previous['eligible'] === true || source['eligible'] === true
		if (previous['enabled'] === true || source['enabled'] === true) previous['enabled'] = true
		else if (previous['enabled'] === false || source['enabled'] === false) previous['enabled'] = false
	}
	return [...grouped.values()]
}

function publicWorkflowStep(value: unknown) {
	const source = record(value)
	if (source === undefined) return undefined
	return compact({
		confirmedAt: stringField(source, 'confirmedAt'),
		label: stringField(source, 'label'),
		status: stringField(source, 'status'),
		txHash: stringField(source, 'txHash') ?? stringField(source, 'transactionHash') ?? stringField(source, 'hash'),
	})
}

function publicWorkflow(value: unknown) {
	const source = record(value)
	if (source === undefined) return undefined
	return compact({
		classification: operationClassificationField(source, 'classification'),
		completedAt: stringField(source, 'completedAt'),
		ecosystem: stringField(source, 'ecosystem'),
		id: stringField(source, 'id'),
		label: stringField(source, 'label'),
		operationId: stringField(source, 'operationId'),
		startedAt: stringField(source, 'startedAt') ?? stringField(source, 'createdAt'),
		status: stringField(source, 'status'),
		updatedAt: stringField(source, 'updatedAt'),
		steps: Array.isArray(source['steps'])
			? source['steps'].flatMap(entry => {
					const step = publicWorkflowStep(entry)
					return step === undefined ? [] : [step]
				})
			: [],
	})
}

function publicPendingTransaction(value: unknown) {
	const source = record(value)
	if (source === undefined) return undefined
	return compact({
		cancellationHash: stringField(source, 'cancellationHash'),
		hash: stringField(source, 'hash'),
		label: stringField(source, 'label'),
		nonce: scalar(source, 'nonce'),
		operationId: stringField(source, 'operationId'),
		recoveryBlocker: stringField(source, 'recoveryBlocker'),
		replacementHash: stringField(source, 'replacementHash'),
		status: stringField(source, 'status'),
		submittedAt: stringField(source, 'submittedAt'),
		submissionBlock: scalar(source, 'submissionBlock'),
	})
}

function publicObligation(value: unknown) {
	const source = record(value)
	if (source === undefined) return undefined
	return compact({
		attemptCount: safeIntegerField(source, 'attemptCount'),
		automaticRetryCount: safeIntegerField(source, 'automaticRetryCount'),
		automaticRetryLimit: safeIntegerField(source, 'automaticRetryLimit'),
		blockers: publicStrings(source['blockers']),
		dueAt: stringField(source, 'dueAt'),
		ecosystem: stringField(source, 'ecosystem'),
		id: stringField(source, 'id'),
		label: stringField(source, 'label'),
		notBefore: isoTimestampField(source, 'notBefore'),
		operationId: stringField(source, 'operationId'),
		status: stringField(source, 'status'),
		updatedAt: stringField(source, 'updatedAt'),
	})
}

function publicActivity(value: unknown) {
	const source = record(value)
	if (source === undefined) return undefined
	return compact({
		at: stringField(source, 'at'),
		ecosystem: stringField(source, 'ecosystem'),
		label: stringField(source, 'label') ?? stringField(source, 'message'),
		operationId: stringField(source, 'operationId'),
		status: stringField(source, 'status'),
		summary: stringField(source, 'summary'),
		txHash: stringField(source, 'txHash') ?? stringField(source, 'hash'),
	})
}

function publicAlert(value: unknown) {
	const source = record(value)
	if (source === undefined) return undefined
	return compact({ message: stringField(source, 'message'), severity: stringField(source, 'severity') })
}

export function publicChaosState(value: unknown, configurationValue?: unknown) {
	const source = record(value)
	if (source === undefined) return {}
	const rpcHealthPolicy = publicRpcHealthPolicy(configurationValue)
	const workflows = Array.isArray(source['workflows']) ? source['workflows'] : []
	const activeWorkflow = workflows.find(entry => {
		const status = stringField(record(entry) ?? {}, 'status')
		return status === 'running' || status === 'waiting-continuation' || status === 'waiting-obligation' || status === 'waiting-transaction'
	})
	const currentWorkflow = publicWorkflow(source['currentWorkflow'] ?? activeWorkflow)
	const evaluationSource = source['operationEvaluations'] ?? source['evaluations']
	return compact({
		activities: Array.isArray(source['activities'])
			? source['activities'].flatMap(entry => {
					const activity = publicActivity(entry)
					return activity === undefined ? [] : [activity]
				})
			: [],
		alerts: Array.isArray(source['alerts'])
			? source['alerts'].flatMap(entry => {
					const alert = publicAlert(entry)
					return alert === undefined ? [] : [alert]
				})
			: [],
		chainId: scalar(source, 'chainId') ?? rpcHealthPolicy.expectedChainId,
		currentWorkflow,
		execute: booleanField(source, 'execute'),
		inventory: publicInventory(source['inventory']),
		inventoryAvailable: booleanField(source, 'inventoryAvailable') ?? source['inventory'] !== undefined,
		lastScanAt: stringField(source, 'lastScanAt'),
		lastScannedBlock: scalar(source, 'lastScannedBlock') ?? scalar(source, 'block'),
		network: stringField(source, 'network'),
		obligations: Array.isArray(source['obligations'])
			? source['obligations'].flatMap(entry => {
					const obligation = publicObligation(entry)
					if (obligation === undefined || (obligation['status'] !== 'blocked' && obligation['status'] !== 'deferred' && obligation['status'] !== 'executing' && obligation['status'] !== 'failed' && obligation['status'] !== 'pending')) {
						return []
					}
					return [obligation]
				})
			: [],
		operationEvaluations: groupedPublicEvaluations(evaluationSource),
		paused: booleanField(source, 'paused'),
		pendingTransactions: Array.isArray(source['pendingTransactions'])
			? source['pendingTransactions'].flatMap(entry => {
					const transaction = publicPendingTransaction(entry)
					return transaction === undefined ? [] : [transaction]
				})
			: [],
		rpcHealth: publicRpcHealth(source['rpcEndpointHealth'], configurationValue),
		safetyPaused: booleanField(source, 'safetyPaused'),
		scheduler: publicScheduler(source['scheduler']),
		signerReady: booleanField(source, 'signerReady') ?? booleanField(source, 'operatorCapable') ?? (stringField(source, 'wallet') === undefined ? undefined : true),
		status: stringField(source, 'status'),
		topology: publicChaosTopology(source['topology']),
		wallet: stringField(source, 'wallet') ?? stringField(source, 'signer'),
	})
}

function publicOperationControls(value: unknown) {
	const source = record(value)
	if (source === undefined) return {}
	const enabled = record(source['enabled'])
	return compact({
		disabledOperations: publicStrings(source['disabledOperations']),
		enabled: enabled === undefined ? undefined : Object.fromEntries(Object.entries(enabled).flatMap(([key, entry]) => (typeof entry === 'boolean' && safeString(key) !== undefined ? [[key, entry]] : []))),
	})
}

export function publicChaosConfiguration(value: unknown) {
	const source = record(value)
	if (source === undefined) return {}
	const settings = record(source['settings']) ?? source
	const runtime = record(settings['runtime']) ?? settings
	const scheduler = record(settings['scheduler']) ?? settings
	const strategy = record(settings['strategy']) ?? settings
	const privateKey = settings['privateKey']
	return compact({
		allowHighRiskOperations: booleanField(strategy, 'allowHighRiskOperations'),
		allowIrreversibleOperations: booleanField(strategy, 'allowIrreversibleOperations'),
		chainId: scalar(record(settings['network']) ?? {}, 'chainId'),
		enabledEcosystems: publicStrings(strategy['enabledEcosystems']),
		execute: booleanField(runtime, 'execute'),
		hasSigner: booleanField(source, 'hasSigner') ?? booleanField(source, 'signerReady') ?? (privateKey === null || privateKey === undefined ? false : true),
		maximumDelaySeconds: scalar(scheduler, 'maximumDelaySeconds'),
		maximumEthPerOperation: scalar(strategy, 'maximumEthPerOperation'),
		maximumGasCostEth: scalar(strategy, 'maximumGasCostEth'),
		maximumRepPerOperation: scalar(strategy, 'maximumRepPerOperation'),
		minimumDelaySeconds: scalar(scheduler, 'minimumDelaySeconds'),
		minimumEthReserve: scalar(strategy, 'minimumEthReserve'),
		minimumRepReserve: scalar(strategy, 'minimumRepReserve'),
		network: stringField(record(settings['network']) ?? {}, 'name'),
		networkConfigured: booleanField(settings, 'networkConfigured'),
		operationControls: publicOperationControls(settings['operations'] ?? source['operationControls']),
		paused: booleanField(settings, 'paused'),
		rememberSigner: booleanField(source, 'rememberSigner'),
		revision: scalar(source, 'revision'),
		selectableOperationAllowlist: nullablePublicStrings(strategy['selectableOperationAllowlist']),
		wallet: stringField(source, 'wallet') ?? stringField(source, 'signerAddress'),
		workflowValidForBlocks: scalar(strategy, 'workflowValidForBlocks'),
	})
}

type ChaosReadinessCheck = {
	detail?: string | undefined
	ready: boolean
}

function decimalAtto(value: unknown) {
	if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) return undefined
	const [whole = '0', fraction = ''] = value.split('.')
	return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'))
}

function inventoryReadyForLiveExecution(state: Record<string, unknown>, settings: Record<string, unknown>) {
	const inventory = record(state['inventory'])
	const strategy = record(settings['strategy'])
	if (inventory === undefined || strategy === undefined) return false
	const eth = typeof inventory['eth'] === 'string' && /^\d+$/.test(inventory['eth']) ? BigInt(inventory['eth']) : undefined
	const maximumEthPerOperationAttoEth = decimalAtto(strategy['maximumEthPerOperation'])
	const maximumGasCostAttoEth = decimalAtto(strategy['maximumGasCostEth'])
	const maximumRepPerOperationAttoRep = decimalAtto(strategy['maximumRepPerOperation'])
	const minimumEthReserveAttoEth = decimalAtto(strategy['minimumEthReserve'])
	const minimumRepReserveAttoRep = decimalAtto(strategy['minimumRepReserve'])
	if (eth === undefined || maximumEthPerOperationAttoEth === undefined || maximumGasCostAttoEth === undefined || maximumRepPerOperationAttoRep === undefined || minimumEthReserveAttoEth === undefined || minimumRepReserveAttoRep === undefined) {
		return false
	}
	const required = requiredLiveInventory({ maximumEthPerOperationAttoEth, maximumGasCostAttoEth, maximumRepPerOperationAttoRep, minimumEthReserveAttoEth, minimumRepReserveAttoRep })
	if (eth < required.ethAttoEth) return false
	if (!Array.isArray(inventory['rep'])) return false
	return inventory['rep'].some(candidate => {
		const balance = record(candidate)?.['balance']
		return typeof balance === 'string' && /^\d+$/.test(balance) && BigInt(balance) >= required.repAttoRep
	})
}

function readinessCheck(ready: boolean, detail?: string): ChaosReadinessCheck {
	return detail === undefined ? { ready } : { detail, ready }
}

export function publicChaosReadiness(stateValue: unknown, configurationValue: unknown, nowMilliseconds = Date.now()) {
	const state = record(stateValue)
	const configuration = record(configurationValue)
	const settings = record(configuration?.['settings']) ?? configuration
	if (state === undefined || settings === undefined) {
		return {
			blockers: ['runtime_snapshot_unavailable'],
			checkedAt: new Date(nowMilliseconds).toISOString(),
			checks: { storage: readinessCheck(false, 'Runtime or configuration snapshot is unavailable') },
			ready: false,
		}
	}
	const runtime = record(settings['runtime']) ?? settings
	const network = record(settings['network']) ?? settings
	const execute = runtime['execute'] === true
	const configured = settings['networkConfigured'] === true
	const paused = settings['paused'] === true || state['paused'] === true
	const safetyPaused = state['safetyPaused'] === true
	const signerReady = configuration?.['hasSigner'] === true || (settings['privateKey'] !== undefined && settings['privateKey'] !== null)
	const lastScanAt = typeof state['lastScanAt'] === 'string' && Number.isFinite(Date.parse(state['lastScanAt'])) ? state['lastScanAt'] : undefined
	const maximumBlockIntervalSeconds = typeof network['maximumBlockIntervalSeconds'] === 'number' && Number.isSafeInteger(network['maximumBlockIntervalSeconds']) ? network['maximumBlockIntervalSeconds'] : 60
	const lifecyclePollMilliseconds = typeof runtime['lifecyclePollMilliseconds'] === 'number' && Number.isSafeInteger(runtime['lifecyclePollMilliseconds']) ? runtime['lifecyclePollMilliseconds'] : 12_000
	const maximumScanAgeSeconds = Math.ceil((lifecyclePollMilliseconds * 3) / 1_000) + maximumBlockIntervalSeconds * 2
	const scanAgeSeconds = lastScanAt === undefined ? undefined : Math.max(0, Math.floor((nowMilliseconds - Date.parse(lastScanAt)) / 1_000))
	const topology = record(state['topology'])
	const scanReady = lastScanAt !== undefined && scanAgeSeconds !== undefined && scanAgeSeconds <= maximumScanAgeSeconds && topology?.['complete'] === true
	const pendingCount = Array.isArray(state['pendingTransactions']) ? state['pendingTransactions'].length : 0
	const activeWorkflows = Array.isArray(state['workflows'])
		? state['workflows'].filter(candidate => {
				const status = record(candidate)?.['status']
				return status === 'running' || status === 'waiting-continuation' || status === 'waiting-obligation' || status === 'waiting-transaction'
			}).length
		: 0
	const obligations = Array.isArray(state['obligations'])
		? state['obligations'].flatMap(candidate => {
				const obligation = record(candidate)
				return obligation === undefined ? [] : [obligation]
			})
		: []
	const failedObligationCount = obligations.filter(candidate => candidate['status'] === 'failed').length
	const blockedObligationCount = obligations.filter(candidate => candidate['status'] === 'blocked').length
	const pendingObligationCount = obligations.filter(candidate => candidate['status'] === 'pending' || candidate['status'] === 'executing').length
	const automaticRetryObligationCount = obligations.filter(candidate => candidate['status'] === 'deferred' && typeof candidate['notBefore'] === 'string').length
	const lifecyclePresenceBlocked = record(state['lifecyclePresenceBlocker']) !== undefined
	const recoveryReady = pendingCount === 0 && activeWorkflows === 0 && failedObligationCount === 0 && blockedObligationCount === 0 && pendingObligationCount === 0 && automaticRetryObligationCount === 0 && !lifecyclePresenceBlocked
	const inventoryReady = !execute || inventoryReadyForLiveExecution(state, settings)
	const rpcHealth = publicRpcHealth(state['rpcEndpointHealth'], configurationValue)
	const rpcReady = !configured || rpcHealth['chainReady'] === true
	const submissionHealth = publicSubmissionHealth(state['rpcEndpointHealth'], configurationValue, nowMilliseconds, maximumScanAgeSeconds)
	const submissionReady = !execute || submissionHealth.ready
	const status = stringField(state, 'status')
	const runtimeReady = state['error'] === undefined
	const storageReady = status !== 'error'
	let pauseDetail: string | undefined
	if (safetyPaused) pauseDetail = 'Durable safety pause is latched'
	else if (paused) pauseDetail = 'Operator is intentionally paused'
	let scanDetail: string | undefined
	if (!scanReady) scanDetail = lastScanAt === undefined ? 'No complete canonical scan is available' : 'Canonical scan is incomplete or stale'
	const checks: Record<string, ChaosReadinessCheck> = {
		configuration: readinessCheck(configured, configured ? undefined : 'Network deployment and connectivity are not configured'),
		inventory: readinessCheck(inventoryReady, inventoryReady ? undefined : 'Live inventory does not cover the ETH reserve, maximum ETH principal, maximum gas budget, REP reserve, and maximum REP principal'),
		paused: readinessCheck(!paused, pauseDetail),
		recovery: readinessCheck(recoveryReady, recoveryReady ? undefined : 'A transaction, workflow, lifecycle obligation, or lifecycle-presence guard prevents scheduled novelty'),
		rpc: readinessCheck(rpcReady, rpcReady ? undefined : 'Read RPC quorum is not currently healthy'),
		runtime: readinessCheck(runtimeReady, runtimeReady ? undefined : 'Runtime reports an active error that must be reconciled'),
		scan: readinessCheck(scanReady, scanDetail),
		signer: readinessCheck(!execute || signerReady, !execute || signerReady ? undefined : 'Live execution has no configured signer'),
		storage: readinessCheck(storageReady, storageReady ? 'Runtime and configuration snapshots are readable' : 'Runtime reports a storage or fatal error'),
		submission: readinessCheck(submissionReady, submissionReady ? undefined : 'Live submission endpoint evidence is missing, stale, failed, or below its required healthy-origin threshold'),
	}
	const blockers = Object.entries(checks)
		.filter(([, check]) => !check.ready)
		.map(([name]) => name)
	return {
		activeWorkflowCount: activeWorkflows,
		automaticRetryObligationCount,
		blockers,
		blockedObligationCount,
		checkedAt: new Date(nowMilliseconds).toISOString(),
		checks,
		failedObligationCount,
		lifecyclePresenceBlocked,
		maximumScanAgeSeconds,
		mode: execute ? 'live' : 'dry-run',
		paused,
		pendingObligationCount,
		pendingTransactionCount: pendingCount,
		ready: blockers.length === 0,
		safetyPaused,
		scanAgeSeconds,
	}
}

function chaosReadinessMetrics(readiness: ReturnType<typeof publicChaosReadiness>) {
	const readinessChecks = record(readiness.checks) ?? {}
	const lines = [
		'# HELP zoltar_chaos_ready Whether the chaos operator is ready for scheduled work.',
		'# TYPE zoltar_chaos_ready gauge',
		`zoltar_chaos_ready ${readiness.ready ? '1' : '0'}`,
		'# HELP zoltar_chaos_readiness_check Whether one named readiness condition is satisfied.',
		'# TYPE zoltar_chaos_readiness_check gauge',
		...['configuration', 'inventory', 'paused', 'recovery', 'rpc', 'runtime', 'scan', 'signer', 'storage', 'submission'].map(name => `zoltar_chaos_readiness_check{check="${name}"} ${record(readinessChecks[name])?.['ready'] === true ? '1' : '0'}`),
		'# HELP zoltar_chaos_paused Whether the operator is intentionally paused.',
		'# TYPE zoltar_chaos_paused gauge',
		`zoltar_chaos_paused ${readiness.paused === true ? '1' : '0'}`,
		'# HELP zoltar_chaos_safety_paused Whether the durable safety pause is latched.',
		'# TYPE zoltar_chaos_safety_paused gauge',
		`zoltar_chaos_safety_paused ${readiness.safetyPaused === true ? '1' : '0'}`,
		'# HELP zoltar_chaos_pending_transactions Transactions awaiting recovery or finality.',
		'# TYPE zoltar_chaos_pending_transactions gauge',
		`zoltar_chaos_pending_transactions ${readiness.pendingTransactionCount?.toString() ?? '0'}`,
		'# HELP zoltar_chaos_active_workflows Durable workflows that have not reached a terminal state.',
		'# TYPE zoltar_chaos_active_workflows gauge',
		`zoltar_chaos_active_workflows ${readiness.activeWorkflowCount?.toString() ?? '0'}`,
		'# HELP zoltar_chaos_pending_obligations Lifecycle obligations that are pending or executing.',
		'# TYPE zoltar_chaos_pending_obligations gauge',
		`zoltar_chaos_pending_obligations ${readiness.pendingObligationCount?.toString() ?? '0'}`,
		'# HELP zoltar_chaos_automatic_retry_obligations Lifecycle obligations waiting for bounded automatic retry.',
		'# TYPE zoltar_chaos_automatic_retry_obligations gauge',
		`zoltar_chaos_automatic_retry_obligations ${readiness.automaticRetryObligationCount?.toString() ?? '0'}`,
		'# HELP zoltar_chaos_blocked_obligations Lifecycle obligations blocked on operator or protocol recovery.',
		'# TYPE zoltar_chaos_blocked_obligations gauge',
		`zoltar_chaos_blocked_obligations ${readiness.blockedObligationCount?.toString() ?? '0'}`,
		'# HELP zoltar_chaos_failed_obligations Lifecycle obligations in a failed state.',
		'# TYPE zoltar_chaos_failed_obligations gauge',
		`zoltar_chaos_failed_obligations ${readiness.failedObligationCount?.toString() ?? '0'}`,
		'# HELP zoltar_chaos_lifecycle_presence_blocker Whether unrepresented canonical lifecycle presence blocks novelty.',
		'# TYPE zoltar_chaos_lifecycle_presence_blocker gauge',
		`zoltar_chaos_lifecycle_presence_blocker ${readiness.lifecyclePresenceBlocked === true ? '1' : '0'}`,
		'# HELP zoltar_chaos_scan_age_seconds Age of the last complete canonical scan in seconds.',
		'# TYPE zoltar_chaos_scan_age_seconds gauge',
		`zoltar_chaos_scan_age_seconds ${readiness.scanAgeSeconds?.toString() ?? 'NaN'}`,
	]
	return `${lines.join('\n')}\n`
}

function publicFailure(operation: string, error: unknown) {
	console.error(`chaosDashboardOperation=${operation} failed=${error instanceof Error ? error.message : String(error)}`)
	if (error instanceof Error && error.name === CONFIGURATION_COMMITTED_SAFELY_PAUSED) {
		return json(
			{
				code: 'configuration_committed_safely_paused',
				committed: true,
				error: 'The configuration was committed, but activation did not complete. The bot remains durably safety-paused. Reload the committed configuration and explicitly resume after recovery.',
				safetyPaused: true,
			},
			503,
		)
	}
	if (error instanceof Error && error.name === CONFIGURATION_COMMIT_INDETERMINATE) {
		return indeterminateConfigurationFailure()
	}
	if (error instanceof Error && error.name === 'SignerOperationBusy') {
		const pausing = operation === 'mutation:/api/paused'
		return json(
			{
				error: pausing ? 'The operator is completing a transaction boundary. A requested pause is active in memory; retry to persist the change.' : 'The operator is completing a transaction boundary. No configuration change was applied; retry shortly.',
			},
			423,
		)
	}
	if (error instanceof Error && error.name === CONFIGURATION_REVISION_CONFLICT) {
		return json(
			{
				code: 'configuration_revision_conflict',
				error: 'Configuration changed after these values were loaded. Reload and review the current policy before saving again.',
			},
			409,
		)
	}
	return json({ error: 'The dashboard request could not be completed. Review the submitted values and protected bot logs.' }, 400)
}

function indeterminateConfigurationFailure() {
	return json(
		{
			code: 'configuration_commit_indeterminate',
			commitStatus: 'indeterminate',
			error: 'The configuration may have committed. Treat it as committed and stop the bot before inspecting and reloading the owner configuration and runtime-state files.',
			safetyPausedInProcess: true,
			treatAsCommitted: true,
		},
		503,
	)
}

export function startDashboardServer(port: number, controller: ChaosDashboardController) {
	const dashboardPassword = controller.password
	if (controller.hostname === '0.0.0.0' && controller.loopbackPublished !== true) {
		throw new Error('Non-loopback chaos dashboard exposure is disabled; bind to 127.0.0.1 or publish a 0.0.0.0 container listener through a host-loopback-only port')
	}
	if (dashboardPassword === undefined || dashboardPassword.length < 16) {
		throw new Error('ZOLTAR_BOT_DASHBOARD_PASSWORD must contain at least 16 characters for every chaos dashboard binding, including loopback')
	}
	validateDashboardAuthentication(controller.hostname, dashboardPassword, controller.loopbackPublished)
	const directory = import.meta.dir
	const browserSource = Bun.file(join(directory, 'dashboard.ts'))
	const transpiler = new Bun.Transpiler({ loader: 'ts', target: 'browser' })
	let authority = ''
	let configurationCommitIndeterminate = false
	let mutationBarrier = Promise.resolve()
	const enqueueMutation = (operation: () => Promise<Response>) => {
		const predecessor = mutationBarrier
		let release: () => void = () => undefined
		mutationBarrier = new Promise<void>(resolve => {
			release = resolve
		})
		return (async () => {
			await predecessor
			try {
				return await operation()
			} finally {
				release()
			}
		})()
	}
	const server = Bun.serve({
		hostname: controller.hostname,
		port,
		async fetch(request) {
			if (request.headers.get('host') !== authority) return json({ error: 'Request authority is not accepted' }, 403)
			const url = new URL(request.url)
			if (request.method === 'GET' && url.pathname === '/healthz') return new Response('ok', { headers: securityHeaders('text/plain; charset=utf-8') })
			if (!dashboardRequestIsAuthenticated(request, dashboardPassword)) {
				return Response.json({ error: 'Dashboard authentication is required' }, { headers: { ...securityHeaders('application/json; charset=utf-8'), ...dashboardAuthenticationChallenge() }, status: 401 })
			}
			if (request.method === 'GET') {
				if (url.pathname === '/readyz' || url.pathname === '/metrics') {
					try {
						await mutationBarrier
						const [state, configuration] = await Promise.all([controller.getState(), controller.getConfiguration()])
						const readiness = publicChaosReadiness(state, configuration)
						if (url.pathname === '/metrics') {
							return new Response(chaosReadinessMetrics(readiness), { headers: securityHeaders('text/plain; version=0.0.4; charset=utf-8'), status: 200 })
						}
						return json(readiness, readiness.ready ? 200 : 503)
					} catch (error) {
						console.error(`chaosDashboardOperation=readiness-read failed=${error instanceof Error ? error.message : String(error)}`)
						return json({ blockers: ['runtime_snapshot_unavailable'], ready: false }, 503)
					}
				}
				const page = url.pathname === '/' ? 'overview' : url.pathname.slice(1)
				if (dashboardPages.has(page)) {
					const html = await Bun.file(join(directory, 'index.html')).text()
					return new Response(html.replace('<body>', `<body data-page="${page}">`), { headers: securityHeaders('text/html; charset=utf-8') })
				}
				if (url.pathname === '/dashboard.css') return new Response(Bun.file(join(directory, 'styles.css')), { headers: securityHeaders('text/css; charset=utf-8') })
				if (url.pathname === '/operator-console.css') {
					return new Response(Bun.file(join(directory, '..', '..', '..', 'shared', 'src', 'dashboard', 'operator-console.css')), { headers: securityHeaders('text/css; charset=utf-8') })
				}
				if (url.pathname === '/dashboard.js') return new Response(transpiler.transformSync(await browserSource.text()), { headers: securityHeaders('text/javascript; charset=utf-8') })
				if (url.pathname === '/api/state') {
					try {
						await mutationBarrier
						const [stateResult, configurationResult] = await Promise.allSettled([controller.getState(), controller.getConfiguration()])
						if (stateResult.status === 'rejected') throw stateResult.reason
						if (configurationResult.status === 'rejected') console.error('chaosDashboardOperation=configuration-read-for-health failed=configuration unavailable')
						return json(publicChaosState(stateResult.value, configurationResult.status === 'fulfilled' ? configurationResult.value : undefined))
					} catch (error) {
						console.error(`chaosDashboardOperation=state-read failed=${error instanceof Error ? error.message : String(error)}`)
						return json({ error: 'Dashboard state is temporarily unavailable. Automatic recovery remains active.' }, 503)
					}
				}
				if (url.pathname === '/api/configuration') {
					try {
						await mutationBarrier
						return json({ ...publicChaosConfiguration(await controller.getConfiguration()), configurationCommitIndeterminate })
					} catch (error) {
						console.error(`chaosDashboardOperation=configuration-read failed=${error instanceof Error ? error.message : String(error)}`)
						return json({ error: 'Dashboard configuration is temporarily unavailable.' }, 503)
					}
				}
				if (url.pathname === '/favicon.ico') return new Response(undefined, { headers: securityHeaders('image/x-icon'), status: 204 })
			}
			if (request.method === 'PUT') {
				if (request.headers.get('origin') !== `http://${authority}`) return json({ error: 'Cross-origin requests are not accepted' }, 403)
				const handlers = new Map<string, (value: unknown) => unknown | Promise<unknown>>([
					['/api/reconciliation/candidate', controller.setCandidate],
					['/api/reconciliation/cancellation', controller.setCancellation],
					['/api/reconciliation/obligation', controller.setObligation],
					['/api/paused', controller.setPaused],
					['/api/reconciliation/replacement', controller.setReplacement],
					['/api/reconciliation/workflow', controller.setWorkflow],
					['/api/settings', controller.setSettings],
					['/api/signer', controller.setSigner],
				])
				const handler = handlers.get(url.pathname)
				if (handler !== undefined) {
					return await enqueueMutation(async () => {
						if (configurationCommitIndeterminate) return indeterminateConfigurationFailure()
						try {
							const value = await boundedDashboardJson(request)
							await handler(value)
							return json({ saved: true })
						} catch (error) {
							if (error instanceof Error && error.name === CONFIGURATION_COMMIT_INDETERMINATE) configurationCommitIndeterminate = true
							return publicFailure(`mutation:${url.pathname}`, error)
						}
					})
				}
			}
			return json({ error: 'Not found' }, 404)
		},
	})
	if (server.port === undefined) throw new Error('Dashboard server did not expose its listening port')
	authority = `127.0.0.1:${server.port.toString()}`
	return server
}
