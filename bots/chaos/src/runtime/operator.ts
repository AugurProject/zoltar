import { createWalletClient, privateKeyToAccount, zeroAddress, type Address } from '@zoltar/bot-shared/ethereum'
import { checkPrivateTransactionSubmissionEndpoints, checkRpcEndpoint, EndpointCheckFailure, type EndpointCheck } from '@zoltar/bot-shared/monitoring/connectivity'
import { createSignerOperationGate } from '@zoltar/bot-shared/execution/signer-operation-gate'
import { operationalFailureDisposition, pollUntilStopped, retryDelayMilliseconds } from '@zoltar/bot-shared/monitoring/resilience'
import { saveSettings, type OperatorSettings } from '../config/settings.ts'
import { chaosDashboardLifecycle } from '../core/process-locks.ts'
import type { ChaosProcessLocks, ChaosShutdownController } from '../core/process-locks.ts'
import { randomInteger } from '../core/random.ts'
import { createChaosScheduler } from '../core/scheduler.ts'
import { startDashboardServer } from '../dashboard/dashboard-server.ts'
import { recoverPendingTransactions } from '../execution/recovery.ts'
import { executeOperationPlan, OperationRediscoveryRequired, TransactionAwaitingRecovery, type ExecutionEnvironment } from '../execution/transaction-executor.ts'
import { carryProofDeploymentProfileId } from '../monitoring/carry-proof-scan.ts'
import type { CarryProofJournal } from '../monitoring/carry-proof-journal.ts'
import { ChaosProtocolIndexReorgError } from '../monitoring/protocol-index.ts'
import type { CanonicalImmutableTopologyCache } from '../monitoring/topology-cache.ts'
import { reevaluateOperationContinuation } from '../operations/catalog.ts'
import type { OperationPlan } from '../operations/types.ts'
import { bindRuntimeStateToSigner, loadRuntimeState, recordActivity, resetRuntimeStateForProfile, saveDurableState, type RuntimeState, type RuntimeTopologySummary } from '../state/operator-state.ts'
import { blockExecutableEvaluations, applyExecutionPolicy, chaosChain, createChaosReadPool, performCanonicalScan, planningOptions, unavailableOperationCatalog, type CanonicalScanResult } from './canonical-scan.ts'
import { createChaosDashboardController, restartSafeSettings, type ConfigurationState } from './dashboard-controller.ts'
import { beginLifecycleObligation, completeLifecycleObligation, failLifecycleObligation, obligationForPlan, synchronizeLifecycleObligations } from './obligations.ts'
import { randomOperationPlans, urgentOperationPlans } from './selection.ts'
import { blockInterruptedWorkflows, durableWorkflowPlan, markWorkflowForRediscovery, refreshWorkflowContinuation, workflowFailureHasTransaction, workflowNeedsContinuation, retryableOnChainWorkflowFailure } from './workflows.ts'

type LoadedConfiguration = {
	path: string
	revision: string
	settings: OperatorSettings
}

type RuntimeResources = {
	pool: ReturnType<typeof createChaosReadPool>
	readPreflightChecks: readonly EndpointCheck[]
	submissionPreflightChecks: readonly EndpointCheck[]
}

function errorMessage(error: unknown) {
	return (error instanceof Error ? error.message : String(error)).slice(0, 1_500)
}

export function backfillWaitMilliseconds(lifecyclePollMilliseconds: number, consecutiveBackfillCycles: number) {
	if (!Number.isSafeInteger(lifecyclePollMilliseconds) || lifecyclePollMilliseconds < 1_000 || lifecyclePollMilliseconds > 60_000) {
		throw new Error('Backfill poll interval must be an integer from 1000 through 60000 milliseconds')
	}
	if (!Number.isSafeInteger(consecutiveBackfillCycles) || consecutiveBackfillCycles < 0) {
		throw new Error('Consecutive backfill cycle count must be a non-negative integer')
	}
	const initialCadence = Math.min(lifecyclePollMilliseconds, 5_000)
	const completedWindows = Math.min(Math.floor(consecutiveBackfillCycles / 16), 4)
	return Math.min(lifecyclePollMilliseconds, initialCadence * 2 ** completedWindows)
}

export function runtimeTopologySummary(scan: Pick<CanonicalScanResult, 'anchor' | 'canonicalLifecyclePresenceComplete' | 'carryProofJournalComplete' | 'indexComplete' | 'snapshot' | 'topologyCache'>): RuntimeTopologySummary {
	return {
		anchor: { blockNumber: scan.anchor.blockNumber, timestamp: scan.anchor.timestamp },
		auctions: scan.snapshot.auctions.map(auction => ({
			address: auction.address,
			bidCount: auction.bids.length,
			endTime: auction.endTime,
			finalized: auction.finalized,
			pool: auction.pool,
			startTime: auction.startTime,
		})),
		complete: scan.canonicalLifecyclePresenceComplete && scan.carryProofJournalComplete && scan.indexComplete,
		pairs: scan.snapshot.pairs.map(pair => ({ address: pair.address, feeBps: pair.feeBps, pool: pair.pool, status: pair.status, universeId: pair.universeId })),
		pools: scan.snapshot.pools.map(pool => ({
			address: pool.address,
			awaitingForkContinuation: pool.awaitingForkContinuation,
			coordinator: pool.coordinator,
			questionId: pool.questionId,
			systemState: pool.systemState,
			universeId: pool.universeId,
			vaultCount: registeredVaultCount(scan.topologyCache, pool.address),
		})),
		reports: scan.snapshot.reports.map(report => ({
			currentReporter: report.currentReporter,
			flags: report.flags,
			reportId: report.reportId,
			settlementTime: report.settlementTime,
			token1: report.token1,
			token2: report.token2,
		})),
		universes: scan.snapshot.universes.map(universe => ({
			forkQuestionId: universe.forkQuestionId,
			forkTime: universe.forkTime,
			id: universe.id,
			knownChildOutcomeCount: universe.knownChildOutcomes.length,
			...(universe.parentUniverseId === undefined ? {} : { parentUniverseId: universe.parentUniverseId }),
			repToken: universe.repToken,
		})),
	}
}

function registeredVaultCount(topologyCache: CanonicalImmutableTopologyCache, pool: Address) {
	const registeredVaults = topologyCache.vaultsByPool[pool.toLowerCase()]
	if (registeredVaults === undefined) throw new Error(`Canonical topology cache omitted the vault registry for pool ${pool}`)
	return registeredVaults.length
}

function configuredWallet(settings: OperatorSettings): Address | undefined {
	return settings.privateKey === undefined ? undefined : privateKeyToAccount(settings.privateKey).address
}

function assertDurableSignerScope(state: RuntimeState, wallet: Address | undefined, stateFile: string) {
	if (wallet !== undefined && state.signerAddress !== undefined && wallet.toLowerCase() !== state.signerAddress.toLowerCase()) {
		throw new Error(`Durable state ${stateFile} is scoped to signer ${state.signerAddress}; configure a distinct state file for signer ${wallet}`)
	}
}

function isPristineBootstrapState(state: RuntimeState) {
	const schedulerIsPristine = (state.scheduler.status === 'idle' || state.scheduler.status === 'paused') && state.scheduler.lastDelaySeconds === undefined && state.scheduler.lastRunAt === undefined && state.scheduler.nextRunAt === undefined && state.scheduler.selectedOperationId === undefined
	return state.signerAddress === undefined && state.activities.length === 0 && state.obligationTombstones.length === 0 && state.obligations.length === 0 && state.pendingTransactions.length === 0 && state.protocolIndex === undefined && !state.safetyPaused && schedulerIsPristine && state.workflows.length === 0
}

function resetPristineStateForDeploymentProfile(state: RuntimeState, expectedProfileId: string, paused: boolean, wallet: Address | undefined, stateFile: string) {
	if (state.profileId === expectedProfileId) return false
	if (!isPristineBootstrapState(state)) {
		throw new Error(`Durable state ${stateFile} contains signer, workflow, obligation, recovery, or audit history for deployment profile ${state.profileId}; configure a distinct state file for the new deployment profile ${expectedProfileId}`)
	}
	resetRuntimeStateForProfile(state, expectedProfileId, paused, wallet)
	return true
}

export function executionProfileId(settings: OperatorSettings) {
	return carryProofDeploymentProfileId(settings)
}

function currentStatus(settings: OperatorSettings) {
	if (settings.paused) return 'paused' as const
	return settings.runtime.execute ? ('running' as const) : ('dry-run' as const)
}

async function persistState(configuration: ConfigurationState, state: RuntimeState) {
	await saveDurableState(configuration.settings.runtime.stateFile, state)
}

function schedulerFor(configuration: ConfigurationState, state: RuntimeState) {
	return createChaosScheduler({
		persist: async candidate => {
			await saveDurableState(configuration.settings.runtime.stateFile, {
				...state,
				scheduler: candidate,
			})
		},
		settings: configuration.settings.scheduler,
		state: state.scheduler,
	})
}

export async function scheduleAfterRecoveredTransaction(configuration: ConfigurationState, state: RuntimeState, operationId: string) {
	if (state.scheduler.selectedOperationId !== operationId || (state.scheduler.status !== 'running' && state.scheduler.status !== 'paused')) return false
	const scheduler = schedulerFor(configuration, state)
	await scheduler.complete(operationId)
	if (configuration.settings.paused || state.paused) await scheduler.pause()
	return true
}

function workflowStartedAfterLastScheduledRun(state: RuntimeState) {
	const operationId = state.scheduler.selectedOperationId
	if (operationId === undefined) return false
	const lastRunAt = state.scheduler.lastRunAt === undefined ? undefined : Date.parse(state.scheduler.lastRunAt)
	return state.workflows.some(workflow => {
		if (workflow.classification !== 'selectable' || workflow.operationId !== operationId) return false
		if (workflow.status !== 'abandoned' && workflow.status !== 'completed' && workflow.status !== 'failed') return false
		const startedAt = Date.parse(workflow.startedAt ?? workflow.createdAt)
		return lastRunAt === undefined || startedAt > lastRunAt
	})
}

function interruptedSchedulerRunNeedsClosure(state: RuntimeState) {
	if (state.pendingTransactions.length !== 0 || state.workflows.some(workflowNeedsContinuation)) return false
	if (state.scheduler.status === 'running') return true
	return state.scheduler.status === 'paused' && workflowStartedAfterLastScheduledRun(state)
}

async function preflightRpcSet(rpcUrls: readonly string[], expectedChainId: number, kind: 'public-rpc' | 'read-rpc', requiredHealthy: number) {
	const checks = await Promise.all(rpcUrls.map(rpcUrl => checkRpcEndpoint(rpcUrl, expectedChainId, kind)))
	const failed = checks.filter(check => check.status === 'failed')
	const safetyFailure = failed.find(check => check.failureDisposition !== 'connectivity-degraded')
	const healthyCount = checks.length - failed.length
	if (safetyFailure !== undefined || healthyCount < requiredHealthy) {
		throw new EndpointCheckFailure(failed.map(check => (check.error?.includes(check.target) ? check.error : `${check.target}: ${check.error ?? 'endpoint check failed'}`)).join('; '), checks)
	}
	return checks
}

async function preflightReadNetwork(settings: OperatorSettings) {
	const connectivity = settings.connectivity
	if (connectivity === undefined) throw new Error('Network preflight requires configured connectivity')
	return await preflightRpcSet([connectivity.readRpcUrl, ...connectivity.quorumRpcUrls], settings.network.chainId, 'read-rpc', connectivity.rpcQuorum)
}

async function preflightSubmissionNetwork(settings: OperatorSettings) {
	const connectivity = settings.connectivity
	if (connectivity === undefined) throw new Error('Submission preflight requires configured connectivity')
	if (settings.submission.mode === 'private') {
		return await checkPrivateTransactionSubmissionEndpoints(settings.submission, settings.network.chainId)
	}
	return await preflightRpcSet(connectivity.publicRpcUrls, settings.network.chainId, 'public-rpc', 1)
}

export async function recordEndpointPreflightChecks(run: () => Promise<readonly EndpointCheck[]>, recordChecks: (checks: readonly EndpointCheck[]) => void) {
	try {
		const checks = await run()
		recordChecks(checks)
		return checks
	} catch (error) {
		if (error instanceof EndpointCheckFailure) recordChecks(error.checks)
		throw error
	}
}

async function ensureSubmissionPreflight(resources: RuntimeResources, settings: OperatorSettings) {
	await recordEndpointPreflightChecks(
		async () => await preflightSubmissionNetwork(settings),
		checks => {
			resources.submissionPreflightChecks = checks
		},
	)
}

async function ensureReadPreflight(resources: RuntimeResources, settings: OperatorSettings) {
	await recordEndpointPreflightChecks(
		async () => await preflightReadNetwork(settings),
		checks => {
			resources.readPreflightChecks = checks
		},
	)
}

function resourceHealth(resources: RuntimeResources) {
	return [...resources.readPreflightChecks, ...resources.submissionPreflightChecks, ...resources.pool.snapshot()]
}

function executionEnvironment(settings: OperatorSettings, state: RuntimeState, pool: RuntimeResources['pool'], recoverySender?: Address | undefined, beforeSign?: (() => Promise<void>) | undefined, executionCancelled?: (() => boolean) | undefined): ExecutionEnvironment {
	const account = settings.privateKey === undefined ? undefined : privateKeyToAccount(settings.privateKey)
	const sender = recoverySender ?? account?.address
	if (sender === undefined) throw new Error('Transaction execution requires the configured signer')
	if (account !== undefined && account.address.toLowerCase() !== sender.toLowerCase()) {
		throw new Error('The configured signer does not match the pending transaction recovery signer')
	}
	return {
		...(beforeSign === undefined ? {} : { beforeSign }),
		chain: chaosChain(settings),
		...(executionCancelled === undefined ? {} : { executionCancelled }),
		pool,
		sender,
		settings,
		state,
		...(account === undefined
			? {}
			: {
					wallet: createWalletClient({
						account,
						chain: chaosChain(settings),
						transport: pool.transport,
					}),
				}),
	}
}

function workflowForPlan(state: RuntimeState, plan: Pick<OperationPlan, 'definitionId' | 'id'>) {
	return state.workflows.find(workflow => workflow.planId === plan.id && workflow.operationId === plan.definitionId)
}

function rediscoverableExecutionFailure(state: RuntimeState, plan: OperationPlan, error: unknown) {
	if (!(error instanceof OperationRediscoveryRequired)) return false
	const workflow = workflowForPlan(state, plan)
	if (workflow === undefined || workflowFailureHasTransaction(workflow)) return false
	markWorkflowForRediscovery(workflow, error)
	return true
}

export function abandonRetryableSelectableFailure(state: RuntimeState, plan: Pick<OperationPlan, 'definitionId' | 'ecosystem' | 'id' | 'label'>) {
	const workflow = workflowForPlan(state, plan)
	if (workflow === undefined || workflow.classification !== 'selectable' || !retryableOnChainWorkflowFailure(workflow)) {
		return false
	}
	const timestamp = new Date().toISOString()
	workflow.completedAt ??= timestamp
	workflow.status = 'abandoned'
	workflow.updatedAt = timestamp
	recordActivity(state, {
		ecosystem: plan.ecosystem,
		message: `Finalized selectable revert retained as a completed attempt for fresh canonical discovery: ${plan.label}`,
		operationId: plan.definitionId,
		status: 'skipped',
		type: 'recovery',
	})
	return true
}

function recordDryRun(state: RuntimeState, plan: OperationPlan) {
	recordActivity(state, {
		ecosystem: plan.ecosystem,
		message: `Dry-run selection: ${plan.label}`,
		operationId: plan.definitionId,
		status: 'dry-run',
		summary: `${plan.steps.length.toString()} step${plan.steps.length === 1 ? '' : 's'}; ${plan.risk} risk; no transaction signed`,
		type: 'operation',
	})
}

async function executeLifecyclePlan(configuration: ConfigurationState, state: RuntimeState, resources: RuntimeResources, plan: OperationPlan, executionCancelled: () => boolean) {
	const obligation = obligationForPlan(state, plan)
	if (obligation === undefined) throw new Error(`Lifecycle plan ${plan.id} has no durable obligation`)
	beginLifecycleObligation(obligation)
	await persistState(configuration, state)
	try {
		await executeOperationPlan(
			executionEnvironment(
				configuration.settings,
				state,
				resources.pool,
				undefined,
				async () => {
					await ensureSubmissionPreflight(resources, configuration.settings)
					state.rpcEndpointHealth = resourceHealth(resources)
				},
				executionCancelled,
			),
			plan,
		)
		if (!completeLifecycleObligation(state, obligation)) {
			throw new Error(`Lifecycle workflow ${obligation.workflowId} did not complete every step`)
		}
		await persistState(configuration, state)
	} catch (error) {
		if (error instanceof TransactionAwaitingRecovery) {
			failLifecycleObligation(obligation, error, true)
			await persistState(configuration, state)
			throw error
		}
		if (rediscoverableExecutionFailure(state, plan, error)) {
			failLifecycleObligation(obligation, error, true)
			recordActivity(state, {
				ecosystem: plan.ecosystem,
				message: `Lifecycle preflight changed before signing: ${plan.label}`,
				operationId: plan.definitionId,
				status: 'skipped',
				type: 'operation',
			})
			await persistState(configuration, state)
			return
		}
		if (operationalFailureDisposition(error) === 'connectivity-degraded') {
			failLifecycleObligation(obligation, error, true)
			await persistState(configuration, state)
			throw error
		}
		const failedWorkflow = workflowForPlan(state, plan)
		if (failedWorkflow !== undefined && retryableOnChainWorkflowFailure(failedWorkflow)) {
			failLifecycleObligation(obligation, error, false)
			recordActivity(state, {
				ecosystem: plan.ecosystem,
				message: `Finalized lifecycle revert retained for canonical reconciliation: ${plan.label}`,
				operationId: plan.definitionId,
				status: 'skipped',
				type: 'recovery',
			})
			await persistState(configuration, state)
			return
		}
		failLifecycleObligation(obligation, error, false)
		await persistState(configuration, state)
		throw error
	}
}

async function executeRandomPlan(configuration: ConfigurationState, state: RuntimeState, resources: RuntimeResources, plan: OperationPlan, executionCancelled: () => boolean) {
	const scheduler = schedulerFor(configuration, state)
	await scheduler.begin(plan.definitionId)
	if (!configuration.settings.runtime.execute) {
		recordDryRun(state, plan)
		await scheduler.complete(plan.definitionId)
		return
	}
	try {
		await executeOperationPlan(
			executionEnvironment(
				configuration.settings,
				state,
				resources.pool,
				undefined,
				async () => {
					await ensureSubmissionPreflight(resources, configuration.settings)
					state.rpcEndpointHealth = resourceHealth(resources)
				},
				executionCancelled,
			),
			plan,
		)
		await scheduler.complete(plan.definitionId)
	} catch (error) {
		if (error instanceof TransactionAwaitingRecovery) throw error
		if (rediscoverableExecutionFailure(state, plan, error)) {
			recordActivity(state, {
				ecosystem: plan.ecosystem,
				message: `Anchored preflight changed before signing: ${plan.label}`,
				operationId: plan.definitionId,
				status: 'skipped',
				type: 'operation',
			})
			await scheduler.complete(plan.definitionId)
			return
		}
		if (abandonRetryableSelectableFailure(state, plan)) {
			await scheduler.complete(plan.definitionId)
			return
		}
		await scheduler.complete(plan.definitionId)
		throw error
	}
}

async function executeRandomContinuation(configuration: ConfigurationState, state: RuntimeState, resources: RuntimeResources, plan: OperationPlan, executionCancelled: () => boolean) {
	const scheduler = schedulerFor(configuration, state)
	try {
		await executeOperationPlan(
			executionEnvironment(
				configuration.settings,
				state,
				resources.pool,
				undefined,
				async () => {
					await ensureSubmissionPreflight(resources, configuration.settings)
					state.rpcEndpointHealth = resourceHealth(resources)
				},
				executionCancelled,
			),
			plan,
		)
		await scheduler.complete(plan.definitionId)
	} catch (error) {
		if (error instanceof TransactionAwaitingRecovery) throw error
		if (rediscoverableExecutionFailure(state, plan, error)) {
			recordActivity(state, {
				ecosystem: plan.ecosystem,
				message: `Continuation requires fresh canonical discovery: ${plan.label}`,
				operationId: plan.definitionId,
				status: 'skipped',
				type: 'recovery',
			})
			await persistState(configuration, state)
			return
		}
		if (abandonRetryableSelectableFailure(state, plan)) {
			await scheduler.complete(plan.definitionId)
			return
		}
		throw error
	}
}

async function reconcilePendingWork(configuration: ConfigurationState, state: RuntimeState, resources: RuntimeResources, executionCancelled: () => boolean) {
	if (state.pendingTransactions.length === 0) return false
	const settings = configuration.settings
	const wallet = configuredWallet(settings)
	const profileMatches = state.profileId === executionProfileId(settings)
	const pending = state.pendingTransactions[0]
	if (pending === undefined) throw new Error('Pending transaction journal changed during recovery')
	if (wallet !== undefined && pending.sender.toLowerCase() !== wallet.toLowerCase()) {
		throw new Error('The configured signer does not match the pending transaction recovery signer')
	}
	const workflowId = pending.workflowId
	const operationId = pending.operationId
	let recoveryFailure: unknown
	try {
		await recoverPendingTransactions(executionEnvironment(settings, state, resources.pool, pending.sender, undefined, executionCancelled), {
			beforeResubmit: async () => {
				if (state.paused || configuration.settings.paused || !configuration.settings.runtime.execute) {
					throw new Error('Chaos bot paused before pending transaction resubmission')
				}
				await ensureSubmissionPreflight(resources, settings)
				state.rpcEndpointHealth = resourceHealth(resources)
			},
			resubmit: wallet !== undefined && profileMatches && settings.runtime.execute && !settings.paused && !state.paused,
		})
	} catch (error) {
		recoveryFailure = error
	}
	if (state.pendingTransactions.length !== 0) {
		if (!profileMatches) {
			state.error = 'The pending transaction belongs to the previous deployment profile and is being checked read-only; restore that exact profile or queue a verified replacement reconciliation'
			state.status = 'paused'
			await persistState(configuration, state)
		} else if (wallet === undefined) {
			state.error = 'The pending transaction was checked read-only and is waiting for the exact recovery signer before resubmission'
			state.status = 'paused'
			await persistState(configuration, state)
		}
		if (recoveryFailure !== undefined) throw recoveryFailure
		return true
	}
	blockInterruptedWorkflows(state)
	const workflow = state.workflows.find(candidate => candidate.id === workflowId)
	if (workflow === undefined) throw new Error(`Recovered workflow ${workflowId} is unavailable`)
	const obligation = state.obligations.find(candidate => candidate.workflowId === workflowId)
	let retryableLifecycleFailure = false
	let retryableSelectableFailure = false
	if (workflowNeedsContinuation(workflow)) {
		if (obligation !== undefined) {
			failLifecycleObligation(obligation, 'Recovered one workflow step; canonical continuation is required before novelty', true)
		}
	} else if (obligation !== undefined) {
		if (workflow.status === 'failed') {
			retryableLifecycleFailure = retryableOnChainWorkflowFailure(workflow)
			failLifecycleObligation(obligation, recoveryFailure ?? 'Recovered transaction failed on chain', false)
		} else if (!completeLifecycleObligation(state, obligation) && workflow.status === 'blocked') {
			failLifecycleObligation(obligation, 'Recovered a prerequisite; canonical rediscovery is required for the remaining lifecycle steps', true)
		}
	} else if ((state.scheduler.status === 'running' || state.scheduler.status === 'paused') && state.scheduler.selectedOperationId === operationId) {
		retryableSelectableFailure = abandonRetryableSelectableFailure(state, {
			definitionId: workflow.operationId,
			ecosystem: workflow.ecosystem,
			id: workflow.planId,
			label: workflow.label,
		})
		await scheduleAfterRecoveredTransaction(configuration, state, operationId)
	}
	await persistState(configuration, state)
	if (recoveryFailure !== undefined && !retryableLifecycleFailure && !retryableSelectableFailure) {
		throw recoveryFailure
	}
	return true
}

async function safetyPause(configuration: ConfigurationState, state: RuntimeState) {
	state.safetyPaused = true
	state.paused = true
	state.scheduler.status = 'paused'
	state.status = 'paused'
	const failures: unknown[] = []
	try {
		await persistState(configuration, state)
	} catch (error) {
		failures.push(error)
	}
	if (!configuration.settings.paused) {
		const candidate = { ...configuration.settings, paused: true }
		try {
			const revision = await saveSettings(configuration.path, restartSafeSettings(candidate, configuration.rememberSigner), configuration.revision)
			configuration.revision = revision
			configuration.settings = candidate
		} catch (error) {
			failures.push(error)
		}
	}
	if (failures.length !== 0) {
		throw new AggregateError(failures, 'Chaos bot entered an in-memory safety pause, but one or more durable pause records could not be saved')
	}
}

async function handleCycleFailure(error: unknown, configuration: ConfigurationState, state: RuntimeState) {
	if (error instanceof ChaosProtocolIndexReorgError) {
		state.protocolIndex = undefined
		state.error = 'A protocol-index reorganization was detected; canonical backfill will restart from the configured protocol start block'
		state.status = currentStatus(configuration.settings)
		recordActivity(state, {
			message: 'Canonical protocol index invalidated by a chain reorganization',
			status: 'info',
			type: 'recovery',
		})
		await persistState(configuration, state)
		return
	}
	const message = errorMessage(error)
	const changed = state.error !== message
	state.error = message
	if (changed) {
		recordActivity(state, {
			message: `Operator cycle stopped safely: ${message}`,
			status: 'failed',
			type: 'error',
		})
	}
	if (error instanceof TransactionAwaitingRecovery) {
		state.status = 'connectivity-degraded'
	} else if (operationalFailureDisposition(error) === 'connectivity-degraded') {
		state.status = 'connectivity-degraded'
	} else {
		await safetyPause(configuration, state)
		state.status = 'paused'
	}
	await persistState(configuration, state)
}

export async function runChaosOperator(loaded: LoadedConfiguration, locks: ChaosProcessLocks, shutdown: ChaosShutdownController) {
	const initialWallet = configuredWallet(loaded.settings)
	const state = await loadRuntimeState(loaded.settings.runtime.stateFile, loaded.settings.paused, initialWallet, loaded.settings.network.chainId)
	const initialProfileId = executionProfileId(loaded.settings)
	assertDurableSignerScope(state, initialWallet, loaded.settings.runtime.stateFile)
	const initialCarryProfileResetAuthorized = resetPristineStateForDeploymentProfile(state, initialProfileId, loaded.settings.paused, initialWallet, loaded.settings.runtime.stateFile)
	if (initialCarryProfileResetAuthorized) {
		recordActivity(state, {
			message: 'Durable runtime initialized for the configured deployment profile',
			status: 'info',
			type: 'configuration',
		})
	}
	if (state.signerAddress === undefined && initialWallet !== undefined) {
		const binding = bindRuntimeStateToSigner(state, initialWallet)
		recordActivity(state, {
			message: binding.indexInvalidated ? `Durable runtime bound to signer ${initialWallet}; keyless wallet index invalidated for canonical rebuild` : `Durable runtime bound to signer ${initialWallet}`,
			status: 'info',
			type: 'wallet',
		})
	}
	blockInterruptedWorkflows(state)
	const configuration: ConfigurationState = {
		path: loaded.path,
		rememberSigner: loaded.settings.privateKey !== undefined,
		revision: loaded.revision,
		settings: loaded.settings,
	}
	if (interruptedSchedulerRunNeedsClosure(state)) {
		const scheduler = schedulerFor(configuration, state)
		await scheduler.complete(state.scheduler.selectedOperationId)
		if (configuration.settings.paused || state.paused) await scheduler.pause()
		recordActivity(state, {
			message: 'Interrupted scheduler run was closed with a fresh randomized wait before any new operation',
			status: 'info',
			type: 'recovery',
		})
		await persistState(configuration, state)
	}
	let resources: RuntimeResources | undefined
	if (loaded.settings.networkConfigured) {
		resources = {
			pool: createChaosReadPool(loaded.settings),
			readPreflightChecks: [],
			submissionPreflightChecks: [],
		}
	}
	state.rpcEndpointHealth = resources === undefined ? [] : resourceHealth(resources)
	const signerOperationGate = createSignerOperationGate()
	const dashboardController = createChaosDashboardController({
		configuration,
		gate: signerOperationGate,
		hostname: loaded.settings.runtime.uiHost,
		locks,
		loopbackPublished: process.env['ZOLTAR_BOT_DASHBOARD_LOOPBACK_PUBLISHED'] === 'true',
		password: process.env['ZOLTAR_BOT_DASHBOARD_PASSWORD'],
		state,
	})
	const dashboard = loaded.settings.runtime.ui ? startDashboardServer(loaded.settings.runtime.uiPort, dashboardController) : undefined
	await using _dashboardLifecycle = dashboard === undefined ? undefined : chaosDashboardLifecycle(dashboard)
	let carryProofJournal: CarryProofJournal | undefined
	let carryProofJournalStateFile: string | undefined
	let topologyCache: CanonicalImmutableTopologyCache | undefined
	let topologyCacheProfileId: string | undefined
	let topologyCacheStateFile: string | undefined
	let carryProfileResetAuthorized = initialCarryProfileResetAuthorized
	let backfillIncomplete = false
	let consecutiveBackfillCycles = 0
	await persistState(configuration, state)
	await pollUntilStopped(
		async () => {
			if (shutdown.isRequested()) return true
			const cycleRevision = configuration.revision
			const settings = configuration.settings
			let gateHeld = false
			const acquireCycleGate = () => {
				if (gateHeld) return true
				if (!signerOperationGate.acquire('scan')) return false
				gateHeld = true
				return true
			}
			const configurationIsCurrent = () => configuration.revision === cycleRevision && configuration.settings === settings
			try {
				const expectedProfileId = executionProfileId(settings)
				if (state.profileId !== expectedProfileId) {
					if (!acquireCycleGate()) return 'deferred'
					if (!configurationIsCurrent()) return 'deferred'
					const wallet = configuredWallet(settings)
					assertDurableSignerScope(state, wallet, settings.runtime.stateFile)
					resetPristineStateForDeploymentProfile(state, expectedProfileId, settings.paused, wallet, settings.runtime.stateFile)
					carryProofJournal = undefined
					carryProofJournalStateFile = undefined
					topologyCache = undefined
					topologyCacheProfileId = undefined
					topologyCacheStateFile = undefined
					carryProfileResetAuthorized = true
					recordActivity(state, {
						message: 'Durable runtime reset because the canonical deployment changed',
						status: 'info',
						type: 'configuration',
					})
					await persistState(configuration, state)
				}
				const profileMismatch = state.profileId !== expectedProfileId
				state.paused = settings.paused || profileMismatch || state.safetyPaused
				state.wallet = configuredWallet(settings) ?? state.signerAddress
				state.status = profileMismatch || state.safetyPaused ? 'paused' : currentStatus(settings)
				state.scanning = true
				backfillIncomplete = false
				if (!settings.networkConfigured || settings.connectivity === undefined) {
					if (!acquireCycleGate()) return 'deferred'
					if (!configurationIsCurrent()) return 'deferred'
					state.evaluations = unavailableOperationCatalog('Configure and authenticate the network deployment before discovery')
					state.error = 'Network deployment and RPC connectivity are not configured'
					state.status = 'paused'
					if (state.scheduler.status !== 'paused') {
						await schedulerFor(configuration, state).pause()
					}
					await persistState(configuration, state)
					return settings.runtime.once
				}
				if (resources === undefined) {
					throw new Error('Configured network is missing its RPC endpoint pool')
				}
				await ensureReadPreflight(resources, settings)
				state.rpcEndpointHealth = resourceHealth(resources)
				if (state.pendingTransactions.length !== 0) {
					if (!acquireCycleGate()) return 'deferred'
					if (!configurationIsCurrent()) return 'deferred'
					if (await reconcilePendingWork(configuration, state, resources, shutdown.isRequested)) {
						return settings.runtime.once
					}
				}
				const discoveryWallet = state.wallet ?? zeroAddress
				if (carryProofJournalStateFile !== settings.runtime.stateFile) carryProofJournal = undefined
				if (topologyCacheStateFile !== settings.runtime.stateFile || topologyCacheProfileId !== expectedProfileId) topologyCache = undefined
				const scan = await performCanonicalScan(settings, resources.pool, discoveryWallet, randomInteger(0, 0x1_0000_0000), state.protocolIndex, carryProofJournal, carryProfileResetAuthorized, topologyCache)
				if (!acquireCycleGate()) return 'deferred'
				if (!configurationIsCurrent()) return 'deferred'
				state.protocolIndex = scan.index
				carryProofJournal = scan.carryProofJournal
				carryProofJournalStateFile = settings.runtime.stateFile
				topologyCache = scan.topologyCache
				topologyCacheProfileId = expectedProfileId
				topologyCacheStateFile = settings.runtime.stateFile
				carryProfileResetAuthorized = false
				state.evaluations = state.wallet === undefined ? blockExecutableEvaluations(scan.evaluations, 'Configure the dedicated transaction signer before execution') : scan.evaluations
				state.inventory = scan.inventory
				state.topology = runtimeTopologySummary(scan)
				state.lastScanAt = new Date().toISOString()
				state.lastScannedBlock = scan.anchor.blockNumber
				state.error = undefined
				state.warnings = [...scan.snapshot.warnings]
				state.rpcEndpointHealth = resourceHealth(resources)
				synchronizeLifecycleObligations(state, state.evaluations, scan.canonicalLifecyclePresence, scan.canonicalLifecyclePresenceComplete, scan.anchor.blockNumber, scan.anchor.timestamp)
				await persistState(configuration, state)
				if (!scan.indexComplete || !scan.carryProofJournalComplete) {
					backfillIncomplete = true
					return settings.runtime.once
				}
				const continuationWorkflows = state.workflows.filter(workflowNeedsContinuation)
				if (continuationWorkflows.length > 1) {
					throw new Error('Multiple partial workflows require explicit operator reconciliation')
				}
				const continuationWorkflow = continuationWorkflows[0]
				if (continuationWorkflow !== undefined) {
					const continuationEvaluation = applyExecutionPolicy([reevaluateOperationContinuation(scan.snapshot, durableWorkflowPlan(continuationWorkflow), planningOptions(settings, continuationWorkflow.planningSeed))], settings, true, scan.anchor.blockNumber.toString(), scan.anchor.blockNumber.toString())[0]
					if (continuationEvaluation === undefined) {
						throw new Error('Canonical continuation evaluation returned no result')
					}
					const freshPlan = continuationEvaluation.eligibility.eligible ? continuationEvaluation.plan : undefined
					if (freshPlan === undefined) {
						const blockers = continuationEvaluation.eligibility.blockers.join('; ')
						state.error = `Partial workflow ${continuationWorkflow.label} is waiting for its canonical continuation; novel work remains blocked${blockers === '' ? '' : `: ${blockers}`}`
						await persistState(configuration, state)
						return settings.runtime.once
					}
					refreshWorkflowContinuation(continuationWorkflow, freshPlan)
					await persistState(configuration, state)
					if (state.paused || !settings.runtime.execute) {
						state.error = `Partial workflow ${continuationWorkflow.label} is ready to continue after live execution resumes`
						await persistState(configuration, state)
						return settings.runtime.once
					}
					await ensureSubmissionPreflight(resources, settings)
					state.rpcEndpointHealth = resourceHealth(resources)
					const continuationPlan = durableWorkflowPlan(continuationWorkflow)
					const obligation = state.obligations.find(candidate => candidate.workflowId === continuationWorkflow.id)
					if (obligation === undefined) {
						await executeRandomContinuation(configuration, state, resources, continuationPlan, shutdown.isRequested)
					} else {
						await executeLifecyclePlan(configuration, state, resources, continuationPlan, shutdown.isRequested)
					}
					return settings.runtime.once
				}
				const obstructingObligation = state.obligations.find(obligation => obligation.status === 'blocked' || obligation.status === 'executing' || obligation.status === 'failed')
				if (obstructingObligation !== undefined) {
					const blocker = obstructingObligation.blockers[0]
					const message = `Lifecycle obligation ${obstructingObligation.label} is ${obstructingObligation.status} and prevents novel work${blocker === undefined ? '' : `: ${blocker}`}. Resolve its precondition or use explicit operator reconciliation.`
					if (state.error !== message) {
						recordActivity(state, {
							ecosystem: obstructingObligation.ecosystem,
							message,
							operationId: obstructingObligation.operationId,
							status: 'failed',
							type: 'error',
						})
					}
					state.error = message
					if (obstructingObligation.status !== 'blocked') {
						await safetyPause(configuration, state)
						state.status = 'paused'
					}
					await persistState(configuration, state)
					return settings.runtime.once
				}
				const scheduler = schedulerFor(configuration, state)
				if (state.paused) {
					if (state.scheduler.status !== 'paused') await scheduler.pause()
					return settings.runtime.once
				}
				const urgent = urgentOperationPlans(state.evaluations)
				const actionableUrgent = urgent.filter(plan => obligationForPlan(state, plan) !== undefined)
				if (actionableUrgent.length > 0 && settings.runtime.execute) {
					const plan = actionableUrgent[0]
					if (plan === undefined) throw new Error('Urgent operation selection returned no plan')
					await ensureSubmissionPreflight(resources, settings)
					state.rpcEndpointHealth = resourceHealth(resources)
					await executeLifecyclePlan(configuration, state, resources, plan, shutdown.isRequested)
					return settings.runtime.once
				}
				const pendingObligation = state.obligations.find(obligation => obligation.status === 'pending')
				if (pendingObligation !== undefined) {
					state.error = settings.runtime.execute
						? `Lifecycle obligation ${pendingObligation.label} remains pending and prevents random work until its canonical plan is actionable`
						: `Lifecycle obligation ${pendingObligation.label} requires live execution or explicit reconciliation before random dry-run work can continue`
					await persistState(configuration, state)
					return settings.runtime.once
				}
				await scheduler.resume()
				await scheduler.ensureScheduled()
				await scheduler.markDue()
				if (!scheduler.isDue() && state.scheduler.status !== 'due') {
					return settings.runtime.once
				}
				const candidates = randomOperationPlans(state.evaluations)
				const plan = candidates.length === 0 ? undefined : candidates[randomInteger(0, candidates.length)]
				if (plan === undefined) {
					recordActivity(state, {
						message: 'No random operation is currently eligible',
						status: 'skipped',
						type: 'scheduler',
					})
					await scheduler.complete()
					return settings.runtime.once
				}
				if (settings.runtime.execute) {
					await ensureSubmissionPreflight(resources, settings)
					state.rpcEndpointHealth = resourceHealth(resources)
				}
				await executeRandomPlan(configuration, state, resources, plan, shutdown.isRequested)
				return settings.runtime.once
			} catch (error) {
				if (!acquireCycleGate()) return 'deferred'
				if (!configurationIsCurrent()) return 'deferred'
				if (resources !== undefined) state.rpcEndpointHealth = resourceHealth(resources)
				await handleCycleFailure(error, configuration, state)
				throw error
			} finally {
				state.scanning = false
				if (resources !== undefined) {
					state.rpcEndpointHealth = resourceHealth(resources)
				}
				if (gateHeld) signerOperationGate.release('scan')
			}
		},
		async consecutiveFailures => {
			const milliseconds = backfillIncomplete ? backfillWaitMilliseconds(configuration.settings.runtime.lifecyclePollMilliseconds, consecutiveBackfillCycles) : retryDelayMilliseconds(configuration.settings.runtime.lifecyclePollMilliseconds, consecutiveFailures)
			if (backfillIncomplete) consecutiveBackfillCycles += 1
			else consecutiveBackfillCycles = 0
			await shutdown.wait(milliseconds)
		},
		loaded.settings.runtime.once,
		error => console.error(`chaosBot=${errorMessage(error)}`),
	)
}
