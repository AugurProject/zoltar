#!/usr/bin/env bun

import { ExecutionSignerLockHeldError, signerLockConflictMessage } from '@zoltar/bot-shared/execution/process-lock'
import { saveOperatorSettings } from '#config/settings-store'
import { loadConfiguration } from '#config/configuration'
import { createExecutionLockManager } from '#execution/execution-locks'
import { acquireExecutionSignerLock, acquirePositionJournalLock } from '#state/position-store'
import { privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { createBotShutdownController, runBotMain } from '@zoltar/bot-shared/execution/bot-process-locks'
import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'
import { operationalFailureDisposition, retryDelayMilliseconds } from '@zoltar/bot-shared/monitoring/resilience'
import { runOperator } from '../runtime/operator'

export { createExecutionLockManager, persistSignerSettingsWithProvisionalLock } from '#execution/execution-locks'
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
export { immediateReplacementAmounts, lifecycleExecutionFromLogs, replacementCreditExecutionFromLogs } from '#execution/recovery-support'

async function main() {
	using shutdown = createBotShutdownController()
	for (;;) {
		if (shutdown.isRequested()) return
		const config = await loadConfiguration()
		if (shutdown.isRequested()) return
		const lockManager = createExecutionLockManager(account => acquireExecutionSignerLock(config.network.chain.id, account))
		try {
			if (config.execute || config.ui) await lockManager.hold(acquirePositionJournalLock(config.positionFile))
			if (shutdown.isRequested()) return
			let initialSignerLock
			let startupSignerConflict: string | undefined
			try {
				initialSignerLock = !config.execute || config.privateKey === undefined ? undefined : await lockManager.acquireSigner(privateKeyToAccount(config.privateKey).address)
			} catch (error) {
				if (!config.ui || !(error instanceof ExecutionSignerLockHeldError)) throw error
				startupSignerConflict = signerLockConflictMessage(error)
				config.execute = false
				config.paused = true
				config.operatorSettings = { ...config.operatorSettings, paused: true, runtime: { ...config.operatorSettings.runtime, execute: false } }
				config.settingsRevision = await saveOperatorSettings(config.settingsFile, config.operatorSettings, undefined, config.settingsRevision)
				console.error(startupSignerConflict)
			}
			if (shutdown.isRequested()) return
			let startupFailures = 0
			for (;;) {
				try {
					if (await runOperator(config, lockManager, initialSignerLock, shutdown, startupSignerConflict)) break
					return
				} catch (error) {
					if (config.once || operationalFailureDisposition(error) === 'safety-paused') throw error
					startupFailures += 1
					console.error(`startupConnectivityDegraded=${errorMessage(error)}`)
					await shutdown.wait(retryDelayMilliseconds(config.pollMilliseconds, startupFailures))
					if (shutdown.isRequested()) return
				}
			}
		} finally {
			await lockManager.releaseAll()
		}
	}
}

if (import.meta.main) runBotMain(main)
