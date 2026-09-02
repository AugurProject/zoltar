import { privateKeyToAccount, type Address, type Hex } from '@zoltar/bot-shared/ethereum'
import type { SignerOperationGate } from '@zoltar/bot-shared/execution/signer-operation-gate'
import { checkPublicTransactionSubmissionEndpoints, checkRpcEndpoint, EndpointCheckFailure, type EndpointCheck } from '@zoltar/bot-shared/monitoring/connectivity'
import type { ChaosDashboardController } from '../dashboard/dashboard-server.ts'
import { CONFIGURATION_REVISION_CONFLICT, configurationRevisionConflict, parseSettings, saveSettings, serializedSettings, type OperatorSettings } from '../config/settings.ts'
import type { ChaosProcessLocks } from '../core/process-locks.ts'
import { scheduledStateAfterRun, schedulerIsDue } from '../core/scheduler.ts'
import { abandonLifecycleObligation, lifecyclePresenceBlockerMessage, MAXIMUM_AUTOMATIC_LIFECYCLE_ATTEMPTS, retryLifecycleObligation } from './obligations.ts'
import { liveInventoryReadinessBlockers } from './live-readiness.ts'
import { workflowNeedsContinuation } from './workflows.ts'
import { bindRuntimeStateToSigner, MAXIMUM_OBLIGATION_TOMBSTONE_COUNT, recordActivity, saveDurableState, type RuntimeState } from '../state/operator-state.ts'

export type ConfigurationState = {
	path: string
	rememberSigner: boolean
	revision: string
	settings: OperatorSettings
}

export const CONFIGURATION_COMMIT_INDETERMINATE = 'ConfigurationCommitIndeterminate'
export const CONFIGURATION_COMMITTED_SAFELY_PAUSED = 'ConfigurationCommittedSafelyPaused'

export type DashboardControllerOptions = {
	checkConnectivityUpdate?: ((settings: OperatorSettings) => Promise<readonly EndpointCheck[]>) | undefined
	configuration: ConfigurationState
	gate: SignerOperationGate
	hostname: ChaosDashboardController['hostname']
	locks: ChaosProcessLocks
	loopbackPublished?: boolean | undefined
	onConnectivityUpdated?: ((settings: OperatorSettings, checks: readonly EndpointCheck[]) => void) | undefined
	saveConfiguration?: typeof saveSettings | undefined
	saveState?: ((path: string, state: RuntimeState) => Promise<void>) | undefined
	state: RuntimeState
}

function record(value: unknown, label: string) {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be a JSON object`)
	return Object.fromEntries(Object.entries(value))
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], label: string) {
	const allowed = new Set(required)
	const missing = required.filter(key => !(key in value))
	const unexpected = Object.keys(value).filter(key => !allowed.has(key))
	if (missing.length !== 0) throw new Error(`${label} is missing ${missing[0] ?? 'a required field'}`)
	if (unexpected.length !== 0) throw new Error(`${label} contains unsupported field ${unexpected[0] ?? 'unknown'}`)
}

function expectedRevision(value: unknown, current: string) {
	if (typeof value !== 'string' || value !== current) throw configurationRevisionConflict()
	return value
}

function transactionHash(value: unknown, label: string) {
	if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
		throw new Error(`${label} must be a 32-byte transaction hash`)
	}
	return value as Hex
}

export function settingsPatchCandidate(current: OperatorSettings, value: unknown) {
	const body = record(value, 'Settings update')
	exactKeys(body, ['patch', 'revision'], 'Settings update')
	const patch = record(body['patch'], 'Settings patch')
	exactKeys(patch, ['runtime', 'scheduler', 'strategy'], 'Settings patch')
	const runtime = record(patch['runtime'], 'Runtime patch')
	exactKeys(runtime, ['execute'], 'Runtime patch')
	const scheduler = record(patch['scheduler'], 'Scheduler patch')
	exactKeys(scheduler, ['maximumDelaySeconds', 'minimumDelaySeconds'], 'Scheduler patch')
	const strategy = record(patch['strategy'], 'Strategy patch')
	exactKeys(
		strategy,
		['allowHighRiskOperations', 'allowIrreversibleOperations', 'enabledEcosystems', 'initializeGenesisUniverse', 'maximumEthPerOperation', 'maximumGasCostEth', 'maximumRepPerOperation', 'minimumEthReserve', 'minimumRepReserve', 'selectableOperationAllowlist', 'workflowValidForBlocks'],
		'Strategy patch',
	)
	const serialized = serializedSettings(current)
	return {
		revision: body['revision'],
		settings: parseSettings(
			{
				...serialized,
				runtime: { ...serialized.runtime, execute: runtime['execute'] },
				scheduler: {
					...serialized.scheduler,
					maximumDelaySeconds: scheduler['maximumDelaySeconds'],
					minimumDelaySeconds: scheduler['minimumDelaySeconds'],
				},
				strategy: {
					...serialized.strategy,
					allowHighRiskOperations: strategy['allowHighRiskOperations'],
					allowIrreversibleOperations: strategy['allowIrreversibleOperations'],
					initializeGenesisUniverse: strategy['initializeGenesisUniverse'],
					enabledEcosystems: strategy['enabledEcosystems'],
					maximumEthPerOperation: strategy['maximumEthPerOperation'],
					maximumGasCostEth: strategy['maximumGasCostEth'],
					maximumRepPerOperation: strategy['maximumRepPerOperation'],
					minimumEthReserve: strategy['minimumEthReserve'],
					minimumRepReserve: strategy['minimumRepReserve'],
					selectableOperationAllowlist: strategy['selectableOperationAllowlist'],
					workflowValidForBlocks: strategy['workflowValidForBlocks'],
				},
			},
			current.privateKey,
		),
	}
}

export function connectivityCandidate(current: OperatorSettings, value: unknown) {
	const body = record(value, 'Connectivity update')
	exactKeys(body, ['connectivity', 'revision'], 'Connectivity update')
	return {
		revision: body['revision'],
		settings: parseSettings(
			{
				...serializedSettings(current),
				connectivity: body['connectivity'],
				networkConfigured: true,
			},
			current.privateKey,
		),
	}
}

async function preflightConnectivityUpdate(settings: OperatorSettings) {
	const connectivity = settings.connectivity
	if (connectivity === undefined) throw new Error('RPC connectivity is required')
	const primaryCheck = await checkRpcEndpoint(connectivity.readRpcUrl, settings.network.chainId, 'read-rpc')
	if (primaryCheck.status === 'failed') throw new EndpointCheckFailure(primaryCheck.error ?? 'Primary read RPC check failed', [primaryCheck])
	const submissionChecks = await checkPublicTransactionSubmissionEndpoints(connectivity.publicRpcUrls, settings.network.chainId)
	const failedSubmissionChecks = submissionChecks.filter(check => check.status === 'failed')
	if (failedSubmissionChecks.length !== 0) {
		throw new EndpointCheckFailure(failedSubmissionChecks.map(check => (check.error?.includes(check.target) ? check.error : `${check.target}: ${check.error ?? 'public transaction endpoint check failed'}`)).join('; '), [primaryCheck, ...submissionChecks])
	}
	const quorumChecks = await Promise.all(connectivity.quorumRpcUrls.map(url => checkRpcEndpoint(url, settings.network.chainId, 'read-rpc')))
	const failed = quorumChecks.filter(check => check.status === 'failed')
	if (failed.length !== 0) {
		throw new EndpointCheckFailure(failed.map(check => (check.error?.includes(check.target) ? check.error : `${check.target}: ${check.error ?? 'endpoint check failed'}`)).join('; '), [primaryCheck, ...submissionChecks, ...quorumChecks])
	}
	if (1 + quorumChecks.length < connectivity.rpcQuorum) throw new Error(`RPC quorum ${connectivity.rpcQuorum.toString()} requires at least ${connectivity.rpcQuorum.toString()} healthy read endpoints`)
	return [primaryCheck, ...submissionChecks, ...quorumChecks]
}

export function pausedCandidate(current: OperatorSettings, value: unknown) {
	const body = record(value, 'Pause update')
	exactKeys(body, ['paused', 'revision'], 'Pause update')
	return {
		revision: body['revision'],
		settings: parseSettings({ ...serializedSettings(current), paused: body['paused'] }, current.privateKey),
	}
}

export function signerCandidateSettings(current: OperatorSettings, value: unknown) {
	const body = record(value, 'Signer update')
	exactKeys(body, ['privateKey', 'remember', 'revision'], 'Signer update')
	if (typeof body['remember'] !== 'boolean') throw new Error('Signer remember must be a boolean')
	const privateKey = body['privateKey']
	if (privateKey !== null && (typeof privateKey !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(privateKey))) {
		throw new Error('Private key must be null or a 32-byte 0x-prefixed value')
	}
	const serialized = serializedSettings(current)
	return {
		rememberSigner: privateKey === null ? false : body['remember'],
		revision: body['revision'],
		settings: parseSettings(
			{
				...serialized,
				paused: privateKey === null ? true : serialized.paused,
				privateKey,
				runtime: {
					...serialized.runtime,
					execute: privateKey === null ? false : serialized.runtime.execute,
				},
			},
			undefined,
		),
	}
}

export function restartSafeSettings(settings: OperatorSettings, rememberSigner: boolean) {
	if (rememberSigner || settings.privateKey === undefined) return settings
	return {
		...settings,
		paused: true,
		privateKey: undefined,
		runtime: { ...settings.runtime, execute: false },
	}
}

function signerAddress(settings: OperatorSettings): Address | undefined {
	return settings.privateKey === undefined ? undefined : privateKeyToAccount(settings.privateKey).address
}

function assertLiveExecutionReadiness(state: RuntimeState, settings: OperatorSettings) {
	const address = signerAddress(settings)
	if (address === undefined) throw new Error('Live execution requires a configured transaction signer')
	const signerMatches = state.signerAddress?.toLowerCase() === address.toLowerCase() && state.wallet?.toLowerCase() === address.toLowerCase()
	const topology = state.topology
	if (!signerMatches || state.lastScanAt === undefined || state.lastScannedBlock === undefined || topology?.complete !== true || topology.anchor.blockNumber !== state.lastScannedBlock) {
		throw new Error('Live execution requires a fresh, complete canonical scan for the configured signer')
	}
	const blocker = liveInventoryReadinessBlockers(state.inventory, topology.universes, settings.strategy)[0]
	if (blocker !== undefined) throw new Error(blocker)
}

export function assertSignerCompatibleWithPending(pendingSender: Address | undefined, address: Address | undefined) {
	if (pendingSender !== undefined && (address === undefined || address.toLowerCase() !== pendingSender.toLowerCase())) {
		throw new Error('The signer cannot be cleared or replaced while a transaction intent is pending recovery')
	}
}

export function assertSignerCompatibleWithDurableScope(recordedAddress: Address | undefined, configuredAddress: Address | undefined) {
	if (recordedAddress !== undefined && configuredAddress !== undefined && recordedAddress.toLowerCase() !== configuredAddress.toLowerCase()) {
		throw new Error(`This durable state file is scoped to signer ${recordedAddress}; configure a distinct state file before using ${configuredAddress}`)
	}
}

export function assertSettingsUpdatePaused(current: OperatorSettings, runtimePaused: boolean) {
	if (!current.paused || !runtimePaused) {
		throw new Error('Pause both the persisted configuration and running chaos bot before changing execution policy')
	}
}

function groupedOperationEvaluations(state: RuntimeState, enabled: ReadonlySet<string>) {
	const rows = new Map<
		string,
		{
			blockers: string[]
			candidateCount: number
			classification: (typeof state.evaluations)[number]['definition']['classification']
			description: string
			ecosystem: (typeof state.evaluations)[number]['definition']['ecosystem']
			eligible: boolean
			enabled: boolean
			id: string
			independentlyExecutable: boolean
			label: string
			prerequisites: string[]
			risk: (typeof state.evaluations)[number]['definition']['risk']
		}
	>()
	for (const evaluation of state.evaluations) {
		const id = evaluation.definition.id
		const existing = rows.get(id)
		if (existing === undefined) {
			rows.set(id, {
				blockers: [...new Set(evaluation.eligibility.blockers)],
				candidateCount: evaluation.plan === undefined ? 0 : 1,
				classification: evaluation.definition.classification,
				description: evaluation.definition.description,
				ecosystem: evaluation.definition.ecosystem,
				eligible: evaluation.eligibility.eligible,
				enabled: enabled.has(evaluation.definition.ecosystem),
				id,
				independentlyExecutable: evaluation.definition.independentlyExecutable ?? (evaluation.definition.classification === 'selectable' || evaluation.definition.classification === 'lifecycle-obligation'),
				label: evaluation.definition.label,
				prerequisites: [...new Set(evaluation.definition.discoveryInputs)],
				risk: evaluation.definition.risk,
			})
			continue
		}
		existing.candidateCount += evaluation.plan === undefined ? 0 : 1
		existing.eligible ||= evaluation.eligibility.eligible
		existing.blockers = [...new Set([...existing.blockers, ...evaluation.eligibility.blockers])]
		existing.prerequisites = [...new Set([...existing.prerequisites, ...evaluation.definition.discoveryInputs])]
	}
	return [...rows.values()]
}

function dashboardState(state: RuntimeState, configuration: ConfigurationState) {
	const currentWorkflow = state.workflows.find(workflow => workflow.status === 'running' || workflow.status === 'waiting-continuation' || workflow.status === 'waiting-obligation' || workflow.status === 'waiting-transaction')
	const enabled = new Set(configuration.settings.strategy.enabledEcosystems)
	const lifecyclePresenceAlert = state.lifecyclePresenceBlocker === undefined ? undefined : lifecyclePresenceBlockerMessage(state.lifecyclePresenceBlocker)
	return {
		...state,
		alerts: [
			...(state.error === undefined ? [] : [{ message: state.error, severity: 'error' }]),
			...(lifecyclePresenceAlert === undefined || lifecyclePresenceAlert === state.error ? [] : [{ message: lifecyclePresenceAlert, severity: 'error' }]),
			...(state.safetyPaused
				? [
						{
							message: 'Safety pause is latched; review the failure activity and current recovery state before explicitly resuming execution',
							severity: 'error',
						},
					]
				: []),
			...(state.obligationTombstones.length >= MAXIMUM_OBLIGATION_TOMBSTONE_COUNT * 0.8
				? [
						{
							message: `Lifecycle tombstone journal is at ${state.obligationTombstones.length.toString()} of ${MAXIMUM_OBLIGATION_TOMBSTONE_COUNT.toString()} entries; complete canonical scans so retired identities can be pruned`,
							severity: 'warning',
						},
					]
				: []),
			...state.warnings.map(message => ({ message, severity: 'warning' })),
		],
		currentWorkflow,
		execute: configuration.settings.runtime.execute,
		inventoryAvailable: state.lastScanAt !== undefined,
		network: configuration.settings.network.name,
		obligations: state.obligations.filter(obligation => obligation.status !== 'abandoned' && obligation.status !== 'completed').map(obligation => ({ ...obligation, automaticRetryLimit: MAXIMUM_AUTOMATIC_LIFECYCLE_ATTEMPTS })),
		operationEvaluations: groupedOperationEvaluations(state, enabled),
		scheduler: {
			...state.scheduler,
			due: schedulerIsDue(state.scheduler.status === 'due' ? { ...state.scheduler, status: 'scheduled' } : state.scheduler),
		},
		signerReady: configuration.settings.privateKey !== undefined,
		topology:
			state.topology === undefined
				? undefined
				: {
						...state.topology,
						auctions: state.topology.auctions.map(auction => ({ ...auction })),
						pairs: state.topology.pairs.map(pair => ({ ...pair })),
						pools: state.topology.pools.map(pool => ({ ...pool })),
						reports: state.topology.reports.map(report => ({ ...report })),
						universes: state.topology.universes.map(universe => ({ ...universe })),
					},
	}
}

export class SignerOperationBusy extends Error {
	constructor() {
		super('The operator is completing a transaction boundary; retry the configuration request')
		this.name = 'SignerOperationBusy'
	}
}

export class ConfigurationCommitIndeterminate extends Error {
	constructor(cause: unknown) {
		super('The configuration commit outcome is indeterminate. Treat the requested configuration as committed. Execution is safety-paused in this process; inspect and reload the owner configuration and runtime-state files before retry or restart.', { cause })
		this.name = CONFIGURATION_COMMIT_INDETERMINATE
	}
}

export class ConfigurationCommittedSafelyPaused extends Error {
	constructor(stage: string, cause: unknown) {
		super(`The configuration was committed, but ${stage} failed. The bot remains durably safety-paused; reload the committed configuration and explicitly resume after recovery.`, { cause })
		this.name = CONFIGURATION_COMMITTED_SAFELY_PAUSED
	}
}

function acquireConfigurationGate(gate: SignerOperationGate) {
	if (!gate.acquire('configuration')) throw new SignerOperationBusy()
}

function runtimeStateCandidate(state: RuntimeState): RuntimeState {
	return {
		...state,
		activities: [...state.activities],
		scheduler: { ...state.scheduler },
		topology:
			state.topology === undefined
				? undefined
				: {
						...state.topology,
						auctions: state.topology.auctions.map(auction => ({ ...auction })),
						pairs: state.topology.pairs.map(pair => ({ ...pair })),
						pools: state.topology.pools.map(pool => ({ ...pool })),
						reports: state.topology.reports.map(report => ({ ...report })),
						universes: state.topology.universes.map(universe => ({ ...universe })),
					},
	}
}

function latchSafetyPause(state: RuntimeState) {
	state.paused = true
	state.safetyPaused = true
	state.scheduler.status = 'paused'
	state.status = 'paused'
}

function safelyPausedSettings(settings: OperatorSettings): OperatorSettings {
	return {
		...settings,
		paused: true,
		runtime: { ...settings.runtime, execute: false },
	}
}

function safetyFailureCheckpoint(checkpoint: RuntimeState, message: string) {
	const failed = runtimeStateCandidate(checkpoint)
	failed.error = message
	recordActivity(failed, {
		message,
		status: 'failed',
		type: 'error',
	})
	return failed
}

function applyRuntimeSettings(state: RuntimeState, settings: OperatorSettings, address: Address | undefined) {
	if (address !== undefined) bindRuntimeStateToSigner(state, address)
	state.paused = settings.paused || state.safetyPaused
	state.wallet = address ?? state.signerAddress
	if (state.paused) state.status = 'paused'
	else state.status = settings.runtime.execute ? 'running' : 'dry-run'
}

function commitRuntimeState(target: RuntimeState, candidate: RuntimeState) {
	Object.assign(target, candidate)
}

function dashboardConfiguration(configuration: ConfigurationState) {
	return {
		hasSigner: configuration.settings.privateKey !== undefined,
		rememberSigner: configuration.rememberSigner,
		revision: configuration.revision,
		settings: serializedSettings(configuration.settings, true),
		wallet: signerAddress(configuration.settings),
	}
}

export function createChaosDashboardController(options: DashboardControllerOptions): ChaosDashboardController {
	const persistRuntimeState = options.saveState ?? saveDurableState
	const persistConfiguration = options.saveConfiguration ?? saveSettings
	const apply = async (candidate: OperatorSettings, revision: unknown, rememberSigner = options.configuration.rememberSigner, mutateRuntimeState: (state: RuntimeState, baseline: RuntimeState) => void = () => undefined) => {
		expectedRevision(revision, options.configuration.revision)
		const address = signerAddress(candidate)
		const pendingSender = options.state.pendingTransactions[0]?.sender
		assertSignerCompatibleWithPending(pendingSender, address)
		assertSignerCompatibleWithDurableScope(options.state.signerAddress, address)
		const nextLock = await options.locks.acquireSigner(address)
		const baselineState = runtimeStateCandidate(options.state)
		const safetyCheckpoint = runtimeStateCandidate(baselineState)
		latchSafetyPause(safetyCheckpoint)
		recordActivity(safetyCheckpoint, {
			message: 'Configuration mutation entered a durable safety checkpoint pending owner-file and signer-lock commit',
			status: 'info',
			type: 'configuration',
		})
		try {
			await persistRuntimeState(options.configuration.settings.runtime.stateFile, safetyCheckpoint)
		} catch (error) {
			try {
				await options.locks.discardSigner(address, nextLock)
			} catch (cleanupError) {
				throw new AggregateError([error, cleanupError], 'Failed to persist the configuration safety checkpoint and release its prepared signer lock')
			}
			throw error
		}
		commitRuntimeState(options.state, safetyCheckpoint)
		const persistedSettings = restartSafeSettings(candidate, rememberSigner)
		let savedRevision: string
		try {
			savedRevision = await persistConfiguration(options.configuration.path, persistedSettings, options.configuration.revision)
		} catch (error) {
			let failure = error
			try {
				await options.locks.discardSigner(address, nextLock)
			} catch (cleanupError) {
				failure = new AggregateError([error, cleanupError], 'Configuration save and prepared signer-lock cleanup both failed')
			}
			const failedState = safetyFailureCheckpoint(safetyCheckpoint, 'Configuration owner-file save outcome is indeterminate; treat the requested configuration as committed and inspect both durable files before retry')
			try {
				await persistRuntimeState(candidate.runtime.stateFile, failedState)
			} catch (stateError) {
				failure = new AggregateError([failure, stateError], 'Configuration save and its durable failure-audit update both failed')
			}
			commitRuntimeState(options.state, failedState)
			throw new ConfigurationCommitIndeterminate(failure)
		}
		options.configuration.rememberSigner = rememberSigner
		options.configuration.revision = savedRevision
		options.configuration.settings = persistedSettings
		try {
			await options.locks.commitSigner(address, nextLock)
		} catch (error) {
			const failedState = safetyFailureCheckpoint(safetyCheckpoint, 'Configuration owner file committed, but signer-lock activation failed; the bot remains safety-paused')
			let failure = error
			try {
				await persistRuntimeState(candidate.runtime.stateFile, failedState)
			} catch (stateError) {
				failure = new AggregateError([error, stateError], 'Signer-lock commit and its durable failure-audit update both failed')
			}
			commitRuntimeState(options.state, failedState)
			throw new ConfigurationCommittedSafelyPaused('signer-lock commit', failure)
		}
		const committedState = runtimeStateCandidate(baselineState)
		applyRuntimeSettings(committedState, candidate, address)
		mutateRuntimeState(committedState, baselineState)
		try {
			await persistRuntimeState(candidate.runtime.stateFile, committedState)
		} catch (error) {
			const failedState = safetyFailureCheckpoint(safetyCheckpoint, 'Configuration owner file and signer lock committed, but runtime activation failed; the bot remains safety-paused')
			try {
				await persistRuntimeState(candidate.runtime.stateFile, failedState)
			} catch (stateCompensationError) {
				const safeOwnerSettings = safelyPausedSettings(persistedSettings)
				try {
					const safeRevision = await persistConfiguration(options.configuration.path, safeOwnerSettings, savedRevision)
					options.configuration.revision = safeRevision
					options.configuration.settings = safeOwnerSettings
				} catch (configurationCompensationError) {
					commitRuntimeState(options.state, failedState)
					throw new ConfigurationCommitIndeterminate(new AggregateError([error, stateCompensationError, configurationCompensationError], 'Final runtime-state commit and both durable safety compensations failed'))
				}
			}
			commitRuntimeState(options.state, failedState)
			throw new ConfigurationCommittedSafelyPaused('final runtime-state and audit commit', error)
		}
		options.configuration.settings = candidate
		commitRuntimeState(options.state, committedState)
		return candidate
	}
	const update = async <T>(operation: () => Promise<T>) => {
		acquireConfigurationGate(options.gate)
		try {
			return await operation()
		} finally {
			options.gate.release('configuration')
		}
	}

	return {
		getConfiguration: () => dashboardConfiguration(options.configuration),
		getState: () => dashboardState(options.state, options.configuration),
		hostname: options.hostname,
		...(options.loopbackPublished === undefined ? {} : { loopbackPublished: options.loopbackPublished }),
		async setCancellation(value) {
			await update(async () => {
				if (!options.configuration.settings.paused || !options.state.paused) {
					throw new Error('Pause the chaos bot before queuing nonce cancellation verification')
				}
				const body = record(value, 'Nonce cancellation reconciliation')
				exactKeys(body, ['cancellationHash', 'confirmation', 'intentHash', 'reason'], 'Nonce cancellation reconciliation')
				if (body['confirmation'] !== 'VERIFY NONCE CANCELLATION') {
					throw new Error('Type VERIFY NONCE CANCELLATION to confirm this action')
				}
				const reason = body['reason']
				if (typeof reason !== 'string' || reason.trim().length < 12 || reason.trim().length > 2_048) {
					throw new Error('Nonce cancellation reconciliation requires a 12 to 2048 character reason')
				}
				const intentHash = transactionHash(body['intentHash'], 'Cancellation intent hash')
				const cancellationHash = transactionHash(body['cancellationHash'], 'Nonce cancellation transaction hash')
				const intent = options.state.pendingTransactions.find(candidate => candidate.hash.toLowerCase() === intentHash.toLowerCase())
				if (intent === undefined) {
					throw new Error('The pending intent changed; refresh before queuing reconciliation')
				}
				if (intent.hash.toLowerCase() === cancellationHash.toLowerCase()) {
					throw new Error('Nonce cancellation hash must differ from the original intent hash')
				}
				if (intent.replacementHash !== undefined) {
					throw new Error('Exact replacement verification is already queued for this intent')
				}
				if (intent.cancellationHash !== undefined) {
					if (intent.cancellationHash.toLowerCase() !== cancellationHash.toLowerCase()) {
						throw new Error('A different nonce cancellation hash is already queued for this intent')
					}
					return
				}
				const candidateState: RuntimeState = {
					...options.state,
					activities: [...options.state.activities],
					obligations: [...options.state.obligations],
					pendingTransactions: options.state.pendingTransactions.map(candidate => (candidate.id === intent.id ? { ...candidate, cancellationHash } : candidate)),
					workflows: [...options.state.workflows],
				}
				recordActivity(candidateState, {
					details: reason.trim(),
					hash: cancellationHash,
					message: `Queued strict nonce cancellation verification for ${intent.label}`,
					operationId: intent.operationId,
					status: 'pending',
					type: 'recovery',
				})
				await persistRuntimeState(options.configuration.settings.runtime.stateFile, candidateState)
				options.state.activities.splice(0, options.state.activities.length, ...candidateState.activities)
				options.state.pendingTransactions.splice(0, options.state.pendingTransactions.length, ...candidateState.pendingTransactions)
			})
		},
		async setCandidate(value) {
			await update(async () => {
				if (!options.configuration.settings.paused || !options.state.paused) {
					throw new Error('Pause the chaos bot before clearing a recovery candidate')
				}
				const body = record(value, 'Recovery candidate reconciliation')
				exactKeys(body, ['confirmation', 'expectedCandidateHash', 'intentHash', 'reason'], 'Recovery candidate reconciliation')
				if (body['confirmation'] !== 'CLEAR RECOVERY CANDIDATE') {
					throw new Error('Type CLEAR RECOVERY CANDIDATE to confirm this action')
				}
				const reason = body['reason']
				if (typeof reason !== 'string' || reason.trim().length < 12 || reason.trim().length > 2_048) {
					throw new Error('Recovery candidate reconciliation requires a 12 to 2048 character reason')
				}
				const intentHash = transactionHash(body['intentHash'], 'Recovery intent hash')
				const expectedCandidateHash = transactionHash(body['expectedCandidateHash'], 'Expected recovery candidate hash')
				const intent = options.state.pendingTransactions.find(candidate => candidate.hash.toLowerCase() === intentHash.toLowerCase())
				const currentCandidate = intent?.replacementHash ?? intent?.cancellationHash
				if (intent === undefined || currentCandidate?.toLowerCase() !== expectedCandidateHash.toLowerCase()) {
					throw new Error('The queued recovery candidate changed; refresh and review it again')
				}
				const candidateState: RuntimeState = {
					...options.state,
					activities: [...options.state.activities],
					obligations: [...options.state.obligations],
					pendingTransactions: options.state.pendingTransactions.map(candidate => {
						if (candidate.id !== intent.id) return candidate
						const cleared = { ...candidate }
						delete cleared.cancellationHash
						delete cleared.replacementHash
						return cleared
					}),
					workflows: [...options.state.workflows],
				}
				recordActivity(candidateState, {
					details: reason.trim(),
					hash: currentCandidate,
					message: `Cleared queued recovery candidate for ${intent.label}`,
					operationId: intent.operationId,
					status: 'skipped',
					type: 'recovery',
				})
				await persistRuntimeState(options.configuration.settings.runtime.stateFile, candidateState)
				options.state.activities.splice(0, options.state.activities.length, ...candidateState.activities)
				options.state.pendingTransactions.splice(0, options.state.pendingTransactions.length, ...candidateState.pendingTransactions)
			})
		},
		async setObligation(value) {
			await update(async () => {
				if (!options.configuration.settings.paused || !options.state.paused) {
					throw new Error('Pause the chaos bot before reconciling a lifecycle obligation')
				}
				const body = record(value, 'Lifecycle reconciliation')
				exactKeys(body, ['action', 'confirmation', 'obligationId', 'reason', 'updatedAt'], 'Lifecycle reconciliation')
				const action = body['action']
				if (action !== 'retry' && action !== 'abandon') {
					throw new Error('Lifecycle reconciliation action is invalid')
				}
				const obligationId = body['obligationId']
				const updatedAt = body['updatedAt']
				const reason = body['reason']
				const confirmation = body['confirmation']
				if (typeof obligationId !== 'string' || obligationId === '') {
					throw new Error('Lifecycle reconciliation requires an obligation ID')
				}
				if (typeof updatedAt !== 'string' || updatedAt === '') {
					throw new Error('Lifecycle reconciliation requires the current update timestamp')
				}
				if (typeof reason !== 'string' || reason.trim().length < 12) {
					throw new Error('Lifecycle reconciliation requires a detailed reason')
				}
				const expectedConfirmation = action === 'retry' ? 'RETRY VERIFIED SAFE FAILURE' : 'ABANDON OBLIGATION'
				if (confirmation !== expectedConfirmation) {
					throw new Error(`Type ${expectedConfirmation} to confirm this lifecycle action`)
				}
				const source = options.state.obligations.find(candidate => candidate.id === obligationId)
				if (source === undefined || source.updatedAt !== updatedAt) {
					throw new Error('The lifecycle obligation changed; refresh and review it again')
				}
				const candidateState: RuntimeState = {
					...options.state,
					activities: [...options.state.activities],
					obligationTombstones: options.state.obligationTombstones.map(tombstone => ({ ...tombstone })),
					obligations: options.state.obligations.map(obligation => ({
						...obligation,
						blockers: [...obligation.blockers],
						metadata: { ...obligation.metadata },
					})),
					pendingTransactions: [...options.state.pendingTransactions],
					workflows: options.state.workflows.map(workflow => ({
						...workflow,
						metadata: { ...workflow.metadata },
						steps: workflow.steps.map(step => ({
							...step,
							evidence: [...step.evidence],
							walletAssetDebits: [...step.walletAssetDebits],
						})),
					})),
				}
				const obligation = candidateState.obligations.find(candidate => candidate.id === obligationId)
				if (obligation === undefined) {
					throw new Error('Lifecycle obligation changed during reconciliation')
				}
				if (action === 'retry') {
					retryLifecycleObligation(candidateState, obligation)
				} else {
					abandonLifecycleObligation(candidateState, obligation, reason)
				}
				recordActivity(candidateState, {
					details: reason.trim(),
					ecosystem: obligation.ecosystem,
					message: action === 'retry' ? `Verified-safe lifecycle obligation queued for retry: ${obligation.label}` : `Lifecycle obligation explicitly abandoned: ${obligation.label}`,
					operationId: obligation.operationId,
					status: action === 'retry' ? 'pending' : 'skipped',
					type: 'recovery',
				})
				await persistRuntimeState(options.configuration.settings.runtime.stateFile, candidateState)
				options.state.activities.splice(0, options.state.activities.length, ...candidateState.activities)
				options.state.obligationTombstones.splice(0, options.state.obligationTombstones.length, ...candidateState.obligationTombstones)
				options.state.obligations.splice(0, options.state.obligations.length, ...candidateState.obligations)
				options.state.workflows.splice(0, options.state.workflows.length, ...candidateState.workflows)
			})
		},
		async setReplacement(value) {
			await update(async () => {
				if (!options.configuration.settings.paused || !options.state.paused) {
					throw new Error('Pause the chaos bot before queuing a replacement reconciliation')
				}
				const body = record(value, 'Replacement reconciliation')
				exactKeys(body, ['intentHash', 'replacementHash'], 'Replacement reconciliation')
				const intentHash = transactionHash(body['intentHash'], 'Replacement intent hash')
				const replacementHash = transactionHash(body['replacementHash'], 'Replacement transaction hash')
				const intent = options.state.pendingTransactions.find(candidate => candidate.hash.toLowerCase() === intentHash.toLowerCase())
				if (intent === undefined) {
					throw new Error('The pending intent changed; refresh before queuing reconciliation')
				}
				if (intent.hash.toLowerCase() === replacementHash.toLowerCase()) {
					throw new Error('Replacement transaction hash must differ from the original intent hash')
				}
				if (intent.cancellationHash !== undefined) {
					throw new Error('Nonce cancellation verification is already queued for this intent')
				}
				if (intent.replacementHash !== undefined) {
					if (intent.replacementHash.toLowerCase() !== replacementHash.toLowerCase()) {
						throw new Error('A different replacement hash is already queued for this intent')
					}
					return
				}
				const candidateState: RuntimeState = {
					...options.state,
					activities: [...options.state.activities],
					obligations: [...options.state.obligations],
					pendingTransactions: options.state.pendingTransactions.map(candidate => (candidate.id === intent.id ? { ...candidate, replacementHash } : candidate)),
					workflows: [...options.state.workflows],
				}
				recordActivity(candidateState, {
					hash: replacementHash,
					message: `Queued exact replacement verification for ${intent.label}`,
					operationId: intent.operationId,
					status: 'pending',
					type: 'recovery',
				})
				await persistRuntimeState(options.configuration.settings.runtime.stateFile, candidateState)
				options.state.activities.splice(0, options.state.activities.length, ...candidateState.activities)
				options.state.pendingTransactions.splice(0, options.state.pendingTransactions.length, ...candidateState.pendingTransactions)
			})
		},
		async setWorkflow(value) {
			await update(async () => {
				if (!options.configuration.settings.paused || !options.state.paused) {
					throw new Error('Pause the chaos bot before reconciling a partial workflow')
				}
				const body = record(value, 'Partial workflow reconciliation')
				exactKeys(body, ['action', 'confirmation', 'reason', 'updatedAt', 'workflowId'], 'Partial workflow reconciliation')
				if (body['action'] !== 'abandon') {
					throw new Error('Partial workflow reconciliation action is invalid')
				}
				if (body['confirmation'] !== 'ABANDON PARTIAL WORKFLOW') {
					throw new Error('Type ABANDON PARTIAL WORKFLOW to confirm this action')
				}
				const workflowId = body['workflowId']
				const updatedAt = body['updatedAt']
				const reason = body['reason']
				if (typeof workflowId !== 'string' || workflowId === '') {
					throw new Error('Partial workflow reconciliation requires a workflow ID')
				}
				if (typeof updatedAt !== 'string' || updatedAt === '') {
					throw new Error('Partial workflow reconciliation requires the current update timestamp')
				}
				if (typeof reason !== 'string' || reason.trim().length < 12 || reason.trim().length > 2_048) {
					throw new Error('Partial workflow reconciliation requires a 12 to 2048 character reason')
				}
				const source = options.state.workflows.find(workflow => workflow.id === workflowId)
				if (source === undefined || source.updatedAt !== updatedAt) {
					throw new Error('The partial workflow changed; refresh and review it again')
				}
				if (!workflowNeedsContinuation(source)) {
					throw new Error('Only a partial workflow awaiting continuation can be abandoned')
				}
				if (options.state.obligations.some(obligation => obligation.workflowId === source.id)) {
					throw new Error('Lifecycle workflows must use lifecycle obligation reconciliation')
				}
				if (options.state.pendingTransactions.some(intent => intent.workflowId === source.id)) {
					throw new Error('A workflow with a pending transaction cannot be abandoned')
				}
				const candidateState: RuntimeState = {
					...options.state,
					activities: [...options.state.activities],
					obligationTombstones: [...options.state.obligationTombstones],
					obligations: [...options.state.obligations],
					pendingTransactions: [...options.state.pendingTransactions],
					scheduler: { ...options.state.scheduler },
					workflows: options.state.workflows.map(workflow => ({
						...workflow,
						steps: workflow.steps.map(step => ({ ...step })),
					})),
				}
				const workflow = candidateState.workflows.find(candidate => candidate.id === source.id)
				if (workflow === undefined) {
					throw new Error('Partial workflow changed during reconciliation')
				}
				const timestamp = new Date().toISOString()
				const incomplete = workflow.steps.find(step => step.status !== 'confirmed')
				if (incomplete !== undefined) {
					incomplete.failure = reason.trim()
					incomplete.status = 'blocked'
				}
				workflow.completedAt = timestamp
				workflow.status = 'abandoned'
				workflow.updatedAt = timestamp
				candidateState.scheduler = scheduledStateAfterRun(candidateState.scheduler, options.configuration.settings.scheduler, Date.now(), workflow.operationId)
				candidateState.scheduler.status = 'paused'
				recordActivity(candidateState, {
					details: reason.trim(),
					ecosystem: workflow.ecosystem,
					message: `Partial workflow explicitly abandoned: ${workflow.label}`,
					operationId: workflow.operationId,
					status: 'skipped',
					type: 'recovery',
				})
				await persistRuntimeState(options.configuration.settings.runtime.stateFile, candidateState)
				options.state.activities.splice(0, options.state.activities.length, ...candidateState.activities)
				Object.assign(options.state.scheduler, candidateState.scheduler)
				options.state.workflows.splice(0, options.state.workflows.length, ...candidateState.workflows)
			})
		},
		async setPaused(value) {
			const candidate = pausedCandidate(options.configuration.settings, value)
			try {
				await update(async () => {
					expectedRevision(candidate.revision, options.configuration.revision)
					if (!candidate.settings.paused && candidate.settings.runtime.execute) assertLiveExecutionReadiness(options.state, candidate.settings)
					await apply(candidate.settings, candidate.revision, options.configuration.rememberSigner, (state, baseline) => {
						const priorSafetyPause = baseline.safetyPaused
						if (!candidate.settings.paused) {
							state.safetyPaused = false
							state.paused = false
							state.status = candidate.settings.runtime.execute ? 'running' : 'dry-run'
						}
						if (candidate.settings.paused) state.scheduler.status = 'paused'
						else if (schedulerIsDue({ ...state.scheduler, status: 'scheduled' })) state.scheduler.status = 'due'
						else state.scheduler.status = state.scheduler.nextRunAt === undefined ? 'idle' : 'scheduled'
						let message = 'Chaos bot resumed'
						if (candidate.settings.paused) message = 'Chaos bot paused'
						else if (priorSafetyPause) message = 'Safety pause acknowledged and chaos bot resumed'
						recordActivity(state, {
							message,
							status: 'info',
							type: 'configuration',
						})
					})
				})
			} catch (error) {
				if (error instanceof SignerOperationBusy && candidate.settings.paused) {
					const wasSafetyPaused = options.state.safetyPaused
					options.state.safetyPaused = true
					options.state.paused = true
					options.state.scheduler.status = 'paused'
					options.state.status = 'paused'
					if (!wasSafetyPaused) {
						recordActivity(options.state, {
							message: 'Pause requested during an active transaction boundary; the durable safety pause will remain latched until an explicit resume',
							status: 'info',
							type: 'configuration',
						})
					}
					await persistRuntimeState(options.configuration.settings.runtime.stateFile, options.state)
					return
				}
				throw error
			}
		},
		async setConnectivity(value) {
			await update(async () => {
				const candidate = connectivityCandidate(options.configuration.settings, value)
				expectedRevision(candidate.revision, options.configuration.revision)
				const checks = await (options.checkConnectivityUpdate ?? preflightConnectivityUpdate)(candidate.settings)
				await apply(candidate.settings, candidate.revision, options.configuration.rememberSigner, state => {
					state.rpcEndpointHealth = [...checks]
					recordActivity(state, {
						message: 'Chain and RPC configuration verified and saved',
						status: 'info',
						type: 'configuration',
					})
				})
				options.onConnectivityUpdated?.(candidate.settings, checks)
			})
		},
		async setSettings(value) {
			await update(async () => {
				const candidate = settingsPatchCandidate(options.configuration.settings, value)
				assertSettingsUpdatePaused(options.configuration.settings, options.state.paused)
				expectedRevision(candidate.revision, options.configuration.revision)
				if (!options.configuration.settings.runtime.execute && candidate.settings.runtime.execute) assertLiveExecutionReadiness(options.state, candidate.settings)
				await apply(candidate.settings, candidate.revision, options.configuration.rememberSigner, state => {
					recordActivity(state, {
						message: 'Execution policy updated',
						status: 'info',
						type: 'configuration',
					})
				})
			})
		},
		async setSigner(value) {
			const candidate = signerCandidateSettings(options.configuration.settings, value)
			try {
				await update(async () => {
					await apply(candidate.settings, candidate.revision, candidate.rememberSigner, (state, baseline) => {
						let message = 'Transaction signer updated'
						if (candidate.settings.privateKey === undefined) message = 'Transaction signer cleared'
						else if (baseline.protocolIndex !== undefined && state.protocolIndex === undefined) message = 'Transaction signer updated; wallet-scoped protocol index invalidated for canonical rebuild'
						recordActivity(state, {
							message,
							status: 'info',
							type: 'wallet',
						})
					})
				})
			} catch (error) {
				if (error instanceof SignerOperationBusy && candidate.settings.privateKey === undefined) {
					options.state.paused = true
					options.state.scheduler.status = 'paused'
					options.state.status = 'paused'
				}
				throw error
			}
		},
	}
}

export function isConfigurationRevisionConflict(error: unknown) {
	return error instanceof Error && error.name === CONFIGURATION_REVISION_CONFLICT
}
