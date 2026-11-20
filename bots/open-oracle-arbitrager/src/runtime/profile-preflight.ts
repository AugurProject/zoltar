import { runnableOperatorSettings } from '#config/configuration'
import type { PersistedOperatorSettings } from '#config/settings-store'
import { assertStoredExecutorDeploymentIntent } from '#execution/create2-executor'
import { executorDeploymentIntentPath, loadExecutorDeploymentIntentForChain } from '#execution/executor-deployment-store'
import { loadPriceHistory } from '#monitoring/market-monitor'
import { loadExecutionHistory } from '#state/operator-state'
import { loadSettlementJournal, settlementJournalPath } from '#state/settlement-store'
import { acquireExecutionSignerLock, acquirePositionJournalLock, type ExclusiveProcessLock, loadPositionJournal } from '#state/position-store'
import { privateKeyToAccount } from '@zoltar/bot-shared/ethereum'
import { checkConnectivity, checkSubmissionEndpoints } from '@zoltar/bot-shared/monitoring/connectivity'
import { checkIndependentRpcChains } from './connectivity-update.ts'

/** Proves a target chain profile can run before the operator switches to it: endpoints answer, stores load, and the locks it needs are free. */
export async function preflightOperatorProfile(settingsFile: string, target: PersistedOperatorSettings) {
	const chain = runnableOperatorSettings(settingsFile, target).network.chain
	const deploymentIntent = await loadExecutorDeploymentIntentForChain(executorDeploymentIntentPath(settingsFile, target.network), chain.id)
	if (deploymentIntent !== undefined) await assertStoredExecutorDeploymentIntent(deploymentIntent, chain.id)
	if (target.networkConfigured) {
		await checkConnectivity(target.connectivity, chain.id)
		await checkIndependentRpcChains(target.connectivity.quorumRpcUrls, chain.id)
		await checkSubmissionEndpoints(target.submission, chain.id)
	}
	let journalLock: ExclusiveProcessLock | undefined
	let signerLock: ExclusiveProcessLock | undefined
	await runThenReleaseLocks(
		async () => {
			if (target.runtime.execute || target.runtime.ui) journalLock = await acquirePositionJournalLock(target.runtime.positionFile)
			if (target.runtime.execute) {
				if (target.privateKey === undefined) throw new Error('Execution requires an active signer')
				signerLock = await acquireExecutionSignerLock(chain.id, privateKeyToAccount(target.privateKey).address)
			}
			// Every journal the operator reads at startup, so a switch never persists a profile that cannot restart.
			await Promise.all([loadPositionJournal(target.runtime.positionFile, chain.id), loadSettlementJournal(settlementJournalPath(target.runtime.positionFile), chain.id), loadExecutionHistory(target.runtime.historyFile, chain.id), loadPriceHistory(target.runtime.priceHistoryFile, chain.id)])
		},
		() => [signerLock, journalLock],
	)
}

/**
 * @internal Tests verify that locks are released on every path and that a preflight failure is never lost.
 * Runs the preflight body, then releases whichever locks it acquired, whether or not it failed.
 * A release failure takes precedence and carries the body failure as its cause; otherwise the body failure is rethrown.
 */
export async function runThenReleaseLocks(body: () => Promise<void>, heldLocks: () => readonly (Pick<ExclusiveProcessLock, 'release'> | undefined)[]) {
	let bodyFailure: { readonly error: unknown } | undefined
	try {
		await body()
	} catch (error) {
		bodyFailure = { error }
	}
	const results = await Promise.allSettled(
		heldLocks()
			.filter(lock => lock !== undefined)
			.map(lock => lock.release()),
	)
	const errors = results.filter(result => result.status === 'rejected').map(result => result.reason)
	if (errors.length !== 0) throw new AggregateError(errors, 'Failed to release target chain profile preflight locks', bodyFailure === undefined ? undefined : { cause: bodyFailure.error })
	if (bodyFailure !== undefined) throw bodyFailure.error
}
