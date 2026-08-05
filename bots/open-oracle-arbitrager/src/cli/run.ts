#!/usr/bin/env bun

import { privateKeyToAccount } from '#ethereum'
import { loadConfiguration } from '#config/configuration'
import { createExecutionLockManager } from '#execution/execution-locks'
import { errorMessage } from '#core/rpc-validation'
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
	if (!config.execute) {
		await runOperator(config, undefined, undefined)
		return
	}
	const lockManager = createExecutionLockManager(account => acquireExecutionSignerLock(config.network.chain.id, account))
	try {
		await lockManager.hold(acquirePositionJournalLock(config.positionFile))
		const initialSignerLock = config.privateKey === undefined ? undefined : await lockManager.acquireSigner(privateKeyToAccount(config.privateKey).address)
		await runOperator(config, lockManager, initialSignerLock)
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
