import { privateKeyToAccount, type Address } from '@zoltar/bot-shared/ethereum'
import { checkPublicTransactionSubmissionEndpoints, checkRpcEndpoint, EndpointCheckFailure } from '@zoltar/bot-shared/monitoring/connectivity'
import { parseSettings, serializedSettings, type OperatorSettings } from '../config/settings.ts'
import { dashboardRecord as record, exactDashboardKeys as exactKeys } from './dashboard-input.ts'
import { liveInventoryReadinessBlockers } from './live-readiness.ts'
import type { RuntimeState } from '../state/operator-state.ts'

export function signerAddress(settings: OperatorSettings): Address | undefined {
	return settings.privateKey === undefined ? undefined : privateKeyToAccount(settings.privateKey).address
}

export function assertLiveExecutionReadiness(state: RuntimeState, settings: OperatorSettings) {
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

export async function preflightConnectivityUpdate(settings: OperatorSettings) {
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
