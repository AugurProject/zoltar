import { PortfolioOpportunityExpired } from '#execution/portfolio-executor'
import { sharedQuorumReadTargets } from '@zoltar/bot-shared/monitoring/read-quorum'
import { loadPortfolioObservation, managedPortfolioScopes, requireCompletePortfolioExposure } from '#monitoring/portfolio-monitor'
import { shouldStopAfterSuccessfulCycle } from '#core/cycle-control'
import { validateApprovedUniverseSelection } from '@zoltar/bot-shared/monitoring/universe-policy'
import { OperatorStopping, TransactionAwaitingCanonicalFinality } from '#execution/execution-safety'
import { availableExecutionObservations, liquidationExecutionSnapshotObservation } from '#monitoring/execution-quorum'
import { canonicalBlockHash, chainFor } from '#monitoring/operator-chain'
import { scanPortfolioContext } from '#monitoring/portfolio-context'
import { recordActivity, saveDurableState } from '#state/operator-state'
import { recordSystemDeploymentCheck } from '../core/deployment-observation.ts'
import { createLiquidatorScanReport, cycleFailureMessage, runningStatus } from '../monitoring/scan-status.ts'
import { createPublicClient } from '@zoltar/bot-shared/ethereum'
import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'
import { clearOrphanedDexEvidenceForHeadReplacement } from '@zoltar/bot-shared/monitoring/market-consensus'
import { operationalFailureDisposition } from '@zoltar/bot-shared/monitoring/resilience'
import { createPrimaryClient, persistSettings, readEndpoints, type LiquidatorDeps, type LiquidatorRuntime } from './liquidator-runtime.ts'
import { collectMarketEvidence } from './market-evidence.ts'
import { runDryRunStep, runLiveExecutionStep } from './scan-execution.ts'

/**
 * Scans the monitored pools. Live execution requires the RPC quorum to agree on one execution snapshot and adopts the
 * client that produced it as the primary client; dry runs scan through the primary read endpoint alone.
 */
async function scanExecutionSnapshot(runtime: LiquidatorRuntime, deps: LiquidatorDeps, currentChain: LiquidatorRuntime['chain']) {
	const { shutdown, state } = deps
	state.portfolioScopes = managedPortfolioScopes(state.portfolioScopes, runtime.settings.selectedPortfolios)
	const scanClient = async (client: typeof runtime.client, blockNumber?: bigint) => {
		const scan = await scanPortfolioContext(client, runtime.settings, state.wallet, shutdown.isRequested, blockNumber)
		const portfolios = []
		for (const scope of state.portfolioScopes) {
			if (shutdown.isRequested()) throw new OperatorStopping()
			portfolios.push(await loadPortfolioObservation(client, runtime.settings, state.wallet, scope, scan.block.number))
		}
		requireCompletePortfolioExposure(portfolios)
		return { ...scan, portfolios }
	}
	if (!runtime.settings.runtime.execute) return await scanClient(runtime.client)
	const pinned = await sharedQuorumReadTargets(
		readEndpoints(runtime.settings).map(endpoint => ({ endpoint, client: createPublicClient({ chain: currentChain, transport: runtime.readPool.transportFor(endpoint) }) })),
		runtime.settings.connectivity.rpcQuorum,
	)
	const settled = await Promise.allSettled(pinned.readers.map(async ({ client, endpoint }) => ({ client, endpoint, scan: await scanClient(client, pinned.blockNumber) })))
	const available = availableExecutionObservations('liquidation execution snapshot', settled, liquidationExecutionSnapshotObservation, runtime.settings.connectivity.rpcQuorum)
	const selected = available[0]
	if (selected === undefined) throw new Error('Liquidation execution snapshot is unavailable')
	runtime.client = selected.client
	return selected.scan
}

/** The scan cycle body; resolves to the poll loop's stop decision, or `'deferred'` while the system is undeployed. */
async function scanAndAct(runtime: LiquidatorRuntime, deps: LiquidatorDeps, scanReport: ReturnType<typeof createLiquidatorScanReport>, markScanCompleted: () => void): Promise<boolean | 'deferred'> {
	const { shutdown, state } = deps
	const currentChain = chainFor(runtime.settings)
	runtime.chain = currentChain
	runtime.client = createPrimaryClient(runtime)
	const deploymentStatus = await deps.checkSystemDeployment(runtime.client, runtime.settings.network.chainId, runtime.settings.deployment)
	runtime.missingDeploymentAddress = recordSystemDeploymentCheck(state, deploymentStatus, runtime.missingDeploymentAddress)
	if (!deploymentStatus.deployed) {
		scanReport.update({ status: 'waiting' })
		return 'deferred'
	}
	const primary = await scanExecutionSnapshot(runtime, deps, currentChain)
	if (shutdown.isRequested()) return true
	const scannedBlock = primary.block
	scanReport.update({ block: scannedBlock.number })
	const replacedMarketHead = await clearOrphanedDexEvidenceForHeadReplacement({ hash: state.lastScannedBlockHash, number: state.lastScannedBlock }, { hash: scannedBlock.hash, number: scannedBlock.number }, state, previousBlockNumber => canonicalBlockHash(runtime.settings, previousBlockNumber, runtime.readPool))
	state.lastScannedBlock = scannedBlock.number
	state.lastScannedBlockHash = scannedBlock.hash
	state.lastScannedTimestamp = scannedBlock.timestamp
	if (replacedMarketHead) {
		state.portfolioScopes = state.portfolioScopes.map(scope => ({ ...scope, nextPositionId: 1n, sweepEnd: 0n, retirementObservations: [] }))
		recordActivity(state, {
			details: `block=${scannedBlock.number.toString()}`,
			kind: 'scan',
			message: 'DEX market evidence reset after canonical head replacement',
			status: 'info',
		})
		state.lastScanAt = new Date().toISOString()
		await saveDurableState(runtime.settings.runtime.stateFile, state)
		return shouldStopAfterSuccessfulCycle(runtime.settings.runtime.once)
	}
	state.portfolios = primary.portfolios
	state.portfolioScopes = primary.portfolios.map(portfolio => portfolio.nextScope)
	state.universes = primary.universes
	state.walletRepByToken = primary.walletRepByToken
	const rootUniverse = state.universes.find(universe => universe.parentId === undefined)
	if (rootUniverse === undefined) throw new Error('Universe scan did not return the root REP asset')
	if (await collectMarketEvidence(runtime, deps, scannedBlock, rootUniverse.repToken)) return true
	validateApprovedUniverseSelection(state.universes, runtime.settings.approvedUniverses)
	state.lastScanAt = new Date().toISOString()
	if (state.wallet !== undefined) {
		state.walletAttoEth = await runtime.client.getBalance({ address: state.wallet })
	}
	state.status = runningStatus(state.paused, runtime.settings.runtime.execute)
	markScanCompleted()
	if (shutdown.isRequested()) {
		await saveDurableState(runtime.settings.runtime.stateFile, state)
		return true
	}
	if (!state.paused && runtime.settings.runtime.execute) {
		const stop = await runLiveExecutionStep(runtime, deps)
		if (stop !== undefined) return stop
	} else if (!state.paused) {
		runDryRunStep(runtime, deps)
	}
	await saveDurableState(runtime.settings.runtime.stateFile, state)
	return shouldStopAfterSuccessfulCycle(runtime.settings.runtime.once)
}

/** @internal Tests verify interrupted-cycle recovery; `undefined` means the error is a failure. */
export async function settleInterruptedCycle(runtime: Pick<LiquidatorRuntime, 'settings'>, deps: Pick<LiquidatorDeps, 'state'> & { shutdown: Pick<LiquidatorDeps['shutdown'], 'isRequested'> }, error: unknown) {
	const { state } = deps
	if (deps.shutdown.isRequested()) {
		await saveDurableState(runtime.settings.runtime.stateFile, state)
		return true
	}
	if (error instanceof OperatorStopping) {
		await saveDurableState(runtime.settings.runtime.stateFile, state)
		return true
	}
	if (error instanceof PortfolioOpportunityExpired) {
		state.status = runningStatus(state.paused, runtime.settings.runtime.execute)
		recordActivity(state, { kind: 'liquidation', status: 'info', message: 'Portfolio opportunity expired; rescreen next cycle', details: error.message })
		await saveDurableState(runtime.settings.runtime.stateFile, state)
		return shouldStopAfterSuccessfulCycle(runtime.settings.runtime.once)
	}
	if (error instanceof TransactionAwaitingCanonicalFinality) {
		state.status = 'running'
		await saveDurableState(runtime.settings.runtime.stateFile, state)
		return shouldStopAfterSuccessfulCycle(runtime.settings.runtime.once)
	}
	return undefined
}

/** Records a failed cycle, pausing and persisting the pause when a live safety check failed. */
async function recordCycleFailure(runtime: LiquidatorRuntime, deps: LiquidatorDeps, error: unknown) {
	const { state } = deps
	state.error = errorMessage(error)
	const disposition = operationalFailureDisposition(error)
	state.status = disposition === 'connectivity-degraded' ? 'connectivity-degraded' : 'error'
	if (runtime.settings.runtime.execute && disposition === 'safety-paused') {
		state.paused = true
		await persistSettings(runtime, deps, current => ({ ...current, paused: true })).catch(settingsError => {
			state.error = `${state.error}; failed to persist safety pause: ${errorMessage(settingsError)}`
		})
	}
	recordActivity(state, {
		details: state.error,
		kind: 'error',
		message: cycleFailureMessage(disposition, runtime.settings.runtime.execute),
		status: 'failed',
	})
	await saveDurableState(runtime.settings.runtime.stateFile, state).catch(() => undefined)
}

/**
 * One poll of the operator loop. Resolves to `true` to stop the loop, `false` to wait and poll again, or `'deferred'`
 * while the system is undeployed; rejects after recording a failed cycle so the loop retries with backoff.
 */
export async function runPollCycle(runtime: LiquidatorRuntime, deps: LiquidatorDeps): Promise<boolean | 'deferred'> {
	const { shutdown, state } = deps
	if (shutdown.isRequested()) return true
	if (runtime.profileSwitchRequested) return true
	if (deps.configurationMutationGate.isActive()) return false
	if (!runtime.settings.networkConfigured) return false
	const scanReport = createLiquidatorScanReport(runtime.settings.network, () => runtime.client.getBlockNumber(), deps.blockTimeOverrideMs)
	let scanCompleted = false
	state.scanning = true
	state.error = undefined
	try {
		return await scanAndAct(runtime, deps, scanReport, () => {
			scanCompleted = true
		})
	} catch (error) {
		const settled = await settleInterruptedCycle(runtime, deps, error)
		if (settled !== undefined) return settled
		scanReport.update({ status: 'failed' })
		scanCompleted = false
		await recordCycleFailure(runtime, deps, error)
		throw error
	} finally {
		if (scanCompleted) scanReport.update({ status: state.paused ? 'paused' : 'live', details: { pools: state.pools.length, candidates: state.pools.reduce((count, pool) => count + pool.candidates.length, 0), pendingTransactions: state.pendingTransactions.length } })
		await scanReport.finish(shutdown.isRequested() ? 'incomplete' : undefined)
		state.scanning = false
	}
}
