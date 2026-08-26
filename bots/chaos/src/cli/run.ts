#!/usr/bin/env bun

import { assertSettingsProfileIsolation, loadSettings } from '../config/settings.ts'
import { acquireChaosProcessLocksForShutdown, ChaosProcessLockAcquisitionError, createChaosShutdownController, type ChaosProcessLocks } from '../core/process-locks.ts'
import { runChaosOperator } from '../runtime/operator.ts'

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}

export async function main() {
	if (process.argv.length > 2) {
		throw new Error('The chaos bot accepts no command-line arguments; use its owner-only operator file or dashboard')
	}
	using shutdown = createChaosShutdownController()
	const loaded = await loadSettings()
	await assertSettingsProfileIsolation(loaded.path, loaded.settings)
	let locks: ChaosProcessLocks
	try {
		const acquired = await acquireChaosProcessLocksForShutdown(
			{
				chainId: loaded.settings.network.chainId,
				execute: loaded.settings.runtime.execute,
				privateKey: loaded.settings.privateKey,
				stateFile: loaded.settings.runtime.stateFile,
			},
			shutdown,
		)
		if (acquired === undefined) return
		locks = acquired
	} catch (error) {
		if (error instanceof ChaosProcessLockAcquisitionError) {
			await error.releaseProcessLocks()
			throw error.acquisitionCause
		}
		throw error
	}
	try {
		await runChaosOperator(loaded, locks, shutdown)
	} finally {
		await locks.release()
	}
}

if (import.meta.main) {
	main().catch(error => {
		console.error(errorMessage(error))
		process.exitCode = 1
	})
}
