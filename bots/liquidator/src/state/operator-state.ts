import { randomBytes } from 'node:crypto'
import { dirname } from 'node:path'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { getAddress, keccak256, parseTransaction, recoverTransactionAddress, type Address, type Hex } from '@zoltar/bot-shared/ethereum'
import { formatDecimalAmount } from '#config/settings'
import { isVaultMigrationSourceEligible } from '#core/fork-migration'
import { vaultHealthBps, type LiquidationCandidate, type VaultPosition } from '#core/strategy'
import { centralizedMarketConfigurationAllowsExecution, centralizedPriceAllowsExecution, centralizedPriceDeviationBps, serializeCentralizedMarketEstimate, type CentralizedMarketEstimate, type CentralizedMarketSettings } from '@zoltar/bot-shared/monitoring/centralized-markets'
import { marketConsensusAllowsExecution, marketConsensusDeviationBps, serializeMarketConsensusEstimate, type MarketConsensusEstimate } from '@zoltar/bot-shared/monitoring/market-consensus'
import type { MarketConsensusObservation } from '@zoltar/bot-shared/monitoring/market-consensus'
import type { RpcEndpointHealth } from '@zoltar/bot-shared/ethereum/rpc-resilience'

export type PoolObservation = {
	knownVaultCount: bigint
	address: Address
	approvedUniverse: boolean
	botVault: VaultPosition
	candidates: LiquidationCandidate[]
	settlementCollateralAttoEth: bigint
	currentRetentionRate: bigint
	forkActivationTime: bigint
	forkOutcomeIndex: bigint | undefined
	initialReportPriorityFeeAttoEthPerGas: bigint
	isPriceValid: boolean
	lastPrice: bigint
	lastSettlementTimestamp: bigint
	manager: Address
	minLiquidationPriceDistanceBps: bigint
	minimumSecurityBondDebtAttoEth: bigint
	minimumToken1ReportAttoEth: bigint
	minimumVaultRepDepositAttoRep: bigint
	multiplierBps: bigint
	parent: Address
	parentUniverseId: bigint | undefined
	pendingReportId: bigint
	pendingReportSponsor: Address
	questionId: bigint
	repToken: Address
	requestPriceCostAttoEth: bigint
	selected: boolean
	securityPoolForker: Address
	stagedOperations: StagedOperationObservation[]
	systemState: bigint
	totalCapacityOwnershipAttoRep: bigint
	totalAttoRep: bigint
	truncatedVaults: boolean
	universeId: bigint
	vaults: VaultPosition[]
}

export type UniverseObservation = {
	approved: boolean
	forkQuestionId: bigint
	forkTime: bigint
	id: bigint
	outcomeIndex: bigint | undefined
	parentId: bigint | undefined
	repToken: Address
}

export type StagedOperationObservation = {
	operationAmountAttoRepOrAttoEth: bigint
	id: bigint
	liquidationApprovalId: `0x${string}`
	isPendingSettlement: boolean
	operation: bigint
	operator: Address
	queuedAt: bigint
	receiverVault: Address
	reservedLiquidationDebtAttoEth: bigint
	snapshotTotalRepBackingUnits: bigint
	snapshotTargetCapacityOwnershipAttoRep: bigint
	snapshotTargetDisputeStakedAttoRep: bigint
	snapshotTargetOpenInterestAttoEth: bigint
	snapshotTargetBackingUnits: bigint
	snapshotTotalPoolHeldAttoRep: bigint
	targetVault: Address
	validForSeconds: bigint
}

export type Activity = {
	at: string
	details?: string | undefined
	hash?: Hex | undefined
	kind: 'configuration' | 'deployment' | 'deposit' | 'error' | 'fees' | 'liquidation' | 'migration' | 'recovery' | 'scan' | 'withdrawal'
	message: string
	status: 'confirmed' | 'dry-run' | 'failed' | 'info' | 'pending'
}

export type DurableState = {
	activities: Activity[]
	lastScannedBlock: string | undefined
	pendingStagedOperations: PendingStagedOperation[]
	pendingTransactions: PendingTransactionIntent[]
	version: 1
}

export type PendingStagedOperation = {
	coordinator: Address
	operationId: bigint
	queuedBlock: bigint
	target: Address
}

export type PendingTransactionIntent = {
	hash: Hex
	kind: 'deployment' | 'deposit' | 'fees' | 'liquidation' | 'migration' | 'withdrawal'
	label: string
	maxBlockNumber: bigint
	mode: 'private' | 'public'
	nonce: bigint
	receiptExpectation: { type: 'transaction' } | { coordinator: Address; operation: 0 | 1; type: 'staged-success' } | { amount: bigint; coordinator: Address; operator: Address; receiver: Address; target: Address; type: 'pending-liquidation' }
	requiresMarketEvidence: boolean
	sender: Address
	serializedTransaction: Hex
	submissionBlock: bigint
}

export type RuntimeState = {
	activities: Activity[]
	centralizedMarket: CentralizedMarketEstimate | undefined
	centralizedMarketsByAsset: Map<string, CentralizedMarketEstimate>
	marketConsensus: MarketConsensusEstimate | undefined
	marketConsensusByAsset: Map<string, MarketConsensusEstimate>
	marketObservations: MarketConsensusObservation[]
	error: string | undefined
	lastScanAt: string | undefined
	lastScannedBlock: bigint | undefined
	lastScannedBlockHash: Hex | undefined
	lastScannedTimestamp: bigint | undefined
	paused: boolean
	rpcEndpointHealth: readonly RpcEndpointHealth[]
	pendingStagedOperations: PendingStagedOperation[]
	pendingTransactions: PendingTransactionIntent[]
	pools: PoolObservation[]
	scanning: boolean
	startedAt: string
	status: 'connectivity-degraded' | 'dry-run' | 'error' | 'paused' | 'running' | 'starting'
	universes: UniverseObservation[]
	wallet: Address | undefined
	walletAttoEth: bigint
	walletRepByToken: Map<string, bigint>
}

export function initialRuntimeState(paused: boolean, wallet: Address | undefined): RuntimeState {
	return {
		activities: [],
		centralizedMarket: undefined,
		centralizedMarketsByAsset: new Map(),
		marketConsensus: undefined,
		marketConsensusByAsset: new Map(),
		marketObservations: [],
		error: undefined,
		lastScanAt: undefined,
		lastScannedBlock: undefined,
		lastScannedBlockHash: undefined,
		lastScannedTimestamp: undefined,
		paused,
		rpcEndpointHealth: [],
		pendingStagedOperations: [],
		pendingTransactions: [],
		pools: [],
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

export function recoveredIntentCanBeResubmitted(intent: Pick<PendingTransactionIntent, 'requiresMarketEvidence'>) {
	return !intent.requiresMarketEvidence
}

export function resolveRecoveredIntentJournal(state: Pick<RuntimeState, 'pendingTransactions'>, hash: Hex, receiptStatus: 'reverted' | 'success' | undefined) {
	if (receiptStatus === undefined) return false
	state.pendingTransactions = state.pendingTransactions.filter(intent => intent.hash.toLowerCase() !== hash.toLowerCase())
	return true
}

export function recordActivity(state: RuntimeState, activity: Omit<Activity, 'at'> & { at?: string | undefined }) {
	state.activities.unshift({
		at: activity.at ?? new Date().toISOString(),
		...(activity.details === undefined ? {} : { details: activity.details }),
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

function vaultView(vault: VaultPosition, multiplierBps?: bigint, price?: bigint) {
	const healthBps = multiplierBps === undefined || price === undefined ? undefined : vaultHealthBps(vault.vaultAttoRepBacking, vault.openInterestAttoEth, multiplierBps, price, vault.disputeStakedAttoRep)
	return {
		address: vault.address,
		capacityOwnershipRep: formatDecimalAmount(vault.capacityOwnershipAttoRep),
		openInterestDisplay: formatDecimalAmount(vault.openInterestAttoEth),
		healthBps: healthBps?.toString(),
		backingUnits: vault.backingUnits.toString(),
		vaultRepBacking: formatDecimalAmount(vault.vaultAttoRepBacking),
		claimableFeesEth: formatDecimalAmount(vault.claimableFeesAttoEth),
	}
}

function candidateView(candidate: LiquidationCandidate) {
	return {
		bonusValueEth: formatDecimalAmount(candidate.bonusValueAttoEth),
		requestedDebtEth: formatDecimalAmount(candidate.requestedDebtAttoEth),
		priceDistanceBps: candidate.priceDistanceBps.toString(),
		vaultRepBackingToTransferRep: formatDecimalAmount(candidate.vaultAttoRepBackingToTransfer),
		resultingHealthBps: candidate.resultingHealthBps.toString(),
		target: candidate.target.address,
		topUpRep: formatDecimalAmount(candidate.topUpAttoRep),
	}
}

export function operatorSnapshot(state: RuntimeState, execute: boolean, marketConfigurations?: CentralizedMarketSettings | readonly CentralizedMarketSettings[]) {
	const configurations: readonly CentralizedMarketSettings[] = marketConfigurations === undefined ? [] : 'assetAddress' in marketConfigurations ? [marketConfigurations] : marketConfigurations
	const marketConfigurationFor = (asset: Address) => configurations.find(configuration => configuration.assetAddress.toLowerCase() === asset.toLowerCase())
	const deployedRep = state.pools.reduce((total, pool) => total + pool.botVault.vaultAttoRepBacking, 0n)
	const assumedOpenInterestAttoEth = state.pools.reduce((total, pool) => total + pool.botVault.openInterestAttoEth, 0n)
	const walletRep = [...state.walletRepByToken.values()].reduce((total, amount) => total + amount, 0n)
	const rootConfiguration = configurations[0]
	const discoveredRepAssets = new Set(state.pools.map(pool => pool.repToken.toLowerCase()))
	const alerts: { message: string; severity: 'error' | 'warning' }[] = []
	if (state.status === 'connectivity-degraded') alerts.push({ message: state.error ?? 'RPC connectivity is degraded; automatic execution is blocked until connectivity recovers', severity: 'warning' })
	if (state.pendingTransactions.length > 0) alerts.push({ message: `${state.pendingTransactions.length.toString()} transaction intent(s) require recovery before execution can continue`, severity: 'error' })
	for (const configuration of configurations) {
		if (configuration !== rootConfiguration && !discoveredRepAssets.has(configuration.assetAddress.toLowerCase())) continue
		const consensus = state.marketConsensusByAsset.get(configuration.assetAddress.toLowerCase()) ?? (configuration === rootConfiguration ? state.marketConsensus : undefined)
		const asset = `${configuration.assetAddress.slice(0, 6)}…${configuration.assetAddress.slice(-4)}`
		if (configuration.requiredForExecution && consensus === undefined) alerts.push({ message: `Required REP market consensus is unavailable for ${asset}`, severity: 'error' })
		else if (configuration.requiredForExecution && consensus?.reliable === false) alerts.push({ message: `Required REP market consensus is blocked for ${asset}: ${consensus.reasons.join('; ')}`, severity: 'error' })
		else if (consensus?.reliable === true && (!consensus.cex.reliable || !consensus.dex.reliable)) alerts.push({ message: `REP market consensus for ${asset} is operating with the configured single-group fallback`, severity: 'warning' })
	}
	const recentReorgResets = state.activities.filter(activity => activity.message === 'DEX market evidence reset after canonical head replacement' && Date.now() - Date.parse(activity.at) <= 60 * 60 * 1_000).length
	if (recentReorgResets >= 2) alerts.push({ message: `${recentReorgResets.toString()} canonical market-evidence resets occurred during the last hour`, severity: 'warning' })
	const universeMap = new Map<
		string,
		{
			approved: boolean
			forkedPoolCount: number
			forkQuestionId: bigint
			forkTime: bigint
			id: bigint
			migratableVaultCount: number
			operationalPoolCount: number
			outcomeIndex: bigint | undefined
			parentId: bigint | undefined
			poolCount: number
			repToken: Address
			selectedPoolCount: number
		}
	>()
	for (const universe of state.universes) {
		universeMap.set(universe.id.toString(), {
			approved: universe.approved,
			forkedPoolCount: 0,
			forkQuestionId: universe.forkQuestionId,
			forkTime: universe.forkTime,
			id: universe.id,
			migratableVaultCount: 0,
			operationalPoolCount: 0,
			outcomeIndex: universe.outcomeIndex,
			parentId: universe.parentId,
			poolCount: 0,
			repToken: universe.repToken,
			selectedPoolCount: 0,
		})
	}
	for (const pool of state.pools) {
		const key = pool.universeId.toString()
		const existing = universeMap.get(key) ?? {
			approved: pool.approvedUniverse,
			forkedPoolCount: 0,
			forkQuestionId: 0n,
			forkTime: 0n,
			id: pool.universeId,
			migratableVaultCount: 0,
			operationalPoolCount: 0,
			outcomeIndex: pool.forkOutcomeIndex,
			parentId: pool.parentUniverseId,
			poolCount: 0,
			repToken: pool.repToken,
			selectedPoolCount: 0,
		}
		existing.poolCount += 1
		if (pool.selected) existing.selectedPoolCount += 1
		if (pool.systemState === 0n) existing.operationalPoolCount += 1
		if (pool.systemState === 1n) existing.forkedPoolCount += 1
		universeMap.set(key, existing)
	}
	for (const universe of universeMap.values()) {
		const scannedTimestamp = state.lastScannedTimestamp
		if (!universe.approved || universe.parentId === undefined || universe.outcomeIndex === undefined || scannedTimestamp === undefined) continue
		universe.migratableVaultCount = state.pools.filter(parent => parent.universeId === universe.parentId && isVaultMigrationSourceEligible(parent, scannedTimestamp)).length
	}
	return {
		activities: state.activities,
		alerts,
		centralizedMarket: serializeCentralizedMarketEstimate(state.centralizedMarket),
		marketConsensus: serializeMarketConsensusEstimate(state.marketConsensus, formatDecimalAmount),
		error: state.error,
		execute,
		lastScanAt: state.lastScanAt,
		lastScannedBlock: state.lastScannedBlock?.toString(),
		metrics: {
			approvedUniverseCount: [...universeMap.values()].filter(universe => universe.approved).length,
			assumedOpenInterestEth: formatDecimalAmount(assumedOpenInterestAttoEth),
			candidateCount: state.pools.reduce((total, pool) => total + pool.candidates.length, 0),
			deployedRep: formatDecimalAmount(deployedRep),
			eligiblePoolCount: state.pools.filter(pool => pool.selected && pool.approvedUniverse && pool.systemState === 0n).length,
			poolCount: state.pools.length,
			selectedPoolCount: state.pools.filter(pool => pool.selected).length,
			walletEth: formatDecimalAmount(state.walletAttoEth),
			walletRep: formatDecimalAmount(walletRep),
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
		pools: state.pools.map(pool => {
			const centralizedMarkets = marketConfigurationFor(pool.repToken)
			const centralizedMarket = state.centralizedMarketsByAsset.get(pool.repToken.toLowerCase()) ?? (centralizedMarkets === configurations[0] ? state.centralizedMarket : undefined)
			const marketConsensus = state.marketConsensusByAsset.get(pool.repToken.toLowerCase()) ?? (centralizedMarkets === configurations[0] ? state.marketConsensus : undefined)
			return {
				knownVaultCount: pool.knownVaultCount.toString(),
				address: pool.address,
				approvedUniverse: pool.approvedUniverse,
				botVault: vaultView(pool.botVault, pool.multiplierBps, pool.lastPrice),
				candidates: pool.candidates.map(candidateView),
				settlementCollateralEth: formatDecimalAmount(pool.settlementCollateralAttoEth),
				centralizedPriceAllowed:
					centralizedMarkets === undefined
						? configurations.length === 0
						: !centralizedMarketConfigurationAllowsExecution(centralizedMarkets)
							? false
							: centralizedMarkets.venueConsensus === undefined
								? centralizedMarkets.requiredForExecution
									? false
									: centralizedPriceAllowsExecution(pool.lastPrice, centralizedMarket, centralizedMarkets, pool.repToken)
								: marketConsensusAllowsExecution(
										pool.lastPrice,
										marketConsensus,
										{
											maximumDeviationBps: centralizedMarkets.maximumDexDeviationBps,
											maximumObservationAgeMilliseconds: centralizedMarkets.maximumObservationAgeMilliseconds,
											requiredForExecution: centralizedMarkets.requiredForExecution,
										},
										pool.repToken,
										centralizedMarkets.assetChainId,
									),
				currentRetentionRate: pool.currentRetentionRate.toString(),
				forkActivationTime: pool.forkActivationTime.toString(),
				forkOutcomeIndex: pool.forkOutcomeIndex?.toString(),
				initialReportPriorityFeeAttoEthPerGas: pool.initialReportPriorityFeeAttoEthPerGas.toString(),
				isPriceValid: pool.isPriceValid,
				lastPrice: formatDecimalAmount(pool.lastPrice),
				centralizedPriceDeviationBps:
					centralizedMarkets?.venueConsensus === undefined
						? centralizedMarket === undefined || centralizedMarkets === undefined
							? undefined
							: centralizedPriceDeviationBps(pool.lastPrice, centralizedMarket, pool.repToken)?.toString()
						: marketConsensusDeviationBps(pool.lastPrice, marketConsensus, pool.repToken)?.toString(),
				lastSettlementTimestamp: pool.lastSettlementTimestamp.toString(),
				manager: pool.manager,
				minLiquidationPriceDistanceBps: pool.minLiquidationPriceDistanceBps.toString(),
				minimumToken1ReportEth: formatDecimalAmount(pool.minimumToken1ReportAttoEth),
				multiplierBps: pool.multiplierBps.toString(),
				parent: pool.parent,
				parentUniverseId: pool.parentUniverseId?.toString(),
				pendingReportId: pool.pendingReportId.toString(),
				pendingReportSponsor: pool.pendingReportSponsor,
				questionId: pool.questionId.toString(),
				repToken: pool.repToken,
				requestPriceCostEth: formatDecimalAmount(pool.requestPriceCostAttoEth),
				selected: pool.selected,
				securityPoolForker: pool.securityPoolForker,
				systemState: pool.systemState.toString(),
				totalCapacityOwnershipRep: formatDecimalAmount(pool.totalCapacityOwnershipAttoRep),
				totalPoolHeldRep: formatDecimalAmount(pool.totalAttoRep),
				truncatedVaults: pool.truncatedVaults,
				universeId: pool.universeId.toString(),
				vaults: pool.vaults.map(vault => vaultView(vault)),
			}
		}),
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
			.sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
			.map(universe => ({
				approved: universe.approved,
				forkedPoolCount: universe.forkedPoolCount,
				forkQuestionId: universe.forkQuestionId.toString(),
				forkTime: universe.forkTime.toString(),
				id: universe.id.toString(),
				migratableVaultCount: universe.migratableVaultCount,
				operationalPoolCount: universe.operationalPoolCount,
				outcomeIndex: universe.outcomeIndex?.toString(),
				parentId: universe.parentId?.toString(),
				poolCount: universe.poolCount,
				repToken: universe.repToken,
				selectedPoolCount: universe.selectedPoolCount,
			})),
		wallet: state.wallet,
		walletRep: Object.fromEntries([...state.walletRepByToken.entries()].map(([token, amount]) => [token, formatDecimalAmount(amount)])),
	}
}

export async function loadDurableState(path: string): Promise<DurableState> {
	const contents = await readFile(path, 'utf8').catch(error => {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
		throw error
	})
	if (contents === undefined) return { activities: [], lastScannedBlock: undefined, pendingStagedOperations: [], pendingTransactions: [], version: 1 }
	const value: unknown = JSON.parse(contents)
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Liquidator state must be an object')
	const version = Reflect.get(value, 'version')
	const activities = Reflect.get(value, 'activities')
	const lastScannedBlock = Reflect.get(value, 'lastScannedBlock')
	const pendingStagedOperations = Reflect.get(value, 'pendingStagedOperations')
	const pendingTransactions = Reflect.get(value, 'pendingTransactions')
	if (version !== 1 || !Array.isArray(activities)) throw new Error('Liquidator state version is unsupported')
	if (!Array.isArray(pendingStagedOperations)) throw new Error('pendingStagedOperations must be an array')
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
		lastScannedBlock: typeof lastScannedBlock === 'string' ? lastScannedBlock : undefined,
		pendingStagedOperations: pendingStagedOperations.map((operation: unknown) => {
			if (typeof operation !== 'object' || operation === null || Array.isArray(operation)) throw new Error('Pending staged operation must be an object')
			const operationId = Reflect.get(operation, 'operationId')
			const queuedBlock = Reflect.get(operation, 'queuedBlock')
			if (typeof operationId !== 'string' || typeof queuedBlock !== 'string') throw new Error('Pending staged operation has invalid numeric metadata')
			return {
				coordinator: getAddress(String(Reflect.get(operation, 'coordinator'))),
				operationId: BigInt(operationId),
				queuedBlock: BigInt(queuedBlock),
				target: getAddress(String(Reflect.get(operation, 'target'))),
			}
		}),
		pendingTransactions: (await Promise.all(
			pendingTransactions.map(async (intent: unknown) => {
				if (typeof intent !== 'object' || intent === null || Array.isArray(intent)) throw new Error('Pending transaction intent must be an object')
				const hash = Reflect.get(intent, 'hash')
				const kind = Reflect.get(intent, 'kind')
				const label = Reflect.get(intent, 'label')
				const maxBlockNumber = Reflect.get(intent, 'maxBlockNumber')
				const mode = Reflect.get(intent, 'mode')
				const nonce = Reflect.get(intent, 'nonce')
				const rawExpectation = Reflect.get(intent, 'receiptExpectation')
				const rawRequiresMarketEvidence = Reflect.get(intent, 'requiresMarketEvidence')
				const sender = Reflect.get(intent, 'sender')
				const serializedTransaction = Reflect.get(intent, 'serializedTransaction')
				const submissionBlock = Reflect.get(intent, 'submissionBlock')
				if (typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash) || typeof serializedTransaction !== 'string' || !/^0x(?:[0-9a-fA-F]{2})+$/.test(serializedTransaction)) throw new Error('Pending transaction intent has invalid transaction hex')
				if (keccak256(serializedTransaction as Hex).toLowerCase() !== hash.toLowerCase()) throw new Error('Pending transaction intent hash does not match its serialized transaction')
				if (typeof label !== 'string' || (kind !== 'deployment' && kind !== 'deposit' && kind !== 'fees' && kind !== 'liquidation' && kind !== 'migration' && kind !== 'withdrawal')) throw new Error('Pending transaction intent has invalid metadata')
				if (mode !== 'private' && mode !== 'public') throw new Error('Pending transaction intent has invalid mode')
				if (typeof nonce !== 'string' || typeof maxBlockNumber !== 'string' || typeof submissionBlock !== 'string') throw new Error('Pending transaction intent has invalid numeric metadata')
				if (typeof sender !== 'string') throw new Error('Pending transaction intent is missing sender')
				const parsedNonce = BigInt(nonce)
				const parsedTransaction = parseTransaction(serializedTransaction as Hex)
				if (parsedTransaction.nonce !== parsedNonce) throw new Error('Pending transaction intent nonce does not match its serialized transaction')
				const normalizedSender = getAddress(sender)
				const recoveredSender = await recoverTransactionAddress({ serializedTransaction: serializedTransaction as Hex })
				if (recoveredSender.toLowerCase() !== normalizedSender.toLowerCase()) throw new Error('Pending transaction intent sender does not match its serialized transaction')
				if (typeof rawExpectation !== 'object' || rawExpectation === null || Array.isArray(rawExpectation)) throw new Error('Pending transaction intent is missing receipt expectation')
				const expectationType = Reflect.get(rawExpectation, 'type')
				const receiptExpectation =
					expectationType === 'transaction'
						? ({ type: 'transaction' } as const)
						: expectationType === 'staged-success'
							? {
									coordinator: getAddress(String(Reflect.get(rawExpectation, 'coordinator'))),
									operation:
										Reflect.get(rawExpectation, 'operation') === 0
											? (0 as const)
											: Reflect.get(rawExpectation, 'operation') === 1
												? (1 as const)
												: (() => {
														throw new Error('Pending transaction intent has invalid staged operation')
													})(),
									type: 'staged-success' as const,
								}
							: expectationType === 'pending-liquidation'
								? {
										amount: BigInt(String(Reflect.get(rawExpectation, 'amount'))),
										coordinator: getAddress(String(Reflect.get(rawExpectation, 'coordinator'))),
										operator: getAddress(String(Reflect.get(rawExpectation, 'operator'))),
										receiver: getAddress(String(Reflect.get(rawExpectation, 'receiver'))),
										target: getAddress(String(Reflect.get(rawExpectation, 'target'))),
										type: 'pending-liquidation' as const,
									}
								: (() => {
										throw new Error('Pending transaction intent has invalid receipt expectation')
									})()
				const requiresMarketEvidence = typeof rawRequiresMarketEvidence === 'boolean' ? rawRequiresMarketEvidence : kind === 'deposit' || kind === 'liquidation' || kind === 'withdrawal'
				return { hash: hash as Hex, kind, label, maxBlockNumber: BigInt(maxBlockNumber), mode, nonce: parsedNonce, receiptExpectation, requiresMarketEvidence, sender: normalizedSender, serializedTransaction: serializedTransaction as Hex, submissionBlock: BigInt(submissionBlock) }
			}),
		)) as PendingTransactionIntent[],
		version: 1,
	}
}

export async function saveDurableState(path: string, state: RuntimeState) {
	await mkdir(dirname(path), { mode: 0o700, recursive: true })
	const temporaryPath = `${path}.${randomBytes(8).toString('hex')}.tmp`
	const handle = await open(temporaryPath, 'wx', 0o600)
	try {
		await handle.writeFile(
			`${JSON.stringify({
				activities: state.activities,
				lastScannedBlock: state.lastScannedBlock?.toString(),
				pendingStagedOperations: state.pendingStagedOperations.map(operation => ({
					...operation,
					operationId: operation.operationId.toString(),
					queuedBlock: operation.queuedBlock.toString(),
				})),
				pendingTransactions: state.pendingTransactions.map(intent => ({
					...intent,
					maxBlockNumber: intent.maxBlockNumber.toString(),
					nonce: intent.nonce.toString(),
					receiptExpectation: intent.receiptExpectation.type === 'pending-liquidation' ? { ...intent.receiptExpectation, amount: intent.receiptExpectation.amount.toString() } : intent.receiptExpectation,
					submissionBlock: intent.submissionBlock.toString(),
				})),
				version: 1,
			})}\n`,
			{ encoding: 'utf8' },
		)
		await handle.sync()
		await handle.close()
		await rename(temporaryPath, path)
		const directoryHandle = await open(dirname(path), 'r')
		try {
			await directoryHandle.sync()
		} finally {
			await directoryHandle.close()
		}
	} catch (error) {
		await handle.close().catch(() => undefined)
		await rm(temporaryPath, { force: true })
		throw error
	}
}
