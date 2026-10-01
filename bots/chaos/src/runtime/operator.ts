import { preflightOperationPreview } from '../execution/operation-preview.ts'
import { assertDurableDeploymentFactory, assertDurableStateFactories } from '../config/deployment-state.ts'
import { readBotEnvironment } from '@zoltar/bot-shared/config/environment'
import { botDashboardLifecycle, type BotShutdownController } from '@zoltar/bot-shared/execution/bot-process-locks'
import { createSignerOperationGate } from '@zoltar/bot-shared/execution/signer-operation-gate'
import { pollUntilStopped } from '@zoltar/bot-shared/monitoring/resilience'
import { executionProfileId } from '../config/execution-profile.ts'
import { saveSettings, type OperatorSettings } from '../config/settings.ts'
import { startDashboardServer } from '../dashboard/dashboard-server.ts'
import type { OperationPlan } from '../operations/types.ts'
import { migrateEmptyBootstrapState } from '../state/bootstrap-migration.ts'
import { bindRuntimeStateToSigner, loadRuntimeState, recordActivity } from '../state/operator-state.ts'
import { isPristineBootstrapState } from '../state/pristine.ts'
import { performCanonicalScan } from './canonical-scan.ts'
import { createChaosDashboardController, type ChaosProcessLocks, type ConfigurationState } from './dashboard-controller.ts'
import { resetPristineStateForDeploymentProfile, verifyRetirementCompletionFinality } from './deployment-profile.ts'
import { executionEnvironment } from './execution-environment.ts'
import { createManualOperationController } from './manual-operations.ts'
import { assertDurableSignerScope, configuredWallet, createRuntimeResources, currentResources, persistState, resourceHealth, type OperatorDependencies, type OperatorState } from './operator-context.ts'
import { logCycleFailure, recordScanResult, runOperatorCycle, synchronizeScanObligations, waitForNextCycle } from './operator-cycle.ts'
import { executeLifecyclePlan, executeRandomPlan, handleCycleFailure, safetyPause } from './operator-execution.ts'
import { recordDryRun, closeInterruptedSchedulerRun } from './scheduled-operation.ts'
import { ensureReadPreflight } from './submission-preflight.ts'
import { blockInterruptedWorkflows } from './workflows.ts'
import { repairDurableSelectableFailures } from './workflow-repair.ts'

type LoadedConfiguration = { needsDeploymentPin?: boolean; path: string; revision: string; settings: OperatorSettings }

export { executionProfileId } from '../config/execution-profile.ts'

/** Load, migrate and repair durable runtime state, then pin the configuration the operator starts from. */
async function startOperator(loaded: LoadedConfiguration): Promise<OperatorState> {
	const initialWallet = configuredWallet(loaded.settings)
	const storedState = await loadRuntimeState(loaded.settings.runtime.stateFile, loaded.settings.paused, initialWallet, loaded.settings.network.chainId)
	assertDurableStateFactories(loaded.settings, storedState)
	const state = migrateEmptyBootstrapState(storedState, loaded.settings)
	const initialProfileId = executionProfileId(loaded.settings)
	assertDurableSignerScope(state, initialWallet, loaded.settings.runtime.stateFile)
	if (state.profileId === initialProfileId && (state.uniswapV3Factory !== undefined || !isPristineBootstrapState(state))) assertDurableDeploymentFactory(loaded.settings, state, loaded.settings.runtime.stateFile)
	const initialCarryProfileResetAuthorized = await resetPristineStateForDeploymentProfile(state, initialProfileId, loaded.settings.deployment.uniswapV3Factory, loaded.settings.paused, initialWallet, loaded.settings.runtime.stateFile, async evidence => verifyRetirementCompletionFinality(loaded.settings, evidence))
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
	const startupFailureRepair = repairDurableSelectableFailures(state)
	const configuration: ConfigurationState = {
		path: loaded.path,
		rememberSigner: loaded.settings.privateKey !== undefined,
		revision: loaded.needsDeploymentPin ? await saveSettings(loaded.path, loaded.settings, loaded.revision) : loaded.revision,
		settings: loaded.settings,
	}
	if (state.uniswapV3Factory === undefined) {
		state.uniswapV3Factory = loaded.settings.deployment.uniswapV3Factory
		await persistState(configuration, state)
	}
	if (startupFailureRepair.requiresSafetyStop) {
		await safetyPause(configuration, state)
	} else if (startupFailureRepair.repairedWorkflowIds.length !== 0) {
		await persistState(configuration, state)
	}
	await closeInterruptedSchedulerRun(configuration, state)
	const resources = loaded.settings.networkConfigured ? createRuntimeResources(loaded.settings) : undefined
	state.rpcEndpointHealth = resources === undefined ? [] : resourceHealth(resources)
	return {
		backfillIncomplete: false,
		configuration,
		consecutiveBackfillCycles: 0,
		resources,
		runtime: state,
		topology: { cache: undefined, profileId: undefined, stateFile: undefined },
	}
}

function manualOperationInputError(message: string) {
	const error = new Error(message)
	error.name = 'ManualOperationInputError'
	return error
}

/** Scan canonical state on behalf of a dashboard operation request. */
async function scanForManualOperation(operator: OperatorState, deps: OperatorDependencies) {
	const { configuration, runtime: state } = operator
	if (operator.resources === undefined || state.wallet === undefined) throw manualOperationInputError('Configure the network and signer before planning an operation')
	const settings = configuration.settings
	const expectedProfile = executionProfileId(settings)
	if (state.profileId !== expectedProfile || deps.shutdown.isRequested()) throw manualOperationInputError('Wait for the bot to initialize the current deployment profile')
	assertDurableSignerScope(state, configuredWallet(settings), settings.runtime.stateFile)
	if (operator.topology.stateFile !== settings.runtime.stateFile || operator.topology.profileId !== expectedProfile) operator.topology.cache = undefined
	await ensureReadPreflight(currentResources(operator), settings)
	const scan = await performCanonicalScan(settings, currentResources(operator).pool, state.wallet, 0, state.protocolIndex, operator.topology.cache)
	recordScanResult(operator, scan, executionProfileId(settings), settings.runtime.stateFile, scan.evaluations)
	synchronizeScanObligations(state, scan.evaluations, scan)
	await persistState(configuration, state)
	return scan
}

async function executeManualOperation(operator: OperatorState, deps: OperatorDependencies, plan: OperationPlan) {
	const { configuration, runtime: state } = operator
	const resources = currentResources(operator, 'Operation RPC resources are unavailable')
	try {
		if (!configuration.settings.runtime.execute) {
			recordDryRun(state, plan)
			await persistState(configuration, state)
		} else if (plan.classification === 'lifecycle-obligation') {
			await executeLifecyclePlan(configuration, state, resources, plan, deps.shutdown.isRequested)
		} else {
			await executeRandomPlan(configuration, state, resources, plan, deps.shutdown.isRequested, 'manual')
		}
	} catch (error) {
		await handleCycleFailure(error, configuration, state)
		throw error
	}
}

/** Wire the dashboard controller and manual operations to the operator state. */
function createOperatorDashboard(operator: OperatorState, deps: OperatorDependencies, locks: ChaosProcessLocks) {
	const { configuration, runtime: state } = operator
	const dashboardController = createChaosDashboardController({
		configuration,
		onScheduleRequested: deps.shutdown.wake,
		gate: deps.gate,
		hostname: configuration.settings.runtime.uiHost,
		locks,
		loopbackPublished: deps.environment.dashboard.loopbackPublished,
		onConnectivityUpdated: (settings, checks) => {
			operator.resources = createRuntimeResources(settings, checks)
		},
		state,
	})
	const manualOperations = createManualOperationController({
		configuration,
		gate: deps.gate,
		state,
		scan: async () => await scanForManualOperation(operator, deps),
		preflight: async plan => {
			const resources = currentResources(operator, 'Operation RPC resources are unavailable')
			await preflightOperationPreview(executionEnvironment(configuration.settings, state, resources), plan)
		},
		execute: async plan => await executeManualOperation(operator, deps, plan),
	})
	dashboardController.setOperation = manualOperations.handle
	return { dashboardController, manualOperations }
}

export async function runChaosOperator(loaded: LoadedConfiguration, locks: ChaosProcessLocks, shutdown: BotShutdownController) {
	const environment = readBotEnvironment()
	const operator = await startOperator(loaded)
	const deps: OperatorDependencies = { environment, gate: createSignerOperationGate(), shutdown }
	const { dashboardController, manualOperations } = createOperatorDashboard(operator, deps, locks)
	await using _manualOperations = manualOperations
	const dashboard = loaded.settings.runtime.ui ? startDashboardServer(loaded.settings.runtime.uiPort, dashboardController) : undefined
	await using _dashboardLifecycle = dashboard === undefined ? undefined : botDashboardLifecycle(dashboard)
	await persistState(operator.configuration, operator.runtime)
	await pollUntilStopped(
		async () => await runOperatorCycle(operator, deps),
		async consecutiveFailures => await waitForNextCycle(operator, deps, consecutiveFailures),
		loaded.settings.runtime.once,
		logCycleFailure,
	)
}
