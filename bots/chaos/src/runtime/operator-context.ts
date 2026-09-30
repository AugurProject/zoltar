import type { BotEnvironment } from '@zoltar/bot-shared/config/environment'
import { privateKeyToAccount, type Address } from '@zoltar/bot-shared/ethereum'
import type { BotShutdownController } from '@zoltar/bot-shared/execution/bot-process-locks'
import type { SignerOperationGate } from '@zoltar/bot-shared/execution/signer-operation-gate'
import { errorMessage as formatErrorMessage } from '@zoltar/bot-shared/infrastructure/error-message'
import type { EndpointCheck } from '@zoltar/bot-shared/monitoring/connectivity'
import type { OperatorSettings } from '../config/settings.ts'
import type { CanonicalImmutableTopologyCache } from '../monitoring/topology-cache.ts'
import { saveDurableState, type RuntimeState } from '../state/operator-state.ts'
import { createChaosReadPool } from './canonical-scan.ts'
import type { ConfigurationState } from './dashboard-controller.ts'
import { preflightTransactionSubmissionNetwork, recordEndpointPreflightChecks, submissionPreflightConfigurationIdentity, type SubmissionPreflightResources } from './submission-preflight.ts'

export type RuntimeResources = SubmissionPreflightResources & {
	pool: ReturnType<typeof createChaosReadPool>
	readPreflightChecks: readonly EndpointCheck[]
}

/** Topology cache reused across scans while the state file and deployment profile stay unchanged. */
type TopologyCacheBinding = {
	cache: CanonicalImmutableTopologyCache | undefined
	profileId: string | undefined
	stateFile: string | undefined
}

/**
 * Mutable operator-process state shared by the startup, scan-loop, dashboard and shutdown phases.
 * `resources` is replaced whenever the dashboard updates connectivity, so phases read it through
 * `currentResources` instead of capturing it.
 */
export type OperatorState = {
	backfillIncomplete: boolean
	configuration: ConfigurationState
	consecutiveBackfillCycles: number
	resources: RuntimeResources | undefined
	runtime: RuntimeState
	topology: TopologyCacheBinding
}

export type OperatorDependencies = {
	/** The shared bot environment, read once at startup. */
	environment: BotEnvironment
	gate: SignerOperationGate
	shutdown: BotShutdownController
}

export const errorMessage = (error: unknown) => formatErrorMessage(error).slice(0, 1_500)

export function configuredWallet(settings: OperatorSettings): Address | undefined {
	return settings.privateKey === undefined ? undefined : privateKeyToAccount(settings.privateKey).address
}

export function assertDurableSignerScope(state: RuntimeState, wallet: Address | undefined, stateFile: string) {
	if (wallet !== undefined && state.signerAddress !== undefined && wallet.toLowerCase() !== state.signerAddress.toLowerCase()) {
		throw new Error(`Durable state ${stateFile} is scoped to signer ${state.signerAddress}; configure a distinct state file for signer ${wallet}`)
	}
}

export function currentStatus(settings: OperatorSettings) {
	if (settings.paused) return 'paused' as const
	return settings.runtime.execute ? ('running' as const) : ('dry-run' as const)
}

export async function persistState(configuration: ConfigurationState, state: RuntimeState) {
	await saveDurableState(configuration.settings.runtime.stateFile, state)
}

export async function ensureSubmissionPreflight(resources: RuntimeResources, settings: OperatorSettings) {
	const configurationIdentity = submissionPreflightConfigurationIdentity(settings)
	await recordEndpointPreflightChecks(
		async () => await preflightTransactionSubmissionNetwork(settings),
		checks => {
			resources.submissionPreflightConfigurationIdentity = configurationIdentity
			resources.submissionPreflightChecks = checks
		},
	)
}

export function resourceHealth(resources: RuntimeResources) {
	return [...resources.readPreflightChecks, ...resources.submissionPreflightChecks, ...resources.pool.snapshot()]
}

/** Refresh submission preflight evidence and publish the resulting endpoint health. */
export async function prepareSubmission(state: RuntimeState, resources: RuntimeResources, settings: OperatorSettings) {
	await ensureSubmissionPreflight(resources, settings)
	state.rpcEndpointHealth = resourceHealth(resources)
}

export function refreshEndpointHealth(operator: OperatorState) {
	if (operator.resources !== undefined) operator.runtime.rpcEndpointHealth = resourceHealth(operator.resources)
}

/** The live RPC resources; connectivity updates replace them but never clear them once configured. */
export function currentResources(operator: OperatorState, message = 'Configured network is missing its RPC endpoint pool') {
	if (operator.resources === undefined) throw new Error(message)
	return operator.resources
}

export function createRuntimeResources(settings: OperatorSettings, checks: readonly EndpointCheck[] = []): RuntimeResources {
	return {
		pool: createChaosReadPool(settings),
		readPreflightChecks: checks.filter(check => check.kind === 'read-rpc'),
		submissionPreflightConfigurationIdentity: undefined,
		submissionPreflightChecks: checks.filter(check => check.kind === 'public-rpc'),
	}
}
