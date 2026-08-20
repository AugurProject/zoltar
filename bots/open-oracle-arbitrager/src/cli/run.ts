#!/usr/bin/env bun

import { privateKeyToAccount } from '#ethereum'
import { loadConfiguration } from '#config/configuration'
import { createExecutionLockManager } from '#execution/execution-locks'
import { errorMessage } from '#core/rpc-validation'
import { operationalFailureDisposition, retryDelayMilliseconds } from '#monitoring/resilience'
import { acquireExecutionSignerLock, acquirePositionJournalLock } from '#state/position-store'
import { runOperator } from '../runtime/operator'

export { immediateReplacementAmounts, lifecycleExecutionFromLogs, replacementCreditExecutionFromLogs } from '#execution/recovery-support'
export {
	discoverPublicReplacementWithQuorum,
	executionRecordForConfirmedPosition,
	expireEntryWithQuorum,
	finalizeLifecycleAfterFinalityWithQuorum,
	processPositionLifecycle,
	reconcileExpiredAttemptsWithQuorum,
	recoverPendingEntryWithQuorum,
	recoverPendingLifecycleWithQuorum,
} from '#execution/position-lifecycle'
export { createExecutionLockManager, persistSignerSettingsWithProvisionalLock } from '#execution/execution-locks'

async function main() {
	const config = await loadConfiguration()
	const lockManager = createExecutionLockManager(account => acquireExecutionSignerLock(config.network.chain.id, account))
	try {
		if (config.execute || config.ui) await lockManager.hold(acquirePositionJournalLock(config.positionFile))
		const initialSignerLock = !config.execute || config.privateKey === undefined ? undefined : await lockManager.acquireSigner(privateKeyToAccount(config.privateKey).address)
		let startupFailures = 0
		for (;;) {
			try {
				await runOperator(config, lockManager, initialSignerLock)
				return
			} catch (error) {
				if (config.once || operationalFailureDisposition(error) === 'safety-paused') throw error
				startupFailures += 1
				console.error(`startupConnectivityDegraded=${errorMessage(error)}`)
				await Bun.sleep(retryDelayMilliseconds(config.pollMilliseconds, startupFailures))
			}
		}
	} finally {
		await lockManager.releaseAll()
	}
}

if (import.meta.main) {
	main().catch(error => {
		console.error(errorMessage(error))
		process.exitCode = 1
	})
}
