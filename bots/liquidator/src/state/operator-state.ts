export type { DurableState } from './durable-state-document.ts'
import { durableStateDocument, type DurableState } from './durable-state-document.ts'
import { parseCompletedInstructions, parseSecurityPoolFunding, type SecurityPoolFundingEffect, type InstructionIdentity } from './security-pool-instructions.ts'
import { marketConfigurationList } from './market-snapshot.ts'
import { parseSecurityPoolScopes } from './security-pool-scopes.ts'
import { parsePendingTransactionIntent } from './pending-transaction-intent.ts'
import type { RuntimeState } from './runtime-state.ts'
export type { RuntimeState } from './runtime-state.ts'
import { readOwnerFileIfPresent, writeDurableStateFile } from '@zoltar/bot-shared/config/durable-file'
import { stringifyWithBigInts } from '@zoltar/core-shared/serialization/bigInt'
import type { Address, Hex } from '@zoltar/bot-shared/ethereum'
import { compareBigint } from '@zoltar/core-shared/math/bigint'
import { formatDecimalAmount } from '@zoltar/bot-shared/infrastructure/json-validation'
import { serializeCentralizedMarketEstimate, type CentralizedMarketSettings } from '@zoltar/bot-shared/monitoring/centralized-markets'
import { serializeMarketConsensusEstimate } from '@zoltar/bot-shared/monitoring/market-consensus'

/** Durable state holds bounded activity and recovery lists; a larger file means corruption or runaway growth. */
const MAXIMUM_STATE_BYTES = 5 * 1024 * 1024
// 500 retained activities with bounded details always fit under the state file cap.
const MAXIMUM_ACTIVITY_DETAILS_LENGTH = 1_500

export type UniverseObservation = {
	approved: boolean
	forkQuestionId: bigint
	forkTime: bigint
	id: bigint
	outcomeIndex: bigint | undefined
	parentId: bigint | undefined
	repToken: Address
}

export type Activity = {
	at: string
	details?: string | undefined
	hash?: Hex | undefined
	kind: 'configuration' | 'deployment' | 'deposit' | 'error' | 'fees' | 'liquidation' | 'migration' | 'recovery' | 'scan' | 'withdrawal'
	message: string
	status: 'confirmed' | 'dry-run' | 'failed' | 'info' | 'pending'
}

export type PendingTransactionIntent = {
	cancellation?: { hash: Hex; serializedTransaction: Hex } | undefined
	reportOperations?: { feed: Address; reportId: bigint } | undefined
	securityPoolFunding?: SecurityPoolFundingEffect | undefined
	securityPoolInstruction?: InstructionIdentity | undefined
	hash: Hex
	/** What the transaction does to the operator's funds; `configuration` changes vault settings without moving tokens. */
	kind: 'configuration' | 'deployment' | 'deposit' | 'fees' | 'liquidation' | 'migration' | 'withdrawal'
	label: string
	/** Renewable relay envelope deadline; not calldata validity. */
	maxBlockNumber: bigint
	/** Calldata-enforced block deadline, when present; never renewed. */
	lastValidBlockNumber?: bigint | undefined
	reconciliationReason?: string | undefined
	mode: 'private' | 'public'
	nonce: bigint
	receiptExpectation: { type: 'transaction' }
	requiresMarketEvidence: boolean
	sender: Address
	serializedTransaction: Hex
	submissionBlock: bigint
}

export function initialRuntimeState(paused: boolean, wallet: Address | undefined, chainId: number): RuntimeState {
	if (!Number.isSafeInteger(chainId) || chainId < 1) throw new Error('Runtime chain ID must be a positive integer')
	return {
		activities: [],
		chainId,
		centralizedMarket: undefined,
		centralizedMarketsByAsset: new Map(),
		marketConsensus: undefined,
		marketConsensusByAsset: new Map(),
		marketObservations: [],
		error: undefined,
		deploymentMissingName: undefined,
		deploymentCheckedBlock: undefined,
		deploymentCheckedTimestamp: undefined,
		lastScanAt: undefined,
		lastScannedBlock: undefined,
		lastScannedBlockHash: undefined,
		lastScannedTimestamp: undefined,
		paused,
		rpcEndpointHealth: [],
		pendingTransactions: [],
		securityPools: [],
		securityPoolScopes: [],
		scanning: false,
		startedAt: new Date().toISOString(),
		status: paused ? 'paused' : 'starting',
		universes: [],
		wallet,
		walletAttoEth: 0n,
		walletRepByToken: new Map(),
	}
}

export function clearMarketEvidenceForConfigurationChange(state: { centralizedMarket: unknown; centralizedMarketsByAsset?: Map<string, unknown> | undefined; marketConsensus: unknown; marketConsensusByAsset?: Map<string, unknown> | undefined; marketObservations: unknown[] }) {
	state.centralizedMarket = undefined
	state.centralizedMarketsByAsset?.clear()
	state.marketConsensus = undefined
	state.marketConsensusByAsset?.clear()
	state.marketObservations = []
}

export function resolveRecoveredIntentJournal(state: Pick<RuntimeState, 'pendingTransactions'>, hash: Hex, receiptStatus: 'reverted' | 'success' | undefined) {
	if (receiptStatus === undefined) return false
	state.pendingTransactions = state.pendingTransactions.filter(intent => intent.hash.toLowerCase() !== hash.toLowerCase())
	return true
}

export function recordActivity(state: RuntimeState, activity: Omit<Activity, 'at'> & { at?: string | undefined }) {
	state.activities.unshift({
		at: activity.at ?? new Date().toISOString(),
		...(activity.details === undefined ? {} : { details: activity.details.slice(0, MAXIMUM_ACTIVITY_DETAILS_LENGTH) }),
		...(activity.hash === undefined ? {} : { hash: activity.hash }),
		kind: activity.kind,
		message: activity.message,
		status: activity.status,
	})
	state.activities = state.activities.slice(0, 500)
}

export async function commitReconciledIntent(path: string, state: RuntimeState, hash: Hex, activity: Omit<Activity, 'at'> & { at?: string | undefined }, persist: (path: string, state: RuntimeState) => Promise<void> = saveDurableState) {
	const reconciledState = {
		...state,
		activities: [...state.activities],
		pendingTransactions: state.pendingTransactions.filter(candidate => candidate.hash.toLowerCase() !== hash.toLowerCase()),
	}
	recordActivity(reconciledState, activity)
	await persist(path, reconciledState)
	state.activities = reconciledState.activities
	state.pendingTransactions = reconciledState.pendingTransactions
}

export function assertIntentSender(intentSender: Address, activeSender: Address) {
	if (intentSender.toLowerCase() !== activeSender.toLowerCase()) {
		throw new Error(`Pending transaction belongs to ${intentSender}, but the active signer is ${activeSender}`)
	}
}

export function operatorSnapshot(state: RuntimeState, execute: boolean, marketConfigurations?: CentralizedMarketSettings | readonly CentralizedMarketSettings[]) {
	const configurations = marketConfigurationList(marketConfigurations)
	const rootConfiguration = configurations[0]
	const alerts: { message: string; severity: 'error' | 'warning' }[] = []
	if (state.status === 'connectivity-degraded') alerts.push({ message: state.error ?? 'RPC connectivity is degraded; automatic execution is blocked until connectivity recovers', severity: 'warning' })
	if (state.pendingTransactions.length > 0) alerts.push({ message: `${state.pendingTransactions.length.toString()} transaction intent(s) require recovery before execution can continue`, severity: 'error' })
	for (const configuration of configurations) {
		if (configuration !== rootConfiguration) continue
		const consensus = state.marketConsensusByAsset.get(configuration.assetAddress.toLowerCase()) ?? state.marketConsensus
		const asset = `${configuration.assetAddress.slice(0, 6)}…${configuration.assetAddress.slice(-4)}`
		if (configuration.requiredForExecution && consensus === undefined) alerts.push({ message: `Required REP market consensus is unavailable for ${asset}`, severity: 'error' })
		else if (configuration.requiredForExecution && consensus?.reliable === false) alerts.push({ message: `Required REP market consensus is blocked for ${asset}: ${consensus.reasons.join('; ')}`, severity: 'error' })
		else if (consensus?.reliable === true && (!consensus.cex.reliable || !consensus.dex.reliable)) alerts.push({ message: `REP market consensus for ${asset} is operating with the configured single-group fallback`, severity: 'warning' })
	}
	const recentReorgResets = state.activities.filter(activity => activity.message === 'DEX market evidence reset after canonical head replacement' && Date.now() - Date.parse(activity.at) <= 60 * 60 * 1_000).length
	if (recentReorgResets >= 2) alerts.push({ message: `${recentReorgResets.toString()} canonical market-evidence resets occurred during the last hour`, severity: 'warning' })
	const universeMap = new Map(state.universes.map(universe => [universe.id.toString(), universe]))

	return {
		activities: state.activities,
		alerts,
		centralizedMarket: serializeCentralizedMarketEstimate(state.centralizedMarket),
		marketConsensus: serializeMarketConsensusEstimate(state.marketConsensus, formatDecimalAmount),
		error: state.error,
		execute,
		operatorCapable: state.lastScanAt !== undefined && state.lastScannedBlock !== undefined && !state.scanning && !state.paused && state.error === undefined && state.pendingTransactions.length === 0 && state.status === (execute ? 'running' : 'dry-run') && (!execute || state.wallet !== undefined),
		deploymentMissingName: state.deploymentMissingName,
		deploymentCheckedBlock: state.deploymentCheckedBlock?.toString(),
		deploymentCheckedTimestamp: state.deploymentCheckedTimestamp?.toString(),
		lastScanAt: state.lastScanAt,
		lastScannedBlock: state.lastScannedBlock?.toString(),
		lastScannedTimestamp: state.lastScannedTimestamp?.toString(),
		metrics: {
			approvedUniverseCount: [...universeMap.values()].filter(universe => universe.approved).length,
			assumedOpenInterestEth: '0',
			candidateCount: 0,
			deployedRep: '0',
			eligiblePoolCount: 0,
			poolCount: 0,
			selectedPoolCount: 0,
			walletEth: formatDecimalAmount(state.walletAttoEth),
		},
		paused: state.paused,
		rpcEndpointHealth: state.rpcEndpointHealth,
		pendingTransactions: state.pendingTransactions.map(intent => ({
			hash: intent.hash,
			kind: intent.kind,
			label: intent.label,
			maxBlockNumber: intent.maxBlockNumber.toString(),
			mode: intent.mode,
			nonce: intent.nonce.toString(),
			requiresMarketEvidence: intent.requiresMarketEvidence,
			submissionBlock: intent.submissionBlock.toString(),
		})),
		pools: [],
		scanning: state.scanning,
		marketSources: configurations.flatMap(configuration => {
			const assetKey = configuration.assetAddress.toLowerCase()
			const centralized = state.centralizedMarketsByAsset.get(assetKey) ?? (configuration === rootConfiguration ? state.centralizedMarket : undefined)
			const consensus = state.marketConsensusByAsset.get(assetKey) ?? (configuration === rootConfiguration ? state.marketConsensus : undefined)
			const rawDex = state.marketObservations.filter(observation => observation.kind === 'dex' && observation.assetId.toLowerCase() === assetKey)
			return [
				...configuration.sources.map(source => {
					const observed = centralized?.observations.some(observation => observation.exchangeId === source.exchangeId) === true
					const admitted = configuration.venueConsensus === undefined ? observed : consensus?.cex.observations.some(observation => observation.sourceId === source.exchangeId) === true
					const unavailable = centralized?.reasons.find(reason => reason.startsWith(`${source.exchangeId} `))
					return {
						assetId: configuration.assetAddress,
						id: source.exchangeId,
						kind: 'cex' as const,
						market: source.repMarket,
						reason: admitted ? undefined : (unavailable ?? (observed ? 'Observed but excluded by persistence, depth, or dispersion policy' : 'Not admitted: stale, shallow, or unavailable')),
						status: admitted ? ('admitted' as const) : ('excluded' as const),
					}
				}),
				...(configuration.venueConsensus?.dexSources.map(source => {
					const admitted = consensus?.dex.observations.some(observation => observation.sourceId === source.sourceId) === true
					const observed = rawDex.some(observation => observation.sourceId === source.sourceId)
					const unavailable = consensus?.dex.reasons.find(reason => reason.startsWith(`${source.sourceId} `))
					return {
						assetId: configuration.assetAddress,
						id: source.sourceId,
						kind: 'dex' as const,
						market: source.pair,
						reason: admitted ? undefined : (unavailable ?? (observed ? 'Observed but excluded by persistence, depth, or dispersion policy' : 'Observation unavailable')),
						status: admitted ? ('admitted' as const) : ('excluded' as const),
					}
				}) ?? []),
			]
		}),
		startedAt: state.startedAt,
		status: state.status,
		universes: [...universeMap.values()]
			.sort((left, right) => compareBigint(left.id, right.id))
			.map(universe => ({
				approved: universe.approved,
				forkedPoolCount: 0,
				forkQuestionId: universe.forkQuestionId.toString(),
				forkTime: universe.forkTime.toString(),
				id: universe.id.toString(),
				migratableVaultCount: 0,
				operationalPoolCount: 0,
				outcomeIndex: universe.outcomeIndex?.toString(),
				parentId: universe.parentId?.toString(),
				poolCount: 0,
				repToken: universe.repToken,
				selectedPoolCount: 0,
			})),
		wallet: state.wallet,
		walletRep: Object.fromEntries([...state.walletRepByToken.entries()].map(([token, amount]) => [token, formatDecimalAmount(amount)])),
	}
}

/** Staged-operation recovery was removed; a journal still holding such entries needs manual resolution rather than silently blocking execution forever. */
function assertNoLegacyStagedOperations(value: unknown, path: string) {
	if (value === undefined || (Array.isArray(value) && value.length === 0)) return
	const entries = Array.isArray(value) ? `${value.length.toString()} legacy pending staged operation(s)` : 'a legacy pendingStagedOperations field'
	throw new Error(`Liquidator state contains ${entries}, which are no longer supported; resolve them on-chain, then remove pendingStagedOperations from ${path}`)
}

export async function loadDurableState(path: string, expectedChainId: number): Promise<DurableState> {
	if (!Number.isSafeInteger(expectedChainId) || expectedChainId < 1) throw new Error('Expected state chain ID must be a positive integer')
	const contents = await readOwnerFileIfPresent(path, 'Liquidator state', MAXIMUM_STATE_BYTES)
	if (contents === undefined) return { securityPoolFunding: {}, completedSecurityPoolInstructions: {}, securityPoolScopes: [], activities: [], chainId: expectedChainId, lastScannedBlock: undefined, pendingTransactions: [], version: 2 }
	const value: unknown = JSON.parse(contents)
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Liquidator state must be an object')
	const version = Reflect.get(value, 'version')
	const chainId = Reflect.get(value, 'chainId')
	const activities = Reflect.get(value, 'activities')
	const lastScannedBlock = Reflect.get(value, 'lastScannedBlock')
	const lastExpiredTakeoverBlock = Reflect.get(value, 'lastExpiredTakeoverBlock')
	if (lastExpiredTakeoverBlock !== undefined && (typeof lastExpiredTakeoverBlock !== 'string' || !/^[0-9]+$/.test(lastExpiredTakeoverBlock))) throw new Error('Invalid takeover retry budget block')
	const pendingStagedOperations = Reflect.get(value, 'pendingStagedOperations')
	const pendingTransactions = Reflect.get(value, 'pendingTransactions')
	if (version !== 2 || !Array.isArray(activities)) throw new Error('Liquidator state version is unsupported')
	if (chainId !== expectedChainId) throw new Error(`Liquidator state belongs to chain ${String(chainId)}, expected chain ${expectedChainId.toString()}`)
	assertNoLegacyStagedOperations(pendingStagedOperations, path)
	if (!Array.isArray(pendingTransactions)) throw new Error('pendingTransactions must be an array')
	return {
		activities: activities.flatMap(activity => {
			if (typeof activity !== 'object' || activity === null || Array.isArray(activity)) return []
			const at = Reflect.get(activity, 'at')
			const kind = Reflect.get(activity, 'kind')
			const message = Reflect.get(activity, 'message')
			const status = Reflect.get(activity, 'status')
			if (typeof at !== 'string' || typeof message !== 'string') return []
			if (kind !== 'configuration' && kind !== 'deployment' && kind !== 'deposit' && kind !== 'error' && kind !== 'fees' && kind !== 'liquidation' && kind !== 'migration' && kind !== 'recovery' && kind !== 'scan' && kind !== 'withdrawal') return []
			if (status !== 'confirmed' && status !== 'dry-run' && status !== 'failed' && status !== 'info' && status !== 'pending') return []
			const details = Reflect.get(activity, 'details')
			const hash = Reflect.get(activity, 'hash')
			return [
				{
					at,
					...(typeof details === 'string' ? { details } : {}),
					...(typeof hash === 'string' && hash.startsWith('0x') ? { hash: hash as Hex } : {}),
					kind,
					message,
					status,
				},
			]
		}),
		chainId,
		lastScannedBlock: typeof lastScannedBlock === 'string' ? lastScannedBlock : undefined,
		lastExpiredTakeoverBlock: lastExpiredTakeoverBlock === undefined ? undefined : BigInt(lastExpiredTakeoverBlock),
		pendingTransactions: await Promise.all(pendingTransactions.map((intent: unknown) => parsePendingTransactionIntent(intent, expectedChainId))),
		securityPoolFunding: parseSecurityPoolFunding(Reflect.get(value, 'securityPoolFunding')),
		completedSecurityPoolInstructions: parseCompletedInstructions(Reflect.get(value, 'completedSecurityPoolInstructions')),
		securityPoolScopes: parseSecurityPoolScopes(Reflect.get(value, 'securityPoolScopes')),
		version: 2,
	}
}

export async function saveDurableState(path: string, state: RuntimeState) {
	// Render before queueing so the file captures the state as of this call, not of a later mutation.
	const contents = `${stringifyWithBigInts(durableStateDocument(state))}\n`
	await writeDurableStateFile(path, contents, { label: 'Liquidator state', maximumBytes: MAXIMUM_STATE_BYTES })
}
