import { groupedPublicEvaluations } from './public-operation-evaluations.ts'
import { publicWorkflowStep } from './public-workflow-step.ts'
import { publicActivity } from './public-activity.ts'
import { pendingTransactionObservationKind } from '../state/pending-transaction-observation.ts'
import { booleanField, compact, isoTimestampField, record, publicExplorerUrl, publicStrings, operationClassificationField, safeIntegerField, safeString, scalar, stringField } from './public-fields.ts'
import { publicAlert, publicRetirement } from './public-retirement.ts'

function configuredRpcUrls(value: unknown) {
	return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length <= 2_048).slice(0, 8) : []
}

function optionalPublicStrings(value: unknown) {
	if (!Array.isArray(value)) return undefined
	return publicStrings(value)
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
			portfolio: stringField(source, 'portfolio'),
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
			portfolio: stringField(source, 'portfolio'),
			universeId: stringField(source, 'universeId'),
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
function publicChaosTopology(value: unknown) {
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

export function publicRpcHealth(value: unknown, configurationValue: unknown) {
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

export function publicSubmissionHealthMaximumAgeSeconds(configurationValue: unknown) {
	const configuration = record(configurationValue)
	const settings = record(configuration?.['settings']) ?? configuration
	const runtime = record(settings?.['runtime']) ?? settings
	const network = record(settings?.['network']) ?? settings
	const maximumBlockIntervalSeconds = typeof network?.['maximumBlockIntervalSeconds'] === 'number' && Number.isSafeInteger(network['maximumBlockIntervalSeconds']) ? network['maximumBlockIntervalSeconds'] : 60
	const pollMilliseconds = typeof runtime?.['pollMilliseconds'] === 'number' && Number.isSafeInteger(runtime['pollMilliseconds']) ? runtime['pollMilliseconds'] : 12_000
	return Math.ceil((pollMilliseconds * 3) / 1_000) + maximumBlockIntervalSeconds * 2
}

export function publicSubmissionHealth(value: unknown, configurationValue: unknown, nowMilliseconds: number, maximumAgeSeconds: number) {
	const configuration = record(configurationValue)
	const settings = record(configuration?.['settings']) ?? configuration
	const connectivity = record(settings?.['connectivity'])
	const network = record(settings?.['network'])
	const submission = record(settings?.['submission'])
	const expectedChainId = safeIntegerField(network ?? {}, 'chainId')
	if (connectivity === undefined || submission === undefined || expectedChainId === undefined || !Number.isSafeInteger(maximumAgeSeconds) || maximumAgeSeconds < 1) return { ready: false, status: 'not-configured' as const }
	const mode = submission['mode']
	if (mode !== 'public' && mode !== 'private') return { ready: false, status: 'not-configured' as const }
	const base = { mode, ready: false }
	let expectedKind: 'private-relay' | 'public-rpc' = 'public-rpc'
	let expectedAuthenticationAddress: string | undefined
	let requiredHealthyOriginCount = 1
	let urls: unknown = connectivity['publicRpcUrls']
	if (mode === 'private') {
		expectedKind = 'private-relay'
		const wallet = stringField(configuration ?? {}, 'wallet') ?? stringField(configuration ?? {}, 'signerAddress')
		if (wallet === undefined || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return { ...base, status: 'not-configured' as const }
		expectedAuthenticationAddress = wallet.toLowerCase()
		const required = safeIntegerField(submission, 'minimumBundleRelaySuccesses')
		if (required === undefined || required < 1) return { ...base, status: 'not-configured' as const }
		requiredHealthyOriginCount = required
		urls = submission['relayUrls']
	}
	if (!Array.isArray(urls) || urls.length === 0 || urls.some(url => typeof url !== 'string')) return { ...base, status: 'not-configured' as const }
	const configuredOrigins = urls.flatMap(url => {
		const origin = endpointOrigin(url)
		return origin === undefined ? [] : [origin]
	})
	const configuredTargets = new Set(configuredOrigins)
	if (configuredOrigins.length !== urls.length || configuredTargets.size < requiredHealthyOriginCount) return { ...base, status: 'not-configured' as const }
	const configuredOriginCount = configuredTargets.size
	const checksByTarget = new Map<string, { check: Record<string, unknown>; checkedAt: string; target: string }>()
	if (Array.isArray(value)) {
		for (const candidate of value) {
			const check = record(candidate)
			if (check?.['kind'] !== expectedKind) continue
			const target = endpointOrigin(check['target'])
			const checkedAt = isoTimestampField(check, 'checkedAt')
			if (target === undefined || checkedAt === undefined || !configuredTargets.has(target)) continue
			const current = checksByTarget.get(target)
			if (current === undefined || Date.parse(checkedAt) > Date.parse(current.checkedAt)) checksByTarget.set(target, { check, checkedAt, target })
		}
	}
	const currentChecks = [...checksByTarget.values()]
	const checkedOriginCount = currentChecks.length
	const lastCheckedAt = currentChecks.map(({ checkedAt }) => checkedAt).sort((left, right) => Date.parse(right) - Date.parse(left))[0]
	if (currentChecks.length === 0) {
		return { ...base, checkedOriginCount, configuredOriginCount, freshOriginCount: 0, healthyOriginCount: 0, requiredHealthyOriginCount, status: 'not-checked' as const }
	}
	const freshChecks = currentChecks.filter(({ checkedAt }) => {
		const ageMilliseconds = nowMilliseconds - Date.parse(checkedAt)
		return ageMilliseconds >= 0 && ageMilliseconds <= maximumAgeSeconds * 1_000
	})
	const freshOriginCount = freshChecks.length
	const common = { ...base, checkedOriginCount, configuredOriginCount, freshOriginCount, lastCheckedAt, requiredHealthyOriginCount }
	const healthyOrigins = new Set(
		freshChecks.flatMap(({ check, target }) => (check['status'] === 'healthy' && safeIntegerField(check, 'chainId') === expectedChainId && (expectedAuthenticationAddress === undefined || stringField(check, 'authenticatedAddress')?.toLowerCase() === expectedAuthenticationAddress) ? [target] : [])),
	)
	const healthyOriginCount = healthyOrigins.size
	if (checkedOriginCount !== configuredOriginCount) return { ...common, healthyOriginCount, status: 'not-checked' as const }
	if (freshOriginCount !== configuredOriginCount) return { ...common, healthyOriginCount, status: 'stale' as const }
	const proofMatchesSigner = expectedAuthenticationAddress === undefined ? undefined : freshChecks.every(({ check }) => stringField(check, 'authenticatedAddress')?.toLowerCase() === expectedAuthenticationAddress)
	const safetyFailure = freshChecks.some(({ check }) => check['status'] === 'failed' && check['failureDisposition'] !== 'connectivity-degraded')
	const ready = !safetyFailure && proofMatchesSigner !== false && healthyOriginCount >= requiredHealthyOriginCount
	return compact({ ...common, healthyOriginCount, proofMatchesSigner, ready, status: ready ? ('ready' as const) : ('degraded' as const) })
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

function publicPendingTransactionObservation(value: unknown) {
	const source = record(value)
	if (source === undefined) return undefined
	const kind = pendingTransactionObservationKind(source['kind'])
	const checkedAt = isoTimestampField(source, 'checkedAt')
	const head = scalar(source, 'head')
	if (kind === undefined || checkedAt === undefined || head === undefined) return undefined
	return compact({ checkedAt, head, includedBlock: scalar(source, 'includedBlock'), kind })
}

function publicPendingTransaction(value: unknown) {
	const source = record(value)
	if (source === undefined) return undefined
	return compact({
		cancellationHash: stringField(source, 'cancellationHash'),
		hash: stringField(source, 'hash'),
		label: stringField(source, 'label'),
		maxBlockNumber: scalar(source, 'maxBlockNumber'),
		nonce: scalar(source, 'nonce'),
		observation: publicPendingTransactionObservation(source['observation']),
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

export function publicChaosState(value: unknown, configurationValue?: unknown, nowMilliseconds = Date.now()) {
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
		workflows: workflows.flatMap(value => {
			const workflow = publicWorkflow(value)
			return workflow === undefined ? [] : [workflow]
		}),
		execute: booleanField(source, 'execute'),
		inventory: publicInventory(source['inventory']),
		inventoryAvailable: booleanField(source, 'inventoryAvailable') === true && stringField(source, 'wallet') !== undefined,
		lastScanAt: stringField(source, 'lastScanAt'),
		lastDeploymentCheckedBlock: scalar(source, 'lastDeploymentCheckedBlock'),
		lastDeploymentCheckAt: stringField(source, 'lastDeploymentCheckAt'),
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
		profileId: stringField(source, 'profileId'),
		retirement: publicRetirement(source['retirement']),
		rpcHealth: publicRpcHealth(source['rpcEndpointHealth'], configurationValue),
		submissionHealth: publicSubmissionHealth(source['rpcEndpointHealth'], configurationValue, nowMilliseconds, publicSubmissionHealthMaximumAgeSeconds(configurationValue)),
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
	const connectivity = record(settings['connectivity'])
	return compact({
		allowHighRiskOperations: booleanField(strategy, 'allowHighRiskOperations'),
		allowIrreversibleOperations: booleanField(strategy, 'allowIrreversibleOperations'),
		initializeGenesisUniverse: booleanField(strategy, 'initializeGenesisUniverse'),
		chainId: scalar(record(settings['network']) ?? {}, 'chainId'),
		enabledEcosystems: publicStrings(strategy['enabledEcosystems']),
		execute: booleanField(runtime, 'execute'),
		explorerUrl: publicExplorerUrl((record(settings['network']) ?? {})['explorerUrl']),
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
		rpcQuorum: scalar(record(settings['connectivity']) ?? {}, 'rpcQuorum'),
		connectivity:
			connectivity === undefined
				? undefined
				: {
						publicRpcUrls: configuredRpcUrls(connectivity['publicRpcUrls']),
						quorumRpcUrls: configuredRpcUrls(connectivity['quorumRpcUrls']),
						readRpcUrl: typeof connectivity['readRpcUrl'] === 'string' ? connectivity['readRpcUrl'] : undefined,
						rpcQuorum: scalar(connectivity, 'rpcQuorum'),
					},
		operationControls: publicOperationControls(settings['operations'] ?? source['operationControls']),
		paused: booleanField(settings, 'paused'),
		rememberSigner: booleanField(source, 'rememberSigner'),
		revision: scalar(source, 'revision'),
		selectableOperationAllowlist: optionalPublicStrings(strategy['selectableOperationAllowlist']),
		wallet: stringField(source, 'wallet') ?? stringField(source, 'signerAddress'),
		workflowValidForBlocks: scalar(strategy, 'workflowValidForBlocks'),
	})
}
