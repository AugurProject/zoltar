import { logEvent } from '@zoltar/bot-shared/infrastructure/log-event'
import { retryDelayMilliseconds, type PollResult } from '@zoltar/bot-shared/monitoring/resilience'
import { scanBlockTimeMs, startScanReport } from '@zoltar/core-shared/monitoring/scanStatus'
import { executionProfileId } from '../config/execution-profile.ts'
import type { OperatorSettings } from '../config/settings.ts'
import { randomInteger } from '../core/random.ts'
import { backfillWaitMilliseconds, operatorWaitMilliseconds } from '../core/scheduler.ts'
import { preflightOperationPreview } from '../execution/operation-preview.ts'
import { publicFailureReason, recordPreflightFailure } from '../execution/preflight-failure.ts'
import { executionEnvironment } from './execution-environment.ts'
import { TransactionAwaitingRecovery } from '../execution/transaction-executor.ts'
import { evaluateSelectableOperationDefinition, operationHasCanonicalContinuationBuilder } from '../operations/catalog.ts'
import type { EvaluatedOperation } from '../operations/types.ts'
import { recordActivity, setRuntimeExecutionAddress, type RuntimeState } from '../state/operator-state.ts'
import { applyExecutionPolicy, blockExecutableEvaluations, chaosReadClients, performCanonicalScan, planningOptions, unavailableOperationCatalog, type CanonicalScanResult } from './canonical-scan.ts'
import { checkDeploymentAvailability, recordUnavailableDeploymentScan, tradingDeploymentNotice } from './deployment-availability.ts'
import { resetPristineStateForDeploymentProfile, verifyRetirementCompletionFinality } from './deployment-profile.ts'
import { actionableUrgentLifecyclePlan, lifecycleObstructions } from './lifecycle-readiness.ts'
import { blockNovelEvaluations, lifecyclePresenceBlockerMessage, synchronizeLifecycleObligations } from './obligations.ts'
import { assertDurableSignerScope, configuredWallet, currentResources, currentStatus, ensureSubmissionPreflight, errorMessage, persistState, prepareSubmission, refreshEndpointHealth, type OperatorDependencies, type OperatorState } from './operator-context.ts'
import { executeLifecyclePlan, executeRandomContinuation, executeRandomPlan, handleCycleFailure, reconcilePendingWork, safetyPause } from './operator-execution.ts'
import { reconcileClosedV3RetirementWorkflow, V3_RETIREMENT_OPERATION } from './retirement-v3-continuation.ts'
import { retirementPlanAllowed } from './retirement-operation-policy.ts'
import { enforceRetirementContinuation, processRetirementCycle, retirementCompletionEvidenceCanonical, retirementPositionsForScan, updateRetirementAssessment } from './retirement-runner.ts'
import { schedulerFor } from './scheduled-operation.ts'
import { genesisInitializationDefinitionId, genesisInitializationPlan, genesisInitializationTarget, randomOperationPlans, selectExecutableOperationPlan } from './selection.ts'
import { ensureReadPreflight, refreshSubmissionReadiness } from './submission-preflight.ts'
import { runtimeTopologySummary } from './topology-summary.ts'
import { evaluatePolicySafeContinuation } from './workflow-continuation.ts'
import { durableWorkflowPlan, refreshWorkflowContinuation, workflowNeedsContinuation } from './workflows.ts'

/** Per-iteration scan-loop state; the configuration revision and settings are pinned for the whole cycle. */
type OperatorCycle = {
	gateHeld: boolean
	revision: string
	scanCompleted: boolean
	scanReport: ReturnType<typeof startScanReport>
	settings: OperatorSettings
}

type RetirementPositions = Awaited<ReturnType<typeof retirementPositionsForScan>>

/** `undefined` lets the cycle continue with its next phase. */
type PhaseResult = PollResult | undefined

function acquireCycleGate(cycle: OperatorCycle, deps: OperatorDependencies) {
	if (cycle.gateHeld) return true
	if (!deps.gate.acquire('scan')) return false
	cycle.gateHeld = true
	return true
}

function configurationIsCurrent(operator: OperatorState, cycle: OperatorCycle) {
	return operator.configuration.revision === cycle.revision && operator.configuration.settings === cycle.settings
}

/** Acquire the signer gate and confirm the pinned configuration is still current before mutating state. */
function cycleMayMutate(operator: OperatorState, cycle: OperatorCycle, deps: OperatorDependencies) {
	return acquireCycleGate(cycle, deps) && configurationIsCurrent(operator, cycle)
}

async function prepareOperatorSubmission(operator: OperatorState, settings: OperatorSettings) {
	await ensureSubmissionPreflight(currentResources(operator), settings)
	refreshEndpointHealth(operator)
}

export function synchronizeScanObligations(state: RuntimeState, evaluations: readonly EvaluatedOperation[], scan: CanonicalScanResult) {
	synchronizeLifecycleObligations(
		state,
		evaluations,
		scan.canonicalLifecyclePresence,
		scan.canonicalLifecyclePresenceComplete,
		scan.anchor.blockNumber,
		scan.anchor.timestamp,
		scan.executionReady && scan.index?.availableStartBlock !== undefined ? BigInt(scan.index.availableStartBlock) : undefined,
		scan.index?.availableStartBlock === undefined ? undefined : BigInt(scan.index.availableStartBlock),
		scan.carryProofsComplete,
	)
}

/** Record a completed canonical scan and bind its topology cache to the scanned profile and state file. */
export function recordScanResult(operator: OperatorState, scan: CanonicalScanResult, profileId: string, stateFile: string, evaluations: RuntimeState['evaluations']) {
	const state = operator.runtime
	state.protocolIndex = scan.index
	operator.topology = { cache: scan.topologyCache, profileId, stateFile }
	state.evaluations = evaluations
	state.inventory = scan.inventory
	state.inventoryAddress = scan.inventoryAddress
	state.topology = runtimeTopologySummary(scan)
	state.lastScanAt = new Date().toISOString()
	state.lastScannedBlock = scan.anchor.blockNumber
}

async function synchronizeDeploymentProfile(operator: OperatorState, cycle: OperatorCycle, deps: OperatorDependencies, expectedProfileId: string): Promise<PhaseResult> {
	const { configuration, runtime: state } = operator
	const settings = cycle.settings
	if (state.profileId === expectedProfileId) return undefined
	if (!acquireCycleGate(cycle, deps)) return 'deferred'
	if (!configurationIsCurrent(operator, cycle)) return 'deferred'
	const wallet = configuredWallet(settings)
	assertDurableSignerScope(state, wallet, settings.runtime.stateFile)
	await resetPristineStateForDeploymentProfile(state, expectedProfileId, settings.deployment.uniswapV3Factory, settings.paused, wallet, settings.runtime.stateFile, async evidence => verifyRetirementCompletionFinality(settings, evidence))
	operator.topology = { cache: undefined, profileId: undefined, stateFile: undefined }
	recordActivity(state, {
		message: 'Durable runtime reset because the canonical deployment changed',
		status: 'info',
		type: 'configuration',
	})
	await persistState(configuration, state)
	return undefined
}

async function pauseUnconfiguredNetwork(operator: OperatorState, cycle: OperatorCycle, deps: OperatorDependencies): Promise<PollResult> {
	const { configuration, runtime: state } = operator
	if (!acquireCycleGate(cycle, deps)) return 'deferred'
	if (!configurationIsCurrent(operator, cycle)) return 'deferred'
	state.evaluations = unavailableOperationCatalog('Configure and authenticate the network deployment before discovery')
	state.error = 'Network deployment and RPC connectivity are not configured'
	cycle.scanReport.update({ status: 'paused' })
	state.status = 'paused'
	if (state.scheduler.status !== 'paused') {
		await schedulerFor(configuration, state).pause()
	}
	await persistState(configuration, state)
	return cycle.settings.runtime.once
}

async function reconcileOutstandingTransactions(operator: OperatorState, cycle: OperatorCycle, deps: OperatorDependencies): Promise<PhaseResult> {
	const state = operator.runtime
	if (state.pendingTransactions.length === 0 && state.includedTransactions.length === 0 && state.rollbackQueue.length === 0) return undefined
	if (!acquireCycleGate(cycle, deps)) return 'deferred'
	if (!configurationIsCurrent(operator, cycle)) return 'deferred'
	if (await reconcilePendingWork(operator.configuration, state, currentResources(operator), deps.shutdown.isRequested)) {
		return cycle.settings.runtime.once
	}
	return undefined
}

async function waitForDeployment(operator: OperatorState, cycle: OperatorCycle, deps: OperatorDependencies): Promise<PhaseResult> {
	const { configuration, runtime: state } = operator
	const settings = cycle.settings
	const deploymentCheck = await checkDeploymentAvailability(settings, currentResources(operator).pool)
	const deploymentNotice = deploymentCheck.notice
	if (!deploymentCheck.blocking || deploymentNotice === undefined) return undefined
	if (!cycleMayMutate(operator, cycle, deps)) return 'deferred'
	recordUnavailableDeploymentScan(state, deploymentNotice, deploymentCheck)
	cycle.scanReport.update({ status: 'waiting' })
	await schedulerFor(configuration, state).pause()
	await persistState(configuration, state)
	return settings.runtime.once
}

type CompletedScan = { retirementV3: RetirementPositions; scan: CanonicalScanResult }

async function scanCanonicalState(operator: OperatorState, cycle: OperatorCycle, deps: OperatorDependencies, expectedProfileId: string): Promise<CompletedScan | 'deferred'> {
	const { configuration, runtime: state } = operator
	const settings = cycle.settings
	const discoveryWallet = state.wallet
	if (state.protocolIndex === undefined || operator.topology.stateFile !== settings.runtime.stateFile || operator.topology.profileId !== expectedProfileId) operator.topology.cache = undefined
	const scan = await performCanonicalScan(settings, currentResources(operator).pool, discoveryWallet, randomInteger(0, 0x1_0000_0000), state.protocolIndex, operator.topology.cache)
	if (!acquireCycleGate(cycle, deps)) return 'deferred'
	if (!configurationIsCurrent(operator, cycle)) return 'deferred'
	recordScanResult(operator, scan, expectedProfileId, settings.runtime.stateFile, state.wallet === undefined ? blockExecutableEvaluations(scan.evaluations, 'Configure the dedicated transaction signer before execution') : scan.evaluations)
	cycle.scanReport.update({ block: scan.anchor.blockNumber })
	state.deploymentNotice = tradingDeploymentNotice(scan.snapshot)
	state.lastDeploymentCheckedBlock = undefined
	state.lastDeploymentCheckAt = undefined
	state.error = undefined
	state.warnings = [...scan.snapshot.warnings]
	refreshEndpointHealth(operator)
	synchronizeScanObligations(state, state.evaluations, scan)
	if (state.lifecyclePresenceBlocker !== undefined) {
		state.error = lifecyclePresenceBlockerMessage(state.lifecyclePresenceBlocker)
		state.evaluations = blockNovelEvaluations(state.evaluations, state.lifecyclePresenceBlocker)
	}
	const retirementV3 = await retirementPositionsForScan({ anchor: scan.anchor, pool: currentResources(operator).pool, profileId: expectedProfileId, settings, state, wallet: state.wallet })
	updateRetirementAssessment(scan, settings, state, retirementV3, await retirementCompletionEvidenceCanonical(settings, currentResources(operator).pool, state, scan.anchor))
	await persistState(configuration, state)
	cycle.scanCompleted = true
	return { retirementV3, scan }
}

async function advanceContinuationWorkflow(operator: OperatorState, cycle: OperatorCycle, deps: OperatorDependencies, { retirementV3, scan }: CompletedScan): Promise<PhaseResult> {
	const { configuration, runtime: state } = operator
	const settings = cycle.settings
	const continuationWorkflows = state.workflows.filter(workflowNeedsContinuation)
	if (continuationWorkflows.length > 1) {
		throw new Error('Multiple partial workflows require explicit operator reconciliation')
	}
	const continuationWorkflow = continuationWorkflows[0]
	if (continuationWorkflow === undefined) return undefined
	const continuationPlan = durableWorkflowPlan(continuationWorkflow)
	if (!enforceRetirementContinuation(state, continuationWorkflow, operationHasCanonicalContinuationBuilder(continuationWorkflow.operationId), state.retirement.status === 'inactive' || retirementPlanAllowed(continuationPlan, scan.snapshot, state.retirement.policies))) {
		await persistState(configuration, state)
		return settings.runtime.once
	}
	const continuationSelection = evaluatePolicySafeContinuation(scan.snapshot, continuationWorkflow, settings, scan.anchor.blockNumber.toString(), state.retirement.status !== 'inactive' && continuationWorkflow.continuationDisposition === 'cleanup-only', { state, observations: retirementV3 })
	const continuationEvaluation = continuationSelection.evaluation
	if (continuationSelection.continuationDisposition !== undefined && continuationWorkflow.continuationDisposition !== continuationSelection.continuationDisposition) {
		continuationWorkflow.continuationDisposition = continuationSelection.continuationDisposition
		await persistState(configuration, state)
	}
	const freshPlan = continuationEvaluation.eligibility.eligible ? continuationEvaluation.plan : undefined
	if (freshPlan === undefined) {
		const blockers = continuationEvaluation.eligibility.blockers.join('; ')
		state.error = `Partial workflow ${continuationWorkflow.label} is waiting for its canonical continuation; novel work remains blocked${blockers === '' ? '' : `: ${blockers}`}`
		await persistState(configuration, state)
		return settings.runtime.once
	}
	if (continuationWorkflow.operationId === V3_RETIREMENT_OPERATION && freshPlan.steps.length === 0) {
		reconcileClosedV3RetirementWorkflow(scan.snapshot, continuationWorkflow, { state, observations: retirementV3 })
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
	await prepareOperatorSubmission(operator, settings)
	const refreshedContinuationPlan = durableWorkflowPlan(continuationWorkflow)
	const obligation = state.obligations.find(candidate => candidate.workflowId === continuationWorkflow.id)
	if (obligation === undefined) {
		await executeRandomContinuation(configuration, state, currentResources(operator), refreshedContinuationPlan, deps.shutdown.isRequested)
	} else {
		await executeLifecyclePlan(configuration, state, currentResources(operator), refreshedContinuationPlan, deps.shutdown.isRequested)
	}
	return settings.runtime.once
}

type LifecycleObstructions = ReturnType<typeof lifecycleObstructions>

type CycleScheduler = ReturnType<typeof schedulerFor>

async function stopForHardObstruction(operator: OperatorState, cycle: OperatorCycle, obstructions: LifecycleObstructions): Promise<PhaseResult> {
	const { configuration, runtime: state } = operator
	if (obstructions.hard !== undefined) {
		const obstructingObligation = obstructions.hard
		const blocker = obstructingObligation.blockers[0]
		const message = `Lifecycle obligation ${obstructingObligation.label} is ${obstructingObligation.status} and prevents all execution${blocker === undefined ? '' : `: ${blocker}`}. Resolve its precondition or use explicit operator reconciliation.`
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
		return cycle.settings.runtime.once
	}
	return undefined
}

async function deferForLifecycleWork(operator: OperatorState, cycle: OperatorCycle, deps: OperatorDependencies, scan: CanonicalScanResult, obstructions: LifecycleObstructions, scheduler: CycleScheduler): Promise<PhaseResult> {
	const { configuration, runtime: state } = operator
	const settings = cycle.settings
	if (state.paused) {
		if (state.scheduler.status !== 'paused') await scheduler.pause()
		return settings.runtime.once
	}
	const actionableUrgent = actionableUrgentLifecyclePlan(state, plan => state.retirement.status === 'inactive' || retirementPlanAllowed(plan, scan.snapshot, state.retirement.policies))
	if (actionableUrgent !== undefined && settings.runtime.execute) {
		await prepareOperatorSubmission(operator, settings)
		await executeLifecyclePlan(configuration, state, currentResources(operator), actionableUrgent, deps.shutdown.isRequested)
		return settings.runtime.once
	}
	if (obstructions.automaticRetry !== undefined) {
		const retry = obstructions.automaticRetry
		const blocker = retry.blockers[0]
		state.error = `Lifecycle obligation ${retry.label} prevents random novelty while awaiting bounded automatic canonical retry${blocker === undefined ? '' : `: ${blocker}`}`
		await persistState(configuration, state)
		return settings.runtime.once
	}
	const pendingObligation = state.obligations.find(obligation => obligation.status === 'pending')
	if (pendingObligation !== undefined) {
		state.error = settings.runtime.execute ? `Lifecycle obligation ${pendingObligation.label} remains pending and prevents random work until its canonical plan is actionable` : `Lifecycle obligation ${pendingObligation.label} requires live execution or explicit reconciliation before random dry-run work can continue`
		await persistState(configuration, state)
		return settings.runtime.once
	}
	if (state.lifecyclePresenceBlocker !== undefined) {
		state.error = lifecyclePresenceBlockerMessage(state.lifecyclePresenceBlocker)
		await persistState(configuration, state)
		return settings.runtime.once
	}
	return undefined
}

function genesisInitializationState(scan: CanonicalScanResult, { genesisPair, genesisPool, initializerQuestion }: ReturnType<typeof genesisInitializationTarget>) {
	return {
		genesisUniversePresent: scan.snapshot.universes.some(universe => universe.id === '0'),
		hasInitializedPair: genesisPair !== undefined && BigInt(genesisPair.totalSupply) > 0n,
		hasPair: genesisPair !== undefined,
		hasPool: genesisPool !== undefined,
		hasQuestion: initializerQuestion !== undefined,
		hasWalletVault: genesisPool?.walletVaultRegistered === true,
		hasUniswapPool: scan.snapshot.genesisUniswap?.pool !== undefined,
		hasUniswapSeeder: scan.snapshot.genesisUniswap?.seeder ?? false,
		hasWeth: BigInt(scan.snapshot.wallet.tokens.find(token => token.address.toLowerCase() === scan.snapshot.deployments.weth.toLowerCase())?.balance ?? '0') > 1n,
		hasInitializedUniswapPool: scan.snapshot.genesisUniswap?.initialized ?? false,
		hasSeededUniswapPool: BigInt(scan.snapshot.genesisUniswap?.liquidity ?? '0') > 0n,
		tradingFactoryDeployed: scan.snapshot.tradingDeployment?.factory ?? true,
		tradingRouterDeployed: scan.snapshot.tradingDeployment?.router ?? true,
	}
}

/** Resolve the genesis-initialization step, or `undefined` when genesis initialization is disabled or complete. */
function genesisInitialization(scan: CanonicalScanResult, settings: OperatorSettings) {
	const target = genesisInitializationTarget(scan.snapshot)
	const initializationState = genesisInitializationState(scan, target)
	const definitionId = settings.strategy.initializeGenesisUniverse ? genesisInitializationDefinitionId(initializationState) : undefined
	if (definitionId === undefined) return undefined
	const { genesisPair, genesisPool, initializerQuestion } = target
	const evaluation = applyExecutionPolicy(
		[
			evaluateSelectableOperationDefinition(definitionId, scan.snapshot, {
				...planningOptions(settings, 0),
				genesisInitializationTarget: {
					...(genesisPair === undefined ? {} : { pair: genesisPair.address }),
					...(genesisPool === undefined ? {} : { pool: genesisPool.address }),
					...(initializerQuestion === undefined ? {} : { questionId: initializerQuestion.id }),
					universeId: '0',
				},
			}),
		],
		settings,
		scan.executionReady,
		scan.anchor.blockNumber.toString(),
		scan.anchor.blockNumber.toString(),
		BigInt(scan.snapshot.wallet.ethBalanceAttoEth),
	)[0]
	return { definitionId, plan: evaluation === undefined ? undefined : genesisInitializationPlan([evaluation], initializationState) }
}

async function executeScheduledWork(operator: OperatorState, cycle: OperatorCycle, deps: OperatorDependencies, scan: CanonicalScanResult, scheduler: CycleScheduler): Promise<PollResult> {
	const { configuration, runtime: state } = operator
	const settings = cycle.settings
	await scheduler.resume()
	await scheduler.ensureScheduled()
	await scheduler.markDue()
	if (!scheduler.isDue() && state.scheduler.status !== 'due') {
		return settings.runtime.once
	}
	const candidates = randomOperationPlans(state.evaluations, settings.strategy.selectableOperationAllowlist)
	const initialization = genesisInitialization(scan, settings)
	if (initialization !== undefined && initialization.plan === undefined) {
		state.error = `Genesis initialization is waiting for ${initialization.definitionId} to become eligible; unrelated random work is blocked`
		await persistState(configuration, state)
		return settings.runtime.once
	}
	const selectionCandidates = initialization?.plan === undefined ? candidates : [initialization.plan]
	const plan = await selectExecutableOperationPlan(
		selectionCandidates,
		async candidate => {
			if (settings.runtime.execute) await preflightOperationPreview(executionEnvironment(settings, state, currentResources(operator)), candidate)
		},
		(candidate, error) => {
			const reason = publicFailureReason(error)
			state.evaluations = state.evaluations.map(evaluation => (evaluation.definition.id === candidate.definitionId ? { definition: evaluation.definition, eligibility: { eligible: false, blockers: [...evaluation.eligibility.blockers, reason] } } : evaluation))
			recordPreflightFailure(state, candidate, error, `Candidate preflight rejected: ${candidate.label}`)
			if (initialization !== undefined) state.error = `Genesis initialization is waiting for ${initialization.definitionId}: ${reason}`
		},
	)
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
		await prepareOperatorSubmission(operator, settings)
	}
	await executeRandomPlan(configuration, state, currentResources(operator), plan, deps.shutdown.isRequested)
	return settings.runtime.once
}

async function runCyclePhases(operator: OperatorState, cycle: OperatorCycle, deps: OperatorDependencies): Promise<PollResult> {
	const { configuration, runtime: state } = operator
	const settings = cycle.settings
	const expectedProfileId = executionProfileId(settings)
	const profileReset = await synchronizeDeploymentProfile(operator, cycle, deps, expectedProfileId)
	if (profileReset !== undefined) return profileReset
	const profileMismatch = state.profileId !== expectedProfileId
	state.paused = settings.paused || profileMismatch || state.safetyPaused
	setRuntimeExecutionAddress(state, configuredWallet(settings) ?? state.signerAddress)
	state.status = profileMismatch || state.safetyPaused ? 'paused' : currentStatus(settings)
	state.scanning = true
	operator.backfillIncomplete = false
	if (!settings.networkConfigured || settings.connectivity === undefined) return await pauseUnconfiguredNetwork(operator, cycle, deps)
	await ensureReadPreflight(currentResources(operator), settings)
	refreshEndpointHealth(operator)
	const reconciled = await reconcileOutstandingTransactions(operator, cycle, deps)
	if (reconciled !== undefined) return reconciled
	const deploymentWait = await waitForDeployment(operator, cycle, deps)
	if (deploymentWait !== undefined) return deploymentWait
	const completed = await scanCanonicalState(operator, cycle, deps, expectedProfileId)
	if (completed === 'deferred') return 'deferred'
	if (!completed.scan.executionReady) {
		operator.backfillIncomplete = true
		return settings.runtime.once
	}
	// Submission evidence is refreshed in every mode so the go-live checklist can be satisfied before arming.
	const submissionReadiness = await refreshSubmissionReadiness(currentResources(operator), settings)
	if (submissionReadiness !== 'current') refreshEndpointHealth(operator)
	if (submissionReadiness === 'failed') logEvent('chaos', 'submissionReadinessRefreshFailed', { detail: 'the recorded endpoint evidence stays visible until the next refresh' }, 'error')
	const continuation = await advanceContinuationWorkflow(operator, cycle, deps, completed)
	if (continuation !== undefined) return continuation
	const obstructions = lifecycleObstructions(state)
	const hardObstruction = await stopForHardObstruction(operator, cycle, obstructions)
	if (hardObstruction !== undefined) return hardObstruction
	// Created before retirement processing, as its scheduling state is bound at creation.
	const scheduler = schedulerFor(configuration, state)
	const lifecycleWork = await deferForLifecycleWork(operator, cycle, deps, completed.scan, obstructions, scheduler)
	if (lifecycleWork !== undefined) return lifecycleWork
	const retirementResources = currentResources(operator)
	const retirementResult = await processRetirementCycle({
		execute: async plan => await executeRandomPlan(configuration, state, retirementResources, plan, deps.shutdown.isRequested, 'retirement'),
		persist: async () => await persistState(configuration, state),
		prepareExecution: async () => await prepareSubmission(state, retirementResources, settings),
		scan: completed.scan,
		settings,
		state,
		v3: completed.retirementV3,
	})
	if (retirementResult !== undefined) return retirementResult
	return await executeScheduledWork(operator, cycle, deps, completed.scan, scheduler)
}

async function finishCycle(operator: OperatorState, cycle: OperatorCycle, deps: OperatorDependencies) {
	const state = operator.runtime
	if (cycle.scanCompleted && configurationIsCurrent(operator, cycle)) {
		const eligible = state.evaluations.filter(evaluation => evaluation.eligibility.eligible).length
		const scanStatus = state.paused ? 'paused' : 'live'
		cycle.scanReport.update({ status: operator.backfillIncomplete ? 'backfilling' : scanStatus, details: { evaluated: state.evaluations.length, eligible, skipped: state.evaluations.length - eligible } })
	}
	await cycle.scanReport.finish(deps.shutdown.isRequested() || !configurationIsCurrent(operator, cycle) ? 'incomplete' : undefined)
	state.scanning = false
	refreshEndpointHealth(operator)
	if (cycle.gateHeld) deps.gate.release('scan')
}

/** One scan-loop iteration: reconcile, scan, then execute at most one lifecycle, continuation, retirement or random step. */
export async function runOperatorCycle(operator: OperatorState, deps: OperatorDependencies): Promise<PollResult> {
	if (deps.shutdown.isRequested()) return true
	const settings = operator.configuration.settings
	const cycle: OperatorCycle = {
		gateHeld: false,
		revision: operator.configuration.revision,
		scanCompleted: false,
		scanReport: startScanReport({
			network: settings.network,
			blockTimeMs: deps.environment.scanBlockTimeMs ?? scanBlockTimeMs(settings.network.chainId),
			readHead: async () => (operator.resources === undefined || settings.connectivity === undefined ? undefined : await chaosReadClients(settings, operator.resources.pool)[0]?.client.getBlockNumber()),
		}),
		settings,
	}
	try {
		return await runCyclePhases(operator, cycle, deps)
	} catch (error) {
		cycle.scanCompleted = false
		cycle.scanReport.update({ status: 'failed' })
		if (!acquireCycleGate(cycle, deps)) return 'deferred'
		if (!configurationIsCurrent(operator, cycle)) return 'deferred'
		refreshEndpointHealth(operator)
		await handleCycleFailure(error, operator.configuration, operator.runtime)
		throw error
	} finally {
		await finishCycle(operator, cycle, deps)
	}
}

export async function waitForNextCycle(operator: OperatorState, deps: OperatorDependencies, consecutiveFailures: number) {
	const pollMilliseconds = operator.configuration.settings.runtime.pollMilliseconds
	let milliseconds = operator.backfillIncomplete ? backfillWaitMilliseconds(pollMilliseconds, operator.consecutiveBackfillCycles) : retryDelayMilliseconds(pollMilliseconds, consecutiveFailures)
	if (!operator.backfillIncomplete && consecutiveFailures === 0) milliseconds = operatorWaitMilliseconds(milliseconds, operator.runtime)
	if (operator.backfillIncomplete) operator.consecutiveBackfillCycles += 1
	else operator.consecutiveBackfillCycles = 0
	await deps.shutdown.wait(milliseconds)
}

/** Pending transactions are routine recovery progress; every other cycle failure is an error. */
export function logCycleFailure(error: unknown) {
	if (error instanceof TransactionAwaitingRecovery && error.severity === 'pending') {
		logEvent('chaos', 'cyclePending', { reason: errorMessage(error) })
		return
	}
	logEvent('chaos', 'cycleFailed', { error: errorMessage(error) }, 'error')
}
