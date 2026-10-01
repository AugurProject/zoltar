import { positionConsumesRisk } from '#core/safety-controls'
import { isExecutionPausedError } from '#execution/execution-orchestration'
import { processPositionLifecycle, reconcileExpiredAttemptsWithQuorum } from '#execution/position-lifecycle'
import { recordOperation, type OperatorState } from '#state/operator-state'
import type { PositionRecord } from '#state/position-store'
import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'
import { operationalFailureDisposition } from '@zoltar/bot-shared/monitoring/resilience'
import { completeSuccessfulPoll } from './poll-completion.ts'
import type { OperatorContext, OperatorRuntime, ScanPass } from './operator-runtime.ts'

/** How a failed position step ends: finish the poll with `result`, or record the failure and continue. */
type PositionFailureOutcome = { finish: true; result: boolean } | { finish: false }

/**
 * A paused execution ends the poll successfully, a shutdown stops it, and a degraded connection propagates;
 * any other failure fails the position closed and lets the scan continue with the next position.
 */
function positionFailureOutcome(context: OperatorContext, scan: ScanPass, error: unknown, position: PositionRecord, failure: { message: string; describe: (reason: string) => string }): PositionFailureOutcome {
	const { config, shutdown, state } = context
	if (isExecutionPausedError(error)) {
		if (shutdown?.isRequested()) return { finish: true, result: true }
		state.lastPollAt = new Date().toISOString()
		return { finish: true, result: completeSuccessfulPoll(state, scan.nextError, config.once) }
	}
	if (shutdown?.isRequested()) return { finish: true, result: true }
	if (operationalFailureDisposition(error) === 'connectivity-degraded') throw error
	const message = failure.describe(errorMessage(error))
	scan.nextError = message
	recordOperation(state, {
		category: 'transaction',
		details: undefined,
		level: 'error',
		message: failure.message,
		reason: message,
		reportId: position.reportId,
	})
	return { finish: false }
}

function lifecycleOperationSummary(result: 'processed' | 'progressed', reportId: string, updatedPosition: PositionRecord | undefined) {
	if (updatedPosition?.status === 'replaced') return { message: 'Replacement credit claimed', reason: `Report ${reportId} credit is final; the one-sided inventory remains risk-consuming until reconciled` }
	if (result === 'processed') return { message: 'Position lifecycle completed', reason: `Report ${reportId} was settled and withdrawn` }
	return { message: 'Position lifecycle advanced', reason: `Report ${reportId} completed one durable public lifecycle transaction` }
}

function recordLifecycleProgress(state: OperatorState, result: 'processed' | 'progressed', position: PositionRecord) {
	const updatedPosition = state.positions.find(candidate => candidate.reportId === position.reportId)
	const summary = lifecycleOperationSummary(result, position.reportId, updatedPosition)
	recordOperation(state, {
		category: 'transaction',
		details: `withdrawn=${updatedPosition?.withdrawnWeth ?? 'unknown'} WETH; ${updatedPosition?.withdrawnToken ?? 'unknown'} ${updatedPosition?.tokenSymbol ?? 'token'}`,
		level: 'info',
		message: summary.message,
		reason: summary.reason,
		reportId: position.reportId,
	})
}

/**
 * Reconciles expired transaction attempts and advances every risk-consuming position before new reports are
 * considered. Returns the poll result when this phase ends the poll, or `undefined` when the scan continues.
 */
export async function maintainPositions(runtime: OperatorRuntime, context: OperatorContext, scan: ScanPass, blockNumber: bigint): Promise<boolean | undefined> {
	const { config, shutdown, state } = context
	const wallet = runtime.wallet
	if (!config.execute || wallet === undefined) return undefined
	let lifecycleProcessed = false
	for (const position of runtime.positions.filter(candidate => candidate.status !== 'recovery-required' && candidate.manualReconciliation === undefined && (candidate.expiredTransactionAttempts?.length ?? 0) !== 0)) {
		try {
			const reconciled = await reconcileExpiredAttemptsWithQuorum(runtime.readClients, config, position, blockNumber)
			if (reconciled !== position) {
				await context.persistPosition(reconciled)
				recordOperation(state, {
					category: 'transaction',
					details: `entryGas=${reconciled.actualEntryGasCostEth} ETH lifecycleGas=${reconciled.lifecycleGasCostEth} ETH`,
					level: 'info',
					message: 'Late atomic revert gas reconciled',
					reason: (reconciled.expiredTransactionAttempts?.length ?? 0) === 0 ? `Report ${position.reportId} expired transaction monitoring completed` : `Report ${position.reportId} expired transaction monitoring remains active`,
					reportId: position.reportId,
				})
			}
		} catch (error) {
			const outcome = positionFailureOutcome(context, scan, error, position, { message: 'Expired transaction monitoring failed closed', describe: reason => `Position ${position.reportId} expired transaction requires attention: ${reason}` })
			if (outcome.finish) return outcome.result
		}
	}
	for (const position of runtime.positions.filter(candidate => candidate.status !== 'replaced' && positionConsumesRisk(candidate.status))) {
		try {
			if (shutdown?.isRequested()) break
			const result = await processPositionLifecycle(runtime.client, runtime.readClients, wallet, config, position, blockNumber, context.persistPosition, context.trackTransaction, () => state.paused || shutdown?.isRequested() === true)
			if (result === 'processed' || result === 'progressed') {
				lifecycleProcessed = true
				recordLifecycleProgress(state, result, position)
			}
		} catch (error) {
			const outcome = positionFailureOutcome(context, scan, error, position, { message: 'Position lifecycle failed closed', describe: reason => `Position ${position.reportId} lifecycle requires attention: ${reason}` })
			if (outcome.finish) return outcome.result
		}
	}
	if (!lifecycleProcessed) return undefined
	state.lastPollAt = new Date().toISOString()
	return completeSuccessfulPoll(state, scan.nextError, config.once)
}
