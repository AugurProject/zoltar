#!/usr/bin/env bun
import type { OperatorSettings } from '#config/settings'
import { assertSettingsProfileIsolation, loadSettings } from '#config/settings-store'
import { validateReconciliationIntentChain } from '#core/transaction-reconciliation'
import { assertIntentSender, loadDurableState, recordActivity } from '#state/operator-state'
import { privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { acquireBotProcessLocks, botDashboardLifecycle, createBotShutdownController, runBotMain, withBotProcessLocks, type BotProcessLockOptions, type BotProcessLocks, type BotShutdownController } from '@zoltar/bot-shared/execution/bot-process-locks'
import { errorMessage } from '@zoltar/bot-shared/infrastructure/error-message'
import { logEvent } from '@zoltar/bot-shared/infrastructure/log-event'
import { checkConnectivity, checkSubmissionEndpoints, endpointLabel, readRpcChainId } from '@zoltar/bot-shared/monitoring/connectivity'
import { pollUntilStopped, retryDelayMilliseconds } from '@zoltar/bot-shared/monitoring/resilience'
import { startLiquidatorDashboard } from '../runtime/dashboard-controller.ts'
import { createLiquidatorRuntime, waitForProfileSwitchOrDelay, type LoadedSettings } from '../runtime/liquidator-runtime.ts'
import { runPollCycle } from '../runtime/scan-cycle.ts'
import { checkStartupConnectivity } from '../runtime/startup-connectivity.ts'

/** The liquidator only reserves a signer while live execution is enabled; dry-run processes never hold signer locks. */
const LIQUIDATOR_PROCESS_LOCK_OPTIONS: BotProcessLockOptions = { label: 'liquidator', signerLocksInDryRun: false }

async function preflightNetworkProfile(target: OperatorSettings) {
	if (target.networkConfigured) {
		await checkConnectivity(target.connectivity, target.network.chainId)
		for (const rpcUrl of target.connectivity.quorumRpcUrls) {
			const chainId = await readRpcChainId(rpcUrl)
			if (chainId !== target.network.chainId) throw new Error(`${endpointLabel(rpcUrl)} returned chain ${chainId.toString()}`)
		}
		await checkSubmissionEndpoints(target.submission, target.network.chainId)
	}
	const locks = await acquireBotProcessLocks({ chainId: target.network.chainId, execute: target.runtime.execute, privateKey: target.privateKey, stateFile: target.runtime.stateFile }, LIQUIDATOR_PROCESS_LOCK_OPTIONS)
	try {
		const durable = await loadDurableState(target.runtime.stateFile, target.network.chainId)
		const configuredSigner = target.privateKey === undefined ? undefined : privateKeyToAccount(target.privateKey).address
		for (const intent of durable.pendingTransactions) {
			validateReconciliationIntentChain(intent.serializedTransaction, target.network.chainId)
			if (configuredSigner !== undefined) assertIntentSender(intent.sender, configuredSigner)
		}
	} finally {
		await locks.release()
	}
}

async function runOperator(loaded: LoadedSettings, processLocks: BotProcessLocks, shutdown: BotShutdownController) {
	const { deps, runtime } = await createLiquidatorRuntime(loaded, { preflightNetworkProfile, processLocks, shutdown })
	const dashboard = startLiquidatorDashboard(runtime, deps)
	await using _dashboardLifecycle = dashboard === undefined ? undefined : botDashboardLifecycle(dashboard)
	if (dashboard !== undefined) {
		logEvent('liquidator', 'dashboardStarted', { url: dashboard.url.href })
	}
	await checkStartupConnectivity(runtime, deps, dashboard)
	recordActivity(deps.state, {
		details: `chain=${runtime.settings.network.chainId.toString()} factory=${runtime.settings.deployment.securityPoolFactory}`,
		kind: 'scan',
		message: 'Liquidator started',
		status: 'info',
	})
	await pollUntilStopped(
		() => runPollCycle(runtime, deps),
		consecutiveFailures => waitForProfileSwitchOrDelay(runtime, deps, retryDelayMilliseconds(runtime.settings.runtime.pollMilliseconds, consecutiveFailures)),
		runtime.settings.runtime.once,
		error => logEvent('liquidator', 'cycleFailed', { error: errorMessage(error) }, 'error'),
	)
	return runtime.profileSwitchRequested
}

async function main() {
	if (process.argv.length > 2) throw new Error('The liquidator accepts no command-line arguments; use its operator file or dashboard')
	using shutdown = createBotShutdownController()
	for (;;) {
		const loaded = await loadSettings()
		await assertSettingsProfileIsolation(loaded.path, loaded.settings)
		const switchedProfile = await withBotProcessLocks(
			{
				chainId: loaded.settings.network.chainId,
				execute: loaded.settings.runtime.execute,
				privateKey: loaded.settings.privateKey,
				stateFile: loaded.settings.runtime.stateFile,
			},
			LIQUIDATOR_PROCESS_LOCK_OPTIONS,
			shutdown,
			locks => runOperator(loaded, locks, shutdown),
		)
		if (switchedProfile !== true) return
	}
}

if (import.meta.main) runBotMain(main)
