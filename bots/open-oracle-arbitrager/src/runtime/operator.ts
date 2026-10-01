import type { Configuration } from '#config/configuration'
import type { ExecutionLockManager } from '#execution/execution-locks'
import { recordMarketDiscoveryFailure, recordObservedHead } from '#monitoring/market-discovery-status'
import type { ExclusiveProcessLock } from '#state/position-store'
import type { BotShutdownController } from '@zoltar/bot-shared/execution/bot-process-locks'
import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'
import { logEvent } from '@zoltar/bot-shared/infrastructure/log-event'
import { advanceCursorAfterSuccessfulHead } from '@zoltar/bot-shared/monitoring/block-sync'
import { pollUntilStopped, type PollResult } from '@zoltar/bot-shared/monitoring/resilience'
import { scanBlockTimeMs, startScanReport } from '@zoltar/core-shared/monitoring/scanStatus'
import { evaluatePinnedHead, type CompletedHead, type PinnedHeadScan } from './head-evaluation.ts'
import { flushHistoryOutboxes, type OperatorContext, type OperatorRuntime, type ScanPass } from './operator-runtime.ts'
import { startOperator } from './operator-startup.ts'
import { completeSuccessfulPoll, completeUnconfiguredPoll } from './poll-completion.ts'
import { maintainPositions } from './position-maintenance.ts'
import { discoverReports } from './report-discovery.ts'
import { applyScanBoundaryUpdates } from './scan-boundary-updates.ts'
import { finalizeScan, type ScanReport } from './scan-finalization.ts'
import { resetAfterFinalityAnchorReorg, selectScanHead, validateStartupOrRefreshDeployments } from './scan-head.ts'
import { waitBeforeNextScan } from './scan-wait.ts'
import { acquireScanSignerOperation } from './signer-operations.ts'

/** Confirmed disputes whose history write failed on an earlier scan are retried before any new work. */
async function retryHistoryOutboxes(runtime: OperatorRuntime, context: OperatorContext, scan: ScanPass) {
	if (!runtime.positions.some(position => position.historyOutbox !== undefined)) return
	try {
		await flushHistoryOutboxes(runtime, context)
	} catch (error) {
		const message = `Confirmed dispute history is not durable: ${errorMessage(error)}`
		scan.nextError = message
		logEvent('arbitrager', 'historyPersistenceFailed', { error: message }, 'error')
	}
}

/** Scans one pinned head of a configured network, from startup validation through the completed head. */
async function scanConfiguredNetwork(runtime: OperatorRuntime, context: OperatorContext, scanReport: ScanReport, executionActivationPending: boolean): Promise<PollResult> {
	const { config, shutdown, state } = context
	await validateStartupOrRefreshDeployments(runtime, context, executionActivationPending)
	const scan: ScanPass = { nextError: undefined }
	await retryHistoryOutboxes(runtime, context, scan)
	const block = await selectScanHead(runtime, context)
	scanReport.update({ block: block.number })
	recordObservedHead(state, block)
	context.scanWakeGate.headScanned({ hash: block.hash, number: block.number })
	if (await resetAfterFinalityAnchorReorg(runtime, context, block.number)) return 'deferred'
	const positionResult = await maintainPositions(runtime, context, scan, block.number)
	if (positionResult !== undefined) return positionResult
	const discovery = await discoverReports(runtime, context, scan, block)
	if (discovery.kind === 'head-unchanged') {
		scanReport.update({ status: 'waiting' })
		state.blockNumber = block.number.toString()
		state.blockTimestamp = block.timestamp.toString()
		return completeSuccessfulPoll(state, scan.nextError, config.once)
	}
	const head: PinnedHeadScan = { block, discoversReportsFromCoordinators: discovery.discoversReportsFromCoordinators, executionReady: discovery.executionReady, scan, shutdownDuringHead: false }
	let completed: CompletedHead | undefined
	await context.centralizedMarketSampler.ready // background sampling, but the first scan still waits for the first sample
	if (shutdown?.isRequested()) return true
	const completedCursor = await advanceCursorAfterSuccessfulHead(block.number, block.hash, async () => {
		completed = await evaluatePinnedHead(runtime, context, head)
	})
	if (head.shutdownDuringHead || shutdown?.isRequested()) return true
	if (completed === undefined) throw new Error('Successful scan did not produce a finality anchor')
	return finalizeScan(runtime, context, scan, scanReport, block.number, completedCursor, completed)
}

async function pollOnce(runtime: OperatorRuntime, context: OperatorContext, consecutiveFailures: number): Promise<PollResult> {
	const { config, pending, shutdown, state } = context
	if (pending.profileSwitch || shutdown?.isRequested()) return true
	state.consecutivePollFailures = consecutiveFailures
	context.scanWakeGate.beginPoll()
	const scanIntentLock = await acquireScanSignerOperation(context.signerOperationGate, context.deploymentRecovery, context.executorIntentPath, context.deploymentRecoveryReconciliation)
	if (scanIntentLock === undefined) return 'deferred'
	state.nextRetryAt = undefined
	state.retryInProgress = consecutiveFailures > 0
	let scanReport: ScanReport | undefined
	if (state.retryInProgress) state.lastRetryAt = new Date().toISOString()
	try {
		state.rpcEndpointHealth = runtime.readPool.snapshot()
		const executionActivationPending = await applyScanBoundaryUpdates(runtime, context)
		if (!config.networkConfigured) return completeUnconfiguredPoll(state)
		scanReport = startScanReport({
			network: { chainId: config.network.chain.id, name: config.network.name },
			blockTimeMs: context.scanBlockTimeOverride ?? scanBlockTimeMs(config.network.chain.id),
			readHead: () => runtime.client.getBlockNumber(),
		})
		return await scanConfiguredNetwork(runtime, context, scanReport, executionActivationPending)
	} catch (error) {
		scanReport?.update({ status: 'failed' })
		throw error
	} finally {
		await scanReport?.finish(shutdown?.isRequested() ? 'incomplete' : undefined)
		try {
			context.signerOperationGate.release('scan')
		} finally {
			await scanIntentLock.release()
		}
	}
}

async function stopOperator(runtime: OperatorRuntime, context: OperatorContext) {
	runtime.operatorStopped = true
	await Promise.all([context.headWatcher.stop(), context.centralizedMarketSampler.stop()])
	context.state.status = 'stopped'
	await context.dashboard?.stop(context.pending.profileSwitch)
}

/** Runs the operator until it stops; returns whether it stopped to switch the network profile. */
export async function runOperator(config: Configuration, lockManager: ExecutionLockManager | undefined, initialSignerLock: ExclusiveProcessLock | undefined, shutdown?: BotShutdownController, startupSignerConflict?: string) {
	const { context, runtime } = await startOperator(config, lockManager, initialSignerLock, shutdown, startupSignerConflict)
	try {
		await pollUntilStopped(
			async consecutiveFailures => await pollOnce(runtime, context, consecutiveFailures),
			consecutiveFailures => waitBeforeNextScan(runtime, context, consecutiveFailures),
			config.once,
			error => {
				if (shutdown?.isRequested()) return
				context.state.rpcEndpointHealth = runtime.readPool.snapshot()
				recordMarketDiscoveryFailure(context.state, error)
			},
		)
	} finally {
		await stopOperator(runtime, context)
	}
	return context.pending.profileSwitch
}
