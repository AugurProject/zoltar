import { applyStrategy, type Configuration } from '#config/configuration'
import type { Address } from '#ethereum'
import type { ExecutionLockManager } from '#execution/execution-locks'
import { clearWalletDerivedState, type OperatorSnapshotFixedState, type OperatorState } from '#state/operator-state'
import type { ExclusiveProcessLock } from '#state/position-store'
import type { PendingOperatorUpdates } from './operator-control-plane.ts'

export function clearMarketEvidenceForSourceChange(state: { marketConsensus?: unknown; marketObservations?: unknown[] | undefined }) {
	state.marketObservations = []
	state.marketConsensus = undefined
}

export function applyCentralizedMarketSettings<TSettings>(config: { centralizedMarkets: TSettings }, state: { marketConsensus?: unknown; marketObservations?: unknown[] | undefined }, nextSettings: TSettings) {
	config.centralizedMarkets = nextSettings
	clearMarketEvidenceForSourceChange(state)
}

export function applyLookbackBlockSetting(config: { lookbackBlocks: bigint }, nextLookbackBlocks: bigint) {
	const changed = config.lookbackBlocks !== nextLookbackBlocks
	config.lookbackBlocks = nextLookbackBlocks
	return changed
}

export function resetReportScanState<TLog>(
	state: {
		activeReportCount: number
		marketConsensus?: unknown
		marketObservations?: unknown[] | undefined
		opportunities: unknown[]
		reportPaths: unknown[]
		status: OperatorState['status']
		tokenMarkets: unknown[]
	},
	reports: { clear: () => void },
) {
	reports.clear()
	state.activeReportCount = 0
	state.opportunities = []
	state.reportPaths = []
	state.tokenMarkets = []
	state.marketObservations = []
	state.marketConsensus = undefined
	state.status = 'syncing'
	const cachedLogs: TLog[] = []
	return { cachedLogs, cursor: undefined }
}

export function applyQueuedExecutionSettings(config: Configuration, state: OperatorState, pending: PendingOperatorUpdates) {
	let reportScanReset = false
	if (pending.centralizedMarkets !== undefined) {
		applyCentralizedMarketSettings(config, state, pending.centralizedMarkets)
		pending.centralizedMarkets = undefined
	}
	if (pending.lookbackBlocks !== undefined) {
		reportScanReset = applyLookbackBlockSetting(config, pending.lookbackBlocks)
		pending.lookbackBlocks = undefined
	}
	if (pending.maxHedgeSlippageBps !== undefined) {
		config.maxHedgeSlippageBps = pending.maxHedgeSlippageBps
		pending.maxHedgeSlippageBps = undefined
	}
	if (pending.operatorSettings !== undefined) {
		config.operatorSettings = pending.operatorSettings
		pending.operatorSettings = undefined
	}
	if (pending.paused !== undefined) {
		config.paused = pending.paused
		state.paused = pending.paused
		pending.paused = undefined
	}
	if (pending.persistedPrivateKey !== undefined || pending.signerUpdate) {
		config.persistedPrivateKey = pending.persistedPrivateKey
		pending.persistedPrivateKey = undefined
	}
	if (pending.riskLimits !== undefined) {
		config.riskLimits = pending.riskLimits
		pending.riskLimits = undefined
	}
	if (pending.rpcQuorum !== undefined) {
		config.rpcQuorum = pending.rpcQuorum
		process.env['ZOLTAR_BOT_RPC_QUORUM'] = pending.rpcQuorum.toString()
		pending.rpcQuorum = undefined
	}
	if (pending.strategy !== undefined) {
		applyStrategy(config, pending.strategy)
		pending.strategy = undefined
	}
	if (pending.submission !== undefined) {
		config.submission = pending.submission
		pending.submission = undefined
	}
	if (pending.tokenAddresses !== undefined) {
		config.tokenAddresses = pending.tokenAddresses
		state.tokenAddresses = pending.tokenAddresses
		pending.tokenAddresses = undefined
		pending.persistedTokenAddresses = undefined
	}
	return { reportScanReset }
}

export async function applyQueuedSigner<TWallet>(parameters: {
	activeSignerLock: ExclusiveProcessLock | undefined
	config: Configuration
	createWallet: () => TWallet
	fixedState: OperatorSnapshotFixedState
	lockManager: ExecutionLockManager | undefined
	pending: PendingOperatorUpdates
	state: OperatorState
	walletAddress: (wallet: TWallet) => Address | undefined
}) {
	const { config, fixedState, lockManager, pending, state } = parameters
	if (!pending.signerUpdate) return { activeSignerLock: parameters.activeSignerLock, wallet: parameters.createWallet() }
	const nextSignerLock = pending.privateKey === undefined ? undefined : (pending.signerLock ?? parameters.activeSignerLock)
	if (config.execute && pending.privateKey !== undefined && nextSignerLock === undefined) throw new Error('Queued execution signer does not hold an exclusive process lock')
	const previousSignerLock = parameters.activeSignerLock
	pending.signerLock = undefined
	config.privateKey = pending.privateKey
	const wallet = parameters.createWallet()
	fixedState.wallet = parameters.walletAddress(wallet)
	fixedState.queuedWallet = undefined
	clearWalletDerivedState(state)
	pending.signerUpdate = false
	if (previousSignerLock !== undefined && previousSignerLock !== nextSignerLock && lockManager !== undefined) await lockManager.release(previousSignerLock)
	return { activeSignerLock: nextSignerLock, wallet }
}
